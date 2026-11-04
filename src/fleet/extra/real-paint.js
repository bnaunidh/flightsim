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
import { finBox, finPoint, finUV } from './livery-art.js';
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

/** A fin's outline off its vertices: { y0, y1, le0, le1, ch0, ch1 }, or null if it does not read as one fin. */
function readFin(meshes) {
  const pts = [];
  for (const o of meshes) {
    const pos = o.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) pts.push([pos.getY(i), pos.getZ(i)]);
  }
  if (pts.length < 12) return null;
  const ys = pts.map((q) => q[0]);
  const y0 = Math.min(...ys);
  const y1 = Math.max(...ys);
  const H = y1 - y0;
  if (!(H > 1)) return null;
  const band = (yc, w) => {
    let le = Infinity;
    let te = -Infinity;
    let hits = 0;
    for (const [y, z] of pts) {
      if (Math.abs(y - yc) > w) continue;
      le = Math.min(le, z);
      te = Math.max(te, z);
      hits++;
    }
    return hits >= 3 && te - le > 0.3 ? { le, ch: te - le } : null;
  };
  const read = (yc) => band(yc, H * 0.06) || band(yc, H * 0.12) || band(yc, H * 0.2);
  // The root is read a fifth of the way up: the fillet into the body is below it.
  const ra = y0 + H * 0.2;
  const rb = y1 - H * 0.05;
  const r0 = read(ra);
  const r1 = read(rb);
  if (!r0 || !r1) return null;
  const k0 = (y0 + H * 0.1 - ra) / (rb - ra);
  const k1 = (y1 - ra) / (rb - ra);
  return { y0: y0 + H * 0.1, y1, le0: mix(r0.le, r1.le, k0), le1: mix(r0.le, r1.le, k1), ch0: mix(r0.ch, r1.ch, k0), ch1: Math.max(0.3, mix(r0.ch, r1.ch, k1)) };
}

function finUVs(meshes, P) {
  const own = readFin(meshes);
  const to = P.finProfile || null;
  const box = to ? finBox(to) : null;
  for (const o of meshes) {
    const pos = o.geometry.attributes.position;
    const uv = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count && own && to; i++) {
      const y = pos.getY(i);
      const h = (y - own.y0) / (own.y1 - own.y0);
      const le = mix(own.le0, own.le1, h);
      const ch = mix(own.ch0, own.ch1, h);
      const [z2, y2] = finPoint(to, (pos.getZ(i) - le) / ch, h);
      const [u, v] = finUV(to, box, z2, y2);
      uv[i * 2] = clamp(u, 0, 1); // a fillet running on ahead of the canvas takes its edge: the tail colour
      uv[i * 2 + 1] = clamp(v, 0, 1);
    }
    o.geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  }
  return !!(own && to);
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
