/**
 * Ocean.
 *
 * Two stacked planes with scrolling procedural normal maps give convincing
 * wave motion for almost no cost, and a foam band traced along each island's
 * real coastline (found by searching the terrain height function for the
 * zero-elevation contour) sells the shoreline.
 *
 * Also the sea's furniture and the sea as seen from a boat: the channel
 * buoys and harbour-head posts (buildBuoys) with halos for the dark
 * (lampGlow), the harbour walls where the height field puts them and the
 * lifeboat's jetty (buildHarbourWorks), and a near patch of ripples and wave
 * crests that only exists while somebody is in the boat (buildRipples).
 */

import * as THREE from '../vendor/three.module.js';
import { waterNormal, foamTexture } from '../render/textures.js';
import { heightAt, ISLANDS, PALETTE, MAP, channelMarks, harbourBerth } from './terrain.js';
import { setSeaFurniture } from '../vehicles/surface.js';

/**
 * Sea plane size. Deliberately inside the camera's 60 km far plane even at the
 * corners (39.6 km), so the ocean is never sliced by the far clip.
 */
const SEA_SIZE = 56000;
/**
 * The sea follows the aeroplane in whole steps. Both wave layers tile an exact
 * whole number of times per step, so the pattern is continuous across a jump
 * and the surface does not visibly snap as you fly.
 */
const FOLLOW_STEP = 2000;
const TILE_A = 250; // metres per wave tile, coarse layer
const TILE_B = 500; // metres per wave tile, fine layer
/*
 * The boat's near sea: a 360 m patch of fine ripples that follows the boat,
 * in 12 m tiles. See buildRipples().
 */
const RIPPLE_SIZE = 360;
const RIPPLE_TILE = 12;
/*
 * And the wave crests painted on it, 24 m a tile. The patch moves in whole
 * crest tiles, which are whole ripple tiles too, so neither pattern slides.
 */
const CREST_TILE = 24;
let crestCanvas = null;

/**
 * Little wave crests, as a colour map: a mid grey with soft darker troughs
 * and brighter crest lines, tileable (every stroke is drawn nine times, once
 * per neighbouring tile, so nothing is cut at an edge). Built once.
 *
 * Why a picture and not more normal map: from a chase camera five metres up
 * the water is seen at fifteen to twenty degrees, where a normal map only
 * changes which bit of a nearly uniform sky is reflected, and the ripple
 * layer read as a flat colour — measured (boat-playtest P20), the local
 * brightness variation of the sea beside the boat was under 1% at base.
 * Crests drawn into the colour are visible at any angle and in any light,
 * and they are what moves past a boat and tells a child how fast she is
 * going.
 */
function crestImage() {
  if (crestCanvas || typeof document === 'undefined') return crestCanvas;
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = 'rgb(208,208,208)';
  g.fillRect(0, 0, S, S);
  let seed = 7;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const stroke = (x, y, len, w, style) => {
    g.strokeStyle = style;
    g.lineWidth = w;
    g.lineCap = 'round';
    for (const ox of [-S, 0, S]) {
      for (const oy of [-S, 0, S]) {
        g.beginPath();
        g.moveTo(x + ox - len / 2, y + oy);
        g.quadraticCurveTo(x + ox, y + oy - len * 0.18, x + ox + len / 2, y + oy);
        g.stroke();
      }
    }
  };
  for (let i = 0; i < 80; i++) stroke(rnd() * S, rnd() * S, 18 + rnd() * 40, 3 + rnd() * 4, 'rgba(150,150,150,0.38)');
  for (let i = 0; i < 150; i++) {
    stroke(rnd() * S, rnd() * S, 10 + rnd() * 30, 1.5 + rnd() * 2.5, `rgba(255,255,255,${(0.3 + rnd() * 0.45).toFixed(2)})`);
  }
  crestCanvas = c;
  return c;
}
// Scratch colours for update(), which runs every frame and used to allocate
// three THREE.Colors each time it did.
const _base = new THREE.Color();
const _tint = new THREE.Color();
const _swell = new THREE.Color();
const SUNSET_SEA = new THREE.Color(0x3a3550);
/** Moonlight on the near sea's crests at night: see update(). */
const NIGHT_CRESTS = new THREE.Color(0x1c2c40);

let glowTex = null;

/**
 * Halos for the sea's lights: one Points object, a fixed number of pixels
 * across however far away, added on top.
 *
 * The lamps themselves are 0.3 to 0.5 m spheres, which is right for their
 * size and useless for finding them: in Night Shout — whose last instruction
 * is "Head for the two lights on the breakwater heads" — the two head lamps
 * were measured at about two pixels across from the harbour mouth, and the
 * channel buoys under one. A light at sea is seen by its glare, not its
 * bulb. `list` is flat: x, y, z, colour, x, y, z, colour...
 */
