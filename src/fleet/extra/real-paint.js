/**
 * Fitting the paint to a downloaded airframe (aircraft/real-models.js). The
 * files carry no coordinates and no images, so all of a model's paint is
 * mapped here, once per type, from where each vertex is:
 *
 *   fuselage  u along the body exactly as the procedural skin, v round it by
 *             the same (z, y) -> v, the left side's half of the canvas or the
 *             right's.
 *   scraps    plain wing grey in the shape of lightning bolts on a dark belly,
 *             and half a nacelle: see sortScraps.
 *   fin       its own outline read off its vertices, each vertex placed at the
 *             same chord and height on the fin the canvas was drawn for, so
 *             the mark lands inside whatever shape this fin is.
 *   cowls     v from the lip back, u from the crown round to the belly
 *             (mirrored, so there is no seam to see).
 *   wing      u root to tip with the winglet unrolled after it, v along the chord.
 *
 * Only ever reached through userData.realPaint, so none of it weighs on the
 * first load.
 */
import * as THREE from '../../vendor/three.module.js';
import { finBox, finCentre, finUV } from './livery-art.js';
import { WINGLET_U, skinPatch } from './airliner-kit.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const mix = (a, b, t) => a + (b - a) * t;

/** The v of a skin point, on the hump's own band where there is a hump. */
function skinV(P, z, y) {
  const hump = P.hump && P.vHump && P.hull ? P.hump : null;
  const onHump = hump && z > hump.zMin && z < hump.zMax && y > P.hull.topAt(z) - 0.15;
  const v = onHump ? P.vHump(z, y) : P.vAt(z, y);
  return Number.isFinite(v) ? clamp(v, 0, 1) : y > 0 ? 1 : 0;
}

function skinUV(P, uv, i, z, y, left) {
  const a = P.along(z);
  const v = skinV(P, z, y);
  uv[i * 2] = Number.isFinite(a) ? clamp(a, 0, 1) : 0;
  uv[i * 2 + 1] = left ? 0.5 + 0.5 * v : 0.5 * v;
}

