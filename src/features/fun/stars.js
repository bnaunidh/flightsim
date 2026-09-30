/**
 * STAR HUNT: where the golden stars go.
 *
 * Ten on every map for each of the four games, found by flying or driving
 * through them. Nobody placed them by hand — there are nineteen maps — so
 * this works them out from the map itself, the same way every time (the
 * random numbers are seeded from the map's id):
 *
 *   air   (plane and helicopter): one low over the runway, one over the top
 *         of each big hill, one skimming the sea off the main island, one
 *         way up high over the field, one between two islands, and the rest
 *         scattered over the land, never nearer each other than 450 m.
 *   sea   (boat): on open water a few hundred metres off the coasts, the
 *         first one just outside the harbour, all within reach of it.
 *   road  (car): on the roads, spread as far apart as they will go, the
 *         first one nearest the start.
 *
 * Pure: the height of the ground, the runway, the harbour and the roads are
 * handed in, so tests/features/fun.mjs can place and check every map in
 * node without a page.
 */

export const STAR_COUNT = 10;

/** Which set of stars a game hunts. */
export function starSetFor(game) {
  return game === 'boat' ? 'sea' : game === 'car' ? 'road' : 'air';
}

/** A star's id: where it is, to the nearest ten metres. */
export function starId(p) {
  return `${Math.round(p.x / 10)}:${Math.round(p.z / 10)}`;
}

/** How close counts as "through it", sideways and up/down, per set. */
export const CATCH = {
  air: { r: 24, dy: 24 },
  sea: { r: 14, dy: 12 },
  road: { r: 10, dy: 8 },
};

