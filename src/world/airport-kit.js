/**
 * The airfield's toolbox: how a hundred boxes become one draw call.
 *
 * The airport that was here cost about 350 draw calls — every mullion of the
 * terminal glazing, every tower railing post, every traffic cone and every
 * runway light's glow was its own mesh — and a school Chromebook has perhaps
 * five hundred for the whole frame. A draw call costs the same whether it
 * draws a cone or a building, so the answer is to draw far fewer, bigger
 * things:
 *
 *   Batch        collects primitives, each with its own colour, and merges them
 *                into ONE mesh with the colour baked into the vertices.
 *   bakeModel    does the same to an aeroplane built by the game's own model
 *                factory: forty-odd meshes in, one per material out, and all
 *                the plain-coloured ones folded into a single vertex-coloured
 *                mesh. A Meridian at the gate went from 48 draw calls to 7.
 *   glowPoints   every light's halo on the field as one THREE.Points, where
 *                the runway lights alone used to be 56 sprites.
 *
 * Nothing here runs per frame. It is all build time.
 */

import * as THREE from '../vendor/three.module.js';

const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _c = new THREE.Color();
const _nm = new THREE.Matrix3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();
const UP = new THREE.Vector3(0, 1, 0);

/** A matrix from a position, a yaw (radians, three.js sense) and a scale. */
export function trs(x, y, z, ry = 0, sx = 1, sy = 1, sz = 1, out = new THREE.Matrix4()) {
  _q.setFromAxisAngle(UP, ry);
  _v.set(x, y, z);
  _s.set(sx, sy, sz);
  return out.compose(_v, _q, _s);
}

/** Same, with a full Euler rotation. */
export function trse(x, y, z, rx, ry, rz, sx = 1, sy = 1, sz = 1, out = new THREE.Matrix4()) {
  _e.set(rx, ry, rz);
  _q.setFromEuler(_e);
  _v.set(x, y, z);
  _s.set(sx, sy, sz);
  return out.compose(_v, _q, _s);
}

/** Yaw in three.js radians for a compass heading: heading 0 faces -Z. */
export const yawOf = (headingDeg) => (-headingDeg * Math.PI) / 180;

/* ------------------------------------------------------------------ */
/* Batch                                                               */
/* ------------------------------------------------------------------ */

/**
 * Primitives merged into one mesh.
 *
 * `uvTile` (metres) gives a part UVs measured on its own faces rather than
 * the 0..1 each primitive comes with, so a textured wall 60 m long shows the
 * cladding at the same size as one 6 m long.
 */
export class Batch {
  constructor() {
    this.pos = [];
    this.nrm = [];
    this.uv = [];
    this.col = [];
  }

  get vertexCount() {
    return this.pos.length / 3;
  }

  /** Append any BufferGeometry, transformed by `matrix`, in colour `color`. */
  add(geo, matrix, color = 0xffffff, uvTile = 0) {
    const p = geo.attributes.position;
    const n = geo.attributes.normal;
    const t = geo.attributes.uv;
    const idx = geo.index;
    const count = idx ? idx.count : p.count;
    _nm.getNormalMatrix(matrix);
    _c.set(color);
    for (let i = 0; i < count; i++) {
      const j = idx ? idx.getX(i) : i;
      _v.fromBufferAttribute(p, j);
      if (n) _n.fromBufferAttribute(n, j);
      else _n.set(0, 1, 0);
      if (uvTile > 0) {
        // Planar, from whichever axis the face looks down.
        const ax = Math.abs(_n.x);
        const ay = Math.abs(_n.y);
        const az = Math.abs(_n.z);
        if (ay >= ax && ay >= az) this.uv.push(_v.x / uvTile, _v.z / uvTile);
        else if (ax >= az) this.uv.push(_v.z / uvTile, _v.y / uvTile);
        else this.uv.push(_v.x / uvTile, _v.y / uvTile);
      } else if (t) {
        this.uv.push(t.getX(j), t.getY(j));
      } else {
        this.uv.push(0, 0);
      }
      _v.applyMatrix4(matrix);
      _n.applyMatrix3(_nm).normalize();
      this.pos.push(_v.x, _v.y, _v.z);
      this.nrm.push(_n.x, _n.y, _n.z);
      this.col.push(_c.r, _c.g, _c.b);
    }
    return this;
  }

