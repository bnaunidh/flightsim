/**
 * The SCP Foundation's northern Site, on Nunatak Reach — and everything else
 * that map does that no other map does.
 *
 * SCP Foundation content by the SCP Wiki community, CC BY-SA 3.0,
 * scpwiki.com. The name "SCP Foundation", the Site, the Class-D and the
 * three-arrows mark drawn by signTexture() below are the SCP Wiki
 * community's, adapted here under that licence (LICENSE, "SCP FOUNDATION
 * CONTENT"). Everything in this file that is based on them stays CC BY-SA
 * 3.0; the code round them is the game's.
 *
 * WHAT IS BUILT (buildWorld, only on a map with an `scp` block):
 *
 *   The Site     a fenced compound on the yard the map levelled: chain-link
 *                on posts with a wire along the top, a guard tower at each
 *                corner with a searchlight that sweeps slowly, the main
 *                block with its blast doors CLOSED, an annex, a vent tower
 *                and a mast with a red lamp, floodlights over the apron,
 *                warning signs on the fence and a plaque over the door. Every
 *                building, every tower, the fence and the gate barrier are
 *                solid (terrain.js addObstacleAt): you cannot fly or taxi
 *                into any of it, and there is no inside to get to.
 *   The ice      a sheet over every flat the map surfaced 'ice': the Site's
 *                airstrip, with the black cone markers an ice strip really
 *                has along its edges, and the frozen lake on the plain.
 *   The weather  ground fog over the yard, drifting; the snow itself is
 *                world/precip.js (`precip: 'snow'` on the map).
 *   De-icing     a de-icing truck parked by the transfer's stand at the base, with
 *                its boom up: cheap (nine boxes), and it says "cold" the
 *                moment you see the apron.
 *
 * WHAT IT DOES (update):
 *
 *   - sweeps the searchlights (0.18 rad/s: nothing here flashes) and pulses
 *     the mast lamp, capped under Reduce flashing like every other beacon;
 *   - says "braking action poor" ONCE when your wheels are on ice;
 *   - sounds the Site's siren — two slow tones, quiet, faded by distance —
 *     only while the game's audio is running and not muted (the owner's
 *     rule: sound is off unless the player switched it on);
 *   - walks the people of the Class-D transfer (game/extra/scp.js): the
 *     escort and four Class-D in orange, from the van up the C-17's cargo
 *     ramp into its hold at the base, and out of it, down the ramp and to
 *     the blast door at the Site (the side door, for an aircraft with no
 *     ramp). Simple figures (staff/person.js), walking; nothing else
 *     is shown.
 *
 * Spooky atmosphere only. No creatures, nothing behind the doors, nothing
 * happens to anybody.
 */

import * as THREE from '../vendor/three.module.js';
import { registerExtension } from '../game/extensions.js';
import { MAP, heightAt, addObstacleAt, iceAt, FLATS } from '../world/terrain.js';
import { airportLayout, standTaken } from '../world/airport-layout.js';
import { C17_RAMP } from '../aircraft/extra/c17.js';
import { FLASH, CAPS } from '../render/flash-safety.js';
import { createPerson, posePerson, disposePerson } from './staff/person.js';

const D2R = Math.PI / 180;

/** Metres from the Site's centre inside which the siren can be heard. */
const SIREN_RANGE = 1100;
/** Seconds between the siren's two-tone calls. */
const SIREN_PERIOD = 3.2;

/** Walking speeds, metres a second: the escort sets the pace. */
const WALK = { guard: 1.5, classd: 1.42 };
/** Close enough to the door (or the aircraft) to count as there. */
const ARRIVED = 2.4;

const S = {
  sim: null,
  group: null,
  site: null,
  /** The searchlight pivots and their beams. */
  sweeps: [],
  /** Lamps that come on at night, and the one that pulses. */
  nightMats: [],
  beaconMat: null,
  beamMat: null,
  fogs: [],
  t: 0,
  sirenT: 0,
  saidIce: false,
  offIceFor: 0,
  /** The Class-D transfer's people, while any are out. */
  transfer: null,
  built: false,
};

/* ------------------------------------------------------------------ */
/* Textures (canvas, procedural)                                        */
/* ------------------------------------------------------------------ */

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/**
 * The Foundation's mark, drawn from its description: a ring, and three
 * arrows at a hundred and twenty degrees pointing in at the centre. Vector
 * drawn here, nothing copied; the mark itself is the SCP Wiki community's
 * (CC BY-SA 3.0).
 */
