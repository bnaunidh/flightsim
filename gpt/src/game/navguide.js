/**
 * Navigation guidance.
 *
 * Two glowing rails, one running from each wingtip out to wherever you should
 * be going. They converge on the target, so you steer by simply keeping them
 * even — no reading, no arrows, no clutter in the middle of the windscreen.
 *
 * The rails are camera-facing ribbons rather than lines, because a one-pixel
 * line is invisible against bright water and cannot be made thicker in WebGL.
 * Each is rebuilt every frame from the aeroplane's real wingtip positions, so
 * they roll with the aeroplane and read as part of it.
 *
 * The target is whatever the game says is next: a mission waypoint, or the
 * runway threshold when there is nothing else.
 */

import * as THREE from '../vendor/three.module.js';
import { clamp } from '../core/noise.js';

const COLOUR_FAR = new THREE.Color(0x62e0ff);
const COLOUR_NEAR = new THREE.Color(0x7dffb4);

/** Points along each rail. More is smoother; 26 is plenty and costs nothing. */
const SEGMENTS = 26;
/** Where the wingtips are, in the aeroplane's own frame. */
const WING_SPAN = 5.1;
const WING_DROP = 0.35;

class Rail {
  constructor(group) {
    const verts = new Float32Array(SEGMENTS * 2 * 3);
    const colours = new Float32Array(SEGMENTS * 2 * 3);
    const alphas = new Float32Array(SEGMENTS * 2);
    const idx = [];
    for (let i = 0; i < SEGMENTS - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colours, 3));
    geo.setAttribute('aFade', new THREE.BufferAttribute(alphas, 1));
    geo.setIndex(idx);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);

    // Additive so the rails glow over sea and sky alike and never look like a
    // solid object you might fly into.
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: { uOpacity: { value: 1 } },
      vertexShader: `
        attribute float aFade;
        varying float vFade;
        varying vec3 vCol;
        void main() {
          vFade = aFade;
          vCol = color;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform float uOpacity;
        varying float vFade;
        varying vec3 vCol;
        void main() {
          gl_FragColor = vec4(vCol, vFade * uOpacity);
        }`,
      vertexColors: true,
    });

    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 30;
    group.add(this.mesh);
    this.pos = geo.attributes.position;
    this.col = geo.attributes.color;
    this.fade = geo.attributes.aFade;
    this.mat = mat;
  }

  /**
   * @param {THREE.Vector3} from wingtip, in world space
   * @param {THREE.Vector3} to the target
   * @param {THREE.Vector3} eye camera position, for billboarding
   * @param {THREE.Color} colour
   * @param {number} phase 0..1 scrolling offset, so the rail visibly flows
   */
  update(from, to, eye, colour, phase) {
    const p = this.pos.array;
    const c = this.col.array;
    const f = this.fade.array;
    const dir = _v1.subVectors(to, from);
    const total = dir.length() || 1;
    dir.multiplyScalar(1 / total);

    for (let i = 0; i < SEGMENTS; i++) {
      const t = i / (SEGMENTS - 1);
      _v2.copy(from).addScaledVector(dir, total * t);
      // Billboard: offset sideways, perpendicular to both the rail and the
      // direction the camera is looking at this point.
      _v3.subVectors(_v2, eye);
      _v4.crossVectors(dir, _v3).normalize();
      // Thicker further away so the rail keeps a steady width on screen, and
      // tapered towards the target so it reads as pointing somewhere.
      const dist = _v3.length();
      /*
       * Keep a roughly constant width on screen — but only roughly.
       *
       * This widens each segment by its own distance from the eye, so a rail
       * running away from you gets steadily fatter with range: it stops being
       * a rail and becomes a wedge. At the old 0.0032 with an 18 m cap, a
       * guide to a target a few kilometres off was a 36 m slab lying across
       * the sea and the island, at 85% opacity — you could not see the world
       * for the guidance. Halved the rate and cut the cap to 5 m, which keeps
       * it readable at range without painting over the view.
       */
      const w = clamp(dist * 0.0016, 0.3, 5) * (1 - t * 0.55);
      const a = i * 6;
      p[a] = _v2.x - _v4.x * w;
      p[a + 1] = _v2.y - _v4.y * w;
      p[a + 2] = _v2.z - _v4.z * w;
      p[a + 3] = _v2.x + _v4.x * w;
      p[a + 4] = _v2.y + _v4.y * w;
      p[a + 5] = _v2.z + _v4.z * w;

      for (let k = 0; k < 2; k++) {
        const b = a + k * 3;
        c[b] = colour.r;
        c[b + 1] = colour.g;
        c[b + 2] = colour.b;
      }
      // Fade in off the wingtip so it does not sprout out of the wing, fade
      // out at the far end, and run a soft pulse along the length so you can
      // see which way it flows.
      const ends = Math.min(1, t / 0.06) * (1 - clamp((t - 0.8) / 0.2, 0, 1));
      const flow = 0.62 + 0.38 * Math.sin((t * 5.5 - phase * Math.PI * 2) * Math.PI);
      const v = ends * flow;
      f[i * 2] = v;
      f[i * 2 + 1] = v;
    }
    this.pos.needsUpdate = true;
    this.col.needsUpdate = true;
    this.fade.needsUpdate = true;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3();
const _tipL = new THREE.Vector3();
const _tipR = new THREE.Vector3();
const _colour = new THREE.Color();

export class NavGuide {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.name = 'navguide';
    this.enabled = true;
    this.t = 0;

    this.left = new Rail(this.group);
    this.right = new Rail(this.group);

    this.group.visible = false;
    scene.add(this.group);
  }

  setEnabled(on) {
    this.enabled = on;
    if (!on) this.group.visible = false;
    return on;
  }

  toggle() {
    return this.setEnabled(!this.enabled);
  }

  /**
   * @param {THREE.Vector3|null} target where to point, or null to hide
   * @param {THREE.Vector3} from the aeroplane's position
   * @param {THREE.Quaternion} quat the aeroplane's attitude
   * @param {THREE.Vector3} eye the camera position
   */
  update(dt, target, from, quat, eye) {
    if (!this.enabled || !target) {
      this.group.visible = false;
      return;
    }
    this.group.visible = true;
    this.t += dt;

    const dist = from.distanceTo(target);
    // Green once you are close enough to be looking for it out of the window.
    _colour.copy(dist < 900 ? COLOUR_NEAR : COLOUR_FAR);
    // Fade the whole thing out when you are practically on top of the target,
    // so it never sits between you and the runway during the flare.
    // Faint enough to be guidance rather than scenery. It is a hint about
    // where to point, not a feature of the island.
    const opacity = clamp((dist - 90) / 260, 0, 1) * 0.42;
    this.left.mat.uniforms.uOpacity.value = opacity;
    this.right.mat.uniforms.uOpacity.value = opacity;
    if (opacity <= 0.001) {
      this.group.visible = false;
      return;
    }

    // Real wingtip positions, so the rails roll with the aeroplane.
    _tipL.set(-WING_SPAN, WING_DROP, 0.1).applyQuaternion(quat).add(from);
    _tipR.set(WING_SPAN, WING_DROP, 0.1).applyQuaternion(quat).add(from);

    const phase = (this.t * 0.55) % 1;
    this.left.update(_tipL, target, eye, _colour, phase);
    this.right.update(_tipR, target, eye, _colour, phase);
  }
}
