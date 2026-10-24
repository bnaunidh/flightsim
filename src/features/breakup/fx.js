/**
 * The break-up's own effects: sparks off concrete, dust off grass, spray off
 * the sea, fire and smoke where the fuel and the engines are, and the odd
 * secondary pop as something else catches.
 *
 * Two pools of points — glowing (sparks, flame, pops) and soft (dust, smoke,
 * spray) — sized by the quality setting, and emitters that follow a moving
 * thing (a burning wing tumbling away, an engine lying in the grass). All of
 * it pooled: nothing is allocated per frame, and with nothing burning and no
 * particle alive, update() returns at the first line and both pools are
 * hidden — no draw call, no cost.
 *
 * The existing fireball and smoke column (src/game/wreck.js) are left exactly
 * as they are; this is additive, at the pieces.
 *
 * School-safe: it is an aeroplane on fire, never a person.
 *
 * Seizure-safe: a secondary pop is a flash, so it goes through Reduce
 * flashing (../../render/flash-safety.js, on by default) like every other
 * bang in the game: with it on, at most one pop in MIN_FLASH_GAP flares, and
 * then at CAPS.blastSprite of its brightness; any other pop in that gap is a
 * dull glow (a quarter of that again) and its smoke. Fire, sparks and smoke
 * are steady sources, not flashes, and are left as they are.
 */

import * as THREE from '../../vendor/three.module.js';
import { FLASH, CAPS, FlashGate } from '../../render/flash-safety.js';

function glowTexture() {
  if (typeof document === 'undefined' || !document.createElement) return null;
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    if (!g || !g.createRadialGradient) return null;
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.35, 'rgba(255,255,255,0.75)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  } catch (e) {
    return null;
  }
}

