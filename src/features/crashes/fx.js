/**
 * The cartoon bits of a custom crash: puffs of dust and spray, clods of dirt,
 * sparks, the comic word that pops up over the wreck ("KA-TUMBLE!"), the
 * dizzy stars that circle it afterwards, the skid mark it leaves, a dent
 * where a nose went in and a ring where it hit the sea.
 *
 * Kid-safe on purpose: nothing here is fire or smoke (wreck.js already does
 * its fireball, and that stays as it was), nothing is a person, and every
 * colour is a cartoon one.
 *
 * Built for the class's Chromebooks the same way explosions.js is: made once
 * at world build, pooled, nothing allocated per crash on the GPU. All the
 * particles are ONE draw call (live ones packed at the front, draw range set
 * to the count); the word is one sprite, the stars one sprite each (five),
 * the skid, the dent and the ring one mesh each. When the pool is full a new
 * puff is simply not made.
 */

import * as THREE from '../../vendor/three.module.js';

const CAP = 260;
const RIBBON_N = 72;
const STAR_N = 5;

const TYPES = {
  // colour, start size, end size, life, gravity (+ is down), drag
  dust: { c: 0xd8c39a, s0: 1.4, s1: 5.2, life: 1.5, g: -0.4, drag: 1.9, a: 0.75 },
  dirt: { c: 0x6f4a2a, s0: 0.7, s1: 0.9, life: 1.3, g: 9.8, drag: 0.25, a: 1 },
  spray: { c: 0xeaf7ff, s0: 1.0, s1: 2.8, life: 1.2, g: 9.8, drag: 0.35, a: 0.95 },
  spark: { c: 0xffe27a, s0: 0.45, s1: 0.2, life: 0.55, g: 6, drag: 0.9, a: 1 },
  // The cartoon cloud a crash goes "poof" in, instead of a fireball.
  poof: { c: 0xf4f1ea, s0: 3.2, s1: 8.5, life: 1.9, g: -1.4, drag: 2.2, a: 0.95 },
  // And the little wisp that keeps curling up off the wreck afterwards, so you can find it.
  wisp: { c: 0x9a978f, s0: 1.4, s1: 6, life: 3.6, g: -0.9, drag: 0.6, a: 0.55 },
};

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function puffTexture() {
  const c = canvas(64, 64);
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.55, 'rgba(255,255,255,0.85)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function starPath(g, cx, cy, spikes, outer, inner, rot = -Math.PI / 2) {
  g.beginPath();
  for (let i = 0; i < spikes * 2; i++) {
    const r = i % 2 ? inner : outer;
    const a = rot + (i * Math.PI) / spikes;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i) g.lineTo(x, y);
    else g.moveTo(x, y);
  }
  g.closePath();
}

