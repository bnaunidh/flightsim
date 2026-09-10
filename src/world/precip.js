/**
 * Rain.
 *
 * A block of streaks that follows the camera. The streaks fall with gravity,
 * lean with the wind and are stretched along their velocity, which makes them
 * read correctly whether you are parked on the apron or cruising at 100 knots.
 */

import * as THREE from '../vendor/three.module.js';
import { rainStreakTexture } from '../render/textures.js';
import { makeRandom } from '../core/noise.js';

const vert = /* glsl */ `
  attribute vec3 iPos;
  attribute float iLen;
  varying vec2 vUv;
  uniform vec3 uVel;      // world-space streak direction * speed
  uniform float uWidth;
  void main() {
    vUv = uv;
    vec4 mv = viewMatrix * vec4(iPos, 1.0);
    // Direction of travel in view space defines the streak's long axis.
    vec3 dirView = normalize((viewMatrix * vec4(uVel, 0.0)).xyz);
    vec2 along = normalize(dirView.xy + vec2(0.0001, 0.0001));
    vec2 side = vec2(-along.y, along.x);
    mv.xy += along * position.y * iLen + side * position.x * uWidth;
    gl_Position = projectionMatrix * mv;
  }
`;

const frag = /* glsl */ `
  precision mediump float;
  varying vec2 vUv;
  uniform sampler2D uMap;
  uniform float uOpacity;
  void main() {
    vec4 t = texture2D(uMap, vUv);
    gl_FragColor = vec4(t.rgb, t.a * uOpacity);
    if (gl_FragColor.a < 0.01) discard;
  }
`;

const BOX = 90;

export class Rain {
  constructor(scene, quality = 'high') {
    this.count = quality === 'low' ? 900 : quality === 'medium' ? 1800 : 3200;
    const base = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.attributes.position = base.attributes.position;
    geo.attributes.uv = base.attributes.uv;
    geo.instanceCount = this.count;

    this.positions = new Float32Array(this.count * 3);
    this.lengths = new Float32Array(this.count);
    const rnd = makeRandom(909);
    for (let i = 0; i < this.count; i++) {
      this.positions[i * 3] = (rnd() - 0.5) * BOX * 2;
      this.positions[i * 3 + 1] = rnd() * BOX;
      this.positions[i * 3 + 2] = (rnd() - 0.5) * BOX * 2;
      this.lengths[i] = 0.9 + rnd() * 1.6;
    }
    geo.setAttribute('iPos', new THREE.InstancedBufferAttribute(this.positions, 3));
    geo.setAttribute('iLen', new THREE.InstancedBufferAttribute(this.lengths, 1));

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: rainStreakTexture() },
        uVel: { value: new THREE.Vector3(0, -18, 0) },
        uOpacity: { value: 0 },
        uWidth: { value: 0.055 },
      },
      vertexShader: vert,
      fragmentShader: frag,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 8;
    this.mesh.visible = false;
    scene.add(this.mesh);

    this.geo = geo;
    this._vel = new THREE.Vector3();
  }

  update(dt, weather, camPos, aircraftVel) {
    const intensity = weather.cond.rain;
    this.mesh.visible = intensity > 0.02;
    if (!this.mesh.visible) return;

    // Rain velocity relative to the viewer: gravity + wind - own motion.
    const wind = weather.windVector();
    this._vel.set(wind.x, -16 - intensity * 9, wind.z);
    if (aircraftVel) this._vel.sub(aircraftVel);
    const speed = Math.max(4, this._vel.length());

    this.material.uniforms.uVel.value.copy(this._vel).normalize();
    this.material.uniforms.uOpacity.value = 0.25 + intensity * 0.55;
    // Faster relative motion → longer streaks.
    this.material.uniforms.uWidth.value = 0.05;

    const stretch = Math.min(9, 0.7 + speed * 0.055);
    for (let i = 0; i < this.count; i++) {
      const o = i * 3;
      this.positions[o] += this._vel.x * dt;
      this.positions[o + 1] += this._vel.y * dt;
      this.positions[o + 2] += this._vel.z * dt;
      // Wrap inside a box centred on the camera.
      let dx = this.positions[o] - camPos.x;
      let dy = this.positions[o + 1] - camPos.y;
      let dz = this.positions[o + 2] - camPos.z;
      if (dx > BOX) this.positions[o] -= BOX * 2;
      else if (dx < -BOX) this.positions[o] += BOX * 2;
      if (dy > BOX * 0.6) this.positions[o + 1] -= BOX * 1.2;
      else if (dy < -BOX * 0.6) this.positions[o + 1] += BOX * 1.2;
      if (dz > BOX) this.positions[o + 2] -= BOX * 2;
      else if (dz < -BOX) this.positions[o + 2] += BOX * 2;
      this.lengths[i] = (0.9 + (i % 7) * 0.12) * stretch;
    }
    this.geo.attributes.iPos.needsUpdate = true;
    this.geo.attributes.iLen.needsUpdate = true;
  }
}