function drawMark(ctx, cx, cy, r, colour = '#1a1d22') {
  ctx.save();
  ctx.strokeStyle = colour;
  ctx.fillStyle = colour;
  ctx.lineWidth = Math.max(2, r * 0.12);
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = Math.max(1.5, r * 0.07);
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.42, 0, Math.PI * 2);
  ctx.stroke();
  for (let i = 0; i < 3; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / 3;
    const ox = cx + Math.cos(a) * r * 0.98;
    const oy = cy + Math.sin(a) * r * 0.98;
    const ix = cx + Math.cos(a) * r * 0.52;
    const iy = cy + Math.sin(a) * r * 0.52;
    ctx.lineWidth = Math.max(2, r * 0.13);
    ctx.beginPath();
    ctx.moveTo(ox, oy);
    ctx.lineTo(ix, iy);
    ctx.stroke();
    // The head, pointing in.
    const hx = cx + Math.cos(a) * r * 0.44;
    const hy = cy + Math.sin(a) * r * 0.44;
    const w = r * 0.2;
    ctx.beginPath();
    ctx.moveTo(hx, hy);
    ctx.lineTo(hx + Math.cos(a + 2.4) * w, hy + Math.sin(a + 2.4) * w);
    ctx.lineTo(hx + Math.cos(a - 2.4) * w, hy + Math.sin(a - 2.4) * w);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function textureOf(c) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/* ------------------------------------------------------------------ */
/* Batching                                                            */
/* ------------------------------------------------------------------ */

/**
 * Static parts drawn with one material are one mesh. The Site was ninety-odd
 * draw calls as separate boxes (measured in node); the fence, the towers,
 * the block, the truck and the van are a few dozen now. `add` takes a
 * geometry (any of three's primitives: position, normal, uv), where it
 * goes, and how it is turned; `flush` makes one Mesh per material.
 */
class Batch {
  constructor(group) {
    this.group = group;
    this.byMat = new Map();
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3();
  }

  add(geo, mat, x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    this._e.set(rx, ry, rz);
    this._q.setFromEuler(this._e);
    this._p.set(x, y, z);
    this._s.set(sx, sy, sz);
    this._m.compose(this._p, this._q, this._s);
    g.applyMatrix4(this._m);
    if (!this.byMat.has(mat)) this.byMat.set(mat, []);
    this.byMat.get(mat).push(g);
    return g;
  }

  flush(name = 'batch') {
    const out = [];
    for (const [mat, geos] of this.byMat) {
      let n = 0;
      for (const g of geos) n += g.attributes.position.count;
      const pos = new Float32Array(n * 3);
      const nrm = new Float32Array(n * 3);
      const uv = new Float32Array(n * 2);
      let at = 0;
      for (const g of geos) {
        const c = g.attributes.position.count;
        pos.set(g.attributes.position.array, at * 3);
        if (g.attributes.normal) nrm.set(g.attributes.normal.array, at * 3);
        if (g.attributes.uv) uv.set(g.attributes.uv.array, at * 2);
        at += c;
        g.dispose();
      }
      const merged = new THREE.BufferGeometry();
      merged.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      merged.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
      merged.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.name = `${name}:${mat.name || mat.uuid.slice(0, 4)}`;
      this.group.add(mesh);
      out.push(mesh);
    }
    this.byMat.clear();
    return out;
  }
}

/** The fence sign: white board, red band, the mark and the words. */
function signTexture() {
  const c = canvas(256, 192);
  try {
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#f2f3f0';
    ctx.fillRect(0, 0, 256, 192);
    ctx.fillStyle = '#b8231f';
    ctx.fillRect(0, 0, 256, 34);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 20px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('RESTRICTED AREA', 128, 25);
    drawMark(ctx, 48, 100, 34);
    ctx.fillStyle = '#1a1d22';
    ctx.textAlign = 'left';
    ctx.font = 'bold 17px sans-serif';
    ctx.fillText('SCP FOUNDATION', 96, 84);
    ctx.font = '13px sans-serif';
    ctx.fillText('Site-91 North', 96, 104);
    ctx.fillText('Authorised personnel only.', 96, 124);
    ctx.fillText('Do not approach the fence.', 96, 142);
    ctx.fillStyle = '#b8231f';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('SECURE · CONTAIN · PROTECT', 128, 176);
  } catch (e) {
    /* a page with no 2D canvas: a blank board */
  }
  return textureOf(c);
}

/** The plaque over the blast door: dark, the mark, the Site's name. */
function plaqueTexture() {
  const c = canvas(512, 160);
  try {
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#2a2e34';
    ctx.fillRect(0, 0, 512, 160);
    ctx.strokeStyle = '#8b9199';
    ctx.lineWidth = 6;
    ctx.strokeRect(8, 8, 496, 144);
    drawMark(ctx, 84, 80, 52, '#d6dadf');
    ctx.fillStyle = '#e8ebee';
    ctx.textAlign = 'left';
    ctx.font = 'bold 44px sans-serif';
    ctx.fillText('SCP FOUNDATION', 160, 72);
    ctx.font = '28px sans-serif';
    ctx.fillStyle = '#b9c0c8';
    ctx.fillText('SITE-91 NORTH · CONTAINMENT', 160, 116);
  } catch (e) {
    /* blank */
  }
  return textureOf(c);
}

/** Yellow and black hazard stripes for the blast doors' edges. */
function stripeTexture() {
  const c = canvas(128, 128);
  try {
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#d8b21a';
    ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = '#17181a';
    for (let i = -128; i < 256; i += 32) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i + 16, 0);
      ctx.lineTo(i + 16 + 128, 128);
      ctx.lineTo(i + 128, 128);
      ctx.closePath();
      ctx.fill();
    }
  } catch (e) {
    /* blank */
  }
  const t = textureOf(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Chain-link: a fine diamond lattice on a transparent board. */
function wireTexture() {
  const c = canvas(64, 64);
  try {
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, 64, 64);
    ctx.strokeStyle = 'rgba(190,196,204,0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = -64; i < 128; i += 16) {
      ctx.moveTo(i, 0);
      ctx.lineTo(i + 64, 64);
      ctx.moveTo(i + 64, 0);
      ctx.lineTo(i, 64);
    }
    ctx.stroke();
  } catch (e) {
    /* blank */
  }
  const t = textureOf(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** A soft white disc for the ground fog. */
function fogTexture() {
  const c = canvas(128, 128);
  try {
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
    g.addColorStop(0, 'rgba(228,234,242,0.55)');
    g.addColorStop(0.6, 'rgba(228,234,242,0.22)');
    g.addColorStop(1, 'rgba(228,234,242,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
  } catch (e) {
    /* blank */
  }
  return textureOf(c);
}

/* ------------------------------------------------------------------ */
/* Builders                                                            */
/* ------------------------------------------------------------------ */

/** The lowest and highest ground under a footprint, so a slab stands on the hill. */
function groundSpan(x, z, w, d) {
  let lo = Infinity;
  let hi = -Infinity;
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, 0]]) {
    const h = heightAt(x + (sx * w) / 2, z + (sz * d) / 2);
    lo = Math.min(lo, h);
    hi = Math.max(hi, h);
  }
  return [lo, hi];
}

/** A solid box of a building: drawn into the batch, and registered as an obstacle. */
function block(batch, mat, x, z, w, h, d, what) {
  const [lo, hi] = groundSpan(x, z, w, d);
  const base = lo - 0.3;
  const top = hi + h;
  batch.add(new THREE.BoxGeometry(w, top - base, d), mat, x, (base + top) / 2, z);
  addObstacleAt(x, z, w, d, base, top - base, what);
  return { base, top };
}

/**
 * The ice: one sheet over every 'ice' flat on the map. The flat is level
 * ground already (terrain.js); this is the look of it, a hard pale sheet
 * with a little sky in it. The strip also gets its markers.
 */
function buildIce(group, quality) {
  const ice = new THREE.MeshStandardMaterial({
    color: 0xd6e4ee,
    roughness: 0.28,
    metalness: 0.06,
    envMapIntensity: 0.6,
  });
  const lake = new THREE.MeshStandardMaterial({
    color: 0xc4d8e6,
    roughness: 0.34,
    metalness: 0.05,
  });
  const marker = new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.9 });
  let strips = 0;
  for (const f of FLATS) {
    if (f.surface !== 'ice') continue;
    // The sheet is the flat itself, a little over: the blend skirt round a
    // flat slopes UP out of it, and a sheet laid over the skirt cuts into it
    // in a ragged line. A lake is round; a strip is the rectangle it is.
    const w = f.x1 - f.x0 + 8;
    const d = f.z1 - f.z0 + 8;
    const geo = f.kind === 'lake' ? new THREE.CircleGeometry(Math.min(w, d) / 2, 40) : new THREE.PlaneGeometry(w, d);
    geo.rotateX(-Math.PI / 2);
    const sheet = new THREE.Mesh(geo, f.kind === 'lake' ? lake : ice);
    sheet.position.set(f.cx, f.y + 0.06, f.cz);
    sheet.receiveShadow = true;
    sheet.name = `ice:${f.id}`;
    group.add(sheet);
    if (f.kind !== 'strip') continue;
    strips++;
    // Edge markers: the black cones an ice strip is marked with, both
    // sides every 60 m, bigger pairs at the thresholds.
    const along = w > d;
    const L = along ? f.x1 - f.x0 : f.z1 - f.z0;
    const W = along ? f.z1 - f.z0 : f.x1 - f.x0;
    const n = Math.floor(L / 60) + 1;
    const cones = new THREE.InstancedMesh(new THREE.ConeGeometry(0.5, 1.4, 6), marker, n * 2);
    const o = new THREE.Object3D();
    let k = 0;
    for (let i = 0; i < n; i++) {
      const s = -L / 2 + (L / (n - 1)) * i;
      for (const side of [-1, 1]) {
        const x = along ? f.cx + s : f.cx + (side * W) / 2 + side * 3;
        const z = along ? f.cz + (side * W) / 2 + side * 3 : f.cz + s;
        o.position.set(x, f.y + 0.7, z);
        o.updateMatrix();
        cones.setMatrixAt(k++, o.matrix);
      }
    }
    cones.instanceMatrix.needsUpdate = true;
    cones.name = `ice-markers:${f.id}`;
    group.add(cones);
    // Threshold bars, dark, so the ends read from the air: one mesh for both.
    const bars = new Batch(group);
    for (const end of [-1, 1]) {
      bars.add(new THREE.PlaneGeometry(along ? 6 : W - 8, along ? W - 8 : 6), marker,
        along ? f.cx + (end * L) / 2 - end * 12 : f.cx, f.y + 0.1, along ? f.cz : f.cz + (end * L) / 2 - end * 12, -Math.PI / 2);
    }
    bars.flush(`ice-bars:${f.id}`);
    void quality;
  }
  return strips;
}