function rng(seedText) {
  let h = 2166136261;
  for (let i = 0; i < seedText.length; i++) {
    h ^= seedText.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Highest ground within a few metres, so a low star is never inside a slope. */
function groundAround(heightAt, x, z, r = 16) {
  let top = Math.max(0, heightAt(x, z));
  for (let a = 0; a < 6; a++) {
    const ang = (a / 6) * Math.PI * 2;
    top = Math.max(top, heightAt(x + Math.sin(ang) * r, z + Math.cos(ang) * r));
  }
  return top;
}

function farFromAll(list, x, z, min) {
  for (const p of list) if (Math.hypot(p.x - x, p.z - z) < min) return false;
  return true;
}

/**
 * @param {'air'|'sea'|'road'} kind
 * @param {object} w
 * @param {object} w.map          the map definition (id, islands)
 * @param {(x:number,z:number)=>number} w.heightAt
 * @param {object} [w.airport]    { runway: { cx, cz, length }, headingDeg }
 * @param {object} [w.harbour]    { x, z } — the harbour mouth
 * @param {Array}  [w.roads]      road list, each { path: [[x, z], …] }
 * @param {{x:number,z:number}} [w.start]  where this game starts
 * @returns {Array<{id,x,y,z,what}>}
 */
export function placeStars(kind, w) {
  const map = w.map || {};
  const rand = rng(`${map.id || 'map'}:${kind}`);
  const heightAt = w.heightAt;
  const out = [];
  const add = (x, y, z, what, min = 450) => {
    if (out.length >= STAR_COUNT) return false;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return false;
    if (!farFromAll(out, x, z, min)) return false;
    out.push({ x, y, z, what, id: starId({ x, z }) });
    return true;
  };
  const islands = (map.islands || []).slice().sort((a, b) => b.radius - a.radius);
  const main = islands[0] || { cx: 0, cz: 0, radius: 1500 };
  // How far out anything goes: the islands, and a margin.
  let reach = 2500;
  for (const i of islands) reach = Math.max(reach, Math.hypot(i.cx, i.cz) + i.radius);
  reach = Math.min(reach, 9000);

  if (kind === 'air') {
    const rw = w.airport && w.airport.runway;
    if (rw) add(rw.cx, groundAround(heightAt, rw.cx, rw.cz, 30) + 14, rw.cz, 'low over the runway');
    // The top of each big hill.
    for (const isl of islands.slice(0, 5)) {
      let best = null;
      const span = Math.min(isl.radius * 0.7, 2500);
      for (let i = -4; i <= 4; i++) {
        for (let j = -4; j <= 4; j++) {
          const x = isl.cx + (i / 4) * span;
          const z = isl.cz + (j / 4) * span;
          const h = heightAt(x, z);
          if (!best || h > best.h) best = { x, z, h };
        }
      }
      if (best && best.h > 20) add(best.x, groundAround(heightAt, best.x, best.z, 40) + 45, best.z, 'over a hilltop', 700);
    }
    // Skimming the sea just off the main island.
    const a0 = rand() * Math.PI * 2;
    for (let k = 0; k < 12; k++) {
      const ang = a0 + (k / 12) * Math.PI * 2;
      let placed = false;
      for (let d = main.radius * 0.5; d < main.radius * 2.2; d += 60) {
        const x = main.cx + Math.sin(ang) * d;
        const z = main.cz - Math.cos(ang) * d;
        if (heightAt(x, z) < -4) {
          const x2 = main.cx + Math.sin(ang) * (d + 150);
          const z2 = main.cz - Math.cos(ang) * (d + 150);
          placed = add(x2, groundAround(heightAt, x2, z2, 30) + 9, z2, 'skimming the sea');
          break;
        }
      }
      if (placed) break;
    }
    // Way up high over the field.
    const f = rw || { cx: main.cx, cz: main.cz };
    add(f.cx + 300, Math.max(0, heightAt(f.cx + 300, f.cz + 200)) + 420, f.cz + 200, 'way up high', 300);
    // Between two islands.
    if (islands.length > 1) {
      const b = islands[1];
      const x = (main.cx + b.cx) / 2;
      const z = (main.cz + b.cz) / 2;
      add(x, groundAround(heightAt, x, z, 40) + 110, z, 'between the islands');
    }
    // And the rest over the land.
    for (let tries = 0; tries < 600 && out.length < STAR_COUNT; tries++) {
      const isl = islands[Math.floor(rand() * Math.min(islands.length, 4))] || main;
      const ang = rand() * Math.PI * 2;
      const d = Math.sqrt(rand()) * isl.radius * 0.85;
      const x = isl.cx + Math.sin(ang) * d;
      const z = isl.cz - Math.cos(ang) * d;
      if (heightAt(x, z) < 1) continue;
      add(x, groundAround(heightAt, x, z, 40) + 55 + rand() * 90, z, 'over the island', 700 - Math.min(250, tries));
    }
    // A map that is nearly all sea: fill up over the water.
    for (let tries = 0; tries < 400 && out.length < STAR_COUNT; tries++) {
      const ang = rand() * Math.PI * 2;
      const d = 400 + rand() * reach * 0.8;
      const x = main.cx + Math.sin(ang) * d;
      const z = main.cz - Math.cos(ang) * d;
      add(x, groundAround(heightAt, x, z, 30) + 30 + rand() * 80, z, 'out over the sea', 600);
    }
  }

  if (kind === 'sea') {
    const deep = (x, z) =>
      heightAt(x, z) < -3 && heightAt(x + 35, z) < -2 && heightAt(x - 35, z) < -2 && heightAt(x, z + 35) < -2 && heightAt(x, z - 35) < -2;
    const home = w.harbour || w.start || { x: main.cx, z: main.cz + main.radius };
    const within = 3800;
    // The first one just outside the harbour.
    for (let d = 160; d < 900 && !out.length; d += 60) {
      for (let k = 0; k < 8 && !out.length; k++) {
        const ang = (k / 8) * Math.PI * 2;
        const x = home.x + Math.sin(ang) * d;
        const z = home.z - Math.cos(ang) * d;
        if (deep(x, z)) add(x, 2.6, z, 'outside the harbour');
      }
    }
    // Then a few hundred metres off each coast near home.
    for (let tries = 0; tries < 1500 && out.length < STAR_COUNT; tries++) {
      const isl = islands[Math.floor(rand() * islands.length)] || main;
      const ang = rand() * Math.PI * 2;
      const d = isl.radius * (0.9 + rand() * 0.9) + 120;
      const x = isl.cx + Math.sin(ang) * d;
      const z = isl.cz - Math.cos(ang) * d;
      if (Math.hypot(x - home.x, z - home.z) > within) continue;
      if (!deep(x, z)) continue;
      add(x, 2.6, z, 'on the water', tries < 900 ? 500 : 320);
    }
  }

  if (kind === 'road') {
    const pts = [];
    for (const rd of w.roads || []) {
      const p = rd.path || [];
      for (let k = 1; k < p.length; k++) {
        const ax = p[k - 1][0];
        const az = p[k - 1][1];
        const ex = p[k][0] - ax;
        const ez = p[k][1] - az;
        const len = Math.hypot(ex, ez);
        for (let s = 0; s < len; s += 40) pts.push({ x: ax + (ex * s) / len, z: az + (ez * s) / len });
      }
    }
    if (pts.length) {
      const start = w.start || { x: main.cx, z: main.cz };
      // Nearest the start first, then each next one as far from all the others as it can be.
      let first = pts[0];
      for (const p of pts) if (Math.hypot(p.x - start.x, p.z - start.z) > 60 && Math.hypot(p.x - start.x, p.z - start.z) < Math.hypot(first.x - start.x, first.z - start.z)) first = p;
      const road = (p, what) => add(p.x, heightAt(p.x, p.z) + 2.2, p.z, what, 250);
      road(first, 'on the road near the start');
      const dist = pts.map((p) => Math.hypot(p.x - first.x, p.z - first.z));
      while (out.length < STAR_COUNT) {
        let bi = -1;
        for (let i = 0; i < pts.length; i++) if (bi < 0 || dist[i] > dist[bi]) bi = i;
        if (bi < 0 || dist[bi] < 250) break;
        const p = pts[bi];
        road(p, 'on the road');
        for (let i = 0; i < pts.length; i++) dist[i] = Math.min(dist[i], Math.hypot(pts[i].x - p.x, pts[i].z - p.z));
      }
    }
  }
  return out;
}

/** The star at index i is caught by something at pos (a {x, y, z}). */
export function catches(kind, star, pos) {
  const c = CATCH[kind] || CATCH.air;
  return Math.hypot(star.x - pos.x, star.z - pos.z) <= c.r && Math.abs(star.y - pos.y) <= c.dy;
}