  /** A box of w x h x d centred at (x, y, z), turned `ry` about Y. */
  box(w, h, d, x, y, z, color, ry = 0, uvTile = 0) {
    const g = new THREE.BoxGeometry(w, h, d);
    this.add(g, trs(x, y, z, ry, 1, 1, 1, _m), color, uvTile);
    g.dispose();
    return this;
  }

  /** A box by its two corners: x0..x1, y0..y1, z0..z1. */
  slab(x0, x1, y0, y1, z0, z1, color, uvTile = 0) {
    return this.box(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0), (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, color, 0, uvTile);
  }

  /** An upright cylinder, base at y. */
  cyl(rTop, rBot, h, x, y, z, color, seg = 12, opts = {}) {
    const g = new THREE.CylinderGeometry(rTop, rBot, h, seg, 1, !!opts.open, opts.thetaStart || 0, opts.thetaLength || Math.PI * 2);
    const m = opts.matrix
      ? opts.matrix
      : trse(x, y + h / 2, z, opts.rx || 0, opts.ry || 0, opts.rz || 0, 1, 1, 1, _m);
    this.add(g, m, color, opts.uvTile || 0);
    g.dispose();
    return this;
  }

  /** A flat quad lying on the ground, w along X by d along Z. */
  flat(w, d, x, y, z, color, ry = 0) {
    const g = new THREE.PlaneGeometry(w, d);
    g.rotateX(-Math.PI / 2);
    this.add(g, trs(x, y, z, ry, 1, 1, 1, _m), color);
    g.dispose();
    return this;
  }

  /** A straight tube between two points (a rail, a hose, a strut). */
  tube(ax, ay, az, bx, by, bz, r, color, seg = 6) {
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-4) return this;
    const g = new THREE.CylinderGeometry(r, r, len, seg, 1, true);
    _v.set(dx / len, dy / len, dz / len);
    _q.setFromUnitVectors(UP, _v);
    _s.set(1, 1, 1);
    _n.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
    _m.compose(_n, _q, _s);
    this.add(g, _m, color);
    g.dispose();
    return this;
  }

  /** The merged geometry. Empty batches give null. */
  geometry() {
    if (!this.pos.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }

  /** One mesh. The material must have vertexColors on to use the colours. */
  mesh(material, { cast = true, receive = true, name = '' } = {}) {
    const g = this.geometry();
    if (!g) return null;
    const m = new THREE.Mesh(g, material);
    m.castShadow = cast;
    m.receiveShadow = receive;
    m.name = name;
    return m;
  }
}

/** A standard material that takes its colour from the vertices. */
export function vcMaterial(opts = {}) {
  return new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0.05, ...opts });
}

/* ------------------------------------------------------------------ */
/* Depth layers                                                        */
/* ------------------------------------------------------------------ */

/*
 * Which flat thing is drawn over which, at a distance.
 *
 * The runway stands 6 cm proud of the ground, the taxiways and the apron 5,
 * the shoulders 2, the paint 7.5. With the near plane at 0.4 m a 24-bit depth
 * buffer cannot tell 5 cm apart beyond about 550 m, so from further off the
 * grass won the pixels: at San Francisco, looked at from 550 m, the whole
 * 1.2 km apron came out green with the stand lead-in lines painted on the
 * grass. Measured, not guessed — from 60 m the same apron was paved.
 *
 * So each layer is pulled toward the camera by a little more than the one
 * under it: ground, then shoulders, then taxiways and apron, then the
 * runways, then paint. The roads (roads.js) sit at -2/-2 and must stay on top
 * of the apron where Kestrel's road runs across it, which is why the pavement
 * is only -1 in factor. Geometry and heights are untouched; this is only the
 * depth test.
 */
export const LAYER = Object.freeze({
  shoulder: [-1, -1],
  pavement: [-1, -2],
  runway: [-1, -3],
  paint: [-2, -4],
  decal: [-2, -5],
});
export function layer(mat, which) {
  const [f, u] = LAYER[which];
  mat.polygonOffset = true;
  mat.polygonOffsetFactor = f;
  mat.polygonOffsetUnits = u;
  return mat;
}

