/**
 * Sky dome, sun, stars and scene lighting.
 *
 * The dome is a single inward-facing sphere with a custom shader: a physically
 * plausible-looking gradient, a sun disc with glow, a horizon haze band and a
 * procedural star field that fades in at night. Cheap (one draw call) and it
 * reacts instantly to weather changes.
 */

import * as THREE from '../vendor/three.module.js';

const vertexShader = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
  }
`;

const fragmentShader = /* glsl */ `
  precision highp float;
  varying vec3 vDir;

  uniform vec3 uTop;
  uniform vec3 uHorizon;
  uniform vec3 uSunColor;
  uniform vec3 uSunDir;
  uniform float uStars;
  uniform float uOvercast;
  uniform float uFlash;

  float hash(vec3 p) {
    p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }

  void main() {
    vec3 dir = normalize(vDir);
    float h = clamp(dir.y, -1.0, 1.0);

    // Base gradient: strong compression near the horizon like real haze.
    float t = pow(clamp(h, 0.0, 1.0), 0.42);
    vec3 col = mix(uHorizon, uTop, t);

    // Below the horizon fade to a slightly darker haze (seen over the ocean).
    if (h < 0.0) {
      col = mix(uHorizon, uHorizon * 0.72, clamp(-h * 2.2, 0.0, 1.0));
    }

    // Horizon haze: a bright band just above the skyline, like real aerial
    // perspective. This is most of what makes a sky read as "outdoors".
    float haze = exp(-abs(h) * 9.0);
    col = mix(col, uHorizon * 1.12, haze * 0.55);

    // Sun disc, bloom and a wide forward-scatter glow.
    float sd = max(dot(dir, normalize(uSunDir)), 0.0);
    float glow = pow(sd, 4.0) * 0.22 + pow(sd, 32.0) * 0.5 + pow(sd, 400.0) * 1.6;
    float disc = smoothstep(0.9986, 0.9995, sd);
    col += uSunColor * glow * (1.0 - uOvercast * 0.8);
    col += uSunColor * disc * 6.0 * (1.0 - uOvercast);

    // The moon, opposite the sun at night.
    if (uStars > 0.001) {
      float md = max(dot(dir, normalize(-uSunDir * vec3(1.0, -1.0, 1.0))), 0.0);
      col += vec3(0.85, 0.88, 1.0) * smoothstep(0.9990, 0.9997, md) * 2.2 * uStars;
      col += vec3(0.5, 0.55, 0.7) * pow(md, 300.0) * 0.5 * uStars;
    }

    // Star field: quantise the direction into cells and light a few of them.
    if (uStars > 0.001) {
      vec3 q = dir * 260.0;
      vec3 cell = floor(q);
      float r = hash(cell);
      if (r > 0.9925) {
        vec3 f = fract(q) - 0.5;
        float d = length(f);
        float star = smoothstep(0.34, 0.0, d);
        float twinkle = 0.65 + 0.35 * sin(r * 90.0);
        col += vec3(0.85, 0.9, 1.0) * star * twinkle * uStars *
               smoothstep(-0.02, 0.25, h) * 1.6;
      }
    }

    // Lightning: momentarily wash the whole dome.
    col += vec3(0.75, 0.8, 0.95) * uFlash * 0.85;

    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

export class SkyDome {
  constructor(scene, { shadows = true, shadowMapSize = 2048 } = {}) {
    this.scene = scene;

    this.uniforms = {
      uTop: { value: new THREE.Color(0x2f6fd0) },
      uHorizon: { value: new THREE.Color(0xbcd7f2) },
      uSunColor: { value: new THREE.Color(0xfff4e0) },
      uSunDir: { value: new THREE.Vector3(0.4, 0.8, 0.3) },
      uStars: { value: 0 },
      uOvercast: { value: 0 },
      uFlash: { value: 0 },
    };

    const geo = new THREE.SphereGeometry(1, 40, 24);
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader,
      fragmentShader,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.scale.setScalar(30000);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
    scene.add(this.mesh);

    // Sun / moon light.
    this.sun = new THREE.DirectionalLight(0xfff4e0, 3);
    this.sun.castShadow = shadows;
    if (shadows) {
      this.sun.shadow.mapSize.set(shadowMapSize, shadowMapSize);
      // A tighter frustum over the same map size means much crisper shadows
      // around the aeroplane, which is the only place you can see them.
      const d = 150;
      this.sun.shadow.camera.left = -d;
      this.sun.shadow.camera.right = d;
      this.sun.shadow.camera.top = d;
      this.sun.shadow.camera.bottom = -d;
      this.sun.shadow.camera.near = 1;
      this.sun.shadow.camera.far = 1400;
      this.sun.shadow.bias = -0.0006;
      this.sun.shadow.normalBias = 0.6;
    }
    scene.add(this.sun);
    this.shadowsEnabled = shadows;
    this.sunTarget = new THREE.Object3D();
    scene.add(this.sunTarget);
    this.sun.target = this.sunTarget;

    // Sky/ground bounce light.
    this.hemi = new THREE.HemisphereLight(0x9fb8d8, 0x5a6b52, 1.0);
    scene.add(this.hemi);

    // A touch of flat fill so shadowed sides never go pure black.
    this.fill = new THREE.AmbientLight(0xffffff, 0.16);
    scene.add(this.fill);

    scene.fog = new THREE.FogExp2(0xbcd7f2, 0.000018);

    this._sunDir = new THREE.Vector3();
    this._envSignature = '';
  }

  /**
   * Image-based lighting. A miniature copy of the sky dome is rendered into a
   * pre-filtered environment map, which gives the aeroplane's paint and the sea
   * real sky reflections instead of a flat colour. Regenerated only when the
   * weather actually changes — it is far too expensive per frame.
   */
  buildEnvironment(renderer, scene) {
    this.renderer = renderer;
    this.targetScene = scene;
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.pmrem.compileCubemapShader();

    // Same shader, same uniforms, tiny radius — so it tracks the weather.
    const geo = new THREE.SphereGeometry(8, 24, 16);
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: this.mesh.material.vertexShader,
      fragmentShader: this.mesh.material.fragmentShader,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.envScene = new THREE.Scene();
    this.envScene.add(new THREE.Mesh(geo, mat));
    this.refreshEnvironment(true);
  }

  refreshEnvironment(force = false) {
    if (!this.pmrem) return;
    const u = this.uniforms;
    // Quantised deliberately coarsely. A sunset moves the sun a hair every
    // frame; rebuilding the environment for a change nobody can see is pure
    // cost, and each rebuild allocates a fresh render target.
    const q = (n, step) => Math.round(n / step) * step;
    const sig = [
      u.uTop.value.getHexString(),
      u.uHorizon.value.getHexString(),
      q(u.uStars.value, 0.15).toFixed(2),
      q(u.uOvercast.value, 0.15).toFixed(2),
      q(u.uSunDir.value.y, 0.08).toFixed(2),
    ].join('|');
    if (!force && sig === this._envSignature) return;
    this._envSignature = sig;
    try {
      const rt = this.pmrem.fromScene(this.envScene, 0, 1, 40);
      // Dispose the whole previous render target, not just its texture.
      // PMREMGenerator.fromScene() allocates a new WebGLRenderTarget every
      // call; releasing only the texture leaks the framebuffer and, worse,
      // leaves the driver juggling ever more live attachments. Left unchecked
      // this eventually starves the GPU and the most environment-dependent
      // surface in the scene — the sea — starts rendering as blank blocks.
      const old = this.envRT;
      this.envRT = rt;
      this.envMap = rt.texture;
      this.targetScene.environment = this.envMap;
      if (old) old.dispose();
      // The environment now supplies ambient light, so dial the fill back down
      // to avoid washing everything out.
      this.envReady = true;
    } catch (err) {
      console.warn('Environment map unavailable:', err);
      this.pmrem = null;
    }
  }

  /** Free everything this sky owns. Called when the world is rebuilt. */
  dispose() {
    if (this.envRT) {
      this.envRT.dispose();
      this.envRT = null;
      this.envMap = null;
    }
    if (this.pmrem) {
      this.pmrem.dispose();
      this.pmrem = null;
    }
    if (this.envScene) {
      this.envScene.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose();
      });
      this.envScene = null;
    }
    if (this.sun && this.sun.shadow && this.sun.shadow.map) {
      this.sun.shadow.map.dispose();
      this.sun.shadow.map = null;
    }
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.scene.remove(this.sun, this.sunTarget, this.hemi, this.fill, this.mesh);
  }

  setShadowsEnabled(on, mapSize) {
    this.sun.castShadow = on;
    if (on && mapSize && this.sun.shadow.mapSize.x !== mapSize) {
      this.sun.shadow.mapSize.set(mapSize, mapSize);
      if (this.sun.shadow.map) {
        this.sun.shadow.map.dispose();
        this.sun.shadow.map = null;
      }
    }
  }

  /** Keep the shadow frustum centred on the aircraft. */
  followTarget(pos) {
    this.sunTarget.position.copy(pos);
    this.sun.position.copy(pos).addScaledVector(this._sunDir, 800);
    this.mesh.position.set(pos.x, 0, pos.z);
  }

  update(weather) {
    const p = weather.palette();
    weather.sunDirection(this._sunDir);

    this.uniforms.uTop.value.copy(p.top);
    this.uniforms.uHorizon.value.copy(p.horizon);
    this.uniforms.uSunColor.value.copy(p.sun);
    this.uniforms.uSunDir.value.copy(this._sunDir);
    this.uniforms.uStars.value = weather.isNight ? 1 - weather.cond.cloud * 0.95 : 0;
    this.uniforms.uOvercast.value = weather.cond.cloud;
    this.uniforms.uFlash.value = weather.lightningFlash;

    this.sun.color.copy(p.sun);
    this.sun.intensity = p.sunIntensity + weather.lightningFlash * 2.5;
    this.hemi.color.copy(p.ambient);
    this.hemi.groundColor.copy(p.ground);
    this.hemi.intensity = p.ambIntensity;
    this.fill.intensity = weather.isNight ? 0.06 : 0.16;

    this.scene.fog.color.copy(p.fogColor);
    this.scene.fog.density = p.fogDensity;

    // Environment lighting follows the sky, but only rebuilds when the sky
    // itself has meaningfully changed — and never more than once every couple
    // of seconds. Rebuilding is a full render plus a filter chain; doing it on
    // a lightning flash or every frame of a sunset is what used to leave the
    // sea flickering.
    if (this.pmrem) {
      this._envTimer = (this._envTimer || 0) + 1;
      if (this._envTimer > 140) {
        this._envTimer = 0;
        this.refreshEnvironment(false);
      }
    }
    if (this.envReady) this.hemi.intensity = p.ambIntensity * 0.62;
  }
}