/** Some of a mesh's triangles as a mesh of their own, on the same vertices. */
function partOf(mesh, list, name, uv) {
  const g = mesh.geometry;
  const b = new THREE.BufferGeometry();
  b.setAttribute('position', g.attributes.position);
  if (g.attributes.normal) b.setAttribute('normal', g.attributes.normal);
  if (uv) b.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  // Detail maps' UVs too, and where their maps are kept (aircraft/real-packed.js).
  for (const k of ['uv1', 'uv2']) if (g.attributes[k]) b.setAttribute(k, g.attributes[k]);
  Object.defineProperty(b, 'detailFrom', { value: g.detailFrom || g });
  b.setIndex(list);
  const m = new THREE.Mesh(b, mesh.material);
  m.name = name;
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/**
 * The source's "wing" role is what was left over when the rest was sorted:
 * with the wings and tailplanes come scraps of the belly fairing and the tail
 * cone, and half a nacelle on the big jets. Sort them again by where they lie:
 * inboard of the fuselage's side at every corner is fuselage (a wing's or a
 * tailplane's triangles reach out past it), round an engine's axis is cowl.
 */
function sortScraps(mesh, P) {
  const g = mesh.geometry;
  const p = g.attributes.position;
  const idx = g.index;
  const hull = P.hull;
  if (!idx || !hull) return { skin: [], cowl: [] };
  const keep = [];
  const sides = [[], []];
  const cowl = [];
  const W = hull.section((hull.zMin + hull.zMax) / 2).w;
  const eng = jets(P);
  const aft = P.wing ? P.wing.rootZ + P.wing.rootChord + (P.wing.sweep || 0) * 0.3 : Infinity;
  // The fuselage's side by station (a table: the big jets have 25,000 triangles here). Aft of the wing
  // the stubs a tailplane sits on are the body too.
  const sideAt = Array.from({ length: 64 }, (_, i) => {
    const z = hull.zMin + ((hull.zMax - hull.zMin) * i) / 63;
    return Math.max(1.3 * hull.section(z).w, (z > aft ? 1.25 : 0.75) * W) + 0.2;
  });
  for (let t = 0; t < idx.count; t += 3) {
    const v = [idx.getX(t), idx.getX(t + 1), idx.getX(t + 2)];
    const z = (p.getZ(v[0]) + p.getZ(v[1]) + p.getZ(v[2])) / 3;
    const x = p.getX(v[0]) + p.getX(v[1]) + p.getX(v[2]);
    const side = sideAt[Math.max(0, Math.min(63, Math.round(((z - hull.zMin) / (hull.zMax - hull.zMin)) * 63)))];
    if (z > hull.zMin - 1 && z < hull.zMax + 3 && v.every((i) => Math.abs(p.getX(i)) < side)) sides[x < 0 ? 0 : 1].push(...v);
    else if (eng.some((e) => v.every((i) => Math.hypot(p.getX(i) - e.x, p.getY(i) - e.y) < e.radius * 1.8 && Math.abs(p.getZ(i) - e.z) < e.length * 1.1))) cowl.push(...v);
    else keep.push(...v);
  }
  const part = (list, name, uv) => partOf(mesh, list, name, uv);
  const out = { skin: [], cowl: [] };
  sides.forEach((list, s) => {
    if (!list.length) return;
    const uv = new Float32Array(p.count * 2);
    for (const i of new Set(list)) skinUV(P, uv, i, p.getZ(i), p.getY(i), s === 0); // only what these triangles use
    out.skin.push(part(list, s === 0 ? 'skin_l' : 'skin_r', uv));
  });
  if (cowl.length) out.cowl.push(part(cowl, 'cowl', null));
  if (out.skin.length || out.cowl.length) g.setIndex(keep);
  return out;
}

const jets = (P) => (P.engines || []).filter((e) => e.kind === 'jet');

/**
 * A real fin as you see it, from its own triangles: the side-on area sampled
 * so each triangle weighs its size, stopped at the top of the body. Returns its
 * centre, [z, y], and the room there: how far the nearest edge is, in metres.
 */
function finSeen(meshes, P) {
  const hull = P.hull;
  const crown = hull ? (z) => hull.topAt(clamp(z, hull.zMin, hull.zMax)) : () => -Infinity;
  const N = 12;
  const dots = [];
  let [W, zs, ys] = [0, 0, 0];
  for (const o of meshes) {
    const pos = o.geometry.attributes.position;
    const idx = o.geometry.index;
    const n = idx ? idx.count : pos.count;
    const at = (t) => (idx ? idx.getX(t) : t);
    for (let t = 0; t + 2 < n; t += 3) {
      const [a, b, c] = [at(t), at(t + 1), at(t + 2)];
      const [ax, ay, az] = [pos.getX(a), pos.getY(a), pos.getZ(a)];
      // One face of the fin: the far one is the same area over again.
      if (ax + pos.getX(b) + pos.getX(c) > 0) continue;
      const [ey, ez, fy, fz] = [pos.getY(b) - ay, pos.getZ(b) - az, pos.getY(c) - ay, pos.getZ(c) - az];
      const area = Math.abs(ey * fz - ez * fy) / 2; // as seen from the side
      if (!(area > 1e-5)) continue;
      for (let i = 0; i < N; i++) {
        for (let j = 0; j < N - i; j++) {
          const [p, q] = [(i + 0.33) / N, (j + 0.33) / N];
          const [y, z] = [ay + ey * p + fy * q, az + ez * p + fz * q];
          if (y < crown(z) + 0.25) continue;
          W += area;
          zs += z * area;
          ys += y * area;
          dots.push(z, y);
        }
      }
    }
  }
  if (!(W > 0)) return null;
  const [z, y] = [zs / W, ys / W];
  let [z0, z1, y0, y1, H] = [z, z, y, y, 0];
  for (let i = 0; i < dots.length; i += 2) H = Math.max(H, Math.abs(dots[i + 1] - y));
  const near = 0.08 * H;
  for (let i = 0; i < dots.length; i += 2) {
    const [q, r] = [dots[i], dots[i + 1]];
    if (Math.abs(r - y) < near) {
      z0 = Math.min(z0, q);
      z1 = Math.max(z1, q);
    }
    if (Math.abs(q - z) < near) {
      y0 = Math.min(y0, r);
      y1 = Math.max(y1, r);
    }
  }
  // (0.8: along the chord the edge is swept, and nearer than it looks)
  return { z, y, room: Math.max(0.2, Math.min(0.8 * Math.min(z - z0, z1 - z), y - y0, y1 - y)) };
}

/**
 * A real fin's coordinates on the canvas drawn for the procedural fin: the
 * middle of the fin you can see goes on the canvas's own middle, where the mark
 * is, at one scale both ways. So the mark lands dead centre on whatever shape
 * this fin is, as big as this fin allows, and is never stretched.
 */
function finUVs(meshes, P) {
  const to = P.finProfile || null;
  const box = to ? finBox(to) : null;
  const aim = to ? finCentre(to) : null;
  const seen = to ? finSeen(meshes, P) : null;
  const k = seen ? aim.r / seen.room : 1;
  for (const o of meshes) {
    const pos = o.geometry.attributes.position;
    const uv = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count && seen; i++) {
      const [u, v] = finUV(to, box, aim.z + (pos.getZ(i) - seen.z) * k, aim.y + (pos.getY(i) - seen.y) * k);
      // Left unclamped, for the sampler to clamp: a fin is a few long triangles, and pinning one corner
      // to the canvas's edge would shear the mark across the whole of it. (A fillet running on ahead of
      // the canvas takes its edge, the tail colour.)
      uv[i * 2] = u;
      uv[i * 2 + 1] = v;
    }
    o.geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  }
  return !!seen;
}

