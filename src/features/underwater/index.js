/**
 * UNDER THE SEA: "under the map inw ateer isnt void theres an underwater area"
 * (the owner, 2026-11-05). When the camera goes under, the world above the
 * water is put away for the draw and this is drawn instead: the real sea floor
 * (./seabed.js), the water and the surface from below, light shafts and what
 * hangs in the water (./water.js), in the light that is left at that depth
 * (./tint.js).
 *
 * LOADED ONLY WHEN IT IS WANTED. features/breakup.js imports this the moment a
 * wreck starts going down or a lens goes under, and throws it all away with
 * the flight. Nothing here is in the first load, and nothing here runs with the
 * lens above the water: `scene.onBeforeRender` looks at one number.
 *
 * THE DRAW. Everything three needs is settled inside WebGLRenderer.render,
 * after scene.onBeforeRender and before anything is drawn, so that one hook
 * does it all and scene.onAfterRender gives every value back; the game's own
 * code, which runs between draws, never sees any of it:
 *
 *   - every top-level thing in the scene but the lights, the aeroplane, its
 *     pieces and this goes invisible. That is the whole of the cost of the
 *     island gone: under the water there are fewer draw calls than anywhere
 *     else in the game, on every map, and nothing can show through.
 *   - the fog becomes water, and the height fog goes off.
 *   - the scene's lights take the water's colour, as weak as the depth has
 *     left them, and the sky's reflection on the wreck goes with them.
 *
 * The floating origin (render/render-origin.js) moves the scene and the camera
 * for the draw; this stands in the scene like anything else, and only takes
 * the camera's height (which the origin does not touch) from its position.
 */

import * as THREE from '../../vendor/three.module.js';
import { heightAt } from '../../world/terrain.js';
import { HEIGHT_FOG } from '../../render/height-fog.js';
import { Seabed, rippleTexture } from './seabed.js';
import { WaterDome, Shafts, Motes, Bubbles, AMOUNT } from './water.js';
import { waterLook } from './tint.js';

/** Under the surface by this much the world goes (metres); back over it by this much it comes back. */
export const SURFACE = { in: -0.02, out: 0.04 };

const _sun = new THREE.Vector3();

export class Underwater {
  constructor(sim, { quality = 'high', keep = [], focus = null } = {}) {
    this.sim = sim;
    this.scene = sim.scene;
    this.quality = quality;
    this.low = quality === 'low';
    this.keep = new Set(keep.filter(Boolean));
    this.time = 0;
    this.on = false;
    this.hidden = [];
    this.saved = [];
    this.drawn = 0;
    this.root = new THREE.Group();
    this.root.name = 'underwater';
    this.root.visible = false;
    this.keep.add(this.root);
    this.scene.add(this.root);
    this.look = waterLook(10, 1, this.low);
    const c = (v) => new THREE.Color(v[0], v[1], v[2]);
    // One object of each, shared by reference by every material down here.
    this.shared = {
      fog: { value: c(this.look.fog) },
      top: { value: c(this.look.top) },
      deep: { value: c(this.look.deep) },
      sky: { value: new THREE.Color(0.6, 0.8, 0.9) },
      tint: { value: new THREE.Color(0.5, 0.7, 0.7) },
      density: { value: this.look.density },
      ambient: { value: 0.5 },
      caustics: { value: 0 },
      sunDir: { value: new THREE.Vector3(0.3, 0.9, 0.2).normalize() },
      sunGlow: { value: 1 },
      time: { value: 0 },
      depth: { value: 10 },
      eye: { value: new THREE.Vector3() },
      shafts: { value: 0 },
      shaftColor: { value: new THREE.Color(0.6, 0.85, 0.8) },
      moteColor: { value: new THREE.Color(0.6, 0.8, 0.8) },
      bubbleColor: { value: new THREE.Color(0.85, 0.95, 1) },
      siltColor: { value: new THREE.Color(0.5, 0.5, 0.42) },
    };
    const amount = AMOUNT[quality] || AMOUNT.high;
    const h = (sim.renderer && sim.renderer.domElement && sim.renderer.domElement.height) || 768;
    this.ripple = rippleTexture();
    this.bed = new Seabed(this.root, quality, heightAt, this.shared);
    this.dome = new WaterDome(this.root, this.shared, this.ripple);
    this.shaftsMesh = new Shafts(this.root, this.shared, amount.shafts);
    this.motes = new Motes(this.root, this.shared, amount.motes, h);
    this.bubbles = new Bubbles(this.root, this.shared, amount.bubbles, h);
    this.silt = new Bubbles(this.root, this.shared, Math.round(amount.bubbles * 0.6), h, true);
    this.wreck = focus ? focus.clone() : null;
    this.laid = false;
    this.bubbleT = 0;
    this.touched = false;
    if (focus) this.placeBed(focus.x, focus.z);
    this.lights = [];
    this.before = (renderer, scene, camera) => this.beforeDraw(renderer, scene, camera);
    this.after = () => this.afterDraw();
    this.prevBefore = this.scene.onBeforeRender;
    this.prevAfter = this.scene.onAfterRender;
    this.scene.onBeforeRender = this.before;
    this.scene.onAfterRender = this.after;
    this.compile();
  }

