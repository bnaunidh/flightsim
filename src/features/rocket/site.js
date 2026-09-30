/**
 * Where the launch pad goes, on whichever island is loaded.
 *
 * Every map is different and none of them was built with a spaceport in it,
 * so the site is found rather than placed: a flat bit of low ground near a
 * coast, with nothing standing on it, a second flat spot for the landing
 * pad behind it, and open sea in front — because the rocket is launched out
 * over the water (as real ones are), and the ship the booster lands on has
 * to float somewhere along that line.
 *
 * Pure: the page passes in the height field and a `blocked(x, z, r)` that
 * knows about buildings, runways, roads and helipads. The node test runs it
 * on every map with the height field alone, and the browser check with the
 * real `blocked`.
 *
 * Deterministic for a map, and cheap — about a hundred thousand height
 * samples, a few tens of milliseconds — so it is simply worked out again
 * each time a launch starts rather than cached against a map that might
 * have been rebuilt underneath it.
 */

/** The landing pad is this far behind the launch pad, along the flight line. */
export const LZ_BACK = 380;
/** Half the width of the launch pad's concrete, and the landing pad's radius. */
export const PAD_HALF = 24;
export const LZ_R = 30;
/** The ship's deck: half its length along the flight line, half its width. */
export const BARGE_HALF = 35;
export const BARGE_HALF_W = 23;
export const BARGE_DECK = 3;

const TAU = Math.PI * 2;

function flatness(heightAt, x, z, r) {
  let lo = Infinity;
  let hi = -Infinity;
  const c = heightAt(x, z);
  lo = hi = c;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU;
    const h = heightAt(x + Math.cos(a) * r, z + Math.sin(a) * r);
    if (h < lo) lo = h;
    if (h > hi) hi = h;
  }
  const h2 = heightAt(x + r * 0.5, z - r * 0.5);
  if (h2 < lo) lo = h2;
  if (h2 > hi) hi = h2;
  return { centre: c, spread: hi - lo, lo };
}

/**
 * @param {object} o
 * @param {(x:number,z:number)=>number} o.heightAt
 * @param {Array<{cx:number,cz:number,radius:number}>} o.islands
 * @param {(x:number,z:number,r:number)=>boolean} [o.blocked]
 * @returns {{found:boolean, pad:{x,z,y}, lz:{x,z,y}, az:{x,z}, lzS:number, bargeS:number, barge:{x,z}, coast:number}}
 */
export function findLaunchSite({ heightAt, islands, blocked = () => false }) {
  const isl = (islands || []).slice().sort((a, b) => b.radius - a.radius).slice(0, 5);
  if (!isl.length) isl.push({ cx: 0, cz: 0, radius: 2000 });

  // 1. Flat, low, unbuilt-on ground.
  const cands = [];
  for (const I of isl) {
    const rings = [0.28, 0.42, 0.55, 0.67, 0.78, 0.88];
    for (const f of rings) {
      const n = Math.max(24, Math.round((TAU * I.radius * f) / 180));
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU + f * 1.7;
        const x = I.cx + Math.cos(a) * I.radius * f;
        const z = I.cz + Math.sin(a) * I.radius * f;
        const fl = flatness(heightAt, x, z, PAD_HALF + 4);
        if (fl.lo < 2 || fl.centre > 45 || fl.spread > 2.6) continue;
        cands.push({ x, z, h: fl.centre, spread: fl.spread });
      }
    }
  }
  cands.sort((a, b) => a.spread - b.spread || a.h - b.h);

  // 2. For the flattest, which way is the sea, and is there room for the
  //    landing pad behind and the ship in front?
  let best = null;
  let tried = 0;
  for (const c of cands) {
    if (tried >= 60) break;
    if (blocked(c.x, c.z, PAD_HALF + 22)) continue;
    tried++;
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * TAU;
      const ax = Math.cos(a);
      const az = Math.sin(a);
      // The landing pad, behind.
      const lx = c.x - ax * LZ_BACK;
      const lzz = c.z - az * LZ_BACK;
      const lf = flatness(heightAt, lx, lzz, LZ_R + 4);
      if (lf.lo < 1.5 || lf.spread > 2.8 || Math.abs(lf.centre - c.h) > 30) continue;
      // Clear ground all the way between them (no hill, no lake).
      let between = true;
      for (let s = 40; s < LZ_BACK; s += 40) {
        const h = heightAt(c.x - ax * s, c.z - az * s);
        if (h < 0.5 || h > Math.max(c.h, lf.centre) + 25) { between = false; break; }
      }
      if (!between) continue;
      // The coast, in front.
      let coast = null;
      for (let s = 60; s <= 6000; s += 60) {
        const h = heightAt(c.x + ax * s, c.z + az * s);
        if (h > c.h + 120) break; // a hill in the way of the climb out
        if (h < -3) { coast = s; break; }
      }
      if (coast === null) continue;
      // The ship: open, deep water along the line, clear to either side.
      let bargeS = null;
      for (let s = Math.max(6500, coast + 3500); s <= 15000; s += 500) {
        const bx = c.x + ax * s;
        const bz = c.z + az * s;
        let ok = true;
        for (const [du, dv] of [[0, 0], [-260, 0], [260, 0], [0, -160], [0, 160], [-520, 0], [520, 0]]) {
          const h = heightAt(bx + ax * du - az * dv, bz + az * du + ax * dv);
          if (h > -6) { ok = false; break; }
        }
        if (ok) { bargeS = s; break; }
      }
      if (bargeS === null) continue;
      if (blocked(lx, lzz, LZ_R + 10)) continue;
      const eastish = (1 - ax) * 160;
      const score = coast + Math.abs(c.h - 8) * 18 + c.spread * 120 + lf.spread * 80 + eastish + (bargeS - 6500) * 0.05;
      if (!best || score < best.score) {
        best = { score, c, ax, az, lx, lzz, lh: lf.centre, coast, bargeS };
      }
    }
  }

  if (!best) return fallbackSite({ heightAt, isl });
  const { c, ax, az } = best;
  return {
    found: true,
    pad: { x: c.x, z: c.z, y: c.h },
    lz: { x: best.lx, z: best.lzz, y: best.lh },
    az: { x: ax, z: az },
    lzS: -LZ_BACK,
    bargeS: best.bargeS,
    barge: { x: c.x + ax * best.bargeS, z: c.z + az * best.bargeS },
    coast: best.coast,
  };
}