/**
 * A 737's "cowl" has the wing's leading edge and its root in it, and they wore
 * the engine's colour out to the tip. Nowhere near an engine it is wing.
 */
function wingOffCowl(mesh, P) {
  const g = mesh.geometry;
  const p = g.attributes.position;
  const idx = g.index;
  const eng = jets(P);
  if (!idx || !eng.length || !P.wing) return null;
  const near = (i) => eng.some((e) => Math.hypot(p.getX(i) - e.x, p.getY(i) - e.y) < e.radius * 1.8);
  const keep = [];
  const wing = [];
  for (let t = 0; t < idx.count; t += 3) {
    const v = [idx.getX(t), idx.getX(t + 1), idx.getX(t + 2)];
    (v.every(near) ? keep : wing).push(...v);
  }
  if (!wing.length) return null;
  g.setIndex(keep);
  return partOf(mesh, wing, 'wing', null);
}

function cowlUVs(meshes, P) {
  const eng = jets(P);
  if (!eng.length) return false;
  const reach = (x, y, e) => Math.hypot(x - e.x, y - e.y) < e.radius * 1.8;
  // Each engine's length from all its pieces, or the scraps would be measured on their own.
  const zs = eng.map(() => [Infinity, -Infinity]);
  for (const o of meshes) {
    const pos = o.geometry.attributes.position;
    const idx = o.geometry.index;
    const n = idx ? idx.count : pos.count;
    for (let t = 0; t < n; t++) {
      const i = idx ? idx.getX(t) : t;
      eng.forEach((e, k) => {
        if (!reach(pos.getX(i), pos.getY(i), e)) return;
        zs[k][0] = Math.min(zs[k][0], pos.getZ(i));
        zs[k][1] = Math.max(zs[k][1], pos.getZ(i));
      });
    }
  }
  for (const o of meshes) {
    const pos = o.geometry.attributes.position;
    const uv = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      const [x, y] = [pos.getX(i), pos.getY(i)];
      const k = eng.findIndex((e) => reach(x, y, e));
      if (k < 0) {
        uv[i * 2] = 0.5; // whatever else the role caught: plain cowl paint
        uv[i * 2 + 1] = 0.45;
        continue;
      }
      const e = eng[k];
      uv[i * 2] = Math.acos(clamp((y - e.y) / Math.max(0.01, Math.hypot(x - e.x, y - e.y)), -1, 1)) / Math.PI;
      uv[i * 2 + 1] = clamp((pos.getZ(i) - zs[k][0]) / Math.max(0.1, zs[k][1] - zs[k][0]), 0, 1);
    }
    o.geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  }
  return true;
}

