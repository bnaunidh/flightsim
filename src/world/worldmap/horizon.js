/**
 * World Map preview: the islands past the streamed ground, as low-detail
 * shapes on the horizon.
 *
 * The streamed ground stops at the tier's range (30 km at Low, 50 at High).
 * The sea is 400 km across, so without this almost every island in it is
 * simply not there until you are nearly on top of it, and the world reads as
 * an empty sea with the odd rock. Real air is the other way round: the next
 * island is on the horizon, a grey-blue shape in the haze, long before you
 * can see a tree on it.
 *
 * Each island is a polar mesh — RINGS rings of SPOKES points from its middle
 * out past its coast — sampled from the real height field, so a mountain is
 * a mountain-shaped shape and a cay is a smudge at sea level. Every island
 * is in ONE geometry, one draw call, about ten thousand vertices for the
 * whole sea. The vertex shader hides an island while any part of it is
 * inside the streamed range (that island's real tiles are drawn instead;
 * two surfaces at 30 km with a 0.1 m near plane would fight over every
 * pixel), by sending all three corners of its triangles outside the clip
 * volume, so nothing is drawn and nothing is rebuilt as you fly.
 *
 * Built a few islands a frame (build(), inside a time budget), because it is
 * heightAt on the main thread; nothing on the horizon is needed in the first
 * second of a flight.
 */
import * as THREE from '../../vendor/three.module.js';

export const RINGS = [0, 0.22, 0.45, 0.68, 0.88, 1.06, 1.24, 1.45];
export const SPOKES = 18;
/** Metres the shape sits under the real ground, so where it does show it is never above it. */
const SINK = 4;

const COL = {
  sand: new THREE.Color(0xc9bd93).convertSRGBToLinear(),
  grass: new THREE.Color(0x5f7f45).convertSRGBToLinear(),
  scrub: new THREE.Color(0x6e7a4e).convertSRGBToLinear(),
  rock: new THREE.Color(0x7d7a74).convertSRGBToLinear(),
  snow: new THREE.Color(0xe9edf2).convertSRGBToLinear(),
};

/** One island's polar grid of heights (pure: node runs this too). */
export function islandShape(heightAt, isl) {
  const pts = [];
  for (let r = 0; r < RINGS.length; r++) {
    const n = r === 0 ? 1 : SPOKES;
    for (let s = 0; s < n; s++) {
      const a = (s / SPOKES) * Math.PI * 2;
      const d = RINGS[r] * isl.radius;
      const x = isl.cx + Math.cos(a) * d;
      const z = isl.cz + Math.sin(a) * d;
      pts.push([x, heightAt(x, z), z]);
    }
  }
  return pts;
}

function colourFor(h, out) {
  if (h < 4) return out.copy(COL.sand);
  if (h > 1250) return out.copy(COL.snow);
  if (h > 320) return out.copy(COL.rock).lerp(COL.scrub, Math.max(0, 1 - (h - 320) / 400) * 0.4);
  return out.copy(COL.grass).lerp(COL.scrub, Math.min(1, h / 320));
}

