/**
 * Bloom and a colour grade — Graphics quality High and Ultra only.
 *
 * Hand-rolled, no examples/jsm: four full-screen-triangle passes.
 *
 *   1. The scene, into a half-float render target with 4× MSAA (the canvas's
 *      own antialias does not apply inside a render target).
 *   2. Bright-pass, straight down to quarter size (a quarter of the width and
 *      of the height): four bilinear taps cover each 4×4 block, each tap
 *      thresholded on its own so a small bright light is not averaged away
 *      by the dark pixels round it.
 *   3. A separable Gaussian blur, across then down, at quarter size.
 *   4. Composite onto the canvas: the scene, the grade, plus the glow.
 *
 * Why the scene target is flagged `isXRRenderTarget` with an sRGB texture.
 * In r169 a material drawn into an ordinary render target skips tone mapping
 * and writes linear light, and fog is then mixed in linear light too — but on
 * the canvas fog is mixed AFTER tone mapping and the sRGB transfer, and the
 * sky and cloud shaders were never tone mapped at all. Re-doing ACES in the
 * composite would therefore have changed the colour of the sky, the clouds
 * and every hazy hillside at High, compared with Medium. The XR flag is the
 * one switch r169 has for "draw into this target exactly as you would draw to
 * the screen" (WebGLRenderer.setProgram: toneMapping and the output colour
 * space), so the target holds the very pixels Medium would have shown, and
 * the composite only adds to them. Half float keeps what goes over 1.0 — the
 * sun's disc, overlapping light halos — and that headroom is what blooms.
 *
 * Low and Medium never construct any of this: main.js renderFrame() takes
 * the old single renderer.render() for them.
 */

import * as THREE from '../vendor/three.module.js';

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const BRIGHT = /* glsl */ `
  precision highp float;
  uniform sampler2D tSrc;
  uniform vec2 uTexel;     // one SOURCE pixel in uv
  uniform float uThreshold;
  uniform float uKnee;
  varying vec2 vUv;
  vec3 pick(vec2 o) {
    vec3 c = texture2D(tSrc, vUv + o * uTexel).rgb;
    float br = max(c.r, max(c.g, c.b));
    float soft = clamp(br - uThreshold + uKnee, 0.0, 2.0 * uKnee);
    soft = soft * soft / (4.0 * uKnee + 1e-4);
    float k = max(soft, br - uThreshold) / max(br, 1e-4);
    return c * k;
  }
  void main() {
    vec3 c = pick(vec2(-1.0, -1.0)) + pick(vec2(1.0, -1.0)) + pick(vec2(-1.0, 1.0)) + pick(vec2(1.0, 1.0));
    gl_FragColor = vec4(min(c * 0.25, vec3(16.0)), 1.0);
  }
`;

const BLUR = /* glsl */ `
  precision highp float;
  uniform sampler2D tSrc;
  uniform vec2 uStep;      // one pixel of this target, along the blur, times the spread
  varying vec2 vUv;
  void main() {
    // 9-tap Gaussian in 5 bilinear fetches.
    vec3 c = texture2D(tSrc, vUv).rgb * 0.2270270270;
    c += texture2D(tSrc, vUv + uStep * 1.3846153846).rgb * 0.3162162162;
    c += texture2D(tSrc, vUv - uStep * 1.3846153846).rgb * 0.3162162162;
    c += texture2D(tSrc, vUv + uStep * 3.2307692308).rgb * 0.0702702703;
    c += texture2D(tSrc, vUv - uStep * 3.2307692308).rgb * 0.0702702703;
    gl_FragColor = vec4(c, 1.0);
  }
`;

const COMPOSITE = /* glsl */ `
  precision highp float;
  uniform sampler2D tScene;
  uniform sampler2D tBloom;
  uniform float uBloom;
  uniform vec3 uGrade;     // warmth (-1..1), contrast, saturation
  varying vec2 vUv;
  void main() {
    // Display-referred already (see the note at the top of post.js).
    vec3 c = texture2D(tScene, vUv).rgb;
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c = mix(vec3(l), c, uGrade.z);
    c = (c - 0.5) * uGrade.y + 0.5;
    float w = uGrade.x;
    c *= vec3(1.0 + 0.07 * w, 1.0 + 0.012 * w, 1.0 - 0.08 * w);
    c = max(c, 0.0);
    c += texture2D(tBloom, vUv).rgb * uBloom;
    gl_FragColor = vec4(c, 1.0);
  }
`;

function target(w, h, opts = {}) {
  const rt = new THREE.WebGLRenderTarget(w, h, {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: false,
    stencilBuffer: false,
    generateMipmaps: false,
    ...opts,
  });
  rt.texture.name = 'post';
  return rt;
}

