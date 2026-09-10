/**
 * Crashes.
 *
 * Until now a crash was a sound, a camera shake and a banner, while the
 * aeroplane sat on the ground in one immaculate piece. That undersells it —
 * and more practically, it left you unsure whether anything had happened.
 *
 * So: an impact flash, a fireball that rises and goes sooty, debris that
 * actually flies off and tumbles to a stop, a scorch mark, and a smoke column
 * that stands there for a good while afterwards. Hitting water gets a splash,
 * a spreading ring and no fire, because water does not burn.
 *
 * Everything is procedural, everything is pooled and reused, and it all cleans
 * itself up when the flight restarts.
 */

import * as THREE from '../vendor/three.module.js';
import { heightAt } from '../world/terrain.js';

const DEBRIS = 16;
const SPARKS = 90;
const SMOKE = 120;

function glowTexture(inner = 'rgba(255,255,255,1)', mid = 'rgba(255,190,90,0.8)', outer = 'rgba(255,90,20,0)') {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, inner);
  grd.addColorStop(0.4, mid);
  grd.addColorStop(1, outer);
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Points with per-particle size and opacity, which the stock material cannot do. */
function particleMaterial(map, additive) {
  return new THREE.ShaderMaterial({
    uniforms: { uMap: { value: map }, uTint: { value: new THREE.Color(0xffffff) } },
    vertexShader: `
      attribute float aSize;
      attribute float aAlpha;
      varying float vAlpha;
      void main() {
        vAlpha = aAlpha;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = clamp(aSize * (300.0 / max(1.0, -mv.z)), 1.0, 600.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform sampler2D uMap;
      uniform vec3 uTint;
      varying float vAlpha;
      void main() {
        vec4 t = texture2D(uMap, gl_PointCoord);
        float a = t.a * vAlpha;
        if (a < 0.01) discard;
        gl_FragColor = vec4(t.rgb * uTint, a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
}

export class Wreck {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'wreck';
    this.group.visible = false;
    this.active = false;
    this.t = 0;

    /* ---- Debris: small pieces of aeroplane ---- */
    const debrisMat = new THREE.MeshStandardMaterial({ color: 0x6a6f76, roughness: 0.8, metalness: 0.35 });
    this.debris = [];
    for (let i = 0; i < DEBRIS; i++) {
      const s = 0.3 + (i % 5) * 0.22;
      const m = new THREE.Mesh(new THREE.BoxGeometry(s, s * 0.22, s * 0.7), debrisMat);
      m.castShadow = true;
      m.visible = false;
      this.group.add(m);
      this.debris.push({ mesh: m, vel: new THREE.Vector3(), spin: new THREE.Vector3(), rest: false });
    }

    /* ---- Sparks and flame ---- */
    this.fireTex = glowTexture();
    this.fire = this.makePoints(SPARKS, this.fireTex, true);
    this.group.add(this.fire.points);

    /* ---- Smoke ---- */
    this.smokeTex = glowTexture('rgba(210,210,210,0.95)', 'rgba(140,140,140,0.5)', 'rgba(90,90,90,0)');
    this.smoke = this.makePoints(SMOKE, this.smokeTex, false);
    this.smoke.points.material.uniforms.uTint.value.setHex(0x4a4a4a);
    this.group.add(this.smoke.points);

    /* ---- Water: concentric ripple rings and a foam patch ---- */
    // A single spreading circle was a poor impression of hitting the sea. What
    // you actually see is a column of white going straight up, several rings
    // running outwards at different speeds, and a foam patch that sits there
    // long after the splash has gone.
    this.rings = [];
    for (let i = 0; i < 3; i++) {
      const g = new THREE.RingGeometry(0.86, 1, 48);
      g.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(
        g,
        new THREE.MeshBasicMaterial({
          color: 0xeaf6ff,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          side: THREE.DoubleSide,
        })
      );
      m.renderOrder = 5;
      this.group.add(m);
      this.rings.push({ mesh: m, speed: 26 + i * 15, delay: i * 0.55 });
    }
    const foamGeo = new THREE.CircleGeometry(1, 30);
    foamGeo.rotateX(-Math.PI / 2);
    this.foam = new THREE.Mesh(
      foamGeo,
      new THREE.MeshBasicMaterial({ color: 0xdfeff8, transparent: true, opacity: 0, depthWrite: false })
    );
    this.foam.renderOrder = 5;
    this.group.add(this.foam);

    /* ---- Scorch mark / splash ring ---- */
    const ringGeo = new THREE.CircleGeometry(1, 28);
    ringGeo.rotateX(-Math.PI / 2);
    this.mark = new THREE.Mesh(
      ringGeo,
      new THREE.MeshBasicMaterial({ color: 0x14100e, transparent: true, opacity: 0, depthWrite: false })
    );
    this.mark.renderOrder = 4;
    this.group.add(this.mark);

    /* ---- Firelight ---- */
    this.light = new THREE.PointLight(0xff6a20, 0, 220, 2);
    this.group.add(this.light);

    scene.add(this.group);
  }

  makePoints(count, map, additive) {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const size = new Float32Array(count);
    const alpha = new Float32Array(count);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1));
    const points = new THREE.Points(geo, particleMaterial(map, additive));
    points.frustumCulled = false;
    return { points, geo, state: new Array(count).fill(null).map(() => ({ age: 0, life: 1, vel: new THREE.Vector3() })) };
  }

  /**
   * @param {THREE.Vector3} pos where it hit
   * @param {THREE.Vector3} vel how fast it was going, which sets how far things fly
   * @param {boolean} inWater a splash instead of a fire
   */
  start(pos, vel, inWater) {
    this.active = true;
    this.inWater = inWater;
    this.t = 0;
    this.group.visible = true;
    this.origin = pos.clone();
    const speed = Math.min(90, vel.length());

    // Debris flies out along the direction of travel, mostly forwards and up.
    const dir = vel.clone().setY(0).normalize();
    for (let i = 0; i < this.debris.length; i++) {
      const d = this.debris[i];
      const a = (i / this.debris.length) * Math.PI * 2;
      d.mesh.visible = true;
      d.mesh.position.copy(pos);
      d.rest = false;
      d.vel
        .set(Math.cos(a) * 6, 4 + (i % 4) * 3.5, Math.sin(a) * 6)
        .addScaledVector(dir, speed * 0.32)
        .multiplyScalar(0.6 + (i % 3) * 0.25);
      d.spin.set(Math.sin(i) * 6, Math.cos(i * 1.7) * 6, Math.sin(i * 2.3) * 6);
    }

    // Fire (or spray) bursts outward; smoke rises from the same point.
    const fireCol = inWater ? 0xeaf7ff : 0xffffff;
    this.fire.points.material.uniforms.uTint.value.setHex(fireCol);
    for (let i = 0; i < SPARKS; i++) {
      const s = this.fire.state[i];
      s.age = 0;
      const a = Math.random() * Math.PI * 2;
      if (inWater) {
        // A splash is a narrow column that goes *up*, not a ball that goes
        // out: most of the water leaves near-vertically and falls straight
        // back, and the faster you hit, the higher it throws.
        const column = i < SPARKS * 0.55;
        const spread = column ? 1.5 + Math.random() * 4 : 8 + Math.random() * 20;
        const up = column ? 26 + Math.random() * 26 + speed * 0.22 : 9 + Math.random() * 12;
        s.life = column ? 2.6 + Math.random() * 1.6 : 1.5 + Math.random() * 0.9;
        s.vel.set(Math.cos(a) * spread, up, Math.sin(a) * spread);
      } else {
        s.life = 1.1 + (i % 7) * 0.34;
        const up = 6 + Math.random() * 14;
        s.vel.set(Math.cos(a) * (4 + Math.random() * 12), up, Math.sin(a) * (4 + Math.random() * 12));
      }
      this.fire.geo.attributes.position.setXYZ(i, pos.x, pos.y, pos.z);
    }
    for (let i = 0; i < SMOKE; i++) {
      const s = this.smoke.state[i];
      s.age = -i * 0.09; // staggered, so the column builds rather than appears
      s.life = 9 + (i % 6) * 2.4;
      s.vel.set((Math.random() - 0.5) * 2.4, 3 + Math.random() * 3.5, (Math.random() - 0.5) * 2.4);
      this.smoke.geo.attributes.position.setXYZ(i, pos.x, pos.y + 1, pos.z);
    }

    // Scorch on land, a spreading ring on water.
    const ground = inWater ? 0.25 : heightAt(pos.x, pos.z) + 0.25;
    this.mark.position.set(pos.x, ground, pos.z);
    this.mark.scale.setScalar(0.1);
    this.mark.material.color.setHex(inWater ? 0xdfefff : 0x14100e);
    this.mark.material.opacity = inWater ? 0.5 : 0.75;
    this.light.position.copy(pos).add(new THREE.Vector3(0, 4, 0));
    this.light.color.setHex(inWater ? 0x6fa8d0 : 0xff6a20);

    for (const r of this.rings) {
      r.mesh.position.set(pos.x, 0.3, pos.z);
      r.mesh.scale.setScalar(2);
      r.mesh.material.opacity = 0;
      r.mesh.visible = inWater;
    }
    this.foam.position.set(pos.x, 0.35, pos.z);
    this.foam.scale.setScalar(6);
    this.foam.material.opacity = inWater ? 0.62 : 0;
    this.foam.visible = inWater;

    /*
     * Ditching used to be the quiet way to go: a splash, a ring, and silence,
     * because "water does not burn". The water does not — the fuel floating on
     * it very much does, and a full tank going in at speed catches. So the
     * splash comes first, on its own, and about a second later, once the
     * column is at its peak and starting to fall back, it goes up.
     */
    this.blastAt = inWater ? 0.85 : -1;
    this.blown = !inWater;
    this.blastSpeed = speed;
  }

  /** The fuel catching, a beat after the splash. Water crashes only. */
  detonate() {
    this.blown = true;
    const pos = this.origin;
    const speed = this.blastSpeed || 40;

    // Re-seed most of the sparks as a fireball: fast, wide and short-lived,
    // which is what distinguishes an explosion from a fountain.
    for (let i = 0; i < SPARKS; i++) {
      if (i % 5 === 0) continue; // leave some spray still falling back
      const s = this.fire.state[i];
      s.age = 0;
      s.life = 0.7 + Math.random() * 1.1;
      const a = Math.random() * Math.PI * 2;
      const el = Math.random() * Math.PI * 0.5;
      const v = 14 + Math.random() * 26 + speed * 0.14;
      s.vel.set(Math.cos(a) * Math.cos(el) * v, Math.sin(el) * v * 1.15 + 4, Math.sin(a) * Math.cos(el) * v);
      this.fire.geo.attributes.position.setXYZ(i, pos.x, pos.y + 0.6, pos.z);
    }
    // Burning fuel makes black smoke, and plenty of it.
    for (let i = 0; i < SMOKE; i++) {
      const s = this.smoke.state[i];
      s.age = -i * 0.05;
      s.life = 11 + (i % 6) * 2.6;
      s.vel.set((Math.random() - 0.5) * 3.4, 4 + Math.random() * 4.5, (Math.random() - 0.5) * 3.4);
      this.smoke.geo.attributes.position.setXYZ(i, pos.x, pos.y + 1.4, pos.z);
    }
    // The flash. Bright, orange, and gone in a moment — the light decays in
    // update() like the land fire's does.
    this.light.color.setHex(0xff8a2a);
    this.light.intensity = 22 + speed * 0.25;
    this.flash = 1;
    // A burning slick spreading where the aeroplane went in.
    this.mark.material.color.setHex(0x1a1410);
    this.mark.material.opacity = 0.6;
  }

  clear() {
    this.active = false;
    this.group.visible = false;
    this.light.intensity = 0;
    for (const d of this.debris) d.mesh.visible = false;
  }

  update(dt) {
    if (!this.active) return;
    this.t += dt;

    // The fuel catches a beat after the splash.
    if (!this.blown && this.blastAt >= 0 && this.t >= this.blastAt) {
      this.detonate();
      // The spray tint warms to flame over a moment rather than snapping.
      this._tintTo = 0xff9a3c;
    }
    if (this._tintTo !== undefined) {
      const u = this.fire.points.material.uniforms.uTint.value;
      u.lerp(new THREE.Color(this._tintTo), Math.min(1, dt * 6));
    }

    /* ---- Debris ---- */
    for (const d of this.debris) {
      if (d.rest) continue;
      d.vel.y -= 9.81 * dt;
      d.mesh.position.addScaledVector(d.vel, dt);
      d.mesh.rotation.x += d.spin.x * dt;
      d.mesh.rotation.y += d.spin.y * dt;
      d.mesh.rotation.z += d.spin.z * dt;
      const ground = this.inWater ? 0 : heightAt(d.mesh.position.x, d.mesh.position.z);
      if (d.mesh.position.y <= ground + 0.15) {
        d.mesh.position.y = ground + 0.15;
        // Bounce once, then lie still. Pieces that skitter forever look wrong.
        if (d.vel.y < -6) {
          d.vel.y *= -0.28;
          d.vel.x *= 0.5;
          d.vel.z *= 0.5;
          d.spin.multiplyScalar(0.4);
        } else {
          d.rest = true;
          if (this.inWater) d.mesh.visible = false; // it sinks
        }
      }
    }

    /* ---- Fire and smoke ---- */
    const step = (set, isSmoke) => {
      const pos = set.geo.attributes.position.array;
      const size = set.geo.attributes.aSize.array;
      const alpha = set.geo.attributes.aAlpha.array;
      for (let i = 0; i < set.state.length; i++) {
        const s = set.state[i];
        s.age += dt;
        if (s.age < 0) {
          alpha[i] = 0;
          continue;
        }
        const f = s.age / s.life;
        if (f >= 1) {
          alpha[i] = 0;
          continue;
        }
        s.vel.y -= (isSmoke ? 0.4 : 5.5) * dt; // smoke keeps rising, sparks fall
        s.vel.multiplyScalar(1 - dt * (isSmoke ? 0.35 : 0.9));
        pos[i * 3] += s.vel.x * dt;
        pos[i * 3 + 1] += s.vel.y * dt;
        pos[i * 3 + 2] += s.vel.z * dt;
        if (isSmoke) {
          size[i] = 14 + f * 90;
          alpha[i] = Math.sin(Math.min(1, f * 1.2) * Math.PI) * 0.5;
        } else if (this.inWater) {
          // Spray falls back and vanishes the moment it reaches the surface,
          // rather than sinking through it.
          if (pos[i * 3 + 1] < 0.4) {
            alpha[i] = 0;
            s.age = s.life;
            continue;
          }
          size[i] = 22 + f * 26;
          alpha[i] = Math.pow(1 - f, 1.1) * 0.85;
        } else {
          size[i] = 34 * (1 - f * 0.55);
          alpha[i] = Math.pow(1 - f, 1.5);
        }
      }
      set.geo.attributes.position.needsUpdate = true;
      set.geo.attributes.aSize.needsUpdate = true;
      set.geo.attributes.aAlpha.needsUpdate = true;
    };
    step(this.fire, false);
    step(this.smoke, true);

    /* ---- Water: rings spreading, foam lingering ---- */
    if (this.inWater) {
      for (const r of this.rings) {
        const age = this.t - r.delay;
        if (age <= 0) continue;
        const radius = 3 + age * r.speed;
        r.mesh.scale.setScalar(radius);
        // Thin as they grow, and gone by the time they are a hundred metres out.
        r.mesh.material.opacity = Math.max(0, 0.55 * (1 - radius / 130));
      }
      // The foam patch spreads a little, then sits and slowly disperses.
      this.foam.scale.setScalar(6 + Math.min(this.t, 6) * 3.4);
      this.foam.material.opacity = Math.max(0, 0.62 - Math.max(0, this.t - 8) * 0.016);
    }

    /* ---- Mark and light ---- */
    const markGrow = this.inWater ? Math.min(26, 2 + this.t * 9) : Math.min(9, 1 + this.t * 12);
    this.mark.scale.setScalar(markGrow);
    this.mark.material.opacity = this.inWater
      ? Math.max(0, 0.5 - this.t * 0.12)
      : Math.min(0.75, 0.75 - Math.max(0, this.t - 25) * 0.05);
    /*
     * A hot flash, then a fire that flickers down.
     *
     * This runs every frame, so setting `light.intensity` in detonate() would
     * be overwritten before it was ever drawn — the blast has to be part of
     * this formula, not a poke from outside it. On water the flash is timed
     * from the moment the fuel catches rather than from impact, and what burns
     * afterwards is a slick, which goes out far sooner than a wreck on land.
     */
    const flash = this.inWater
      ? this.blown
        ? Math.max(0, 1 - (this.t - this.blastAt) * 2.0)
        : 0
      : Math.max(0, 1 - this.t * 2.2);
    const burn = this.inWater
      ? this.blown
        ? Math.max(0, 1 - (this.t - this.blastAt) / 14)
        : 0
      : Math.max(0, 1 - this.t / 30);
    this.light.intensity =
      3200 * flash + 900 * burn * (0.7 + Math.sin(this.t * 11) * 0.15 + Math.sin(this.t * 3.7) * 0.15);
  }
}