  /** Everything compiled ahead of the moment it is wanted: a hitch at the waterline is the one place it would show. */
  compile() {
    const { sim } = this;
    if (!sim.renderer || !sim.renderer.compileAsync || !sim.camera) return;
    this.root.visible = true;
    const was = this.scene.onBeforeRender;
    try {
      const p = sim.renderer.compileAsync(this.root, sim.camera, this.scene);
      if (p && p.catch) p.catch(() => {});
    } catch (e) {
      /* it will compile on the first draw instead */
    }
    this.scene.onBeforeRender = was;
    this.root.visible = false;
  }

  placeBed(x, z) {
    this.bed.layout(x, z);
    this.laid = true;
  }

  /** The way the aeroplane went into the water: what came off it lies along that line. */
  layDebris(x, z, dx, dz, seed) {
    if (!this.laid) this.placeBed(x, z);
    this.bed.layDebris(x, z, dx, dz, seed);
  }

  /** A frame of the game: dt on its clock, the lens, where the wreck is, and how its dive is going. */
  update(dt, cam, wreckAt, dive) {
    this.time += dt;
    this.shared.time.value = this.time;
    if (cam && (!this.laid || this.bed.nearEdge(cam.position.x, cam.position.z))) this.placeBed(cam.position.x, cam.position.z);
    // What comes off a wreck on its way down, and off the bottom when it lands.
    if (wreckAt && wreckAt.y < -0.5) {
      this.bubbleT -= dt;
      if (this.bubbleT <= 0) {
        this.bubbleT = this.low ? 0.09 : 0.05;
        const s = 5;
        this.bubbles.emit(wreckAt.x + (Math.random() - 0.5) * s, wreckAt.y + Math.random() * 2, wreckAt.z + (Math.random() - 0.5) * s, 0, 1.4 + Math.random() * 1.8, 0, 6, 0.5 + Math.random() * 0.9);
      }
    }
    if (dive && dive.bed && !this.touched && wreckAt) {
      this.touched = true;
      const n = this.low ? 14 : 28;
      const floor = heightAt(wreckAt.x, wreckAt.z);
      for (let i = 0; i < n; i++) {
        const a = Math.random() * 6.283;
        const v = 1.4 + Math.random() * 3;
        this.silt.emit(wreckAt.x + Math.cos(a) * 4, floor + 0.6, wreckAt.z + Math.sin(a) * 4, Math.cos(a) * v, 0.3 + Math.random() * 0.6, Math.sin(a) * v, 4 + Math.random() * 3, 3 + Math.random() * 3);
      }
    }
    this.bubbles.update(dt, this.time);
    this.silt.update(dt, this.time);
    if (cam) {
      this.dome.update(cam.position.x, cam.position.z);
    }
  }

  applyLook(depth) {
    const { sim, shared } = this;
    const w = sim.weather;
    const ti = w && w.timeInfo;
    const day = ti ? ti.daylight : 1;
    const L = (this.look = waterLook(depth, day, this.low));
    shared.fog.value.setRGB(L.fog[0], L.fog[1], L.fog[2]);
    shared.top.value.setRGB(L.top[0], L.top[1], L.top[2]);
    shared.deep.value.setRGB(L.deep[0], L.deep[1], L.deep[2]);
    shared.density.value = L.density;
    shared.depth.value = depth;
    shared.caustics.value = L.caustics;
    shared.shafts.value = L.shafts * (this.low ? 0.1 : 0.09);
    shared.ambient.value = 0.4;
    shared.sunGlow.value = Math.max(0, Math.min(1, (day - 0.1) * 2));
    shared.sky.value.setRGB(0.5, 0.75, 0.82).multiplyScalar(0.25 + 1.1 * L.sun);
    shared.tint.value.setRGB(1, 1, 1).multiplyScalar(0.075 + 0.83 * Math.pow(Math.max(0, Math.min(1, day)), 0.8));
    shared.shaftColor.value.setRGB(L.top[0] + 0.3, L.top[1] + 0.32, L.top[2] + 0.3);
    shared.moteColor.value.setRGB(L.top[0] * 1.5 + 0.1, L.top[1] * 1.5 + 0.12, L.top[2] * 1.5 + 0.12);
    shared.bubbleColor.value.setRGB(L.top[0] * 2 + 0.3, L.top[1] * 2 + 0.3, L.top[2] * 2 + 0.3);
    shared.siltColor.value.setRGB(L.fog[0] * 1.3 + 0.05, L.fog[1] * 1.3 + 0.05, L.fog[2] * 1.1 + 0.03);
    if (w && w.sunDirection) {
      w.sunDirection(_sun);
      if (_sun.y < 0.05) _sun.y = 0.05;
      shared.sunDir.value.copy(_sun.normalize());
    }
  }

