/**
 * Sky dome, sun, stars and scene lighting.
 *
 * The dome is a single inward-facing sphere with a custom shader: a physically
 * plausible-looking gradient, a sun disc with glow, a horizon haze band and a
 * procedural star field that fades in at night. Cheap (one draw call) and it
 * reacts instantly to weather changes.
 */

import * as THREE from '../vendor/three.module.js';
import { dim, CAPS } from '../render/flash-safety.js';

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
  // Light scattering toward a low sun (all tiers, see update()): the horizon
  // turns from the warm side to a cooler dusk on the far side, and a wide
  // forward-scatter lobe in the same colour the fog takes when you look
  // that way, so distant land and sky meet without a seam.
  uniform vec3 uHorizonAway;
  uniform vec3 uHaze;
  uniform float uHazeK;
  // The dome's own tight halo round the sun; turned down where bloom adds one.
  uniform float uGlow;
  // The moon: how visible (night, cloud), how full (0 new .. 1 full), and
  // which side is lit (+1 waxing, -1 waning).
  uniform float uMoon;
  uniform float uMoonPhase;
  uniform float uMoonWax;

  float hash(vec3 p) {
    p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }

  void main() {
    vec3 dir = normalize(vDir);
    float h = clamp(dir.y, -1.0, 1.0);

    // The horizon's colour by azimuth. uHorizonAway equals uHorizon unless
    // the sun is low, so at midday and at night this is the old gradient.
    vec3 sunH = normalize(vec3(uSunDir.x, 0.0, uSunDir.z) + vec3(1e-5, 0.0, 0.0));
    vec3 dirH = normalize(vec3(dir.x, 0.0, dir.z) + vec3(1e-5, 0.0, 0.0));
    float toward = pow(max(0.0, 0.5 + 0.5 * dot(dirH, sunH)), 1.5);
    vec3 horizon = mix(uHorizonAway, uHorizon, toward);

    // Base gradient: strong compression near the horizon like real haze.
    float t = pow(clamp(h, 0.0, 1.0), 0.42);
    vec3 col = mix(horizon, uTop, t);

    // Below the horizon fade to a slightly darker haze (seen over the ocean).
    if (h < 0.0) {
      col = mix(horizon, horizon * 0.72, clamp(-h * 2.2, 0.0, 1.0));
    }

    // Horizon haze: a bright band just above the skyline, like real aerial
    // perspective. This is most of what makes a sky read as "outdoors".
    float haze = exp(-abs(h) * 9.0);
    col = mix(col, horizon * 1.12, haze * 0.55);

    // Sun disc, bloom and a wide forward-scatter glow.
    float sd = max(dot(dir, normalize(uSunDir)), 0.0);
    float glow = pow(sd, 4.0) * 0.22 + (pow(sd, 32.0) * 0.5 + pow(sd, 400.0) * 1.6) * uGlow;
    float disc = smoothstep(0.9986, 0.9995, sd);
    col += uSunColor * glow * (1.0 - uOvercast * 0.8);
    col += uSunColor * disc * 6.0 * (1.0 - uOvercast);

    // Mie scattering toward a low sun: wide, hugging the horizon. Zero when
    // the sun is high or down (uHaze is black then).
    col += uHaze * pow(sd, uHazeK) * exp(-abs(h) * 3.0);

    /*
     * The moon, opposite the sun at night — so that when the sun is under the
     * horizon the moon is up above it.
     *
     * This direction used to be -uSunDir * vec3(1.0, -1.0, 1.0). Negating
     * the sun direction already mirrors its elevation, which is the whole
     * point of putting the moon opposite; flipping y a second time put the y
     * component straight back where it started, so the moon sat at exactly
     * the sun's own height. At night that is below the horizon, and the moon
     * was drawn down in the dark water where nobody ever saw it.
     */
    /*
     * And its phase. Today's real phase (Weather.moonPhase): the lit part is
     * bounded by the terminator, an ellipse across the disc, so a crescent
     * is a crescent; the dark part keeps a trace of earthshine; and the glow
     * round it grows with how full it is. A full moon also washes the
     * fainter stars out (uStars, update()).
     */
    if (uMoon > 0.001) {
      vec3 mDir = normalize(-uSunDir);
      float md = max(dot(dir, mDir), 0.0);
      if (md > 0.99) {
        vec3 mRight = normalize(cross(mDir, vec3(0.0, 1.0, 0.0)) + vec3(1e-5, 0.0, 0.0));
        vec3 mUp = cross(mRight, mDir);
        vec2 q = vec2(dot(dir, mRight), dot(dir, mUp)) / 0.036;
        float r = length(q);
        float discM = smoothstep(1.0, 0.8, r);
        float edge = (1.0 - 2.0 * uMoonPhase) * sqrt(max(0.0, 1.0 - q.y * q.y));
        float lit = smoothstep(edge - 0.1, edge + 0.1, q.x * uMoonWax);
        col = mix(col, col * 0.35, discM * uMoon);
        col += vec3(0.85, 0.88, 1.0) * discM * (lit * 2.2 + 0.05) * uMoon;
      }
      col += vec3(0.5, 0.55, 0.7) * pow(md, 300.0) * 0.5 * uMoon * (0.25 + 0.75 * uMoonPhase);
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

/*
 * Light scattering toward a low sun (update()): the colour the horizon goes
 * on the side away from the sun at dusk, and scratch vectors for the
 * camera's heading. Module-level so update() allocates nothing.
 */
const DUSK_AWAY = new THREE.Color(0x8f86ad);
const _fwd = new THREE.Vector3();
const _awayFog = new THREE.Color();
const _hazeFog = new THREE.Color();

function smooth(e0, e1, x) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

export class SkyDome {
  constructor(scene, { shadows = true, shadowMapSize = 2048, camera = null, glow = 1 } = {}) {
    this.scene = scene;
    // The view the fog colour follows (light scattering, update()). Without
    // one the fog is the preset's, as it always was.
    this.camera = camera;

    this.uniforms = {
      uTop: { value: new THREE.Color(0x2f6fd0) },
      uHorizon: { value: new THREE.Color(0xbcd7f2) },
      uSunColor: { value: new THREE.Color(0xfff4e0) },
      uSunDir: { value: new THREE.Vector3(0.4, 0.8, 0.3) },
      uStars: { value: 0 },
      uOvercast: { value: 0 },
      uFlash: { value: 0 },
      uHorizonAway: { value: new THREE.Color(0xbcd7f2) },
      uHaze: { value: new THREE.Color(0x000000) },
      uHazeK: { value: 5 },
      uGlow: { value: glow },
      uMoon: { value: 0 },
      uMoonPhase: { value: 1 },
      uMoonWax: { value: 1 },
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
    this.viewFog = { color: new THREE.Color(0xbcd7f2), density: 0.000018 };
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
      /*
       * Image-based lighting is live from here on.
       *
       * The note that used to sit here said this dialled the fill light back
       * down, which is not what happens: `fill` is the flat AmbientLight and
       * its intensity is decided by time of day alone, down at the bottom of
       * update(). What this flag actually does is tell update() to take the
       * HEMISPHERE light to 0.62 of its normal strength, because the sky is
       * now lighting the scene through the environment map as well and
       * without that everything washes out.
       */
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

  /**
   * How far round its centre the sun's shadow map reaches (metres, each way).
   *
   * 150 everywhere but the cockpit. From the seat, the shadows that matter
   * are the canopy bow across the panel, the window posts on the glareshield,
   * the glareshield's own edge over the screens — centimetres across, and at
   * 150 m a texel of the shadow map is 30 cm (medium) or 15 (high), so the
   * cockpit was either all in shadow or all in sun. Pulled in to 16 m round
   * the pilot's eye, a texel is 1.6 to 3 cm. The normal bias is in world
   * units, so it scales with it, or every thin part would cast nothing.
   */
  setShadowReach(d) {
    if (!this.sun.shadow || this._reach === d) return;
    this._reach = d;
    const cam = this.sun.shadow.camera;
    cam.left = -d;
    cam.right = d;
    cam.top = d;
    cam.bottom = -d;
    cam.updateProjectionMatrix();
    this.sun.shadow.normalBias = d >= 150 ? 0.6 : Math.max(0.025, 0.6 * (d / 150) * 0.6);
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
    // The moon is as visible as it always was; the stars now also answer to
    // its phase — a full moon leaves about a third of them, a new moon all.
    const moonUp = weather.isNight ? 1 - weather.cond.cloud * 0.95 : 0;
    const phase = typeof weather.moonPhase === 'number' ? weather.moonPhase : 1;
    this.uniforms.uMoon.value = moonUp;
    this.uniforms.uMoonPhase.value = phase;
    this.uniforms.uMoonWax.value = weather.moonWaxing === false ? -1 : 1;
    this.uniforms.uStars.value = moonUp * (0.35 + 0.65 * (1 - phase));
    this.uniforms.uOvercast.value = weather.cond.cloud;
    // Lightning washes the whole sky and the sunlight: the biggest flash in
    // the game, so with Reduce flashing on it is a fraction of the strength.
    const flash = dim(weather.lightningFlash, CAPS.lightning);
    this.uniforms.uFlash.value = flash;

    this.sun.color.copy(p.sun);
    this.sun.intensity = p.sunIntensity + flash * 2.5;
    this.hemi.color.copy(p.ambient);
    this.hemi.groundColor.copy(p.ground);
    this.hemi.intensity = p.ambIntensity;
    this.fill.intensity = weather.isNight ? 0.06 : 0.16;

    this.scene.fog.color.copy(p.fogColor);
    this.scene.fog.density = p.fogDensity;

    /*
     * Light scattering toward a low sun, at no shader cost.
     *
     * With the sun a few degrees up, the air toward it glows: the sun's
     * colour, scattered forward. Away from it the horizon goes a cooler dusk.
     * The dome draws both per pixel (uHorizonAway, uHaze); the fog can only
     * be one colour per frame, so it takes the dome's horizon colour at the
     * camera's own heading, and thickens a little toward the sun, so distant
     * hills and the sea go hazy-gold that way and stay clear the other.
     * Weighted down by cloud: an overcast sunset has no low sun to see.
     */
    const el = weather.timeInfo.sunElev;
    const low = smooth(-6, 0, el) * (1 - smooth(8, 25, el)) * (1 - weather.cond.cloud * 0.85);
    const u = this.uniforms;
    u.uHorizonAway.value.copy(p.horizon).lerp(DUSK_AWAY, 0.5 * low);
    u.uHaze.value.copy(p.sun).multiplyScalar(0.5 * low);
    u.uHazeK.value = 5;
    if (low > 0.001 && this.camera) {
      this.camera.getWorldDirection(_fwd);
      const fx = _fwd.x;
      const fz = _fwd.z;
      const fl = Math.hypot(fx, fz) || 1;
      const sx = this._sunDir.x;
      const sz = this._sunDir.z;
      const sl = Math.hypot(sx, sz) || 1;
      const toward = Math.pow(Math.max(0, 0.5 + 0.5 * ((fx * sx + fz * sz) / (fl * sl))), 1.5);
      // The lobe at the horizon straight ahead: dot(heading, sun direction).
      const sd = Math.max(0, (fx * sx + fz * sz) / fl);
      const lobe = Math.pow(sd, u.uHazeK.value);
      _awayFog.copy(p.fogColor).lerp(DUSK_AWAY, 0.5 * low);
      _hazeFog.copy(p.sun).multiplyScalar(0.5 * low * lobe);
      this.scene.fog.color.copy(_awayFog).lerp(p.fogColor, toward).add(_hazeFog);
      this.scene.fog.density = p.fogDensity * (1 + 2.4 * low * lobe);
    }
    // What the clouds fade into (clouds.js viewFog): this, before anything
    // later in the frame (the in-cloud whiteout) takes the fog over.
    this.viewFog.color.copy(this.scene.fog.color);
    this.viewFog.density = this.scene.fog.density;

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
