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
/**
 * How high the launch deck stands above the ground at the pad's middle:
 * a raised hardstand, so there is room under the rocket for the flame
 * trench. The rocket's feet (and the physics' padY) are at pad.y + PAD_TOP.
 */
export const PAD_TOP = 4;
/** The fence round the launch complex: a square this far out from the pad. */
export const FENCE_HALF = 92;

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
  const padTop = site.pad.y + PAD_TOP;
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

/* ------------------------------------------------------------------ */
/* The spaceport round the pad                                         */
/* ------------------------------------------------------------------ */

/**
 * Pad-local coordinates → world. `u` is metres along the launch direction
 * (towards the sea), `v` metres to its left — the side the camera watches
 * from — so (0, 0) is the middle of the launch pad.
 */
export function padToWorld(site, u, v) {
  return { x: site.pad.x + site.az.x * u - site.az.z * v, z: site.pad.z + site.az.z * u + site.az.x * v };
}

export function worldToPad(site, x, z) {
  const dx = x - site.pad.x;
  const dz = z - site.pad.z;
  return { u: dx * site.az.x + dz * site.az.z, v: -dx * site.az.z + dz * site.az.x };
}

/** The lowest and highest ground under a pad-aligned rectangle. */
export function groundUnder(site, heightAt, u, v, hu, hv, n = 4) {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= n; j++) {
      const p = padToWorld(site, u + hu * ((2 * i) / n - 1), v + hv * ((2 * j) / n - 1));
      const h = heightAt(p.x, p.z);
      if (h < lo) lo = h;
      if (h > hi) hi = h;
    }
  }
  return { lo, hi };
}

/*
 * What goes where, as pad-local spots to try in order — the first that is
 * dry, flat enough and not on anything already there wins, and if none is,
 * that piece is left out rather than built floating or half buried.
 *
 * The pad complex sits mostly BEHIND the rocket as the camera sees it (−v),
 * so the water tower, the tank farm and the lightning masts are the backdrop
 * of the launch, and the trench throws its steam out towards the sea (+u).
 */
const PAD_ITEMS = [
  { id: 'water', hu: 7, hv: 7, spread: 4, spots: [[30, -54], [-30, -60], [30, 54]] },
  { id: 'lox', hu: 9, hv: 9, spread: 4, spots: [[-46, -56], [-50, 52], [52, -64]] },
  { id: 'fuel', hu: 10, hv: 8, spread: 4, spots: [[64, -40], [-66, -30], [64, 40]] },
  { id: 'mast1', hu: 2, hv: 2, spread: 6, spots: [[-40, -40], [-40, 40]] },
  { id: 'mast2', hu: 2, hv: 2, spread: 6, spots: [[40, -38], [40, 40]] },
  { id: 'shed', hu: 8, hv: 5, spread: 3, spots: [[-62, 34], [-62, -78], [10, 70]] },
  { id: 'light1', hu: 1.5, hv: 1.5, spread: 6, spots: [[-44, 34]] },
  { id: 'light2', hu: 1.5, hv: 1.5, spread: 6, spots: [[44, 34]] },
  { id: 'light3', hu: 1.5, hv: 1.5, spread: 6, spots: [[-52, -22], [-52, 22]] },
  { id: 'light4', hu: 1.5, hv: 1.5, spread: 6, spots: [[46, -18]] },
  { id: 'sign', hu: 9, hv: 1.5, spread: 4, spots: [[-36, 46], [-36, -46]] },
];

/** The hangar the rockets are put together in, and the building they are flown from. */
const VAB = { id: 'vab', hu: 30, hv: 24, spread: 8 };
const LCC = { id: 'lcc', hu: 18, hv: 11, spread: 5 };

function overlaps(a, b, gap) {
  return Math.abs(a.u - b.u) < a.hu + b.hu + gap && Math.abs(a.v - b.v) < a.hv + b.hv + gap;
}

/**
 * Lay out the launch complex for a site: every structure on dry ground, on
 * a foundation that goes down below the lowest ground under it and up to
 * the highest, so nothing floats and nothing is half buried; nothing on a
 * runway, a road or a building (`blocked`); nothing on the flight line
 * between the pad and the landing pad, where the booster comes home.
 *
 * Pure numbers, so the node test can lay it out on every map. An offshore
 * pad gets no buildings ashore: it is a platform at sea.
 *
 * @returns {{offshore:boolean, pad:{lo,hi}, items:Array<{id,u,v,hu,hv,lo,hi,x,z}>,
 *   path:Array<{u,v}>|null, gate:{u,v0,v1}|null, fence:{half}|null,
 *   zones:Array<{u,v,hu,hv}>}}
 */