function starTexture() {
  const c = canvas(64, 64);
  const g = c.getContext('2d');
  starPath(g, 32, 33, 5, 27, 12);
  g.fillStyle = '#ffd84a';
  g.fill();
  g.lineWidth = 4;
  g.strokeStyle = '#3a2a10';
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A comic-book burst with a word in it. Drawn once per crash (512×256, a millisecond). */
export function drawWord(ctx, word, fill = '#ffd23f') {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.scale(1, 0.52);
  starPath(ctx, 0, 0, 14, W * 0.47, W * 0.36, -Math.PI / 2 + 0.1);
  ctx.restore();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = 9;
  ctx.strokeStyle = '#1b1b2f';
  ctx.stroke();
  ctx.save();
  ctx.translate(W / 2, H / 2 + 4);
  ctx.rotate(-0.06);
  let size = 92;
  ctx.font = `900 ${size}px "Arial Black", "Helvetica Neue", Arial, sans-serif`;
  while (ctx.measureText && ctx.measureText(word).width > W * 0.72 && size > 40) {
    size -= 6;
    ctx.font = `900 ${size}px "Arial Black", "Helvetica Neue", Arial, sans-serif`;
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 14;
  ctx.strokeStyle = '#1b1b2f';
  ctx.strokeText(word, 0, 0);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(word, 0, 0);
  ctx.restore();
}

function particleMaterial(map) {
  return new THREE.ShaderMaterial({
    uniforms: { uMap: { value: map } },
    vertexShader: `
      attribute float aSize;
      attribute float aAlpha;
      attribute vec3 aColor;
      varying float vAlpha;
      varying vec3 vColor;
      void main() {
        vAlpha = aAlpha;
        vColor = aColor;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = clamp(aSize * (300.0 / max(1.0, -mv.z)), 1.0, 400.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform sampler2D uMap;
      varying float vAlpha;
      varying vec3 vColor;
      void main() {
        vec4 t = texture2D(uMap, gl_PointCoord);
        float a = t.a * vAlpha;
        if (a < 0.02) discard;
        gl_FragColor = vec4(vColor, a);
      }`,
    transparent: true,
    depthWrite: false,
  });
}

export class CrashFx {
  constructor(group, heightAt) {
    this.group = group;
    this.heightAt = heightAt;
    this.scale = 1;

    /* ---- particles ---- */
    this.n = 0;
    this.px = new Float32Array(CAP * 3);
    this.pv = new Float32Array(CAP * 3);
    this.life = new Float32Array(CAP);
    this.max = new Float32Array(CAP);
    this.type = new Array(CAP).fill(null);
    this.sz = new Float32Array(CAP);
    const geo = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(new Float32Array(CAP * 3), 3);
    this.aCol = new THREE.BufferAttribute(new Float32Array(CAP * 3), 3);
    this.aSize = new THREE.BufferAttribute(new Float32Array(CAP), 1);
    this.aAlpha = new THREE.BufferAttribute(new Float32Array(CAP), 1);
    for (const a of [this.aPos, this.aCol, this.aSize, this.aAlpha]) a.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.aPos);
    geo.setAttribute('aColor', this.aCol);
    geo.setAttribute('aSize', this.aSize);
    geo.setAttribute('aAlpha', this.aAlpha);
    geo.setDrawRange(0, 0);
    this.puffTex = puffTexture();
    this.points = new THREE.Points(geo, particleMaterial(this.puffTex));
    this.points.frustumCulled = false;
    this.points.renderOrder = 6;
    group.add(this.points);

    /* ---- the comic word ---- */
    this.wordCanvas = canvas(512, 256);
    this.wordTex = new THREE.CanvasTexture(this.wordCanvas);
    this.wordTex.colorSpace = THREE.SRGBColorSpace;
    this.word = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: this.wordTex, transparent: true, depthTest: false, depthWrite: false })
    );
    this.word.renderOrder = 998;
    this.word.visible = false;
    this.wordT = 0;
    this.wordSize = 12;
    group.add(this.word);

    /* ---- dizzy stars ---- */
    this.starTex = starTexture();
    this.stars = [];
    const starMat = new THREE.SpriteMaterial({ map: this.starTex, transparent: true, depthWrite: false });
    for (let i = 0; i < STAR_N; i++) {
      const s = new THREE.Sprite(starMat);
      s.visible = false;
      s.renderOrder = 7;
      group.add(s);
      this.stars.push(s);
    }
    this.starsOn = false;
    this.starT = 0;
    this.starAt = new THREE.Vector3();
    this.starR = 2;

    /* ---- the skid mark ---- */
    const rg = new THREE.BufferGeometry();
    this.ribbonPos = new THREE.BufferAttribute(new Float32Array(RIBBON_N * 2 * 3), 3);
    this.ribbonPos.setUsage(THREE.DynamicDrawUsage);
    rg.setAttribute('position', this.ribbonPos);
    const idx = [];
    for (let i = 0; i < RIBBON_N - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    rg.setIndex(idx);
    rg.setDrawRange(0, 0);
    this.ribbonMat = new THREE.MeshBasicMaterial({
      color: 0x3b2a1c, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    });
    this.ribbon = new THREE.Mesh(rg, this.ribbonMat);
    this.ribbon.frustumCulled = false;
    this.ribbon.renderOrder = 4;
    group.add(this.ribbon);
    this.ribbonN = 0;
    this.ribbonW = 1;
    this.lastX = 0;
    this.lastZ = 0;

    /* ---- the dent and the ring ---- */
    const dg = new THREE.CircleGeometry(1, 20);
    dg.rotateX(-Math.PI / 2);
    this.dent = new THREE.Mesh(dg, new THREE.MeshBasicMaterial({
      color: 0x2e2116, transparent: true, opacity: 0.6, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    }));
    this.dent.visible = false;
    this.dent.renderOrder = 4;
    group.add(this.dent);
    const ringG = new THREE.RingGeometry(0.8, 1, 40);
    ringG.rotateX(-Math.PI / 2);
    this.ring = new THREE.Mesh(ringG, new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide,
    }));
    this.ring.visible = false;
    this.ring.renderOrder = 5;
    this.ringT = 0;
    this.ringR = 10;
    group.add(this.ring);
    this.fade = 0;
  }

  /** Everything off — a new flight, or the world going away. */
  clear() {
    this.n = 0;
    this.points.geometry.setDrawRange(0, 0);
    this.word.visible = false;
    this.starsOn = false;
    for (const s of this.stars) s.visible = false;
    this.ribbonN = 0;
    this.ribbon.geometry.setDrawRange(0, 0);
    this.ribbonMat.opacity = 0.55;
    this.dent.visible = false;
    this.ring.visible = false;
    this.fade = 0;
  }

  emit(type, x, y, z, vx, vy, vz) {
    if (this.n >= CAP) return;
    const T = TYPES[type];
    const i = this.n++;
    this.px[i * 3] = x;
    this.px[i * 3 + 1] = y;
    this.px[i * 3 + 2] = z;
    this.pv[i * 3] = vx;
    this.pv[i * 3 + 1] = vy;
    this.pv[i * 3 + 2] = vz;
    this.type[i] = T;
    this.max[i] = T.life * (0.75 + Math.random() * 0.5);
    this.life[i] = 0;
    this.sz[i] = 0.8 + Math.random() * 0.5;
    const c = T.col || (T.col = new THREE.Color(T.c));
    this.aCol.array[i * 3] = c.r;
    this.aCol.array[i * 3 + 1] = c.g;
    this.aCol.array[i * 3 + 2] = c.b;
  }

  /** A ring of `n` puffs thrown out from a point. */
  burst(type, p, n, speed, up = 1, spread = 1) {
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2;
      const sp = speed * (0.5 + Math.random() * 0.7);
      this.emit(type, p.x + (Math.random() - 0.5) * spread, p.y + 0.3, p.z + (Math.random() - 0.5) * spread,
        Math.cos(a) * sp, up * (0.4 + Math.random()) * speed, Math.sin(a) * sp);
    }
  }

  /** The comic word, over `at`, sized for a camera about `dist` metres off. */
  showWord(word, fill, at, dist) {
    try {
      const ctx = this.wordCanvas.getContext('2d');
      if (ctx) drawWord(ctx, word, fill);
      this.wordTex.needsUpdate = true;
    } catch (e) {
      /* no canvas: no word */
    }
    this.word.position.copy(at);
    this.wordBase = at.clone();
    this.wordSize = Math.max(8, dist * 0.42);
    this.word.visible = true;
    this.word.material.opacity = 1;
    this.wordT = 0;
  }

  showStars(at, r, size = 1.5) {
    this.starsOn = true;
    this.starT = 0;
    this.starAt.copy(at);
    this.starR = r;
    this.starSize = size;
    for (const s of this.stars) s.visible = true;
  }

  moveStars(at) {
    this.starAt.copy(at);
  }

  /** Start a skid mark this wide. */
  startSkid(width) {
    this.ribbonN = 0;
    this.ribbonW = width;
    this.ribbonMat.opacity = 0.55;
    this.ribbon.geometry.setDrawRange(0, 0);
  }

  /** Add to it, if it has moved far enough since the last point. `dx,dz` is the way it is going. */
  skidTo(x, z, dx, dz) {
    if (this.ribbonN >= RIBBON_N) return;
    if (this.ribbonN && Math.hypot(x - this.lastX, z - this.lastZ) < 0.9) return;
    const L = Math.hypot(dx, dz) || 1;
    const ax = (-dz / L) * this.ribbonW * 0.5;
    const az = (dx / L) * this.ribbonW * 0.5;
    const a = this.ribbonPos.array;
    const i = this.ribbonN * 6;
    const y1 = this.heightAt(x + ax, z + az) + 0.12;
    const y2 = this.heightAt(x - ax, z - az) + 0.12;
    a[i] = x + ax;
    a[i + 1] = y1;
    a[i + 2] = z + az;
    a[i + 3] = x - ax;
    a[i + 4] = y2;
    a[i + 5] = z - az;
    this.ribbonN++;
    this.lastX = x;
    this.lastZ = z;
    this.ribbonPos.needsUpdate = true;
    this.ribbon.geometry.setDrawRange(0, Math.max(0, this.ribbonN - 1) * 6);
    this.ribbon.geometry.computeBoundingSphere();
  }

  showDent(x, z, r) {
    this.dent.position.set(x, this.heightAt(x, z) + 0.1, z);
    this.dent.scale.setScalar(r);
    this.dent.visible = true;
  }

  showRing(x, z, r) {
    this.ring.position.set(x, 0.25, z);
    this.ring.visible = true;
    this.ringT = 0;
    this.ringR = r;
  }

  update(dt, camera) {
    // Particles.
    let w = 0;
    const P = this.px;
    const V = this.pv;
    const pos = this.aPos.array;
    for (let i = 0; i < this.n; i++) {
      const T = this.type[i];
      const life = this.life[i] + dt;
      if (life >= this.max[i]) continue;
      const k = Math.exp(-T.drag * dt);
      let vx = V[i * 3] * k;
      let vy = (V[i * 3 + 1] - T.g * dt) * k;
      let vz = V[i * 3 + 2] * k;
      let x = P[i * 3] + vx * dt;
      let y = P[i * 3 + 1] + vy * dt;
      let z = P[i * 3 + 2] + vz * dt;
      if (T === TYPES.dirt || T === TYPES.spark) {
        const gh = Math.max(0, this.heightAt(x, z));
        if (y < gh) {
          y = gh;
          vy = -vy * 0.3;
          vx *= 0.5;
          vz *= 0.5;
        }
      }
      // Pack the live ones at the front.
      const j = w++;
      P[j * 3] = x;
      P[j * 3 + 1] = y;
      P[j * 3 + 2] = z;
      V[j * 3] = vx;
      V[j * 3 + 1] = vy;
      V[j * 3 + 2] = vz;
      this.life[j] = life;
      this.max[j] = this.max[i];
      this.type[j] = T;
      this.sz[j] = this.sz[i];
      if (j !== i) {
        this.aCol.array[j * 3] = this.aCol.array[i * 3];
        this.aCol.array[j * 3 + 1] = this.aCol.array[i * 3 + 1];
        this.aCol.array[j * 3 + 2] = this.aCol.array[i * 3 + 2];
      }
      const u = life / this.max[j];
      pos[j * 3] = x;
      pos[j * 3 + 1] = y;
      pos[j * 3 + 2] = z;
      this.aSize.array[j] = (T.s0 + (T.s1 - T.s0) * Math.sqrt(u)) * this.sz[j] * this.scale;
      this.aAlpha.array[j] = T.a * (u < 0.1 ? u / 0.1 : 1 - (u - 0.1) / 0.9);
    }
    this.n = w;
    const geo = this.points.geometry;
    geo.setDrawRange(0, w);
    if (w) {
      this.aPos.needsUpdate = true;
      this.aCol.needsUpdate = true;
      this.aSize.needsUpdate = true;
      this.aAlpha.needsUpdate = true;
    }

    // The word: pops in, holds, floats up a little, fades.
    if (this.word.visible) {
      this.wordT += dt;
      const t = this.wordT;
      const pop = t < 0.16 ? (t / 0.16) * 1.18 : t < 0.3 ? 1.18 - ((t - 0.16) / 0.14) * 0.18 : 1;
      const s = this.wordSize * pop;
      this.word.scale.set(s, s * 0.5, 1);
      this.word.position.copy(this.wordBase);
      this.word.position.y += t * 1.2;
      this.word.material.opacity = t < 1.9 ? 1 : Math.max(0, 1 - (t - 1.9) / 0.5);
      if (t > 2.4) this.word.visible = false;
    }

    // Dizzy stars: round and round above the wreck.
    if (this.starsOn) {
      this.starT += dt;
      const t = this.starT;
      const grow = Math.min(1, t / 0.35);
      for (let i = 0; i < this.stars.length; i++) {
        const a = t * 3.2 + (i * Math.PI * 2) / this.stars.length;
        const s = this.stars[i];
        s.position.set(
          this.starAt.x + Math.cos(a) * this.starR,
          this.starAt.y + Math.sin(a * 2 + i) * 0.2 * (this.starSize || 1.5),
          this.starAt.z + Math.sin(a) * this.starR
        );
        const k = (0.9 + 0.25 * Math.sin(t * 7 + i)) * (this.starSize || 1.5) * grow;
        s.scale.set(k, k, 1);
      }
    }

    // The ring on the water spreads and fades.
    if (this.ring.visible) {
      this.ringT += dt;
      const u = this.ringT / 2.2;
      const r = this.ringR * (0.3 + u * 1.7);
      this.ring.scale.set(r, 1, r);
      this.ring.material.opacity = Math.max(0, 0.8 * (1 - u));
      if (u >= 1) this.ring.visible = false;
    }
  }
}