/**
 * Nowhere on this map would do: build it offshore instead — a concrete
 * platform in the sea off the biggest island, the landing pad on a second
 * one behind it. Launch platforms at sea are real, and a pad that exists
 * beats a pad that is not there.
 */
function fallbackSite({ heightAt, isl }) {
  const I = isl[0];
  for (let r = I.radius + 900; r < I.radius + 5000; r += 400) {
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * TAU;
      const x = I.cx + Math.cos(a) * r;
      const z = I.cz + Math.sin(a) * r;
      const ax = Math.cos(a);
      const az = Math.sin(a);
      if (heightAt(x, z) > -4 || heightAt(x - ax * LZ_BACK, z - az * LZ_BACK) > -4) continue;
      const bargeS = 8000;
      if (heightAt(x + ax * bargeS, z + az * bargeS) > -6) continue;
      return {
        found: false,
        offshore: true,
        pad: { x, z, y: 6 },
        lz: { x: x - ax * LZ_BACK, z: z - az * LZ_BACK, y: 6 },
        az: { x: ax, z: az },
        lzS: -LZ_BACK,
        bargeS,
        barge: { x: x + ax * bargeS, z: z + az * bargeS },
        coast: 0,
      };
    }
  }
  return {
    found: false,
    offshore: true,
    pad: { x: I.cx + I.radius + 1500, z: I.cz, y: 6 },
    lz: { x: I.cx + I.radius + 1500 - LZ_BACK, z: I.cz, y: 6 },
    az: { x: 1, z: 0 },
    lzS: -LZ_BACK,
    bargeS: 8000,
    barge: { x: I.cx + I.radius + 9500, z: I.cz },
    coast: 0,
  };
}

/**
 * What is under a point on the flight line: the pads and the ship where
 * they are, the island's own ground, or the sea. `s` is metres from the
 * launch pad along the launch direction (negative is behind it).
 */
export function surfaceFor(site, heightAt) {
  const padTop = site.pad.y + 1.2;
  const lzTop = site.lz.y + 0.5;
  return (s) => {
    if (Math.abs(s) < PAD_HALF) return { y: padTop, kind: 'pad' };
    if (Math.abs(s - site.lzS) < LZ_R) return { y: lzTop, kind: 'lz' };
    if (Math.abs(s - site.bargeS) < BARGE_HALF) return { y: BARGE_DECK, kind: 'barge' };
    if (site.offshore) return { y: 0, kind: 'sea' };
    const h = heightAt(site.pad.x + site.az.x * s, site.pad.z + site.az.z * s);
    if (h <= 0.3) return { y: 0, kind: 'sea' };
    return { y: h, kind: 'land' };
  };
}