/* ------------------------------------------------------------------ */
/* Instancing                                                          */
/* ------------------------------------------------------------------ */

/**
 * One InstancedMesh for `count` copies. Matrices start as identity; set them
 * with setMatrixAt. frustumCulled off, because the instances are spread over
 * a kilometre and the mesh's own bounding sphere is its geometry's, at the
 * origin — culling would hide the lot whenever the origin left the screen.
 */
export function instanced(geometry, material, count, { cast = true, receive = true, name = '' } = {}) {
  const m = new THREE.InstancedMesh(geometry, material, Math.max(1, count));
  m.count = count;
  m.castShadow = cast;
  m.receiveShadow = receive;
  m.frustumCulled = false;
  m.name = name;
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  return m;
}

/**
 * For instances that will not move again: bound them by where they really
 * are and let the renderer cull them. instanced() leaves culling off because
 * a mesh's bounds start as one copy's at the origin; once the matrices are
 * set, three.js can bound the lot — and a car park, a fire station or a row
 * of runway lights behind the camera then costs nothing, in the shadow pass
 * as well as the main one.
 */
export function settle(mesh) {
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.frustumCulled = true;
  return mesh;
}

/* ------------------------------------------------------------------ */
/* Glow                                                                */
/* ------------------------------------------------------------------ */

let glowTex = null;
/** A soft round spot, shared by every glow on the field. */
export function glowTexture() {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  glowTex = new THREE.CanvasTexture(c);
  glowTex.colorSpace = THREE.SRGBColorSpace;
  return glowTex;
}

/**
 * Halos, as one Points object. `size` is in metres — the same sense as a
 * sprite's scale — corrected for PointsMaterial's convention (point size is
 * scale / -z with scale = half the canvas height, where a sprite is sized
 * against the vertical field of view: at 68 degrees that is a factor of 1.48).
 */
export function glowPoints(positions, colors, size, { opacity = 0.85, name = 'glow' } = {}) {
  const n = positions.length / 3;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors.length ? colors : new Array(n * 3).fill(1), 3));
  g.computeBoundingSphere();
  const mat = new THREE.PointsMaterial({
    size: size * 1.48,
    map: glowTexture(),
    vertexColors: true,
    transparent: true,
    opacity,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
  });
  const p = new THREE.Points(g, mat);
  p.name = name;
  p.frustumCulled = false;
  return p;
}

/* ------------------------------------------------------------------ */
/* Canvas                                                              */
/* ------------------------------------------------------------------ */

export function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