export function planSpaceport(site, heightAt, blocked = () => false) {
  const pad = groundUnder(site, heightAt, 0, 0, PAD_HALF + 8, PAD_HALF + 8);
  const out = { offshore: !!site.offshore, pad, items: [], path: null, gate: null, fence: null, zones: [] };
  if (site.offshore) return out;
  const placed = [{ id: 'pad', u: 0, v: 0, hu: PAD_HALF + 8, hv: PAD_HALF + 8 }, { id: 'lz', u: site.lzS, v: 0, hu: LZ_R + 14, hv: LZ_R + 14 }];
  const tryPlace = (spec, spots, extra = () => true) => {
    for (const [u, v] of spots) {
      const it = { id: spec.id, u, v, hu: spec.hu, hv: spec.hv };
      if (placed.some((p) => overlaps(it, p, 4))) continue;
      const g = groundUnder(site, heightAt, u, v, spec.hu, spec.hv);
      if (g.lo < 1 || g.hi - g.lo > spec.spread) continue;
      const w = padToWorld(site, u, v);
      if (blocked(w.x, w.z, Math.hypot(spec.hu, spec.hv) + 4)) continue;
      if (!extra(it)) continue;
      Object.assign(it, g, w);
      placed.push(it);
      out.items.push(it);
      return it;
    }
    return null;
  };

  // The hangar: off to one side, clear of the fence and the flight line.
  const vabSpots = [];
  for (const u of [-200, -150, -250, -120, -300]) for (const v of [-120, 120, -150, 150]) vabSpots.push([u, v]);
  const offLine = (it) => Math.abs(it.v) >= it.hv + 30 && (Math.abs(it.u) > FENCE_HALF + it.hu + 6 || Math.abs(it.v) > FENCE_HALF + it.hv + 6);
  const vab = tryPlace(VAB, vabSpots, offLine);
  if (vab) {
    // The crawler road: out of the hangar's door, a straight run, then a
    // long diagonal up to the ramp on the back of the pad.
    const door = { u: vab.u + vab.hu, v: vab.v };
    const pts = [door, { u: door.u + 26, v: door.v }, { u: -PAD_HALF - 40, v: 0 }, { u: -PAD_HALF - 22, v: 0 }];
    let ok = pts[1].u < pts[2].u - 10;
    for (let i = 1; ok && i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const len = Math.hypot(b.u - a.u, b.v - a.v);
      for (let s = 0; ok && s <= len; s += 8) {
        const u = a.u + ((b.u - a.u) * s) / len;
        const v = a.v + ((b.v - a.v) * s) / len;
        const w = padToWorld(site, u, v);
        if (heightAt(w.x, w.z) < 0.8 || (u < -PAD_HALF - 30 && blocked(w.x, w.z, 9))) ok = false;
        else if (Math.hypot(u - site.lzS, v) < LZ_R + 20) ok = false;
        else {
          for (const p of placed) {
            if (p.id === 'vab' || p.id === 'pad') continue;
            if (Math.abs(u - p.u) < p.hu + 12 && Math.abs(v - p.v) < p.hv + 12) { ok = false; break; }
          }
        }
      }
    }
    if (ok) {
      out.path = pts;
      // The crawler itself, parked outside the door.
      tryPlace({ id: 'crawler', hu: 12, hv: 10, spread: 4 }, [[door.u + 18, door.v], [door.u + 24, door.v]]);
      // The road is kept clear of everything placed after it.
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1];
        const b = pts[i];
        const len = Math.hypot(b.u - a.u, b.v - a.v);
        for (let s = 0; s <= len; s += 10) placed.push({ id: 'road', u: a.u + ((b.u - a.u) * s) / len, v: a.v + ((b.v - a.v) * s) / len, hu: 10, hv: 10 });
      }
    }
    // The control centre: beside the hangar.
    const sgn = Math.sign(vab.v) || 1;
    tryPlace(LCC, [
      [vab.u - 6, vab.v - sgn * (vab.hv + LCC.hv + 14)],
      [vab.u - vab.hu - LCC.hu - 14, vab.v],
      [vab.u + 8, vab.v + sgn * (vab.hv + LCC.hv + 14)],
    ], offLine);
  }

  // The pad complex, round whatever the road left room for.
  for (const spec of PAD_ITEMS) tryPlace(spec, spec.spots);

  // The fence round the pad complex, with a gate where the crawler road runs in.
  out.fence = { half: FENCE_HALF };
  let gv = 0;
  if (out.path) {
    const a = out.path[1];
    const b = out.path[2];
    const t = (-FENCE_HALF - a.u) / (b.u - a.u);
    if (t >= 0 && t <= 1) gv = a.v + (b.v - a.v) * t;
  }
  out.gate = { u: -FENCE_HALF, v0: gv - 14, v1: gv + 14 };

  // Where the island's trees have to go while the spaceport stands.
  out.zones.push({ u: 0, v: 0, hu: FENCE_HALF + 4, hv: FENCE_HALF + 4 });
  out.zones.push({ u: site.lzS, v: 0, hu: LZ_R + 12, hv: LZ_R + 12 });
  for (const it of out.items) out.zones.push({ u: it.u, v: it.v, hu: it.hu + 10, hv: it.hv + 10 });
  if (out.path) {
    for (let i = 1; i < out.path.length; i++) {
      const a = out.path[i - 1];
      const b = out.path[i];
      const len = Math.hypot(b.u - a.u, b.v - a.v);
      for (let s = 0; s <= len; s += 12) {
        out.zones.push({ u: a.u + ((b.u - a.u) * s) / len, v: a.v + ((b.v - a.v) * s) / len, hu: 16, hv: 16 });
      }
    }
  }
  return out;
}