/** The compound. Returns what was built, for the tests and the mission. */
function buildSite(group, cfg, quality) {
  const low = quality === 'low';
  const named = (m, n) => { m.name = n; return m; };
  const concrete = named(new THREE.MeshStandardMaterial({ color: 0x8c9096, roughness: 0.92, metalness: 0.02 }), 'concrete');
  const darkConcrete = named(new THREE.MeshStandardMaterial({ color: 0x5f646b, roughness: 0.95 }), 'dark');
  const steel = named(new THREE.MeshStandardMaterial({ color: 0x4a5058, roughness: 0.55, metalness: 0.5 }), 'steel');
  const galv = named(new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.5, metalness: 0.6 }), 'galv');
  const glass = named(new THREE.MeshStandardMaterial({ color: 0x1c2630, roughness: 0.2, metalness: 0.3, emissive: 0x3a5a6a, emissiveIntensity: 0.3 }), 'glass');
  const yardMat = named(new THREE.MeshStandardMaterial({ color: 0x7c8187, roughness: 0.95 }), 'yard');
  const paint = named(new THREE.MeshBasicMaterial({ color: 0xe8c23a }), 'paint');
  const stripes = named(new THREE.MeshStandardMaterial({ map: stripeTexture(), roughness: 0.7 }), 'stripes');
  const doorMat = named(new THREE.MeshStandardMaterial({ color: 0x556070, roughness: 0.45, metalness: 0.65 }), 'door');
  const lampMat = named(new THREE.MeshStandardMaterial({ color: 0xfff6dc, emissive: 0xfff0c8, emissiveIntensity: 0.2, roughness: 0.4 }), 'lamp');
  S.nightMats.push(lampMat, glass);
  const built = { towers: [], buildings: [], signs: 0, obstacles: 0 };
  const y = heightAt(cfg.door.x, cfg.door.z);
  const Y = cfg.yard;
  const cx = (Y.x0 + Y.x1) / 2;
  const cz = (Y.z0 + Y.z1) / 2;
  const W = Y.x1 - Y.x0;
  const D = Y.z1 - Y.z0;
  const B = new Batch(group);
  const o = new THREE.Object3D();

  /* ---- the yard: a concrete slab, and the apron out to the gate ---- */
  B.add(new THREE.PlaneGeometry(W + 20, D + 20), yardMat, cx, y + 0.05, cz, -Math.PI / 2);
  const apronD = Math.abs(cfg.strip.cz - cfg.strip.halfWidth - Y.z1) + 10;
  B.add(new THREE.PlaneGeometry(150, apronD), yardMat, cfg.gate.x, y + 0.05, (Y.z1 + cfg.strip.cz - cfg.strip.halfWidth) / 2, -Math.PI / 2);
  // The gate stand: a painted T, where the aeroplane is told to stop.
  B.add(new THREE.PlaneGeometry(14, 0.7), paint, cfg.gate.x, y + 0.12, cfg.gate.z - 6, -Math.PI / 2);
  B.add(new THREE.PlaneGeometry(0.7, 22), paint, cfg.gate.x, y + 0.12, cfg.gate.z + 5, -Math.PI / 2);

  /* ---- the fence ---- */
  const post = new THREE.BoxGeometry(0.16, 3.6, 0.16);
  const perim = 2 * (W + D);
  const nPosts = Math.ceil(perim / 6);
  const posts = new THREE.InstancedMesh(post, galv, nPosts);
  let k = 0;
  const corners = [[Y.x0, Y.z0], [Y.x1, Y.z0], [Y.x1, Y.z1], [Y.x0, Y.z1]];
  for (let s = 0; s < 4 && k < nPosts; s++) {
    const [ax, az] = corners[s];
    const [bx, bz] = corners[(s + 1) % 4];
    const len = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.round(len / 6));
    for (let i = 0; i < n && k < nPosts; i++) {
      const t = i / n;
      const x = ax + (bx - ax) * t;
      const z = az + (bz - az) * t;
      o.position.set(x, heightAt(x, z) + 1.8, z);
      o.rotation.set(0, 0, 0);
      o.scale.setScalar(1);
      o.updateMatrix();
      posts.setMatrixAt(k++, o.matrix);
    }
  }
  posts.count = k;
  posts.instanceMatrix.needsUpdate = true;
  posts.name = 'scp-fence-posts';
  group.add(posts);
  const wire = named(new THREE.MeshStandardMaterial({
    map: wireTexture(),
    transparent: true,
    alphaTest: 0.3,
    side: THREE.DoubleSide,
    roughness: 0.6,
    metalness: 0.4,
    depthWrite: false,
  }), 'wire');
  const gateHalf = 6; // the sally gate in the south side, either side of the apron's line
  const panel = (ax, az, bx, bz, what) => {
    const len = Math.hypot(bx - ax, bz - az);
    const geo = new THREE.PlaneGeometry(len, 3.4);
    // The lattice repeats every three metres along the panel: the UVs, not
    // the shared texture, so every panel has its own repeat in one mesh.
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * (len / 3));
    const mx = (ax + bx) / 2;
    const mz = (az + bz) / 2;
    const ry = Math.atan2(bx - ax, -(bz - az)) + Math.PI / 2;
    B.add(geo, wire, mx, heightAt(mx, mz) + 1.75, mz, 0, ry);
    // Barbed wire along the top: a dark line.
    B.add(new THREE.BoxGeometry(len, 0.12, 0.12), steel, mx, heightAt(mx, mz) + 3.55, mz, 0, ry);
    // Solid: a thin wall. Nothing flies or taxis through a fence.
    const alongX = Math.abs(bx - ax) > Math.abs(bz - az);
    addObstacleAt(mx, mz, alongX ? len : 0.6, alongX ? 0.6 : len, heightAt(mx, mz) - 0.5, 4.2, what);
    built.obstacles++;
  };
  const F = 'You hit the Site\'s fence';
  panel(Y.x0, Y.z0, Y.x1, Y.z0, F);
  panel(Y.x1, Y.z0, Y.x1, Y.z1, F);
  panel(Y.x0, Y.z1, Y.x0, Y.z0, F);
  // South side, in two panels either side of the gate.
  panel(Y.x1, Y.z1, cfg.gate.x + gateHalf, Y.z1, F);
  panel(cfg.gate.x - gateHalf, Y.z1, Y.x0, Y.z1, F);
  // The gate: a barrier arm, down, and two gate posts. The arm is its own
  // mesh on a pivot at the west post so it can lift while the escort walks
  // the Class-D through (beginHandover); the obstacle stays down whatever
  // the arm shows — the gap is for people, not aeroplanes.
  const armLen = gateHalf * 2 - 0.6;
  const armGeo = new THREE.BoxGeometry(armLen, 0.22, 0.22);
  armGeo.translate(armLen / 2, 0, 0);
  const arm = new THREE.Mesh(armGeo, stripes);
  arm.position.set(cfg.gate.x - gateHalf + 0.3, y + 1.05, Y.z1);
  arm.name = 'scp-gate-arm';
  arm.castShadow = true;
  group.add(arm);
  S.gateArm = arm;
  addObstacleAt(cfg.gate.x, Y.z1, gateHalf * 2, 0.5, y - 0.5, 1.7, 'You hit the Site\'s gate barrier');
  built.obstacles++;
  for (const sx of [-1, 1]) B.add(new THREE.BoxGeometry(0.5, 2.6, 0.5), darkConcrete, cfg.gate.x + sx * gateHalf, y + 1.3, Y.z1);

  /* ---- guard towers, one at each corner ---- */
  const legGeo = new THREE.BoxGeometry(0.34, 1, 0.34);
  const legs = new THREE.InstancedMesh(legGeo, steel, 16);
  const cabinGeo = new THREE.BoxGeometry(4.2, 2.8, 4.2);
  const roofGeo = new THREE.ConeGeometry(3.6, 1.6, 4);
  roofGeo.rotateY(Math.PI / 4);
  const beamGeo = new THREE.ConeGeometry(8, 90, 12, 1, true);
  beamGeo.translate(0, -45, 0);
  beamGeo.rotateX(-Math.PI / 2); // apex at the lamp, the beam along +Z
  const beamMat = named(new THREE.MeshBasicMaterial({
    color: 0xfff1cf,
    transparent: true,
    opacity: 0.0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  }), 'beam');
  S.beamMat = beamMat;
  let li = 0;
  corners.forEach(([tx0, tz0], i) => {
    const inX = tx0 === Y.x0 ? 1 : -1;
    const inZ = tz0 === Y.z0 ? 1 : -1;
    const tx = tx0 + inX * 7;
    const tz = tz0 + inZ * 7;
    const g0 = heightAt(tx, tz);
    const H = 11;
    for (const [lx, lz] of [[-1.5, -1.5], [1.5, -1.5], [-1.5, 1.5], [1.5, 1.5]]) {
      o.position.set(tx + lx, g0 + H / 2 - 0.2, tz + lz);
      o.scale.set(1, H + 0.4, 1);
      o.rotation.set(0, 0, 0);
      o.updateMatrix();
      legs.setMatrixAt(li++, o.matrix);
    }
    B.add(cabinGeo, i % 2 ? darkConcrete : concrete, tx, g0 + H + 1.4, tz);
    B.add(new THREE.BoxGeometry(4.3, 1.1, 4.3), glass, tx, g0 + H + 1.9, tz);
    B.add(roofGeo, steel, tx, g0 + H + 3.6, tz);
    // The searchlight: a housing on the roof, lit, and the beam it throws.
    // These turn, so they are the one thing per tower not in the batch.
    const pivot = new THREE.Group();
    pivot.position.set(tx, g0 + H + 4.6, tz);
    pivot.rotation.y = Math.atan2(-inX, -inZ) + (i - 1.5) * 0.3;
    const tilt = new THREE.Group();
    tilt.rotation.x = 0.42;
    pivot.add(tilt);
    const housing = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.55, 0.9, 10), lampMat);
    housing.rotation.x = Math.PI / 2;
    housing.position.z = 0.3;
    tilt.add(housing);
    const beam = new THREE.Mesh(beamGeo, beamMat);
    beam.position.z = 0.8;
    beam.renderOrder = 6;
    beam.frustumCulled = false;
    tilt.add(beam);
    group.add(pivot);
    S.sweeps.push({ pivot, base: pivot.rotation.y, phase: i * 1.9, span: 0.55 + (i % 2) * 0.2 });
    addObstacleAt(tx, tz, 5, 5, g0 - 0.3, H + 5.5, 'You flew into a guard tower');
    built.obstacles++;
    built.towers.push({ x: tx, z: tz, top: g0 + H + 5.2 });
  });
  legs.instanceMatrix.needsUpdate = true;
  legs.name = 'scp-tower-legs';
  group.add(legs);

  /* ---- the main block, the blast doors, the annex, the vent tower, the mast ---- */
  const bx = cfg.door.x;
  const bz = cfg.door.z - 17; // the door is on the south face
  block(B, concrete, bx, bz, 90, 14, 34, 'You flew into the Site');
  built.buildings.push({ name: 'main block', x: bx, z: bz, w: 90, d: 34, h: 14 });
  built.obstacles++;
  // A band of dark concrete round the base.
  B.add(new THREE.BoxGeometry(90.4, 1.2, 34.4), darkConcrete, bx, y + 2.6, bz);
  // The blast doors: two slabs, shut, set in a steel frame on the south face.
  B.add(new THREE.BoxGeometry(16.4, 10.4, 1.2), steel, bx, y + 5.1, cfg.door.z + 0.3);
  const doors = new Batch(group);
  for (const sx of [-1, 1]) {
    doors.add(new THREE.BoxGeometry(7.4, 9.4, 0.7), doorMat, bx + sx * 3.85, y + 4.7, cfg.door.z + 0.75);
    B.add(new THREE.BoxGeometry(0.5, 9.4, 0.75), stripes, bx + sx * 0.4, y + 4.7, cfg.door.z + 0.78);
  }
  doors.flush('scp-blast-door').forEach((m) => { m.name = 'scp-blast-door'; });
  // The plaque over the door.
  const plaque = new THREE.Mesh(new THREE.PlaneGeometry(12.8, 4), new THREE.MeshStandardMaterial({ map: plaqueTexture(), roughness: 0.6 }));
  plaque.position.set(bx, y + 12, cfg.door.z + 0.95);
  plaque.name = 'scp-plaque';
  group.add(plaque);
  // Two small floodlights over the door, a lit strip on the face at night.
  for (const sx of [-1, 1]) B.add(new THREE.BoxGeometry(1.2, 0.5, 0.8), lampMat, bx + sx * 9, y + 10.4, cfg.door.z + 0.9);
  // The annex, behind and to the west; the vent tower and the mast east.
  block(B, darkConcrete, bx - 30, bz - 30, 40, 8, 26, 'You flew into the Site');
  built.buildings.push({ name: 'annex', x: bx - 30, z: bz - 30, w: 40, d: 26, h: 8 });
  built.obstacles++;
  block(B, concrete, bx + 36, bz - 27, 9, 22, 9, 'You flew into the Site\'s vent tower');
  built.buildings.push({ name: 'vent tower', x: bx + 36, z: bz - 27, w: 9, d: 9, h: 22 });
  built.obstacles++;
  for (let i = 0; i < 3; i++) B.add(new THREE.BoxGeometry(2.4, 0.8, 2.4), steel, bx + 33 + i * 3, y + 22.6, bz - 27);
  const mastH = 38;
  B.add(new THREE.CylinderGeometry(0.22, 0.5, mastH, 6), galv, bx + 52, y + mastH / 2, bz - 44);
  addObstacleAt(bx + 52, bz - 44, 2, 2, y - 0.3, mastH + 1, 'You flew into the Site\'s mast');
  built.obstacles++;
  const beacon = new THREE.MeshBasicMaterial({ color: 0xff3b2f, transparent: true, opacity: 0.9 });
  S.beaconMat = beacon;
  const lampTop = new THREE.Mesh(new THREE.SphereGeometry(0.55, 8, 6), beacon);
  lampTop.position.set(bx + 52, y + mastH + 0.4, bz - 44);
  lampTop.name = 'scp-mast-lamp';
  group.add(lampTop);

  /* ---- floodlight masts over the apron ---- */
  for (const sx of [-1, 1]) {
    const px = cfg.gate.x + sx * 34;
    const pz = cfg.gate.z + 8;
    B.add(new THREE.CylinderGeometry(0.25, 0.4, 16, 6), galv, px, y + 8, pz);
    B.add(new THREE.BoxGeometry(2.6, 0.5, 1), lampMat, px, y + 16.2, pz, 0.4);
    addObstacleAt(px, pz, 1.2, 1.2, y - 0.3, 17, 'You flew into a floodlight');
    built.obstacles++;
  }

  /* ---- warning signs along the fence, facing out ---- */
  const signMat = new THREE.MeshStandardMaterial({ map: signTexture(), roughness: 0.7, side: THREE.DoubleSide });
  const signGeo = new THREE.PlaneGeometry(1.6, 1.2);
  const spots = [];
  const nPer = low ? 2 : 3;
  for (let s = 0; s < 4; s++) {
    const [ax, az] = corners[s];
    const [bxx, bzz] = corners[(s + 1) % 4];
    for (let i = 1; i <= nPer; i++) {
      const t = i / (nPer + 1);
      const x = ax + (bxx - ax) * t;
      const z = az + (bzz - az) * t;
      // Skip the gate's own stretch; the apron signs below cover it.
      if (Math.abs(z - Y.z1) < 1 && Math.abs(x - cfg.gate.x) < 40) continue;
      const outX = Math.abs(bzz - az) > 0 ? (ax > cx ? 1 : -1) : 0;
      const outZ = Math.abs(bxx - ax) > 0 ? (az > cz ? 1 : -1) : 0;
      spots.push({ x: x + outX * 0.4, z: z + outZ * 0.4, ry: Math.atan2(outX, outZ) });
    }
  }
  // Two big ones on the apron, either side of the gate, facing the strip.
  for (const sx of [-1, 1]) spots.push({ x: cfg.gate.x + sx * 14, z: Y.z1 + 1.2, ry: 0, big: true });
  const signs = new THREE.InstancedMesh(signGeo, signMat, spots.length);
  spots.forEach((sp, i) => {
    o.position.set(sp.x, heightAt(sp.x, sp.z) + (sp.big ? 2.2 : 1.9), sp.z);
    o.rotation.set(0, sp.ry, 0);
    o.scale.setScalar(sp.big ? 2.2 : 1);
    o.updateMatrix();
    signs.setMatrixAt(i, o.matrix);
    if (sp.big) B.add(new THREE.BoxGeometry(0.16, 2.4, 0.16), galv, sp.x, heightAt(sp.x, sp.z) + 1.2, sp.z);
  });
  signs.instanceMatrix.needsUpdate = true;
  signs.name = 'scp-signs';
  group.add(signs);
  built.signs = spots.length;

  // Everything static, one mesh per material.
  const meshes = B.flush('scp');
  for (const m of meshes) {
    if (m.material === concrete) m.name = 'scp-main-block';
    else if (m.material === wire) m.name = 'scp-fence';
    else if (m.material === yardMat || m.material === paint) m.receiveShadow = true;
  }

  /* ---- ground fog over the yard: a few soft sheets, drifting ---- */
  const fogMat = new THREE.MeshBasicMaterial({ map: fogTexture(), transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide });
  const nFog = low ? 3 : 6;
  for (let i = 0; i < nFog; i++) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(220, 220), fogMat);
    m.rotation.x = -Math.PI / 2;
    const fx = cx + ((i % 3) - 1) * 120;
    const fz = cz + (i < 3 ? -40 : 90);
    m.position.set(fx, y + 2.2 + (i % 2) * 1.6, fz);
    m.renderOrder = 5;
    m.name = 'scp-fog';
    group.add(m);
    S.fogs.push({ mesh: m, x: fx, z: fz, phase: i * 1.3 });
  }

  built.doorY = y;
  return built;
}