  beforeDraw(renderer, scene, camera) {
    const y = camera.position.y;
    const under = this.on ? y < SURFACE.out : y < SURFACE.in;
    this.on = under;
    this.root.visible = under;
    if (!under) return;
    this.drawn++;
    const depth = Math.max(0.05, -y);
    this.applyLook(depth);
    this.shared.eye.value.copy(camera.position);
    const L = this.look;
    // The world above the water, away.
    const keep = this.keep;
    const hidden = this.hidden;
    hidden.length = 0;
    for (const c of scene.children) {
      if (!c.visible || c.isLight || keep.has(c)) continue;
      // An empty anchor (the sun's target) is not drawn anyway, and a light may be pointing at it.
      if (c.type === 'Object3D' && !c.children.length) continue;
      c.visible = false;
      hidden.push(c);
    }
    // The water in the fog, and no weather's murk.
    const f = scene.fog;
    this.fogWas = f ? { color: f.color.clone(), density: f.density } : null;
    if (f) {
      f.color.copy(this.shared.fog.value);
      f.density = L.density;
    }
    this.hfWas = HEIGHT_FOG.x;
    HEIGHT_FOG.x = 0;
    // The light that is left down here.
    const saved = this.saved;
    saved.length = 0;
    for (const c of scene.children) {
      if (!c.isLight) continue;
      saved.push(c, c.intensity, c.color.getHex(THREE.LinearSRGBColorSpace), c.groundColor ? c.groundColor.getHex(THREE.LinearSRGBColorSpace) : 0);
      if (c.isDirectionalLight) {
        c.intensity *= L.sun * 1.3;
        c.color.setRGB(0.42, 0.8, 0.82);
      } else if (c.isHemisphereLight) {
        c.intensity = 0.8 * L.ambient;
        c.color.setRGB(L.top[0] * 2.6, L.top[1] * 2.6, L.top[2] * 2.6);
        c.groundColor.setRGB(L.deep[0], L.deep[1], L.deep[2]);
      } else if (c.isAmbientLight) {
        c.intensity = 0.3 * L.ambient;
        c.color.setRGB(0.45, 0.75, 0.8);
      } else c.intensity = 0;
    }
    this.envWas = scene.environmentIntensity;
    scene.environmentIntensity = 0.12 * L.ambient;
  }

  afterDraw() {
    if (!this.on) return;
    const { scene } = this;
    for (const c of this.hidden) c.visible = true;
    this.hidden.length = 0;
    if (this.fogWas && scene.fog) {
      scene.fog.color.copy(this.fogWas.color);
      scene.fog.density = this.fogWas.density;
    }
    HEIGHT_FOG.x = this.hfWas;
    const s = this.saved;
    for (let i = 0; i < s.length; i += 4) {
      const c = s[i];
      c.intensity = s[i + 1];
      c.color.setHex(s[i + 2], THREE.LinearSRGBColorSpace);
      if (c.groundColor) c.groundColor.setHex(s[i + 3], THREE.LinearSRGBColorSpace);
    }
    s.length = 0;
    scene.environmentIntensity = this.envWas;
  }

  debug() {
    return { on: this.on, drawn: this.drawn, laid: this.laid, depth: this.shared.depth.value, look: this.look, patch: this.laid ? { x: this.bed.cx, z: this.bed.cz } : null, rocks: this.bed.rocks.count, weed: this.bed.weed.count, shells: this.bed.shells.count, debris: this.bed.debris.count };
  }

  dispose() {
    const s = this.scene;
    if (s.onBeforeRender === this.before) s.onBeforeRender = this.prevBefore || THREE.Scene.prototype.onBeforeRender;
    if (s.onAfterRender === this.after) s.onAfterRender = this.prevAfter || THREE.Scene.prototype.onAfterRender;
    this.afterDraw();
    this.on = false;
    this.bed.dispose();
    this.dome.dispose();
    this.shaftsMesh.dispose();
    this.motes.dispose();
    this.bubbles.dispose();
    this.silt.dispose();
    this.ripple.dispose();
    this.root.removeFromParent();
  }
}