function lampGlow(list, px) {
  if (!list.length || typeof document === 'undefined') return null;
  if (!glowTex) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.18, 'rgba(255,255,255,0.85)');
    grad.addColorStop(0.45, 'rgba(255,255,255,0.22)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    glowTex = new THREE.CanvasTexture(c);
    glowTex.colorSpace = THREE.SRGBColorSpace;
  }
  const n = list.length / 4;
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  const c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    pos[i * 3] = list[i * 4];
    pos[i * 3 + 1] = list[i * 4 + 1];
    pos[i * 3 + 2] = list[i * 4 + 2];
    c.set(list[i * 4 + 3]);
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.PointsMaterial({
    size: px,
    sizeAttenuation: false,
    map: glowTex,
    vertexColors: true,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const pts = new THREE.Points(geo, mat);
  pts.name = 'lampGlow';
  pts.renderOrder = 4;
  pts.visible = false;
  return pts;
}

export class Ocean {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.name = 'ocean';

    const nrm1 = waterNormal().clone();
    nrm1.needsUpdate = true;
    nrm1.wrapS = nrm1.wrapT = THREE.RepeatWrapping;
    // Big tiles and a different scale per layer: the ocean fills most of the
    // screen, so any visible repeat is glaring. Both repeats divide the follow
    // step exactly (see FOLLOW_STEP).
    nrm1.repeat.set(SEA_SIZE / TILE_A, SEA_SIZE / TILE_A);
    const nrm2 = waterNormal().clone();
    nrm2.needsUpdate = true;
    nrm2.wrapS = nrm2.wrapT = THREE.RepeatWrapping;
    // Mirrored rather than rotated. A rotation would look good but would break
    // the whole-tile follow step, and a lurching sea is far worse than a
    // slightly less varied one.
    nrm2.repeat.set(-SEA_SIZE / TILE_B, SEA_SIZE / TILE_B);
    nrm2.offset.set(0.31, 0.57);

    // Water is a dielectric: metalness stays at zero. Treating it as
    // half-metal turns the surface into a tinted mirror that ignores its own
    // colour, blows out to white wherever the sky is bright, and leaves
    // nothing on screen at all if the environment map ever hiccups.
    // Colours come from the map: turquoise round the atoll, near-black off the
    // fjords, slate grey under the volcano.
    this.pal = PALETTE;
    this.deepMat = new THREE.MeshStandardMaterial({
      color: this.pal.deepWater,
      roughness: 0.14,
      metalness: 0,
      normalMap: nrm1,
      normalScale: new THREE.Vector2(0.5, 0.5),
      envMapIntensity: 1.0,
    });
    // A few segments rather than a single quad. Two triangles spanning tens of
    // kilometres give the rasteriser absurd screen-space derivatives near the
    // horizon, which is where the shading used to fall apart.
    const deep = new THREE.Mesh(new THREE.PlaneGeometry(SEA_SIZE, SEA_SIZE, 24, 24), this.deepMat);
    deep.rotation.x = -Math.PI / 2;
    deep.receiveShadow = false;
    this.group.add(deep);
    this.deep = deep;

    this.swellMat = new THREE.MeshStandardMaterial({
      color: this.pal.swell,
      roughness: 0.1,
      metalness: 0,
      envMapIntensity: 1.1,
      normalMap: nrm2,
      normalScale: new THREE.Vector2(0.85, 0.85),
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
      /*
       * Eight centimetres above the deep layer is less than the depth buffer
       * can tell apart past about a kilometre (near 0.4 m, far 60 km: the
       * step is ~0.5 m at 1.8 km), so out there this layer lost the depth
       * test to the one under it in blocks — measured from 590 m up over the
       * Skerries, stair-stepped dark rectangles across half the sea, and they
       * vanished with this layer hidden. Offsetting it towards the camera in
       * depth lets it always sit on top of the deep layer; anything genuinely
       * in front of it (an island, a hull) is metres nearer and still wins.
       */
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -4,
    });
    // Same size as the deep layer. When it was smaller there was a hard ring
    // 20 km out where the sea abruptly changed colour.
    const swell = new THREE.Mesh(new THREE.PlaneGeometry(SEA_SIZE, SEA_SIZE, 24, 24), this.swellMat);
    swell.rotation.x = -Math.PI / 2;
    swell.position.y = 0.08;
    this.group.add(swell);
    this.swell = swell;

    this.nrm1 = nrm1;
    this.nrm2 = nrm2;
    this.t = 0;

    this.foamMats = [];
    this.shallowMats = [];
    for (const isl of ISLANDS) {
      /*
       * Only the ones that have a coast.
       *
       * traceCoast bisects for the height-zero crossing between 0.2 and 1.9
       * island radii, and an island that is entirely inland — a hill placed
       * on top of a bigger island, which is how Kestrel's relief is built —
       * has no crossing at all, so every ray runs to the far limit and the
       * result is a perfect 1.9R ring of surf and turquoise shallows drawn
       * at sea level underneath the grass. It is buried and nobody has ever
       * seen it, which is exactly why it went unnoticed: two extra meshes
       * and 128 more coastline bisections per inland hill, for a ring inside
       * a hill.
       */
      if (!this.hasCoast(isl)) continue;
      // Shallows first (wider, underneath), then the foam line on top.
      this.group.add(this.buildShallows(isl));
      this.group.add(this.buildFoam(isl));
    }
    this._coast = null;

    this.buoyCount = 0;
    this.headCount = 0;
    this.buildBuoys();
    this.worksCells = 0;
    // A new map's sea starts with nothing solid in it; buildBerth adds its
    // pontoon if this map has a harbour.
    setSeaFurniture([]);
    this.buildHarbourWorks();
    this.buildRipples();

    scene.add(this.group);
  }

  /** Does any ray off this island's centre actually reach the sea? */
  hasCoast(isl) {
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      if (heightAt(isl.cx + Math.cos(a) * isl.radius * 1.9, isl.cz + Math.sin(a) * isl.radius * 1.9) <= 0) return true;
    }
    return false;
  }

  /**
   * The coast crossing along each of SEG rays off an island's centre.
   *
   * Bisection between 0.2 and 1.9 radii for where the ground goes under the
   * sea. Cached per island and ring size, because the foam line and the
   * shallows used to trace the same coast twice, 22 heightAt calls a ray.
   */
  coastRadii(isl, SEG) {
    const key = `${isl.cx},${isl.cz},${isl.radius},${SEG}`;
    this._coast = this._coast || new Map();
    if (this._coast.has(key)) return this._coast.get(key);
    const rs = new Float32Array(SEG + 1);
    for (let i = 0; i <= SEG; i++) {
      const a = (i / SEG) * Math.PI * 2;
      const dx = Math.cos(a);
      const dz = Math.sin(a);
      let lo = isl.radius * 0.2;
      let hi = isl.radius * 1.9;
      for (let k = 0; k < 22; k++) {
        const mid = (lo + hi) / 2;
        if (heightAt(isl.cx + dx * mid, isl.cz + dz * mid) > 0) lo = mid;
        else hi = mid;
      }
      rs[i] = (lo + hi) / 2;
    }
    this._coast.set(key, rs);
    return rs;
  }

  /**
   * How much surf and shelf belongs at this point: 1 on an open coast, 0
   * inside a harbour.
   *
   * A harbour is dredged, walled and sheltered, so there is no surf in it
   * and no turquoise shelf over it — and more to the point, the bands are
   * drawn at 0.2 to 0.5 m ABOVE the sea, which is above a launch's waterline.
   * Measured on Sennen Cove (boat-playtest P4): the shallows band at y 0.24
   * lay right across the basin, over the berth, so from the chase camera the
   * hull was under a translucent sheet — and the foam line, at 0.35 to 0.5,
   * sits higher than her deck. That was half of why she looked sunk at the
   * quay; the other half was the model offset in main.js.
   */
  bandWeight(x, z) {
    const H = MAP.waters && MAP.waters.harbour;
    if (!H || H._du === undefined) return 1;
    const dx = x - H.cx;
    const dz = z - H.cz;
    const u = dx * H._du + dz * H._dv;
    const v = -dx * H._dv + dz * H._du;
    const wall = H.wallW || 26;
    const qu = Math.abs(u) - (H.length / 2 + wall * 2.2);
    const qv = Math.abs(v) - (H.width / 2 + wall * 1.2);
    const out = Math.max(qu, qv);
    return THREE.MathUtils.smoothstep(out, 0, 45);
  }

  /**
   * A band along the coast, `innerOffset` to `outerOffset` metres either side
   * of it, used for both the foam line and the shallow lagoon band.
   *
   * THE STREAKS. Neighbouring rays do not always find neighbouring coast:
   * where a ray runs down a harbour, an inlet or past an offshore rock, the
   * bisection lands on a different bit of shoreline from the ray beside it,
   * and the quad between them became a sliver hundreds of metres long with
   * the foam texture smeared along it. Measured on Sennen Head: ten jumps of
   * over sixty metres between adjacent rays, the worst 296 m, and those are
   * the thin white lines that fanned out across the sea round the boat. A
   * quad whose two rays disagree by more than half a ray's spacing is not a
   * piece of coastline, so it is not drawn.
   */
  traceCoast(isl, innerOffset, outerOffset, innerY = 0.5, outerY = 0.35, SEG = 128) {
    const rs = this.coastRadii(isl, SEG);
    const verts = [];
    const uvs = [];
    const cols = [];
    const idx = [];
    for (let i = 0; i <= SEG; i++) {
      const a = (i / SEG) * Math.PI * 2;
      const dx = Math.cos(a);
      const dz = Math.sin(a);
      const r = rs[i];
      const ix = isl.cx + dx * (r + innerOffset);
      const iz = isl.cz + dz * (r + innerOffset);
      const ox = isl.cx + dx * (r + outerOffset);
      const oz = isl.cz + dz * (r + outerOffset);
      verts.push(ix, innerY, iz);
      verts.push(ox, outerY, oz);
      const u = (i / SEG) * 26;
      uvs.push(u, 0, u, 1);
      cols.push(1, 1, 1, this.bandWeight(ix, iz), 1, 1, 1, this.bandWeight(ox, oz));
    }
    const jump = Math.max(40, ((Math.PI * 2 * isl.radius) / SEG) * 0.5);
    for (let i = 0; i < SEG; i++) {
      if (Math.abs(rs[i + 1] - rs[i]) > jump) continue;
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 4));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return geo;
  }

  /**
   * Shallow water: a wide turquoise band hugging each coast, fading out to deep
   * blue. Real islands have this reef shelf and it is the single biggest thing
   * that makes tropical water look tropical.
   */
  buildShallows(isl) {
    const geo = this.traceCoast(isl, -30, 260, 0.24, 0.2, 96);
    // Fade to transparent on the seaward edge using vertex alpha via UV.v.
    const mat = new THREE.MeshBasicMaterial({
      color: 0x4fd6c8,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
      side: THREE.DoubleSide,
      // RGBA vertex colour: white, with the harbour fade in the alpha.
      vertexColors: true,
    });
    mat.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <alphatest_fragment>',
        `#include <alphatest_fragment>
         // vUv.y runs 0 at the shore to 1 out to sea.
         float shelf = 1.0 - smoothstep(0.0, 0.85, vMapUv.y);
         diffuseColor.a *= shelf;
         diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.18, 0.45, 0.62), vMapUv.y * 0.8);`
      );
    };
    // The replacement above needs a map for vMapUv to exist.
    mat.map = foamTexture();
    mat.map.needsUpdate = true;
    this.shallowMats.push(mat);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'shallows';
    mesh.renderOrder = 1;
    return mesh;
  }

  /** Trace the coastline and build a translucent foam band along it. */
  buildFoam(isl) {
    const geo = this.traceCoast(isl, -26, 34, 0.5, 0.35, 128);
    const tex = foamTexture().clone();
    tex.needsUpdate = true;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
      side: THREE.DoubleSide,
      vertexColors: true,
    });
    this.foamMats.push({ mat, tex });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'surf';
    mesh.renderOrder = 2;
    return mesh;
  }

  /* ------------------------------------------------------------ buoys -- */

  /**
   * The buoyage, standing in the water.
   *
   * terrain.channelMarks() has worked out where every red can, green cone
   * and fairway buoy goes since the boat maps were made, and the only thing
   * that ever drew them was the chart. In the world there was nothing: the
   * first mission's first instruction is "keep the red buoys on your left",
   * and a child looking out of the boat for a red buoy found open sea.
   * Measured on Sennen before this (boat-playtest P18): channelMarks() gave
   * four marks and the scene contained none of them.
   *
   * Three instanced meshes and one for the lamps — four draw calls for the
   * whole buoyage however many marks a map has — and they are big: 2.6 m
   * above the water, which is a real channel buoy and a dot a child can pick
   * out at a kilometre on a school laptop. The two harbour-mouth heads get a
   * post each, red to port and green to starboard coming in.
   */
  buildBuoys() {
    let marks = [];
    try {
      marks = channelMarks();
    } catch (e) {
      console.warn('No buoyage for this map:', e);
      marks = [];
    }
    const heads = [];
    const H = MAP.waters && MAP.waters.harbour;
    if (H && H._du !== undefined) {
      // The ends of the two arms, either side of the gap. Entering, the red
      // head is on your left: the side that is -v when you are heading in.
      const u = H.length / 2 + (H.wallW || 26) * 0.4;
      const half = (H.mouthWidth || 70) / 2 + 9;
      for (const side of [-1, 1]) {
        const v = side * half;
        const x = H.cx + H._du * u - H._dv * v;
        const z = H.cz + H._dv * u + H._du * v;
        // Stand it on the arm, not in the gap: only if the ground there is
        // actually a breakwater.
        if (heightAt(x, z) > 0.5) heads.push({ x, z, red: side > 0, head: true, y: Math.max(0, heightAt(x, z)) });
      }
    }
    if (!marks.length && !heads.length) return;

    const group = new THREE.Group();
    group.name = 'buoyage';
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const sc = new THREE.Vector3(1, 1, 1);
    const p = new THREE.Vector3();
    const col = new THREE.Color();
    const RED = 0xd23a2c;
    const GREEN = 0x21a052;

    const buoys = marks.map((k) => ({
      x: k.x,
      z: k.z,
      kind: k.kind,
      colour: k.kind === 'port' ? RED : k.kind === 'starboard' ? GREEN : 0xe0493a,
    }));

    // Bodies: one cylinder, scaled per kind. A buoy is fat and short; a
    // pier-head post is thin and tall.
    const bodyGeo = new THREE.CylinderGeometry(0.75, 1.05, 1, 12);
    bodyGeo.translate(0, 0.5, 0);
    const bodyMat = new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.05 });
    const n = buoys.length + heads.length;
    const bodies = new THREE.InstancedMesh(bodyGeo, bodyMat, n);
    let i = 0;
    for (const b of buoys) {
      p.set(b.x, -0.5, b.z);
      sc.set(1.1, 3.1, 1.1);
      bodies.setMatrixAt(i, m4.compose(p, q, sc));
      bodies.setColorAt(i, col.set(b.colour));
      i++;
    }
    for (const h of heads) {
      p.set(h.x, h.y, h.z);
      sc.set(0.7, 6, 0.7);
      bodies.setMatrixAt(i, m4.compose(p, q, sc));
      bodies.setColorAt(i, col.set(h.red ? RED : GREEN));
      i++;
    }
    bodies.name = 'buoyBodies';
    group.add(bodies);

    // Topmarks, which is how a buoy says what it is when the light is flat:
    // a can for port, a cone for starboard, a ball for the fairway.
    const addTop = (geo, list, colourOf, yOf) => {
      if (!list.length) return;
      const mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ roughness: 0.5 }), list.length);
      list.forEach((b, k) => {
        p.set(b.x, yOf(b), b.z);
        sc.set(1, 1, 1);
        mesh.setMatrixAt(k, m4.compose(p, q, sc));
        mesh.setColorAt(k, col.set(colourOf(b)));
      });
      group.add(mesh);
    };
    const port = buoys.filter((b) => b.kind === 'port');
    const stbd = buoys.filter((b) => b.kind === 'starboard');
    const fair = buoys.filter((b) => b.kind !== 'port' && b.kind !== 'starboard');
    const canGeo = new THREE.CylinderGeometry(0.55, 0.55, 0.9, 10);
    const coneGeo = new THREE.ConeGeometry(0.7, 1.2, 10);
    const ballGeo = new THREE.SphereGeometry(0.6, 12, 8);
    addTop(canGeo, port, () => RED, () => 3.2);
    addTop(coneGeo, stbd, () => GREEN, () => 3.3);
    addTop(ballGeo, fair, () => 0xf4f1ea, () => 3.3);

    // The lamps: unlit, so they read as lights at night and as bright
    // bulbs by day. They flash together, which from a boat you cannot tell.
    const lampGeo = new THREE.SphereGeometry(0.32, 8, 6);
    this.lampMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const lamps = new THREE.InstancedMesh(lampGeo, this.lampMat, n);
    i = 0;
    for (const b of buoys) {
      p.set(b.x, 3.95, b.z);
      lamps.setMatrixAt(i, m4.compose(p, q, sc.set(1, 1, 1)));
      lamps.setColorAt(i, col.set(b.kind === 'starboard' ? 0x4dff7a : b.kind === 'port' ? 0xff4a3a : 0xfff2c0));
      i++;
    }
    for (const h of heads) {
      p.set(h.x, h.y + 6.3, h.z);
      lamps.setMatrixAt(i, m4.compose(p, q, sc.set(1.6, 1.6, 1.6)));
      lamps.setColorAt(i, col.set(h.red ? 0xff4a3a : 0x4dff7a));
      i++;
    }
    lamps.name = 'buoyLamps';
    group.add(lamps);

    // And a halo on each, for the dark. See lampGlow().
    const glow = [];
    for (const b of buoys) glow.push(b.x, 3.95, b.z, b.kind === 'starboard' ? 0x4dff7a : b.kind === 'port' ? 0xff4a3a : 0xfff2c0);
    for (const h of heads) glow.push(h.x, h.y + 6.3, h.z, h.red ? 0xff4a3a : 0x4dff7a);
    this.buoyGlow = lampGlow(glow, 34);
    if (this.buoyGlow) group.add(this.buoyGlow);

    this.buoyCount = buoys.length;
    this.headCount = heads.length;
    this.buoys = group;
    this.group.add(group);
  }

  /* --------------------------------------------------- harbour works -- */

  /**
   * The harbour walls, drawn where the sea floor actually stops her.
   *
   * terrain.js builds the harbour into the height field — a dredged basin,
   * a quay apron at +3.2 m and breakwater arms at +4.2 m, each about 26 m
   * across — and says in its own comment that the walls "are geometry, built
   * by harbour.js and sitting on this". harbour.js was never written. The
   * terrain mesh is 25 m a vertex, so a 26 m wall falls between vertices and
   * is drawn wherever the sampling happens to land. Measured on Sennen Cove
   * (boat-playtest P22), comparing heightAt with the terrain mesh as drawn
   * on a 5 m grid round the harbour: 460 cells where the bottom stops her but
   * the drawn ground is under water — the middle 100 m of both side walls
   * and both harbour-mouth arms among them. From the chase camera those are
   * open sea, and the first thing a child did in the boat was bump one:
   * "Holding full ahead and taking the first turn ran her aground" was a
   * turn into a wall nobody could see.
   *
   * So the ring of harbour works is drawn here from heightAt itself, on a
   * 3 m grid in the harbour's own frame, only where the ground is within a
   * metre of her keel or higher — which is exactly where she grounds — and
   * only inside the band the harbour term owns, so the island behind the
   * quay stays the terrain's. Stone on top, a dark weed line at the water,
   * and it sits on the terrain with a polygon offset where the two agree.
   * One mesh and one draw call, built once per map, and a pontoon with two
   * lit piles at the lifeboat berth so "come alongside and stop" has
   * something to come alongside.
   */
  buildHarbourWorks() {
    const H = MAP.waters && MAP.waters.harbour;
    if (!H || H._du === undefined || H._pending) return;
    const A = H.length / 2;
    const B = H.width / 2;
    const wallW = H.wallW || 26;
    const quayW = H.quayW || wallW;
    const sea = wallW * 1.7 + 8;
    const land = quayW + 14;
    const STEP = 3;
    const u0 = -A - land;
    const u1 = A + sea;
    const v0 = -B - sea;
    const nu = Math.ceil((u1 - u0) / STEP) + 1;
    const nv = Math.ceil((2 * (B + sea)) / STEP) + 1;
    const du = H._du;
    const dv = H._dv;
    const xOf = (u, v) => H.cx + u * du - v * dv;
    const zOf = (u, v) => H.cz + u * dv + v * du;
    // The harbour term's own signed distance, so the band is the same shape.
    const sdOf = (u, v) => {
      const qx = Math.abs(u) - A;
      const qz = Math.abs(v) - B;
      return Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0);
    };
    const hs = new Float32Array(nu * nv);
    const keep = new Uint8Array(nu * nv);
    for (let j = 0; j < nv; j++) {
      const v = v0 + j * STEP;
      for (let i = 0; i < nu; i++) {
        const u = u0 + i * STEP;
        const k = j * nu + i;
        hs[k] = heightAt(xOf(u, v), zOf(u, v));
        const sd = sdOf(u, v);
        keep[k] = sd > -STEP && sd < (u < 0 ? land : sea) ? 1 : 0;
      }
    }
    const pos = [];
    const col = [];
    const idx = [];
    const map = new Int32Array(nu * nv).fill(-1);
    const vert = (i, j) => {
      const k = j * nu + i;
      if (map[k] >= 0) return map[k];
      const u = u0 + i * STEP;
      const v = v0 + j * STEP;
      // Under water the surface is only there to meet the sea cleanly.
      pos.push(xOf(u, v), Math.max(hs[k], -2.5), zOf(u, v));
      col.push(1, 1, 1);
      map[k] = pos.length / 3 - 1;
      return map[k];
    };
    let cells = 0;
    for (let j = 0; j < nv - 1; j++) {
      for (let i = 0; i < nu - 1; i++) {
        const a = j * nu + i;
        const b = a + 1;
        const c = a + nu;
        const d = c + 1;
        if (!(keep[a] || keep[b] || keep[c] || keep[d])) continue;
        // Where she would ground: the draught is a metre.
        if (Math.max(hs[a], hs[b], hs[c], hs[d]) < -1.1) continue;
        cells++;
        const ia = vert(i, j);
        const ib = vert(i + 1, j);
        const ic = vert(i, j + 1);
        const id = vert(i + 1, j + 1);
        idx.push(ia, ic, ib, ib, ic, id);
      }
    }
    this.worksCells = cells;
    if (!cells) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    // Face the normals up: which way round the cells are wound depends on
    // whether the harbour's (u, v) frame is left- or right-handed in (x, z).
    const nrm = geo.attributes.normal;
    let up = 0;
    for (let i = 0; i < nrm.count; i++) up += nrm.getY(i);
    if (up < 0) {
      for (let t = 0; t < idx.length; t += 3) {
        const s = idx[t + 1];
        idx[t + 1] = idx[t + 2];
        idx[t + 2] = s;
      }
      geo.setIndex(idx);
      geo.computeVertexNormals();
    }
    // Stone by slope and height: pale coping on the tops, darker faces, and
    // the green-black weed line a real wall has where the sea washes it.
    const P = geo.attributes.position;
    const N = geo.attributes.normal;
    const C = geo.attributes.color;
    // Darker than they look written down: the renderer's exposure lifts
    // them, and at 0xb3ad9f the first version read as sand, not stone.
    const top = new THREE.Color(0x8f897c);
    const face = new THREE.Color(0x66635d);
    const weed = new THREE.Color(0x2f3a33);
    const c = new THREE.Color();
    for (let i = 0; i < P.count; i++) {
      const y = P.getY(i);
      const flat = THREE.MathUtils.smoothstep(N.getY(i), 0.55, 0.85);
      c.copy(face).lerp(top, flat);
      c.lerp(weed, 1 - THREE.MathUtils.smoothstep(y, 0.1, 0.9));
      // A little unevenness, fixed per vertex, so it reads as stone.
      const n = 0.93 + 0.14 * (((Math.sin(P.getX(i) * 12.9898 + P.getZ(i) * 78.233) * 43758.5453) % 1 + 1) % 1);
      C.setXYZ(i, c.r * n, c.g * n, c.b * n);
    }
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.93,
      metalness: 0,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -6,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'harbourWorks';
    mesh.receiveShadow = true;
    this.group.add(mesh);
    this.works = mesh;
    this.buildBerth(H);
  }

  /** The pontoon and two lit piles at the lifeboat berth. */
  buildBerth(H) {
    const berth = harbourBerth();
    if (!berth) return;
    const g = new THREE.Group();
    g.name = 'lifeboatBerth';
    // Lying along the harbour's axis, seven metres to the wall side of the
    // berth (the berth is 34 m in from that wall, on the -v side), so the
    // launch lies alongside it at the start and comes alongside it at the
    // end rather than through it. It is not in the height field, so its
    // footprint is handed to the boat (surface.js, setSeaFurniture) and she
    // bumps off it like a wall instead of sailing through it.
    g.position.set(berth.x + H._dv * 7, 0, berth.z - H._du * 7);
    g.rotation.y = Math.atan2(H._du, H._dv);
    setSeaFurniture([{ x: g.position.x, z: g.position.z, ax: H._du, az: H._dv, halfL: 7.1, halfW: 1.3, what: 'the jetty' }]);
    // Timber deck, and a yellow fender band round its sides at the water.
    const deck = new THREE.Mesh(
      new THREE.BoxGeometry(2.4, 0.5, 14),
      new THREE.MeshStandardMaterial({ color: 0x7a6650, roughness: 0.9 })
    );
    deck.position.y = 0.18;
    const fender = new THREE.Mesh(
      new THREE.BoxGeometry(2.56, 0.18, 14.16),
      new THREE.MeshStandardMaterial({ color: 0xf2c230, roughness: 0.6 })
    );
    fender.position.y = 0.2;
    g.add(deck, fender);
    const pileMat = new THREE.MeshStandardMaterial({ color: 0x3b3a36, roughness: 0.8 });
    this.berthLampMat = new THREE.MeshBasicMaterial({ color: 0xffd23f });
    for (const z of [-7.6, 7.6]) {
      const pile = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 4.2, 8), pileMat);
      pile.position.set(0, 1.2, z);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.26, 8, 6), this.berthLampMat);
      lamp.position.set(0, 3.45, z);
      g.add(pile, lamp);
    }
    this.berth = g;
    this.group.add(g);
    // The jetty lights have halos too, steady rather than flashing: they are
    // where Night Shout ends.
    const halo = [];
    for (const z of [-7.6, 7.6]) {
      const w = new THREE.Vector3(0, 3.45, z).applyAxisAngle(new THREE.Vector3(0, 1, 0), g.rotation.y).add(g.position);
      halo.push(w.x, w.y, w.z, 0xffd23f);
    }
    this.berthGlow = lampGlow(halo, 30);
    if (this.berthGlow) this.group.add(this.berthGlow);
  }

  /* --------------------------------------------------- the boat's sea -- */

  /**
   * The sea as it looks from a boat.
   *
   * Everything above was tuned from an aeroplane, and from a chase camera
   * five metres above the water the same sea was a flat pale grey: the
   * translucent swell layer is lerped towards the HORIZON colour and laid
   * over the deep blue at 30-42%, and at the grazing angles you see from a
   * boat it is that layer you see. Measured from the chase camera just
   * outside Sennen's harbour on a clear day (tests/features/boat-playtest,
   * P20): the sea in the bottom quarter of the frame averaged a saturation of
   * 0.23, which is grey. With the changes below it is 0.38.
   *
   * So while somebody is in the boat, the near sea gets a third, fine layer
   * of ripples that follows the boat (twelve-metre tiles, where the others
   * are 250 and 500 m and read as smooth from this close), and the swell
   * layer is thinned and kept blue. main.js calls `boatView(pos)` every frame
   * of a boat trip; if nobody has called it for half a second the ocean puts
   * itself back exactly as the aeroplane had it, so leaving the boat by any
   * route — the menu, a map change, a crash of the tab — cannot leave it on.
   */
  buildRipples() {
    const nrm = waterNormal().clone();
    nrm.needsUpdate = true;
    nrm.wrapS = nrm.wrapT = THREE.RepeatWrapping;
    nrm.repeat.set(RIPPLE_SIZE / RIPPLE_TILE, RIPPLE_SIZE / RIPPLE_TILE);
    // Grazing angles are the whole view from a boat; without anisotropic
    // filtering the ripples mip down to a flat colour a few metres out.
    nrm.anisotropy = 8;
    this.rippleNrm = nrm;
    let crest = null;
    const img = crestImage();
    if (img) {
      crest = new THREE.CanvasTexture(img);
      crest.wrapS = crest.wrapT = THREE.RepeatWrapping;
      crest.repeat.set(RIPPLE_SIZE / CREST_TILE, RIPPLE_SIZE / CREST_TILE);
      crest.anisotropy = 8;
      crest.colorSpace = THREE.SRGBColorSpace;
    }
    this.rippleCrest = crest;
    this.rippleMat = new THREE.MeshStandardMaterial({
      color: 0x2a6f8e,
      map: crest,
      // Black by day; the moonlight on the crests at night (see update).
      emissive: 0x000000,
      emissiveMap: crest,
      roughness: 0.2,
      metalness: 0,
      normalMap: nrm,
      normalScale: new THREE.Vector2(0.9, 0.9),
      envMapIntensity: 0.9,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      vertexColors: true,
    });
    // Radial fade in the vertex alpha, so the patch has no edge.
    const geo = new THREE.PlaneGeometry(RIPPLE_SIZE, RIPPLE_SIZE, 16, 16);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const cols = new Float32Array(pos.count * 4);
    const R = RIPPLE_SIZE / 2;
    for (let i = 0; i < pos.count; i++) {
      const r = Math.hypot(pos.getX(i), pos.getZ(i));
      const a = 1 - THREE.MathUtils.smoothstep(r, R * 0.35, R * 0.95);
      cols[i * 4] = 1;
      cols[i * 4 + 1] = 1;
      cols[i * 4 + 2] = 1;
      cols[i * 4 + 3] = a;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(cols, 4));
    const mesh = new THREE.Mesh(geo, this.rippleMat);
    mesh.name = 'nearRipples';
    mesh.position.y = 0.1;
    // After the swell layer it sits on, before the surf and the shallows.
    mesh.renderOrder = 0.5;
    mesh.visible = false;
    mesh.frustumCulled = false;
    this.ripples = mesh;
    this.group.add(mesh);
    this.boatSeen = -1;
  }

  /** Called every frame of a boat trip with the boat's position. */
  boatView(pos) {
    if (!this.ripples || !pos) return;
    this.boatSeen = this.t;
    // Whole tiles only, so the ripple texture does not slide as she moves.
    this.ripples.position.x = Math.round(pos.x / CREST_TILE) * CREST_TILE;
    this.ripples.position.z = Math.round(pos.z / CREST_TILE) * CREST_TILE;
  }

  /** True while a boat has asked for the near sea in the last half second. */
  get boatMode() {
    return this.boatSeen >= 0 && this.t - this.boatSeen < 0.5;
  }

  /** Keep the ocean centred under the aircraft so it never runs out. */
  follow(pos) {
    this.deep.position.x = Math.round(pos.x / FOLLOW_STEP) * FOLLOW_STEP;
    this.deep.position.z = Math.round(pos.z / FOLLOW_STEP) * FOLLOW_STEP;
    this.swell.position.x = this.deep.position.x;
    this.swell.position.z = this.deep.position.z;
  }

  /** Release every GPU resource this ocean owns. */
  dispose() {
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        for (const key of ['map', 'normalMap']) {
          if (o.material[key]) o.material[key].dispose();
        }
        o.material.dispose();
      }
    });
    if (this.group.parent) this.group.parent.remove(this.group);
  }

  update(dt, weather) {
    this.t += dt;
    const windScale = 0.4 + weather.windSpeedKts / 26;
    this.nrm1.offset.x = (this.t * 0.0035 * windScale) % 1;
    this.nrm1.offset.y = (this.t * 0.0021 * windScale) % 1;
    this.nrm2.offset.x = (-this.t * 0.008 * windScale) % 1;
    this.nrm2.offset.y = (this.t * 0.0052 * windScale) % 1;

    const chop = 0.42 + weather.cond.turb * 0.75;
    this.deepMat.normalScale.set(chop, chop);
    this.swellMat.normalScale.set(chop * 1.5, chop * 1.5);

    // Water colour follows the sky.
    const p = weather.palette();
    _base.set(this.pal.deepWater);
    if (weather.isNight) _base.multiplyScalar(0.22);
    else if (weather.time === 'sunset') _base.lerp(SUNSET_SEA, 0.35);
    const boat = this.boatMode;
    // From a boat the horizon wash is what turns the sea grey (see
    // buildRipples), so it is roughly halved there.
    const wash = (0.18 + weather.cond.cloud * 0.22) * (boat ? 0.55 : 1);
    this.deepMat.color.copy(_base).lerp(p.horizon, wash);
    _swell.set(this.pal.swell);
    this.swellMat.color.copy(p.horizon).lerp(_swell, boat ? 0.75 : 0.45);
    this.swellMat.opacity = (0.3 + weather.cond.cloud * 0.2) * (boat ? 0.6 : 1);

    if (this.ripples) {
      this.ripples.visible = boat;
      if (boat) {
        this.rippleNrm.offset.x = (this.t * 0.05 * windScale) % 1;
        this.rippleNrm.offset.y = (this.t * 0.031 * windScale) % 1;
        // The crests march slowly downwind of nothing in particular: enough
        // that the sea is alive when she is stopped at the berth.
        if (this.rippleCrest) this.rippleCrest.offset.y = (this.t * 0.012 * windScale) % 1;
        const r = 1.1 + weather.cond.turb * 0.9;
        this.rippleMat.normalScale.set(r, r);
        // The swell colour, a shade deeper, so the patch reads as the same
        // water close to rather than as a disc laid on it. The crest map
        // averages about 0.68 in linear light, so the colour under it is
        // lifted by as much again or the patch is a dark disc round her.
        _tint.copy(this.swellMat.color).lerp(_base, 0.35);
        if (this.rippleCrest) _tint.multiplyScalar(1.45);
        this.rippleMat.color.copy(_tint);
        this.rippleMat.opacity = weather.isNight ? 0.55 : 0.7;
        /*
         * At night, moonlight on the crests. The near sea is lit by the
         * scene's lights like everything else, and at two in the morning
         * those are next to nothing, so whatever colour it was given it drew
         * black: from the chase camera 45 s out in Night Shout the bottom
         * half of the frame averaged 1.4% brightness, and a pixel differed
         * from the one three rows down by 0.4% — no waves, nothing to say she
         * was moving but the wake. The crest picture is also its emissive
         * map (set once, so nothing recompiles), black by day and a dim
         * blue at night: the waves glint round her without turning night
         * into day.
         */
        if (weather.isNight) this.rippleMat.emissive.copy(NIGHT_CRESTS);
        else if (weather.time === 'sunset') this.rippleMat.emissive.copy(NIGHT_CRESTS).multiplyScalar(0.3);
        else this.rippleMat.emissive.setScalar(0);
      }
    }
    // A buoy light flashes: on for a second in every three, brighter at
    // night, and never quite out by day so a child can still see the colour.
    const on = this.t % 3 < 1;
    if (this.lampMat) {
      const k = weather.isNight ? (on ? 1.6 : 0.08) : on ? 1 : 0.55;
      this.lampMat.color.setScalar(k);
    }
    // Halos only when it is dark enough for a light to have one.
    const dark = weather.isNight ? 1 : weather.time === 'sunset' ? 0.45 : 0;
    if (this.buoyGlow) {
      this.buoyGlow.visible = dark > 0;
      this.buoyGlow.material.opacity = dark * (on ? 1 : 0.12);
    }
    if (this.berthGlow) {
      this.berthGlow.visible = dark > 0;
      this.berthGlow.material.opacity = dark * 0.9;
    }

    const sh = this.pal.shallow;
    for (const m of this.shallowMats) {
      const night = weather.isNight ? 0.35 : 1;
      m.color.setRGB(sh[0] * night, sh[1] * night, sh[2] * night);
      m.opacity = (0.46 - weather.cond.cloud * 0.16) * night;
    }
    for (const f of this.foamMats) {
      f.tex.offset.y = (this.t * 0.06) % 1;
      f.mat.opacity = 0.45 + 0.25 * Math.sin(this.t * 1.3) + weather.cond.turb * 0.25;
    }
  }
}