function wingUVs(meshes, P) {
  const w = P.wing;
  if (!w) return false;
  const tipRise = Math.max(0.5, 0.07 * w.span);
  for (const o of meshes) {
    const pos = o.geometry.attributes.position;
    const nor = o.geometry.attributes.normal;
    const uv = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      const x = Math.abs(pos.getX(i));
      const y = pos.getY(i);
      const t = clamp((x - w.rootX) / w.span, 0, 1);
      const le = w.rootZ + (w.sweep || 0) * t;
      const ch = mix(w.rootChord, w.tipChord, t);
      const c = (pos.getZ(i) - le) / ch;
      // A winglet stands up from the line of the wing. (A raked tip lies a little above it: P.raked.)
      const up = !nor || nor.getY(i) >= 0;
      const rise = t > 0.86 && !P.raked ? y - (w.rootY + (w.dihedral || 0) * t) - 0.03 * w.span : 0;
      if (rise <= 0 && (c < -0.2 || c > 1.25)) {
        uv[i * 2] = 0.45; // a tailplane, a fairing: plain wing paint
        uv[i * 2 + 1] = 0.25;
      } else {
        uv[i * 2] = rise > 0 ? WINGLET_U + (1 - WINGLET_U) * clamp(0.1 + rise / tipRise, 0, 1) : t * WINGLET_U * 0.998;
        const row = rise > 0 ? 0.25 : 0.5 * clamp(c, 0, 1);
        uv[i * 2 + 1] = up ? 1 - row : row;
      }
    }
    o.geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  }
  return true;
}

/** A hole in a download's skin (a spec's `holes`: z0, z1, y0, y1): the game's own hull, a little inside it. */
function patchHoles(root, P) {
  for (const [z0, z1, y0, y1] of P.holes || []) {
    const mid = (z0 + z1) / 2;
    const [s0, s1] = [P.hull.angleAt(mid, y1), P.hull.angleAt(mid, y0)];
    for (const side of [1, -1]) {
      const left = side < 0;
      const g = skinPatch(P.hull, [[z0, s0], [z1, s0], [z1, s1], [z0, s1]], side, -0.2, 6, 4, (z, s) => {
        const v = 1 - s / Math.PI;
        return [P.along(z), left ? 0.5 + 0.5 * v : 0.5 * v];
      });
      const m = new THREE.Mesh(g);
      m.name = left ? 'skin_l' : 'skin_r';
      root.add(m);
    }
  }
}

/** Every coordinate a model's paint needs, once per type. `root` is the template. */
export function realUVs(root, P) {
  const by = { skin: [], fin: [], cowl: [], wing: [] };
  root.traverse((o) => {
    if (!o.isMesh) return;
    const role = o.parent && o.parent !== root ? o.parent.name : o.name;
    if (role === 'skin_l' || role === 'skin_r') by.skin.push([o, role === 'skin_l']);
    else if (by[role]) by[role].push(o);
  });
  for (const [o, left] of by.skin) {
    const p = o.geometry.attributes.position;
    const uv = new Float32Array(p.count * 2);
    for (let i = 0; i < p.count; i++) skinUV(P, uv, i, p.getZ(i), p.getY(i), left);
    o.geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  }
  patchHoles(root, P);
  for (const o of by.cowl) {
    const stray = wingOffCowl(o, P);
    if (stray) {
      root.add(stray);
      by.wing.push(stray);
    }
  }
  for (const o of by.wing) {
    const got = sortScraps(o, P);
    for (const m of [...got.skin, ...got.cowl]) root.add(m);
    by.cowl.push(...got.cowl);
  }
  return { fin: by.fin.length ? finUVs(by.fin, P) : false, cowl: cowlUVs(by.cowl, P), wing: wingUVs(by.wing, P) };
}

/**
 * A decal's own patch on a real hull: the skin's own triangles where the decal
 * falls, a hair proud of them, so it follows that model's surface exactly and
 * keeps its own texels (the skin's are spread over the whole aeroplane: a
 * name in them is soft close to, and softer on the lower tiers). u along the
 * body, reading left to right from each side; v by height. Cached on the
 * template: `tpl.patches`. Null if the hull has nothing there.
 */