/**
 * The C-17 the transfer is flown in (game/mission-aircraft.js): its span and
 * length, rounded up, for the stand it parks on and the vehicles round it.
 */
export const TRANSFER_CRAFT = Object.freeze({ id: 'c17', halfSpan: 26, noseZ: -22, tailZ: 27 });
/** Where the C-17's wheels meet the ground, in its model's frame (aircraft/extra/c17.js DESC.c17.ground). */
const C17_WHEELS_Y = -4.5;

/**
 * The stand the transfer starts on: the first one at the base with room for
 * the C-17. Every stand at Caribou is a medium one (44 m apart, for a 38 m
 * wing), so it is the first EMPTY stand whose wing tips clear the aeroplanes
 * parked on the stands either side by four metres — the wing reaches over
 * the empty stands next door, as wide-bodies do on a fighter apron. The base's
 * first stand when none has room (or there is no layout), as before.
 */
export function transferStand() {
  let lay = null;
  try {
    lay = airportLayout();
  } catch (e) {
    return null;
  }
  const stands = (lay && lay.stands) || [];
  if (!stands.length) return null;
  const reach = TRANSFER_CRAFT.halfSpan + 4;
  /*
   * A stand the base MEANS to fill counts as filled whether or not this
   * detail level drew its jet (standTaken leaves those out): on Low no
   * parked aeroplane is drawn, every stand looked free, and the transfer
   * started on stand 1 instead of stand 4 — 26 m west of taxiway A2, so the
   * push (which ends facing west) pointed away from the taxiway the arrow
   * showed, the words said "west, left at the first taxiway" (A1, 460 m
   * on, past the hangar), and a pilot turning back for A2 swung the C-17
   * into the van (checker, 2026-10-26). One stand at every detail level.
   */
  const filled = (st) => standTaken(st) || !!st.occupant;
  const fits = (st) => {
    if (filled(st)) return false;
    for (const q of stands) {
      if (q === st || !filled(q)) continue;
      // The neighbour's aeroplane, at most its stand's own half-span out from its middle.
      const half = (q.maxSpan || q.pitch || 40) / 2;
      if (Math.hypot(q.x - st.x, q.z - st.z) < reach + half) return false;
    }
    return true;
  };
  return stands.find(fits) || stands[0];
}

