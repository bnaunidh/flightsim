/**
 * The planform blob shadow — the aircraft's shadow on Low (L10 of the rival
 * brief, .claude/devtools/briefs/rival-details.md).
 *
 * Low has no shadow maps (sky.js `shadows: quality !== 'low'`), so the
 * aeroplane had no shadow at all there, and the shadow on the runway is the
 * main depth cue when landing. This is one transparent quad on the ground:
 *
 *   - its picture is the aircraft's own top-down silhouette, drawn once per
 *     model into a 64×64 target (an orthographic camera straight above it,
 *     every material overridden to black) — so it is the real planform of
 *     whatever you fly, the GLB fleet included, with no shape data to keep;
 *   - it sits under the aircraft, shifted down-sun by AGL / tan(elevation)
 *     (where the shadow really falls), turned to the heading, lifted a
 *     little off the ground so the coarse terrain mesh does not cut it;
 *   - it softens and grows a little with height (the sun is half a degree
 *     wide) and fades out with height and with the daylight — gone by
 *     BLOB.fadeAgl metres, gone under heavy overcast, gone at night.
 *
 * Cost on Low: one quad, one small texture fetch with four taps, and one
 * 64×64 render when the aircraft changes. tests/features/realism.mjs
 * section 2 and realism.browser.js section 2 hold it to its rules.
 */

import * as THREE from '../vendor/three.module.js';
import { daylight, smooth } from '../world/atmos.js';

export const BLOB = Object.freeze({
  /** The silhouette target, pixels a side. */
  size: 64,
  /** Metres above ground at which the shadow has faded out entirely. */
  fadeAgl: 220,
  /**
   * Metres the quad floats above the terrain: the coarse terrain mesh would
   * cut it on the ground, and the runway's pavement sits about 0.4 m over
   * the terrain it is flattened onto (world/airport.js), so it clears that too.
   */
  lift: 0.6,
  /** Its darkness on a clear day at ground level. */
  maxOpacity: 0.55,
  /** The most the shadow may be shifted sideways, as a multiple of AGL (a 4.8° sun). */
  maxShiftPerMetre: 12,
  /** Margin round the silhouette in the target, as a fraction of its size. */
  margin: 0.12,
});

const _box = new THREE.Box3();
const _sun = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _clear = new THREE.Color();

/**
 * Pure: where the blob goes and how dark it is, from the aircraft's state and
 * the sun. { shiftX, shiftZ, opacity, soft, grow } — shift in metres from the
 * point under the aircraft, soft in texels, grow as a scale factor.
 *   sunDir: unit vector TO the sun (x east, y up, z south); agl metres;
 *   overcast 0..1.
 */
export function blobPlacement(sunDir, agl, overcast = 0) {
  const el = Math.asin(Math.max(-1, Math.min(1, sunDir.y))) * (180 / Math.PI);
  const h = Math.max(0, agl);
  const flat = Math.hypot(sunDir.x, sunDir.z);
  // The shadow falls away from the sun: h / tan(el) along −sun, capped.
  const per = sunDir.y > 1e-3 ? Math.min(BLOB.maxShiftPerMetre, flat / sunDir.y) : BLOB.maxShiftPerMetre;
  const inv = flat > 1e-6 ? 1 / flat : 0;
  const shiftX = -sunDir.x * inv * per * h;
  const shiftZ = -sunDir.z * inv * per * h;
  const height = 1 - smooth(0.35, 1, h / BLOB.fadeAgl);
  const opacity = BLOB.maxOpacity * daylight(el) * smooth(1, 7, el) * (1 - 0.8 * Math.max(0, Math.min(1, overcast))) * height;
  // Penumbra: the sun is ~0.5° across, so the edge blurs by about 0.9% of the distance.
  const soft = 1 + h * 0.03;
  const grow = 1 + h * 0.006;
  return { shiftX, shiftZ, opacity, soft, grow, el };
}