export class Horizon {
  /**
   * @param {object} o
   * @param {Function} o.heightAt
   * @param {object[]} o.islands
   * @param {number} o.hideWithin  the streamed range: an island any part of which is nearer is not drawn here
   */
  constructor({ heightAt, islands, hideWithin }) {
    this.heightAt = heightAt;
    this.islands = islands;
    this.todo = islands.map((_, i) => i);
    this.shapes = new Array(islands.length).fill(null);
    this.per = 1 + (RINGS.length - 1) * SPOKES;
    const nV = islands.length * this.per;
    this.pos = new Float32Array(nV * 3);
    this.col = new Float32Array(nV * 3);
    this.isle = new Float32Array(nV * 3);
    const idx = [];
    for (let k = 0; k < islands.length; k++) {
      const base = k * this.per;
      // The centre fan.
      for (let s = 0; s < SPOKES; s++) idx.push(base, base + 1 + ((s + 1) % SPOKES), base + 1 + s);
      for (let r = 1; r < RINGS.length - 1; r++) {
        const a0 = base + 1 + (r - 1) * SPOKES;
        const b0 = base + 1 + r * SPOKES;
        for (let s = 0; s < SPOKES; s++) {
          const s1 = (s + 1) % SPOKES;
          idx.push(a0 + s, a0 + s1, b0 + s, b0 + s, a0 + s1, b0 + s1);
        }
      }
    }
    // Vertices of an island not built yet sit at y = -1e4: under the sea, and hidden anyway (see the shader).
    for (let i = 0; i < nV; i++) this.pos[i * 3 + 1] = -1e4;
    const g = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3);
    this.aCol = new THREE.BufferAttribute(this.col, 3);
    this.aIsle = new THREE.BufferAttribute(this.isle, 3);
    g.setAttribute('position', this.aPos);
    g.setAttribute('color', this.aCol);
    g.setAttribute('aIsle', this.aIsle);
    g.setIndex(idx);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
    this.geometry = g;
    this.uCam = { value: new THREE.Vector2(0, 0) };
    this.uHide = { value: hideWithin };
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uWpCam = this.uCam;
      shader.uniforms.uWpHide = this.uHide;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec3 aIsle;\nuniform vec2 uWpCam;\nuniform float uWpHide;')
        .replace('#include <project_vertex>', `#include <project_vertex>
          // Inside the streamed range, or not built yet: outside the clip volume, so not drawn.
          if (aIsle.z <= 0.0 || length(aIsle.xy - uWpCam) - aIsle.z < uWpHide) gl_Position = vec4(0.0, 0.0, 2.0, 1.0);`);
    };
    mat.customProgramCacheKey = () => 'wp-horizon';
    this.material = mat;
    const mesh = new THREE.Mesh(g, mat);
    mesh.name = 'world-horizon';
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.matrixAutoUpdate = false;
    this.mesh = mesh;
    this.built = 0;
  }

  /** Build islands until `budgetMs` is used (performance.now). Returns how many are left. */
  build(budgetMs = 1.5, now = () => performance.now()) {
    const t0 = now();
    const c = new THREE.Color();
    let dirty = false;
    while (this.todo.length && now() - t0 < budgetMs) {
      const k = this.todo.shift();
      const isl = this.islands[k];
      const pts = islandShape(this.heightAt, isl);
      this.shapes[k] = pts;
      const base = k * this.per;
      for (let i = 0; i < pts.length; i++) {
        const [x, h, z] = pts[i];
        const v = (base + i) * 3;
        // The outer ring is pulled down into the sea, so the shape has a waterline and no edge.
        const y = i >= this.per - SPOKES ? -6 : Math.max(-6, h - SINK);
        this.pos[v] = x;
        this.pos[v + 1] = y;
        this.pos[v + 2] = z;
        colourFor(h, c);
        this.col[v] = c.r;
        this.col[v + 1] = c.g;
        this.col[v + 2] = c.b;
        this.isle[v] = isl.cx;
        this.isle[v + 1] = isl.cz;
        this.isle[v + 2] = isl.radius * 1.45;
      }
      this.built++;
      dirty = true;
    }
    if (dirty) {
      this.aPos.needsUpdate = true;
      this.aCol.needsUpdate = true;
      this.aIsle.needsUpdate = true;
      this.geometry.computeVertexNormals();
    }
    return this.todo.length;
  }

  /** Every frame: where the camera is (world metres), and build a little more if there is more. */
  update(cam, budgetMs) {
    this.uCam.value.set(cam.x, cam.z);
    if (this.todo.length) this.build(budgetMs);
  }

  /** Which islands are drawn as shapes from here (the same rule as the shader). For the tests. */
  shownFrom(x, z) {
    const out = [];
    for (let k = 0; k < this.islands.length; k++) {
      const i = this.islands[k];
      if (!this.shapes[k]) continue;
      if (Math.hypot(i.cx - x, i.cz - z) - i.radius * 1.45 >= this.uHide.value) out.push(i);
    }
    return out;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}