export function canvasTexture(c, { srgb = true, repeat = false } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

/* ------------------------------------------------------------------ */
/* Baking an aeroplane                                                 */
/* ------------------------------------------------------------------ */

/** Plain paint: no texture, opaque, not glowing. These all fold into one mesh. */
function isPlain(m) {
  if (!m || m.transparent || m.map || m.alphaMap || m.normalMap || m.emissiveMap) return false;
  if (m.side === THREE.DoubleSide && m.opacity < 1) return false;
  if (m.emissive && (m.emissive.r + m.emissive.g + m.emissive.b) > 0.02 && (m.emissiveIntensity ?? 1) > 0) return false;
  return m.isMeshStandardMaterial || m.isMeshBasicMaterial || m.isMeshLambertMaterial || m.isMeshPhongMaterial;
}

/**
 * Turn a built aeroplane into a handful of merged geometries.
 *
 * Returns { parts: [{ geometry, material }], box: Box3, section(z) } in the
 * model's own frame (-Z forward, +X right, origin where the game puts the
 * aeroplane's position). `section(z)` answers the fuselage's half-width and
 * top/bottom at station z, which is how the stairs and the bridge find a door
 * on an aeroplane nobody measured by hand.
 */
export function bakeModel(root) {
  /*
   * In the model's frame but at its own scale. The factories build at unit
   * size and scale the root group by the type's `shape.scale`, so baking
   * relative to the root's full matrix gave a Meridian 14 m across instead of
   * 28.8 — the right shape at half the size.
   */
  if (!root.parent) {
    root.position.set(0, 0, 0);
    root.quaternion.identity();
  }
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4();
  if (root.parent) {
    inv.copy(root.matrixWorld).invert();
    _m.makeScale(root.scale.x, root.scale.y, root.scale.z);
    inv.premultiply(_m);
  }
  const buckets = new Map(); // material -> Batch
  const plain = new Batch();
  const plainStats = { rough: 0, metal: 0, n: 0 };
  const box = new THREE.Box3();
  const tmp = new THREE.Matrix4();
  const inst = new THREE.Matrix4();

  const visible = (o) => {
    for (let p = o; p && p !== root; p = p.parent) if (!p.visible) return false;
    return true;
  };
  const push = (geo, matrix, material, start, count) => {
    let g = geo;
    if (start != null) {
      // One group of a multi-material mesh: copy just that range.
      const src = geo.index ? geo.toNonIndexed() : geo;
      const sub = new THREE.BufferGeometry();
      for (const name of ['position', 'normal', 'uv']) {
        const a = src.attributes[name];
        if (!a) continue;
        const sz = a.itemSize;
        sub.setAttribute(name, new THREE.BufferAttribute(a.array.slice(start * sz, (start + count) * sz), sz));
      }
      g = sub;
    }
    if (isPlain(material)) {
      const col = material.color ? material.color.getHex() : 0x888888;
      plain.add(g, matrix, col);
      plainStats.rough += material.roughness ?? 0.7;
      plainStats.metal += material.metalness ?? 0.1;
      plainStats.n++;
    } else {
      let b = buckets.get(material);
      if (!b) buckets.set(material, (b = new Batch()));
      b.add(g, matrix, 0xffffff);
    }
  };

  root.traverse((o) => {
    if (!o.isMesh || o.isSprite || !o.geometry || !o.geometry.attributes.position) return;
    if (!visible(o)) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const copies = o.isInstancedMesh ? o.count : 1;
    for (let k = 0; k < copies; k++) {
      tmp.multiplyMatrices(inv, o.matrixWorld);
      if (o.isInstancedMesh) {
        o.getMatrixAt(k, inst);
        tmp.multiply(inst);
      }
      if (Array.isArray(o.material) && o.geometry.groups.length) {
        for (const gr of o.geometry.groups) {
          const mat = mats[gr.materialIndex];
          if (mat && mat.visible !== false) push(o.geometry, tmp, mat, gr.start, gr.count);
        }
      } else if (mats[0] && mats[0].visible !== false) {
        push(o.geometry, tmp, mats[0]);
      }
    }
  });

  const parts = [];
  if (plain.vertexCount) {
    const n = Math.max(1, plainStats.n);
    parts.push({
      geometry: plain.geometry(),
      material: vcMaterial({ roughness: plainStats.rough / n, metalness: plainStats.metal / n }),
      plain: true,
    });
  }
  for (const [mat, b] of buckets) {
    // The Batch wrote white vertex colours; the original material ignores them.
    const g = b.geometry();
    if (!g) continue;
    g.deleteAttribute('color');
    parts.push({ geometry: g, material: mat, plain: false });
  }
  for (const p of parts) {
    p.geometry.computeBoundingBox();
    box.union(p.geometry.boundingBox);
  }

  // Cross-sections, for finding doors: bucket every vertex by station.
  const len = Math.max(1, box.max.z - box.min.z);
  const bins = 64;
  /*
   * `yc` is the height of the widest point of the section, which on a round
   * fuselage is its centreline — the one number the undercarriage cannot
   * spoil. `bot` can: at the station of the nose leg it is the tyre.
   */
  const sec = Array.from({ length: bins }, () => ({ hw: 0, yc: 0, top: -Infinity, bot: Infinity, n: 0 }));
  const span = Math.max(1, box.max.x - box.min.x);
  for (const p of parts) {
    const a = p.geometry.attributes.position;
    for (let i = 0; i < a.count; i++) {
      const x = a.getX(i);
      // Only the body: anything further out than a tenth of the span either
      // side is wing, engine or tailplane.
      if (Math.abs(x) > span * 0.1 + 1.2) continue;
      const y = a.getY(i);
      const z = a.getZ(i);
      const b = Math.min(bins - 1, Math.max(0, Math.floor(((z - box.min.z) / len) * bins)));
      const s = sec[b];
      if (Math.abs(x) > s.hw) {
        s.hw = Math.abs(x);
        s.yc = y;
      }
      s.top = Math.max(s.top, y);
      s.bot = Math.min(s.bot, y);
      s.n++;
    }
  }
  const section = (z) => {
    const b = Math.min(bins - 1, Math.max(0, Math.floor(((z - box.min.z) / len) * bins)));
    // Nearest populated bin.
    for (let d = 0; d < bins; d++) {
      for (const k of [b - d, b + d]) {
        if (k >= 0 && k < bins && sec[k].n) return sec[k];
      }
    }
    return { hw: 1, yc: 2, top: 3, bot: 0, n: 0 };
  };
  /*
   * The parallel part of the fuselage: every station at least 85% as wide as
   * the widest. Its two ends are where the front and rear doors go. Fixed
   * fractions of the overall length do not work — measured on the Meridian,
   * 78% of the way back is already the tail cone, 0.19 m across.
   */
  let maxHW = 0;
  let yc = 0;
  for (const s of sec) {
    if (s.n && s.hw > maxHW) {
      maxHW = s.hw;
      yc = s.yc;
    }
  }
  let first = -1;
  let last = -1;
  for (let i = 0; i < bins; i++) {
    if (sec[i].n && sec[i].hw >= maxHW * 0.85) {
      if (first < 0) first = i;
      last = i;
    }
  }
  const binZ = (i) => box.min.z + ((i + 0.5) / bins) * len;
  const body = {
    halfWidth: maxHW,
    centreY: yc,
    front: first >= 0 ? binZ(first) : box.min.z + len * 0.15,
    rear: last >= 0 ? binZ(last) : box.max.z - len * 0.3,
  };
  // Where the wing is: the station of the widest vertex.
  let tipZ = 0;
  let tipX = 0;
  for (const p of parts) {
    const a = p.geometry.attributes.position;
    for (let i = 0; i < a.count; i++) {
      const x = Math.abs(a.getX(i));
      if (x > tipX) {
        tipX = x;
        tipZ = a.getZ(i);
      }
    }
  }
  /*
   * The wing's leading edge, as the most forward point at each distance out
   * along the span (past the fuselage). Where an engine hangs, that is the
   * nacelle's lip — which is where a fuel hose would go near enough anyway.
   */
  const leBins = 16;
  const le = new Array(leBins).fill(Infinity);
  const leY = new Array(leBins).fill(0);
  for (const p of parts) {
    const a = p.geometry.attributes.position;
    for (let i = 0; i < a.count; i++) {
      const x = Math.abs(a.getX(i));
      if (x < maxHW * 1.3 || tipX <= 0) continue;
      const b = Math.min(leBins - 1, Math.floor((x / tipX) * leBins));
      const z = a.getZ(i);
      if (z < le[b]) {
        le[b] = z;
        leY[b] = a.getY(i);
      }
    }
  }
  const wingLE = (x) => {
    const b = Math.min(leBins - 1, Math.max(0, Math.floor((Math.abs(x) / Math.max(1e-3, tipX)) * leBins)));
    for (let d = 0; d < leBins; d++) {
      for (const k of [b - d, b + d]) if (k >= 0 && k < leBins && le[k] < Infinity) return { z: le[k], y: leY[k] };
    }
    return { z: tipZ, y: yc };
  };
  return { parts, box, section, body, wingTipZ: tipZ, halfSpan: tipX, wingLE };
}

/**
 * The same measurements for an aeroplane that is not being baked — the one
 * you are flying, when the ground crew needs to find its doors. Costs one
 * bake (about 15 ms for the Meridian) and throws the geometry away.
 */
export function measureModel(root) {
  const b = bakeModel(root);
  const out = { box: b.box.clone(), body: { ...b.body }, wingTipZ: b.wingTipZ, halfSpan: b.halfSpan, wingLE: b.wingLE };
  disposeBake(b);
  for (const p of b.parts) if (p.plain) p.material.dispose();
  return out;
}

/** Free a bake's geometry (its materials belong to the model factory's caches). */
export function disposeBake(bake) {
  if (!bake) return;
  for (const p of bake.parts) p.geometry.dispose();
}