function material(map, additive) {
  return new THREE.ShaderMaterial({
    uniforms: { uMap: { value: map }, uHasMap: { value: map ? 1 : 0 }, uScale: { value: 300 } },
    vertexShader: `
      attribute float aSize;
      attribute float aAlpha;
      attribute vec3 aColor;
      varying float vAlpha;
      varying vec3 vColor;
      uniform float uScale;
      void main() {
        vAlpha = aAlpha;
        vColor = aColor;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = clamp(aSize * (uScale / max(1.0, -mv.z)), 1.0, 380.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform sampler2D uMap;
      uniform float uHasMap;
      varying float vAlpha;
      varying vec3 vColor;
      void main() {
        float a;
        if (uHasMap > 0.5) a = texture2D(uMap, gl_PointCoord).a;
        else { float r = length(gl_PointCoord - 0.5) * 2.0; a = 1.0 - smoothstep(0.2, 1.0, r); }
        a *= vAlpha;
        if (a < 0.01) discard;
        gl_FragColor = vec4(vColor, a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
}

/** Per-kind behaviour: gravity, drag, how it grows and fades, its colour. */
const KIND = {
  spark: { pool: 0, g: -9.81, drag: 0.9, grow: 0, size: 0.14, alpha: 1 },
  fire: { pool: 0, g: 3.2, drag: 1.6, grow: 1.6, size: 1.5, alpha: 0.85 },
  pop: { pool: 0, g: 1.5, drag: 2.4, grow: 2.2, size: 2.2, alpha: 0.95 },
  dust: { pool: 1, g: 0.5, drag: 1.4, grow: 2.2, size: 1.6, alpha: 0.42 },
  smoke: { pool: 1, g: 2.2, drag: 0.55, grow: 3.4, size: 2.4, alpha: 0.5 },
  spray: { pool: 1, g: -9.81, drag: 0.7, grow: 1.2, size: 1.1, alpha: 0.75 },
  bubble: { pool: 1, g: 1.5, drag: 1.2, grow: 0.5, size: 0.3, alpha: 0.85 },
  foam: { pool: 1, g: 0, drag: 0.9, grow: 1.6, size: 2, alpha: 0.4 },
};

export class BreakupFx {
  /**
   * @param parent   the group the points live in (the world's, so they go with it)
   * @param quality  'low' | 'medium' | 'high' | 'ultra'
   */
  constructor(parent, quality = 'high') {
    const cap = quality === 'low' ? 160 : quality === 'medium' ? 300 : quality === 'ultra' ? 640 : 460;
    this.cap = cap;
    const tex = glowTexture();
    this.pools = [true, false].map((additive) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(cap * 3), 3));
      geo.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(cap), 1));
      geo.setAttribute('aAlpha', new THREE.BufferAttribute(new Float32Array(cap), 1));
      geo.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array(cap * 3), 3));
      const pts = new THREE.Points(geo, material(tex, additive));
      pts.frustumCulled = false;
      pts.visible = false;
      pts.renderOrder = additive ? 6 : 5;
      pts.name = additive ? 'breakup:glow' : 'breakup:soft';
      parent.add(pts);
      const p = [];
      for (let i = 0; i < cap; i++) p.push({ alive: false, kind: null, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, age: 0, life: 1, size: 1, r: 1, g: 1, b: 1, floor: -1e9 });
      return { pts, geo, p, cursor: 0, alive: 0 };
    });
    this.emitters = [];
    this.pops = [];
    this.quality = quality;
    this.camera = null;
    // Its own clock (seconds of effect time) and the gate the pops flare through.
    this.clock = 0;
    this.popGate = new FlashGate();
    this.stats = { emitted: 0, spark: 0, dust: 0, spray: 0, fire: 0, smoke: 0, bubble: 0, foam: 0, pops: 0, popFlares: 0, popBright: 0, peakAlive: 0 };
  }

  /**
   * Compile the two particle shaders now, with the scene's own lights and
   * fog, so the first crash does not do it (a hidden object is not compiled,
   * hence the moment of visibility). Idempotent and cheap once compiled.
   */
  warm(renderer, camera, scene) {
    if (!renderer || typeof renderer.compile !== 'function' || !camera) return false;
    const was = this.pools.map((pool) => pool.pts.visible);
    try {
      for (const pool of this.pools) pool.pts.visible = true;
      for (const pool of this.pools) renderer.compile(pool.pts, camera, scene || undefined);
      return true;
    } finally {
      this.pools.forEach((pool, i) => (pool.pts.visible = was[i]));
    }
  }

  /** Is anything going on at all? */
  get busy() {
    return this.pools[0].alive + this.pools[1].alive > 0 || this.emitters.length > 0 || this.pops.length > 0;
  }

  emit(kind, x, y, z, vx, vy, vz, life, size, r, g, b, floor = -1e9) {
    const K = KIND[kind];
    const pool = this.pools[K.pool];
    const p = pool.p[pool.cursor];
    pool.cursor = (pool.cursor + 1) % this.cap;
    if (!p.alive) pool.alive++;
    p.alive = true;
    p.kind = kind;
    p.x = x;
    p.y = y;
    p.z = z;
    p.vx = vx;
    p.vy = vy;
    p.vz = vz;
    p.age = 0;
    p.life = life;
    p.size = size;
    p.r = r;
    p.g = g;
    p.b = b;
    p.floor = floor;
    this.stats.emitted++;
    this.stats[kind] = (this.stats[kind] || 0) + 1;
    pool.pts.visible = true;
  }

  /** Sparks: a fan off a sliding corner on a hard surface. */
  sparks(x, y, z, speed, n = 6, dir = null) {
    const k = Math.min(1, speed / 30);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 3 + Math.random() * 7 * k + speed * 0.12;
      const dx = dir ? dir.x * speed * 0.35 : 0;
      const dz = dir ? dir.z * speed * 0.35 : 0;
      this.emit('spark', x, y + 0.08, z, Math.cos(a) * s + dx, 1.5 + Math.random() * 4.5, Math.sin(a) * s + dz, 0.25 + Math.random() * 0.45, 0.1 + Math.random() * 0.12, 1, 0.78 + Math.random() * 0.15, 0.4, y);
    }
  }

  /** Dust: grey-brown puffs kicked up off the ground. */
  dust(x, y, z, size = 1, n = 5, tint = null) {
    const c = tint || [0.52, 0.47, 0.38];
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 1 + Math.random() * 3 * size;
      this.emit('dust', x + Math.cos(a) * size * 0.4, y + 0.2, z + Math.sin(a) * size * 0.4, Math.cos(a) * s, 0.8 + Math.random() * 1.8, Math.sin(a) * s, 1.4 + Math.random() * 1.6, (1.2 + Math.random()) * size, c[0], c[1], c[2]);
    }
  }

  /** Spray: a ring of water thrown up where a piece goes in. */
  splash(x, z, speed, size = 1) {
    const n = Math.min(40, 10 + Math.round(speed * 1.2));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.4;
      const out = 1.5 + Math.random() * 4 * size;
      const up = 3 + Math.random() * (5 + speed * 0.35);
      this.emit('spray', x + Math.cos(a) * size * 0.5, 0.3, z + Math.sin(a) * size * 0.5, Math.cos(a) * out, up, Math.sin(a) * out, 1 + Math.random() * 0.8, (0.7 + Math.random() * 0.6) * size, 0.92, 0.96, 1, 0.2);
    }
  }

  /** Bubbles breaking the surface over something slipping under. */
  bubbles(x, z, n = 3, spread = 1) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * spread;
      this.emit('bubble', x + Math.cos(a) * r, -0.35 - Math.random() * 0.4, z + Math.sin(a) * r, 0, 0.5 + Math.random() * 0.6, 0, 0.7 + Math.random() * 0.6, 0.18 + Math.random() * 0.25, 0.9, 0.96, 1);
    }
  }

  /** A patch of foam lying on the water, spreading and thinning out. */
  foam(x, z, size = 1) {
    for (let i = 0; i < 3; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * size * 0.8;
      this.emit('foam', x + Math.cos(a) * r, 0.12, z + Math.sin(a) * r, Math.cos(a) * 0.3, 0, Math.sin(a) * 0.3, 4 + Math.random() * 2.5, (1.2 + Math.random()) * size, 0.94, 0.97, 1);
    }
  }

  /**
   * A ball of flame and a puff of smoke: something else catching. Returns how
   * bright its flame was let be (1 with Reduce flashing off).
   */
  pop(x, y, z, size = 1) {
    this.stats.pops++;
    // Reduce flashing: one flare per gap, dimmed; the rest glow dully.
    // `noFlare`: the instant replay is re-emitting this pop for a scrub that
    // came back to it too soon after the last flash (see breakup.js seekReplay).
    const flare = !this.noFlare && this.popGate.allow(this.clock);
    const bright = FLASH.reduce ? CAPS.blastSprite * (flare ? 1 : 0.25) : 1;
    if (flare) this.stats.popFlares++;
    if (bright > this.stats.popBright) this.stats.popBright = bright;
    const n = Math.min(26, 10 + Math.round(size * 8));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const el = Math.random() * Math.PI * 0.5;
      const s = (3 + Math.random() * 5) * Math.sqrt(size);
      // Additive: the colour is the light it adds, so dimming it dims the flash.
      this.emit('pop', x, y + 0.3, z, Math.cos(a) * Math.cos(el) * s, Math.sin(el) * s + 1.5, Math.sin(a) * Math.cos(el) * s, 0.5 + Math.random() * 0.5, (1.4 + Math.random()) * size, bright, (0.55 + Math.random() * 0.25) * bright, 0.15 * bright);
    }
    for (let i = 0; i < 6; i++) {
      this.emit('smoke', x + (Math.random() - 0.5) * size, y + 0.8, z + (Math.random() - 0.5) * size, (Math.random() - 0.5) * 1.5, 2 + Math.random() * 2, (Math.random() - 0.5) * 1.5, 5 + Math.random() * 3, 1.6 * size, 0.16, 0.15, 0.14);
    }
    return bright;
  }

  /**
   * Fire that follows something: `at(out)` fills out with where it is now and
   * returns false once that thing has gone. Burns for `life` seconds.
   */
  fire(at, life = 14, size = 1, smoky = true) {
    if (this.emitters.length > 24) this.emitters.shift();
    this.emitters.push({ at, life, t: 0, size, smoky, acc: 0, sacc: 0, p: new THREE.Vector3() });
  }

  /** A pop at `delay` seconds, where `at` says, if it still exists then. */
  later(delay, at, size = 1, onPop = null) {
    this.pops.push({ t: delay, at, size, onPop, p: new THREE.Vector3() });
  }

  clear() {
    for (const pool of this.pools) {
      for (const p of pool.p) p.alive = false;
      pool.alive = 0;
      pool.pts.visible = false;
    }
    this.emitters.length = 0;
    this.pops.length = 0;
  }

  /**
   * Everything alive right now, as plain data — so the instant replay can
   * clear the pools, play the recorded effects again on its own clock, and
   * then put the live fire and smoke back exactly as they were (../breakup.js
   * startReplay / endReplay). The emitters' `at` closures are shared, which
   * is right: they read where a piece IS.
   */
  snapshot() {
    return {
      clock: this.clock,
      pools: this.pools.map((pool) => ({
        alive: pool.alive,
        cursor: pool.cursor,
        visible: pool.pts.visible,
        p: pool.p.map((q) => ({ ...q })),
      })),
      emitters: this.emitters.map((e) => ({ ...e, p: e.p.clone() })),
      pops: this.pops.map((q) => ({ ...q, p: q.p.clone() })),
    };
  }

  /** Put a snapshot() back. The next update() redraws the attributes from it. */
  restore(snap) {
    if (!snap) return false;
    this.clock = snap.clock;
    this.pools.forEach((pool, i) => {
      const k = snap.pools[i];
      if (!k) return;
      pool.alive = k.alive;
      pool.cursor = k.cursor;
      pool.pts.visible = k.visible;
      for (let j = 0; j < pool.p.length && j < k.p.length; j++) Object.assign(pool.p[j], k.p[j]);
      // A particle put back dead must not keep drawing at its old alpha.
      const A = pool.geo.attributes.aAlpha.array;
      for (let j = 0; j < pool.p.length; j++) if (!pool.p[j].alive) A[j] = 0;
      pool.geo.attributes.aAlpha.needsUpdate = true;
    });
    this.emitters = snap.emitters.map((e) => ({ ...e, p: e.p.clone() }));
    this.pops = snap.pops.map((q) => ({ ...q, p: q.p.clone() }));
    return true;
  }

  update(dt, camera) {
    if (!this.busy) return;
    if (!(dt > 0)) return;
    const step = Math.min(dt, 0.1);
    this.clock += step;
    // Emitters: fire, with smoke over it.
    for (let i = this.emitters.length - 1; i >= 0; i--) {
      const e = this.emitters[i];
      e.t += step;
      const alive = e.t < e.life && e.at(e.p) !== false;
      if (!alive) {
        this.emitters.splice(i, 1);
        continue;
      }
      // Dies down towards the end.
      const k = Math.min(1, (e.life - e.t) / 4) * e.size;
      e.acc += step * 26 * k;
      while (e.acc >= 1) {
        e.acc -= 1;
        const j = 0.5 * e.size;
        this.emit('fire', e.p.x + (Math.random() - 0.5) * j, e.p.y + Math.random() * 0.2, e.p.z + (Math.random() - 0.5) * j,
          (Math.random() - 0.5) * 1.2, 1.5 + Math.random() * 2, (Math.random() - 0.5) * 1.2, 0.45 + Math.random() * 0.45, (0.9 + Math.random() * 0.9) * e.size, 1, 0.42 + Math.random() * 0.3, 0.08);
      }
      if (e.smoky) {
        e.sacc += step * 7 * k;
        while (e.sacc >= 1) {
          e.sacc -= 1;
          this.emit('smoke', e.p.x + (Math.random() - 0.5) * e.size, e.p.y + 0.8 * e.size, e.p.z + (Math.random() - 0.5) * e.size,
            (Math.random() - 0.5) * 1.2, 2 + Math.random() * 2, (Math.random() - 0.5) * 1.2, 6 + Math.random() * 4, (1.5 + Math.random()) * e.size, 0.13, 0.12, 0.12);
        }
      }
    }
    for (let i = this.pops.length - 1; i >= 0; i--) {
      const q = this.pops[i];
      q.t -= step;
      if (q.t > 0) continue;
      this.pops.splice(i, 1);
      if (q.at(q.p) === false) continue;
      this.pop(q.p.x, q.p.y, q.p.z, q.size);
      if (q.onPop) q.onPop(q.p, q.size);
    }
    // Particles.
    let total = 0;
    for (const pool of this.pools) {
      if (!pool.alive) {
        pool.pts.visible = false;
        continue;
      }
      const P = pool.geo.attributes.position.array;
      const S = pool.geo.attributes.aSize.array;
      const A = pool.geo.attributes.aAlpha.array;
      const C = pool.geo.attributes.aColor.array;
      let alive = 0;
      for (let i = 0; i < this.cap; i++) {
        const p = pool.p[i];
        if (!p.alive) {
          A[i] = 0;
          continue;
        }
        p.age += step;
        if (p.age >= p.life) {
          p.alive = false;
          A[i] = 0;
          continue;
        }
        const K = KIND[p.kind];
        p.vy += K.g * step;
        const damp = Math.exp(-K.drag * step);
        p.vx *= damp;
        p.vy *= damp;
        p.vz *= damp;
        p.x += p.vx * step;
        p.y += p.vy * step;
        p.z += p.vz * step;
        if (p.y < p.floor) {
          if (p.kind === 'spark') {
            p.y = p.floor;
            p.vy *= -0.3;
            p.vx *= 0.6;
            p.vz *= 0.6;
          } else if (p.kind === 'spray') {
            p.alive = false;
            A[i] = 0;
            continue;
          }
        }
        const f = p.age / p.life;
        P[i * 3] = p.x;
        P[i * 3 + 1] = p.y;
        P[i * 3 + 2] = p.z;
        S[i] = p.size * (1 + K.grow * f);
        // A bubble pops at the surface; foam lies flat on it.
        if (p.kind === 'bubble' && p.y > 0.1) {
          p.alive = false;
          A[i] = 0;
          continue;
        }
        if (p.kind === 'foam') p.y = 0.12;
        A[i] = K.alpha * (p.kind === 'smoke' || p.kind === 'dust' || p.kind === 'foam' ? Math.sin(Math.min(1, f * 1.4) * Math.PI) : Math.pow(1 - f, 1.3));
        // Flame cools from yellow to red as it rises.
        const cool = p.kind === 'fire' || p.kind === 'pop' ? f : 0;
        C[i * 3] = p.r;
        C[i * 3 + 1] = p.g * (1 - cool * 0.6);
        C[i * 3 + 2] = p.b * (1 - cool);
        alive++;
      }
      pool.alive = alive;
      total += alive;
      pool.pts.visible = alive > 0;
      for (const k of ['position', 'aSize', 'aAlpha', 'aColor']) pool.geo.attributes[k].needsUpdate = true;
    }
    if (total > this.stats.peakAlive) this.stats.peakAlive = total;
    void camera;
  }

  dispose() {
    this.clear();
    for (const pool of this.pools) {
      pool.pts.removeFromParent();
      pool.geo.dispose();
      pool.pts.material.dispose();
    }
  }
}