export function decalPatch(tpl, d) {
  const cache = (tpl.patches = tpl.patches || new Map());
  const key = [d.z, d.y, d.w, d.h].map((n) => n.toFixed(3)).join();
  if (cache.has(key)) return cache.get(key);
  const zA = d.z - d.w / 2;
  const yA = d.y - d.h / 2;
  const [zB, yB] = [zA + d.w, yA + d.h];
  const out = { p: [], n: [], uv: [] };
  tpl.root.traverse((o) => {
    if (!o.isMesh) return;
    const role = o.parent && o.parent !== tpl.root ? o.parent.name : o.name;
    if (role !== 'skin_l' && role !== 'skin_r') return;
    const side = role === 'skin_l' ? -1 : 1;
    const g = o.geometry;
    const pos = g.attributes.position;
    const idx = g.index;
    const n = idx ? idx.count : pos.count;
    const at = (t) => (idx ? idx.getX(t) : t);
    for (let t = 0; t + 2 < n; t += 3) {
      let [a, b, c] = [at(t), at(t + 1), at(t + 2)];
      const [z0, z1, z2] = [pos.getZ(a), pos.getZ(b), pos.getZ(c)];
      if (Math.max(z0, z1, z2) < zA || Math.min(z0, z1, z2) > zB) continue;
      const [y0, y1, y2] = [pos.getY(a), pos.getY(b), pos.getY(c)];
      if (Math.max(y0, y1, y2) < yA || Math.min(y0, y1, y2) > yB) continue;
      const [x0, x1, x2] = [pos.getX(a), pos.getX(b), pos.getX(c)];
      if ((x0 + x1 + x2) * side <= 0) continue;
      // Wound outward whatever the file did: its faces are not all one way round.
      const nx = (y1 - y0) * (z2 - z0) - (z1 - z0) * (y2 - y0);
      if (nx * side < 0) [b, c] = [c, b];
      for (const i of [a, b, c]) {
        const [x, y, z] = [pos.getX(i), pos.getY(i), pos.getZ(i)];
        const q = g.attributes.normal;
        const [ox, oy, oz] = q ? [q.getX(i), q.getY(i), q.getZ(i)] : [side, 0, 0];
        const flip = ox * side < 0 ? -1 : 1;
        // Out along the skin's own normal: 5 cm, over a door's top frame where the name crosses one.
        out.p.push(x + ox * flip * 0.05, y + oy * flip * 0.05, z + oz * flip * 0.05);
        const u = (z - zA) / d.w;
        out.uv.push(side > 0 ? 1 - u : u, (y - yA) / d.h);
        out.n.push(ox * flip, oy * flip, oz * flip);
      }
    }
  });
  let geo = null;
  if (out.p.length) {
    geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(out.p), 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(out.n), 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(out.uv), 2));
  }
  cache.set(key, geo);
  return geo;
}

/**
 * A decal on the skin canvas, cut into rows, each row at the height the skin
 * really puts it: the map from height to canvas row is not straight on a round
 * body, and drawn as one block a tall name came out squashed at its top.
 */
export function drawDecal(g, d, U, V, vAt, mirror, knots = []) {
  const img = d.texture && d.texture.image;
  if (!img) return;
  const zA = d.z - d.w / 2;
  const zB = d.z + d.w / 2;
  const x0 = U(zA);
  const x1 = U(zB);
  // (the best filter is not free, and Low's name is drawn near its own size)
  if ('imageSmoothingQuality' in g) g.imageSmoothingQuality = x1 - x0 > img.width * 0.6 ? 'medium' : 'high';
  if (mirror && d.mirror !== false) {
    g.save();
    g.translate(x0 + x1, 0);
    g.scale(-1, 1);
  }
  // Across a knot of the along map the canvas changes scale: each piece of the word at its own.
  const cuts = [zA, ...knots.filter((k) => k > zA && k < zB), zB];
  const rows = 8;
  const sh = img.height / rows;
  const at = (i) => V(d.z, d.y + d.h / 2 - (d.h * i) / rows, vAt);
  for (let c = 0; c + 1 < cuts.length; c++) {
    const [a, b] = [cuts[c], cuts[c + 1]];
    const sx = ((a - zA) / d.w) * img.width;
    const sw = ((b - a) / d.w) * img.width;
    const dw = U(b) - U(a);
    for (let i = 0; i < rows; i++) {
      const top = at(i);
      g.drawImage(img, sx, i * sh, sw, sh, U(a), top, dw, at(i + 1) - top + 0.4);
    }
  }
  if (mirror && d.mirror !== false) g.restore();
}