/** World point at body (x right, z aft) of an aeroplane standing at (px, pz) facing headingDeg. */
function bodyPoint(px, pz, headingDeg, bx, bz) {
  const h = (headingDeg || 0) * D2R;
  const fx = Math.sin(h);
  const fz = -Math.cos(h);
  const rx = Math.cos(h);
  const rz = Math.sin(h);
  return { x: px + rx * bx - fx * bz, z: pz + rz * bx - fz * bz };
}

/**
 * A de-icing truck by the transfer's stand at the base: a cab, a tank, a boom up
 * on a knuckle and the basket at the end of it. Four meshes (paint, dark,
 * tank, glass). Returns where it stands, or null if the field has no
 * stands to park it by.
 */
function buildDeicer(group) {
  const st = transferStand();
  if (!st) return null;
  const h = (st.headingDeg || 0) * D2R;
  // Off the C-17's right wing tip and a little ahead of it, facing the same way:
  // clear of the wing, and of every way the tug can swing it off the stand
  // (measured: 15 m from the nearest point of the push either way round).
  const at = bodyPoint(st.x, st.z, st.headingDeg, TRANSFER_CRAFT.halfSpan + 12, -10);
  const x = at.x;
  const z = at.z;
  const y = heightAt(x, z);
  const t = new THREE.Group();
  t.name = 'deicing-truck';
  t.position.set(x, y, z);
  t.rotation.y = -h;
  const paint = new THREE.MeshStandardMaterial({ color: 0xe8b826, roughness: 0.55, metalness: 0.2 });
  paint.name = 'paint';
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a2d31, roughness: 0.8 });
  dark.name = 'dark';
  const tank = new THREE.MeshStandardMaterial({ color: 0xdfe3e6, roughness: 0.4, metalness: 0.4 });
  tank.name = 'tank';
  const glass = new THREE.MeshStandardMaterial({ color: 0x1c2630, roughness: 0.2, metalness: 0.3 });
  glass.name = 'glass';
  const B = new Batch(t);
  B.add(new THREE.BoxGeometry(2.5, 1.4, 7.6), dark, 0, 1.0, 0); // chassis
  B.add(new THREE.BoxGeometry(2.4, 1.6, 2.2), paint, 0, 2.5, -2.4); // cab
  B.add(new THREE.BoxGeometry(2.3, 0.9, 0.1), glass, 0, 2.7, -3.52); // windscreen
  const cyl = new THREE.CylinderGeometry(1.0, 1.0, 4.2, 12);
  cyl.rotateX(Math.PI / 2);
  B.add(cyl, tank, 0, 2.4, 1.2); // the fluid tank
  B.add(new THREE.BoxGeometry(0.5, 0.5, 2.2), dark, 0, 3.7, 1.0); // turret base
  B.add(new THREE.BoxGeometry(0.35, 0.35, 7), paint, 0, 6.2, -1.2, 0.95); // boom, up
  B.add(new THREE.BoxGeometry(1.6, 1.1, 1.3), paint, 0, 9.3, -4.3); // the basket
  B.add(new THREE.BoxGeometry(0.2, 0.2, 1.6), dark, 0, 9.6, -5.5); // the nozzle
  const wheel = new THREE.CylinderGeometry(0.5, 0.5, 0.4, 10);
  wheel.rotateZ(Math.PI / 2);
  for (const [wx, wz] of [[-1.2, -2.4], [1.2, -2.4], [-1.2, 2.2], [1.2, 2.2]]) B.add(wheel, dark, wx, 0.5, wz);
  B.flush('deicer');
  group.add(t);
  addObstacleAt(x, z, 3.2, 8, y - 0.3, 4.2, 'You hit the de-icing truck');
  return { x, z, y, headingDeg: st.headingDeg };
}