export class PostFX {
  constructor(renderer) {
    this.renderer = renderer;
    this.enabled = false;
    /*
     * A card that cannot draw into a half-float target (no
     * EXT_color_buffer_float / _half_float — some older tablets) would get an
     * incomplete framebuffer and a black screen. It simply keeps the plain
     * path, which is exactly Medium's frame.
     */
    let ext = null;
    try {
      ext = renderer.extensions;
    } catch (e) {
      ext = null;
    }
    this.supported = !!(ext && ext.has && (ext.has('EXT_color_buffer_float') || ext.has('EXT_color_buffer_half_float')));
    this.width = 0;
    this.height = 0;
    this._size = new THREE.Vector2();
    this.grade = new THREE.Vector3(0, 1, 1);
    this.bloom = 0.4;
    this.threshold = 1.0;
    this.knee = 0.25;
    this.spread = 1.25;

    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
    const mat = (fragmentShader, uniforms) =>
      new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader,
        uniforms,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      });
    this.brightMat = mat(BRIGHT, {
      tSrc: { value: null },
      uTexel: { value: new THREE.Vector2() },
      uThreshold: { value: 1 },
      uKnee: { value: 0.25 },
    });
    this.blurMat = mat(BLUR, { tSrc: { value: null }, uStep: { value: new THREE.Vector2() } });
    this.compositeMat = mat(COMPOSITE, {
      tScene: { value: null },
      tBloom: { value: null },
      uBloom: { value: 0.4 },
      uGrade: { value: this.grade },
    });
    this.quad = new THREE.Mesh(geo, this.brightMat);
    this.quad.frustumCulled = false;
  }

  /** On for High and Ultra (where the card can); off frees every target straight away. */
  setEnabled(on) {
    this.enabled = !!on && this.supported;
    if (!this.enabled) this.disposeTargets();
  }

  /** The look for this weather: Weather.grade() plus the glow settings. */
  setLook({ warmth = 0, contrast = 1, saturation = 1, bloom = 0.4, threshold = 1, knee = 0.25 } = {}) {
    this.grade.set(warmth, contrast, saturation);
    this.bloom = bloom;
    this.threshold = threshold;
    this.knee = knee;
  }

  /** Follow the drawing buffer. Reads the renderer's own numbers, no DOM. */
  _ensureTargets() {
    const s = this.renderer.getDrawingBufferSize(this._size);
    const w = Math.max(1, s.x);
    const h = Math.max(1, s.y);
    if (this.sceneRT && w === this.width && h === this.height) return;
    this.disposeTargets();
    this.width = w;
    this.height = h;
    // Four samples, two on a very large buffer: a 4× half-float target on a
    // 4K screen is a lot of memory for an edge nobody can see.
    const samples = w * h > 2.4e6 ? 2 : 4;
    this.sceneRT = target(w, h, { depthBuffer: true, samples });
    this.sceneRT.texture.colorSpace = THREE.SRGBColorSpace;
    this.sceneRT.isXRRenderTarget = true;
    const qw = Math.max(1, Math.round(w / 4));
    const qh = Math.max(1, Math.round(h / 4));
    this.rtA = target(qw, qh);
    this.rtB = target(qw, qh);
  }

  _pass(material, out) {
    this.quad.material = material;
    this.renderer.setRenderTarget(out);
    this.renderer.render(this.quad, this.camera);
  }

  /** One frame: scene → target, glow, composite to the canvas. */
  render(scene, camera) {
    const r = this.renderer;
    this._ensureTargets();
    const prevTarget = r.getRenderTarget();
    const prevAutoClear = r.autoClear;
    r.autoClear = true;
    try {
      r.setRenderTarget(this.sceneRT);
      r.render(scene, camera);

      const b = this.brightMat.uniforms;
      b.tSrc.value = this.sceneRT.texture;
      b.uTexel.value.set(1 / this.width, 1 / this.height);
      b.uThreshold.value = this.threshold;
      b.uKnee.value = Math.max(0.01, this.knee);
      this._pass(this.brightMat, this.rtA);

      const u = this.blurMat.uniforms;
      u.tSrc.value = this.rtA.texture;
      u.uStep.value.set(this.spread / this.rtA.width, 0);
      this._pass(this.blurMat, this.rtB);
      u.tSrc.value = this.rtB.texture;
      u.uStep.value.set(0, this.spread / this.rtA.height);
      this._pass(this.blurMat, this.rtA);

      const c = this.compositeMat.uniforms;
      c.tScene.value = this.sceneRT.texture;
      c.tBloom.value = this.rtA.texture;
      c.uBloom.value = this.bloom;
      this._pass(this.compositeMat, prevTarget);
    } finally {
      r.setRenderTarget(prevTarget);
      r.autoClear = prevAutoClear;
    }
  }

  disposeTargets() {
    for (const k of ['sceneRT', 'rtA', 'rtB']) {
      if (this[k]) {
        this[k].dispose();
        this[k] = null;
      }
    }
    this.width = 0;
    this.height = 0;
  }

  dispose() {
    this.disposeTargets();
    this.quad.geometry.dispose();
    this.brightMat.dispose();
    this.blurMat.dispose();
    this.compositeMat.dispose();
  }
}