export class BlobShadow {
  constructor(renderer) {
    this.renderer = renderer;
    this.target = new THREE.WebGLRenderTarget(BLOB.size, BLOB.size, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      generateMipmaps: false,
      depthBuffer: true,
      stencilBuffer: false,
    });
    this.target.texture.name = 'blob-shadow';
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
    this.black = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.DoubleSide });
    this.capScene = new THREE.Scene();
    this.capScene.overrideMaterial = this.black;

    /*
     * The quad: x across (span), z along (length), uv matching the capture
     * (u with +x, v with −z — the camera above looks down with north up).
     */
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 0, 0.5, -0.5, 0, 0.5], 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 1, 1, 1, 0, 0, 0], 2));
    geo.setIndex([0, 2, 1, 0, 3, 2]);
    this.uniforms = {
      uMap: { value: this.target.texture },
      uOpacity: { value: 0 },
      uSoft: { value: 1 / BLOB.size },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap;
        uniform float uOpacity;
        uniform float uSoft;
        varying vec2 vUv;
        void main() {
          // Four taps on a rotated cross: a soft edge for one small texture.
          float a = texture2D(uMap, vUv + vec2(uSoft, uSoft * 0.5)).a
                  + texture2D(uMap, vUv + vec2(-uSoft * 0.5, uSoft)).a
                  + texture2D(uMap, vUv + vec2(-uSoft, -uSoft * 0.5)).a
                  + texture2D(uMap, vUv + vec2(uSoft * 0.5, -uSoft)).a;
          a *= 0.25;
          // Fade to nothing at the quad's edge, whatever the silhouette did.
          vec2 e = smoothstep(0.0, 0.08, vUv) * smoothstep(1.0, 0.92, vUv);
          a *= e.x * e.y;
          if (a < 0.004) discard;
          gl_FragColor = vec4(0.0, 0.0, 0.0, a * uOpacity);
        }`,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      polygonOffset: true,
      // Nearer than every pavement, paint and decal layer (world/airport-kit.js LAYER goes to −2/−5).
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -8,
      fog: false,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.name = 'blob-shadow';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.mesh.visible = false;
    this.mesh.matrixAutoUpdate = false;

    this.captured = null;
    this.capturedAt = 0;
    this.recaptureAt = 0;
    this.captures = 0;
    this.span = 1;
    this.length = 1;
    this.centreX = 0;
    this.centreZ = 0;
    this.t = 0;
  }

  /**
   * Draw the model's silhouette from straight above into the target. The
   * model is moved to the origin (upright, unrotated) for the one render and
   * put back; its own scene loses it for the same instant.
   */
  capture(model) {
    if (!model || !this.renderer) return false;
    const r = this.renderer;
    const parent = model.parent;
    _pos.copy(model.position);
    _quat.copy(model.quaternion);
    _scale.copy(model.scale);
    model.position.set(0, 0, 0);
    model.quaternion.identity();
    model.updateMatrixWorld(true);
    this.capScene.add(model);
    model.updateMatrixWorld(true);
    _box.setFromObject(model, true);
    let ok = false;
    if (Number.isFinite(_box.min.x) && Number.isFinite(_box.max.x) && !_box.isEmpty()) {
      const span = Math.max(0.5, _box.max.x - _box.min.x);
      const length = Math.max(0.5, _box.max.z - _box.min.z);
      const side = Math.max(span, length) * (1 + 2 * BLOB.margin);
      this.span = side;
      this.length = side;
      this.centreX = (_box.min.x + _box.max.x) / 2;
      this.centreZ = (_box.min.z + _box.max.z) / 2;
      const cam = this.camera;
      cam.left = -side / 2;
      cam.right = side / 2;
      cam.top = side / 2;
      cam.bottom = -side / 2;
      cam.near = 0.1;
      cam.far = (_box.max.y - _box.min.y) + 40;
      cam.position.set(this.centreX, _box.max.y + 20, this.centreZ);
      cam.up.set(0, 0, -1);
      cam.lookAt(this.centreX, _box.min.y, this.centreZ);
      cam.updateProjectionMatrix();
      cam.updateMatrixWorld(true);
      const prevTarget = r.getRenderTarget();
      const prevAuto = r.autoClear;
      r.getClearColor(_clear);
      const prevAlpha = r.getClearAlpha();
      const prevShadow = r.shadowMap.enabled;
      try {
        r.shadowMap.enabled = false;
        r.setRenderTarget(this.target);
        r.setClearColor(0x000000, 0);
        r.autoClear = true;
        r.clear(true, true, false);
        r.render(this.capScene, cam);
        ok = true;
      } catch (e) {
        console.warn('[blob-shadow] could not draw the silhouette', e);
      } finally {
        r.setRenderTarget(prevTarget);
        r.setClearColor(_clear, prevAlpha);
        r.autoClear = prevAuto;
        r.shadowMap.enabled = prevShadow;
      }
    }
    this.capScene.remove(model);
    if (parent) parent.add(model);
    model.position.copy(_pos);
    model.quaternion.copy(_quat);
    model.scale.copy(_scale);
    model.updateMatrixWorld(true);
    this.captured = model;
    this.capturedAt = this.t;
    /*
     * A model that is still loading (the GLB fleet) is drawn again a few
     * seconds on — twice, at 3 s and 10 s, and then never: this used to
     * re-arm itself on every capture, a full render of the aeroplane into the
     * target every 3 s forever, on Low (checker, realism-1).
     */
    this.recaptureAt = this.captures === 0 ? this.t + 3 : this.captures === 1 ? this.t + 7 : 0;
    this.captures++;
    return ok;
  }

  /**
   * Once a frame: `ac` the player's aircraft (pos, quat, agl), `model` its
   * model, `weather` for the sun and the cloud. Hidden when the sun is down,
   * the sky is overcast or the aircraft is high.
   */
  update(dt, ac, model, weather) {
    this.t += dt;
    if (!ac || !model || !weather) {
      this.mesh.visible = false;
      return;
    }
    if (model !== this.captured) {
      this.captures = 0;
      this.capture(model);
    } else if (this.recaptureAt && this.t >= this.recaptureAt) {
      this.recaptureAt = 0;
      this.capture(model);
    }
    weather.sunDirection(_sun);
    const cloud = weather.cond ? weather.cond.cloud || 0 : 0;
    const agl = Number.isFinite(ac.agl) ? ac.agl : 0;
    // The ground under the aircraft — or the sea's surface over water (agl is measured to the sea floor there).
    const groundY = Math.max(ac.pos.y - agl, 0);
    // How high over what the shadow falls on: over the sea floor's depth it fell ten metres off
    // to one side of an aeroplane sitting on the water, and made it look airborne.
    const height = ac.pos.y - groundY;
    const P = blobPlacement(_sun, height, cloud);
    this.placement = P;
    if (P.opacity < 0.01) {
      this.mesh.visible = false;
      return;
    }
    // Heading from the aircraft's forward vector (a yaw about +y maps (0,0,−1) to (−sin ψ, 0, −cos ψ)).
    _fwd.set(0, 0, -1).applyQuaternion(ac.quat);
    const yaw = Math.atan2(-_fwd.x, -_fwd.z);
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    // The silhouette's centre in aircraft space, turned to the heading.
    const cx = this.centreX * cy + this.centreZ * sy;
    const cz = -this.centreX * sy + this.centreZ * cy;
    const m = this.mesh;
    m.position.set(ac.pos.x + cx + P.shiftX, groundY + BLOB.lift + height * 0.004, ac.pos.z + cz + P.shiftZ);
    m.rotation.set(0, yaw, 0);
    m.scale.set(this.span * P.grow, 1, this.length * P.grow);
    m.updateMatrix();
    m.updateMatrixWorld(true);
    this.uniforms.uOpacity.value = P.opacity;
    this.uniforms.uSoft.value = (P.soft / BLOB.size) * 0.9;
    m.visible = true;
  }

  dispose() {
    this.target.dispose();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.black.dispose();
    if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
  }
}