/**
 * The van the Class-D arrive in, parked by the stand: a dark box van with a
 * barred rear window. Three meshes. Where the transfer's people step out of.
 *
 * Off the C-17's LEFT side, level with the foot of its cargo ramp and well
 * outboard of the tailplane, rear doors towards the ramp: the column walks
 * straight across to the ramp and up it. Not behind the aeroplane, where it
 * stood in the way of the tug: a pushback goes straight back from the stand
 * and swings the tail round one way or the other, and the van stood where
 * either swing put the tail (measured: the van here is 6 m from the nearest
 * point of either push).
 */
function buildVan(group, at) {
  if (!at) return null;
  const P = bodyPoint(at.x, at.z, at.headingDeg, -(TRANSFER_CRAFT.halfSpan + 8), C17_RAMP.rampEnd + 1.5);
  const foot = bodyPoint(at.x, at.z, at.headingDeg, 0, C17_RAMP.rampEnd + 1.5);
  const x = P.x;
  const z = P.z;
  const y = heightAt(x, z);
  const v = new THREE.Group();
  v.name = 'transfer-van';
  v.position.set(x, y, z);
  // Rear doors (+Z in its frame) facing the ramp.
  v.rotation.y = Math.atan2(foot.x - x, foot.z - z);
  const body = new THREE.MeshStandardMaterial({ color: 0x2b2f35, roughness: 0.6, metalness: 0.3 });
  body.name = 'body';
  const glass = new THREE.MeshStandardMaterial({ color: 0x15202a, roughness: 0.2, metalness: 0.3 });
  glass.name = 'glass';
  const trim = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.5, metalness: 0.6 });
  trim.name = 'trim';
  const B = new Batch(v);
  B.add(new THREE.BoxGeometry(2.2, 2.0, 5.6), body, 0, 1.6, 0.2);
  B.add(new THREE.BoxGeometry(2.1, 0.7, 1.0), glass, 0, 1.9, -2.6);
  B.add(new THREE.BoxGeometry(1.2, 0.5, 0.1), trim, 0, 2.0, 3.02); // the barred window
  const wheel = new THREE.CylinderGeometry(0.38, 0.38, 0.3, 10);
  wheel.rotateZ(Math.PI / 2);
  for (const [wx, wz] of [[-1.0, -1.8], [1.0, -1.8], [-1.0, 1.9], [1.0, 1.9]]) B.add(wheel, body, wx, 0.4, wz);
  B.flush('van');
  group.add(v);
  addObstacleAt(x, z, 5.8, 5.8, y - 0.3, 2.9, 'You hit the transport van');
  // The rear doors are at +Z in the van's frame.
  const back = new THREE.Vector3(0, 0, 3.6).applyAxisAngle(new THREE.Vector3(0, 1, 0), v.rotation.y);
  return { x, z, y, rearX: x + back.x, rearZ: z + back.z };
}

/* ------------------------------------------------------------------ */
/* The Class-D transfer's people                                       */
/* ------------------------------------------------------------------ */

function person(outfit, seed) {
  const p = createPerson({ outfit, seed, lite: true });
  p.userData.anim = p.userData.anim || { t: 0, walk: 0, run: 0, air: 0, wave: 0, stop: 0, pointL: 0, pointR: 0, hello: 0, phase: Math.random() * 6 };
  return p;
}

/**
 * Start a walk: six people (two of the escort, four Class-D) from `from`
 * towards wherever `target()` says, in a loose column with the escort
 * front and back. `onArrive(i)` as each gets there; `vanish` hides them
 * there (boarding). Clears any walk already going.
 */
function startWalk(sim, from, target, { vanish = false, label = '', via = null, ramp = null } = {}) {
  endWalk();
  const group = S.group || sim.scene;
  const people = [];
  const kinds = ['tactical', 'classd', 'classd', 'classd', 'classd', 'tactical'];
  // Down a ramp: they come out of the hold one after another, from inside, and walk down it to its foot first.
  const down = ramp && ramp.mode === 'down' ? ramp.geom() : null;
  kinds.forEach((kind, i) => {
    const p = person(kind, 31 + i * 7);
    const side = i % 2 ? 0.95 : -0.95;
    let x = from.x + side + (Math.random() - 0.5) * 0.4;
    let z = from.z + i * 1.5;
    if (down) {
      x = down.inside.x;
      z = down.inside.z;
    }
    p.position.set(x, down ? down.floorY : heightAt(x, z), z);
    if (down) p.visible = false;
    group.add(p);
    people.push({
      p, kind, i, x, z, speed: kind === 'tactical' ? WALK.guard : WALK.classd, behind: i * 1.5, side, done: false, pastVia: !via,
      // Up the ramp: climbing it once at its foot; down it: still to come out (from `out` seconds), or on the way down.
      climb: false, out: down ? i * 1.6 : 0, descending: !!down,
    });
  });
  S.transfer = { people, target, vanish, label, via, ramp, from: { x: from.x, z: from.z }, phase: 'walking', arrived: 0, t: 0 };
  return S.transfer;
}

/**
 * The C-17's cargo ramp where the aeroplane stands now: its foot on the
 * ground behind the tail, the point inside the hold the people walk to
 * (or come out of), and the cargo floor's height there. `open` while the
 * ramp is fully down (model userData.cargo); null for an aircraft with no
 * ramp (then the people use the side door, doorPointOf).
 */
export function rampOf(sim) {
  const ac = sim && sim.aircraft;
  const cargo = sim && sim.model && sim.model.userData && sim.model.userData.cargo;
  if (!ac || !ac.pos || !cargo || !(sim.aircraftType && sim.aircraftType.cargoRamp)) return null;
  const foot = bodyPoint(ac.pos.x, ac.pos.z, ac.heading, 0, C17_RAMP.rampEnd + 1.2);
  const hinge = bodyPoint(ac.pos.x, ac.pos.z, ac.heading, 0, C17_RAMP.hingeZ);
  const inside = bodyPoint(ac.pos.x, ac.pos.z, ac.heading, 0, C17_RAMP.hingeZ - 4);
  const g = heightAt(foot.x, foot.z);
  // The cargo floor's height over the ground the wheels stand on (the hinge's: the floor runs level forward of it).
  const rise = C17_RAMP.floorY - C17_WHEELS_Y;
  const amount = typeof cargo.amount === 'function' ? cargo.amount() : cargo.isOpen ? 1 : 0;
  const moving = (ac.groundSpeed || 0) > 0.8 || !ac.onGround;
  return { foot, hinge, inside, ground: g, floorY: g + rise, rise, open: amount > 0.97, amount, moving };
}

/** Height of a walker at (x, z) on the ramp (up from its foot to the hinge) or in the hold, from the ramp's geometry. */
function rampHeight(geom, x, z) {
  const ax = geom.hinge.x - geom.foot.x;
  const az = geom.hinge.z - geom.foot.z;
  const L2 = ax * ax + az * az || 1;
  const k = ((x - geom.foot.x) * ax + (z - geom.foot.z) * az) / L2;
  return geom.ground + geom.rise * Math.max(0, Math.min(1, k));
}

function endWalk() {
  if (!S.transfer) return;
  for (const w of S.transfer.people) {
    if (w.p.parent) w.p.parent.remove(w.p);
    try {
      disposePerson(w.p);
    } catch (e) {
      /* already gone */
    }
  }
  S.transfer = null;
}

function stepWalk(dt) {
  const T = S.transfer;
  if (!T || T.phase !== 'walking') return;
  T.t += dt;
  const end = T.target();
  if (!end) return;
  // The column's line. Measured from the start (or the gate they are routed
  // through) and not from each walker, or a walker to one side of the line
  // would chase a slot that moved as it walked. With a `via` the column
  // lines up on the via-to-end line on both legs, so the second leg is a
  // straight file through the gate, never through the fence beside it.
  const o = T.via || T.from;
  let dx = end.x - o.x;
  let dz = end.z - o.z;
  const L = Math.hypot(dx, dz) || 1;
  dx /= L;
  dz /= L;
  // Nobody walks into an aeroplane that is moving.
  const hold = end.moving;
  let allDone = true;
  let rank = 0;
  const geom = T.ramp ? T.ramp.geom() : null;
  for (const w of T.people) {
    if (w.done) continue;
    /*
     * The ramp (the C-17). Up: the head of the queue, at the foot, walks up
     * it into the hold and goes aboard there — not at the foot. Down: each
     * comes out of the hold in turn and walks down it to the foot, then on
     * with the column.
     */
    if (geom && (w.climb || w.descending)) {
      allDone = false;
      if (w.descending && T.t < w.out) continue;
      const to = w.climb ? geom.inside : geom.foot;
      const ex = to.x - w.x;
      const ez = to.z - w.z;
      const dist = Math.hypot(ex, ez);
      const speed = hold && w.climb ? 0 : Math.min(w.speed * 0.8, dist / Math.max(dt, 1e-3));
      if (speed > 0 && dist > 1e-3) {
        w.x += (ex / dist) * speed * dt;
        w.z += (ez / dist) * speed * dt;
        w.p.rotation.y = Math.atan2(-ex, -ez);
      }
      w.p.visible = true;
      w.p.position.set(w.x, rampHeight(geom, w.x, w.z), w.z);
      posePerson(w.p, dt, { speed });
      if (dist < 0.3) {
        if (w.climb) {
          w.climb = false;
          w.done = true;
          T.arrived++;
          w.p.visible = false;
        } else {
          w.descending = false;
        }
      }
      continue;
    }
    const tgt = w.pastVia ? end : T.via;
    // A slot behind the lead and to one side, so they arrive as a column.
    // Boarding is a queue: your place is behind the people still waiting,
    // so the next one steps up to the door as each goes aboard (nobody
    // vanishes seven metres short of it).
    const behind = T.vanish ? rank * 1.5 : w.behind;
    rank++;
    const sx = tgt.x - dx * behind - dz * w.side;
    const sz = tgt.z - dz * behind + dx * w.side;
    const ex = sx - w.x;
    const ez = sz - w.z;
    const dist = Math.hypot(ex, ez);
    const speed = hold || dist < 0.15 ? 0 : Math.min(w.speed, dist / Math.max(dt, 1e-3));
    if (speed > 0) {
      w.x += (ex / dist) * speed * dt;
      w.z += (ez / dist) * speed * dt;
      w.p.rotation.y = Math.atan2(-ex, -ez);
    }
    w.p.position.set(w.x, heightAt(w.x, w.z), w.z);
    posePerson(w.p, dt, { speed });
    allDone = false;
    if (!w.pastVia) {
      if (dist < 0.6) w.pastVia = true;
      continue;
    }
    // There: standing in your slot of the column (the lead at the door,
    // the rest in a short queue behind). Boarding: the head of the queue,
    // at the door, goes aboard.
    const toTarget = Math.hypot(end.x - w.x, end.z - w.z);
    const there = T.vanish ? behind === 0 && dist < 0.6 && !hold && !end.wait : dist < 0.6 && toTarget < ARRIVED + w.behind + 1.5;
    if (there && T.vanish && geom && T.ramp.mode === 'up') {
      // At the foot of the ramp: up it (the next one steps up to the foot behind).
      w.climb = true;
      continue;
    }
    if (there) {
      w.done = true;
      T.arrived++;
      if (T.vanish) w.p.visible = false;
    }
  }
  if (allDone || T.arrived === T.people.length) T.phase = 'done';
}

/**
 * The gate's barrier arm: up while a walk is going through it, down
 * otherwise. Slow (about two seconds), like a real one.
 */
function stepGate(dt) {
  const arm = S.gateArm;
  if (!arm) return;
  const T = S.transfer;
  const want = T && T.via && T.phase === 'walking' ? 1.45 : 0;
  const cur = arm.rotation.z;
  const step = 0.75 * dt;
  arm.rotation.z = Math.abs(want - cur) <= step ? want : cur + Math.sign(want - cur) * step;
}

/* ------------------------------------------------------------------ */
/* The siren                                                           */
/* ------------------------------------------------------------------ */

/**
 * Two slow tones, quiet, from the Site. Only while the audio is running and
 * not muted, and only through the environment bus the player can turn down:
 * the rule is that nothing makes a sound unless the player switched sound
 * on, and this is a feature's sound like any other.
 */
function siren(sim, dt) {
  const a = sim.audio;
  if (!a || !a.available || !a.mixer || a.mixer.muted || !a.mixer.busEnabled('environment')) return;
  const ac = sim.aircraft;
  if (!ac || !ac.pos || !S.site) return;
  const d = Math.hypot(ac.pos.x - S.site.cx, ac.pos.z - S.site.cz);
  if (d > SIREN_RANGE) return;
  S.sirenT -= dt;
  if (S.sirenT > 0) return;
  S.sirenT = SIREN_PERIOD;
  const gain = 0.05 * (1 - d / SIREN_RANGE);
  try {
    a.mixer.tone({ bus: 'environment', freq: 392, duration: 1.3, gain, type: 'triangle', attack: 0.25, sweepTo: 523 });
    setTimeout(() => {
      // Muted (or the bus switched off) in the 1.4 s since the first tone: stay quiet.
      if (!a.mixer.ctx || a.mixer.muted || !a.mixer.busEnabled('environment')) return;
      a.mixer.tone({ bus: 'environment', freq: 523, duration: 1.4, gain: gain * 0.9, type: 'triangle', attack: 0.25, sweepTo: 392 });
    }, 1400);
  } catch (e) {
    /* no audio */
  }
}

/* ------------------------------------------------------------------ */
/* The extension                                                       */
/* ------------------------------------------------------------------ */

function reset() {
  endWalk();
  S.sweeps = [];
  S.nightMats = [];
  S.beaconMat = null;
  S.beamMat = null;
  S.fogs = [];
  S.site = null;
  S.deicer = null;
  S.van = null;
  S.gateArm = null;
  S.built = false;
  S.saidIce = false;
  S.offIceFor = 0;
  S.sirenT = 1.5;
}

registerExtension({
  id: 'scp-site',

  install(sim) {
    S.sim = sim;
  },

  buildWorld(sim, group) {
    reset();
    S.group = group;
    const quality = (sim.settings && sim.settings.quality) || 'high';
    buildIce(group, quality);
    const cfg = MAP.scp;
    if (!cfg) return;
    S.site = { ...cfg, ...buildSite(group, cfg, quality) };
    S.deicer = buildDeicer(group);
    S.van = buildVan(group, transferStand() || (cfg.holding ? { x: cfg.holding.x, z: cfg.holding.z, headingDeg: 90 } : null));
    S.built = true;
  },

  startMode() {
    // Not endWalk(): the mission's onStart has already set the boarding walk
    // going by the time this hook is called (the runner starts first), and
    // the people would vanish before the first frame. stop() clears it.
    S.saidIce = false;
    S.offIceFor = 0;
  },

  stop() {
    endWalk();
    S.saidIce = false;
  },

  update(sim, dt) {
    S.t += dt;
    const w = sim.weather;
    const night = w && w.isNight ? 1 : w && w.time === 'sunset' ? 0.55 : 0;
    if (S.site) {
      // Searchlights: a slow sweep, each on its own phase. Brighter after dark.
      for (const s of S.sweeps) s.pivot.rotation.y = s.base + Math.sin(S.t * 0.18 + s.phase) * s.span;
      // Faint by day, a soft cone after dark (0.16 read as a solid white slab).
      if (S.beamMat) S.beamMat.opacity = 0.025 + night * 0.075;
      for (const m of S.nightMats) m.emissiveIntensity = 0.15 + night * 1.6;
      // The mast lamp: a slow pulse, 2.6 s round, never a flash — and
      // dimmer still with Reduce flashing on, like every beacon.
      if (S.beaconMat) {
        const cap = FLASH.reduce ? CAPS.strobe : 1;
        S.beaconMat.opacity = (0.35 + 0.55 * (0.5 + 0.5 * Math.sin(S.t * 2.4))) * (0.5 + 0.5 * cap);
      }
      for (const f of S.fogs) {
        f.mesh.position.x = f.x + Math.sin(S.t * 0.07 + f.phase) * 18;
        f.mesh.position.z = f.z + Math.cos(S.t * 0.05 + f.phase) * 12;
        f.mesh.material.opacity = 0.4 + night * 0.2;
      }
      siren(sim, dt);
    }
    // Ice under the wheels: say so, once per spell on it.
    const ac = sim.aircraft;
    if (ac && ac.pos && sim.state === 'flying') {
      const onIce = ac.onGround && iceAt(ac.pos.x, ac.pos.z);
      if (onIce) {
        S.offIceFor = 0;
        if (!S.saidIce) {
          S.saidIce = true;
          if (sim.hud && sim.hud.notify) sim.hud.notify('Braking action POOR — ice. Brake gently and expect a long roll.', 'warn', 6);
        }
      } else if (S.saidIce) {
        S.offIceFor += dt;
        if (S.offIceFor > 20) S.saidIce = false;
      }
    }
    stepWalk(dt);
    stepGate(dt);
  },
});

/* ------------------------------------------------------------------ */
/* What the mission (game/extra/scp.js) and the tests read             */
/* ------------------------------------------------------------------ */

/** The Site as built for the current world, or null off the snow map. */
export function siteInfo() {
  return S.site;
}

/** The de-icing truck and the transport van, where they were parked. */
export function groundVehicles() {
  return { deicer: S.deicer, van: S.van };
}

/** The walk in progress: { phase: 'walking' | 'done', arrived, people } or null. */
export function transferState() {
  return S.transfer;
}

/**
 * The spot on the ground by the aircraft's left-hand door, which is where
 * the escort walks to and from. `moving` while the aeroplane is rolling, so
 * nobody walks into a taxiing aeroplane.
 */
export function doorPointOf(ac) {
  if (!ac || !ac.pos) return null;
  const h = (ac.heading || 0) * D2R;
  const fx = Math.sin(h);
  const fz = -Math.cos(h);
  const lx = -Math.cos(h);
  const lz = -Math.sin(h);
  return {
    x: ac.pos.x + lx * 4.2 - fx * 1.5,
    z: ac.pos.z + lz * 4.2 - fz * 1.5,
    moving: (ac.groundSpeed || 0) > 0.8 || !ac.onGround,
  };
}

/**
 * Where the people board: the foot of the cargo ramp when the aircraft has
 * one (the C-17) — held there until the ramp is right down and nothing is
 * moving — else the side door.
 */
export function boardPointOf(sim) {
  const g = rampOf(sim);
  if (!g) return doorPointOf(sim && sim.aircraft);
  // Moving: everybody stands still. Ramp not down yet: they walk to its foot and wait there.
  return { x: g.foot.x, z: g.foot.z, moving: g.moving, wait: !g.open };
}

/**
 * Walk the escort and the Class-D from the van to the aircraft: to the foot
 * of the C-17's ramp and up it into the hold, one at a time, where they go
 * aboard (vanish). The side door for an aircraft with no ramp.
 */
export function beginBoarding(sim) {
  const van = S.van;
  const from = van ? { x: van.rearX, z: van.rearZ } : (() => {
    const d = boardPointOf(sim);
    return d ? { x: d.x + 24, z: d.z + 10 } : { x: 0, z: 0 };
  })();
  const ramp = rampOf(sim) ? { mode: 'up', geom: () => rampOf(sim) } : null;
  return startWalk(sim, from, () => boardPointOf(sim), { vanish: true, label: 'boarding', ramp });
}

/**
 * Walk them from the aircraft to the blast door, where they stop and wait:
 * out of the hold and down the ramp first (the C-17), else from the door.
 */
export function beginHandover(sim) {
  const g = rampOf(sim);
  const d = g ? { x: g.foot.x, z: g.foot.z } : doorPointOf(sim.aircraft) || { x: 0, z: 0 };
  const cfg = MAP.scp;
  const door = cfg ? { x: cfg.door.x, z: cfg.door.z + 4, moving: false } : d;
  // Through the gate, not the fence: first to a spot on the apron in line
  // with the gap, then in file to the door (the barrier lifts for them).
  const Y = cfg && cfg.yard;
  const via = cfg && Y ? { x: cfg.gate.x, z: Y.z1 + 8 } : null;
  const ramp = g ? { mode: 'down', geom: () => rampOf(sim) } : null;
  return startWalk(sim, d, () => door, { vanish: false, label: 'handover', via, ramp });
}

/** Take the people away (a mission ending early). */
export function clearTransfer() {
  endWalk();
}

/** For the tests: the things the Site built, by name. */
export const SCP_ATTRIBUTION = 'SCP Foundation content by the SCP Wiki community, CC BY-SA 3.0, scpwiki.com';
