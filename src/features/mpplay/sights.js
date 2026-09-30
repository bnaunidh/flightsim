/**
 * What a summoned disaster looks like from the van or the boat (multiplayer,
 * list 2: "natural disasters affect everyone, if you summon them").
 *
 * A wildfire and a meteor shower are flying games — the fire is put out with
 * water scooped from the sea, the rocks are zapped from the cockpit — and
 * both features switch themselves off on the road and on the water. When
 * somebody in the game summons one, the kids driving still see it happen:
 *
 *   SMOKE    a tall column of cartoon smoke with flames flickering at its
 *            foot, where the fire is, and a flame mark on the minimap, for as
 *            long as a fire like that burns (four minutes);
 *   METEORS  shooting stars streaking across the sky in front of them for a
 *            minute and a half, burning up high above the island.
 *
 * Looks only: nothing here moves anybody or hurts anything. The weather
 * disasters (a tornado, a storm, fog...) are the game's own and are started
 * by ../mpworld.js; these two have no game of their own down here.
 */

import * as THREE from '../../vendor/three.module.js';
import { heightAt } from '../../world/terrain.js';

export const SMOKE_SECS = 240;
export const METEOR_SECS = 90;
const PUFFS = 16;
const FLAMES = 7;
const STREAKS = 8;

function canvasTex(size, paint) {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const g = c.getContext('2d');
  if (g && typeof g.fillRect === 'function') paint(g, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const soft = (g, s, stops) => {
  const r = g.createRadialGradient(s / 2, s / 2, 1, s / 2, s / 2, s / 2);
  for (const [k, c] of stops) r.addColorStop(k, c);
  g.fillStyle = r;
  g.fillRect(0, 0, s, s);
};

export class GroundSights {
  constructor() {
    this.group = null;
    this.smoke = null;
    this.meteors = null;
    this.puffs = [];
    this.flames = [];
    this.streaks = [];
    this.stats = { smoke: 0, meteorShowers: 0, streaks: 0 };
    this._v = new THREE.Vector3();
    this._y = new THREE.Vector3(0, 1, 0);
  }

  /** Into the world's group (mpworld.js's buildWorld): the sprites are made once and reused. */
  build(group) {
    this.group = group;
    this.smoke = null;
    this.meteors = null;
    const smokeTex = canvasTex(64, (g, s) => soft(g, s, [[0, 'rgba(255,255,255,0.95)'], [0.55, 'rgba(255,255,255,0.7)'], [1, 'rgba(255,255,255,0)']]));
    const glowTex = canvasTex(64, (g, s) => soft(g, s, [[0, 'rgba(255,255,255,1)'], [0.3, 'rgba(255,240,200,0.9)'], [1, 'rgba(255,200,120,0)']]));
    this.puffs = [];
    for (let i = 0; i < PUFFS; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, transparent: true, depthWrite: false, opacity: 0 }));
      s.visible = false;
      s.renderOrder = 5;
      s.name = 'mp-sight-smoke';
      group.add(s);
      this.puffs.push({ s, u: i / PUFFS, dx: (Math.random() - 0.5) * 30, dz: (Math.random() - 0.5) * 30 });
    }
    this.flames = [];
    for (let i = 0; i < FLAMES; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: i % 2 ? 0xffd23f : 0xff7a2a, transparent: true, depthWrite: false, opacity: 0 }));
      s.visible = false;
      s.renderOrder = 5;
      s.name = 'mp-sight-flame';
      group.add(s);
      this.flames.push({ s, a: (i / FLAMES) * Math.PI * 2, r: 12 + Math.random() * 30, ph: Math.random() * 6 });
    }
    const tailGeo = new THREE.CylinderGeometry(0.2, 1, 1, 8, 1, true);
    this.streaks = [];
    for (let i = 0; i < STREAKS; i++) {
      const head = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xfff3c4, transparent: true, depthWrite: false, opacity: 0, fog: false }));
      const tail = new THREE.Mesh(tailGeo, new THREE.MeshBasicMaterial({ color: 0xffb46b, transparent: true, opacity: 0, depthWrite: false, fog: false, toneMapped: false }));
      head.visible = false;
      tail.visible = false;
      head.renderOrder = 6;
      tail.renderOrder = 6;
      head.name = 'mp-sight-meteor';
      group.add(head, tail);
      this.streaks.push({ head, tail, pos: new THREE.Vector3(), vel: new THREE.Vector3(), t: 0, life: 0, size: 36, on: false });
    }
  }

  get ready() {
    return !!(this.group && this.group.parent);
  }

  /** A fire's smoke at (x, z), for `secs`. Over the sea there is nothing to see: false. */
  startSmoke(x, z, secs = SMOKE_SECS) {
    if (!this.ready || !Number.isFinite(x) || !Number.isFinite(z)) return false;
    const ground = heightAt(x, z);
    if (!(ground > 1)) return false;
    this.smoke = { x, z, y: ground, left: secs };
    this.stats.smoke++;
    return true;
  }

  /**
   * The fire has moved — the host's own, as it really burns (../mpworld.js
   * 'world:fire'): the column goes with it. Never onto the sea.
   */
  moveSmoke(x, z) {
    const S = this.smoke;
    if (!S || !Number.isFinite(x) || !Number.isFinite(z)) return false;
    const ground = heightAt(x, z);
    if (!(ground > 1)) return false;
    S.x = x;
    S.z = z;
    S.y = ground;
    return true;
  }

  /** The fire is out: the smoke thins away over `secs` (it fades in its last twenty). */
  endSmoke(secs = 20) {
    if (this.smoke) this.smoke.left = Math.min(this.smoke.left, secs);
  }

  startMeteors(secs = METEOR_SECS) {
    if (!this.ready) return false;
    this.meteors = { left: secs, next: 0.3 };
    this.stats.meteorShowers++;
    return true;
  }

  clear() {
    this.smoke = null;
    this.meteors = null;
    for (const p of this.puffs) p.s.visible = false;
    for (const f of this.flames) f.s.visible = false;
    for (const k of this.streaks) {
      k.on = false;
      k.head.visible = false;
      k.tail.visible = false;
    }
  }

  /** Every frame in the van or the boat. `wind` { x, z } in m/s leans the smoke. */
  update(dt, camera, wind = null) {
    if (!this.ready) return;
    this.updateSmoke(dt, wind);
    this.updateMeteors(dt, camera);
  }

  updateSmoke(dt, wind) {
    const S = this.smoke;
    if (S) {
      S.left -= dt;
      if (S.left <= 0) this.smoke = null;
    }
    const on = !!this.smoke;
    const fade = on ? Math.min(1, S.left / 20) : 0;
    const wx = wind ? Math.max(-12, Math.min(12, wind.x || 0)) : 0;
    const wz = wind ? Math.max(-12, Math.min(12, wind.z || 0)) : 0;
    for (const p of this.puffs) {
      if (!on) {
        if (p.s.visible) p.s.visible = false;
        continue;
      }
      // Each puff climbs the column in twelve seconds, grows and pales, then starts again at the foot.
      // Dark: a pale grey was lost against a hazy sky (measured, #adadae at 0.6 — not seen from 900 m).
      p.u += dt / 12;
      if (p.u >= 1) {
        p.u -= 1;
        p.dx = (Math.random() - 0.5) * 30;
        p.dz = (Math.random() - 0.5) * 30;
      }
      const h = p.u * 320;
      p.s.visible = true;
      p.s.position.set(S.x + p.dx + wx * p.u * 26, S.y + 25 + h, S.z + p.dz + wz * p.u * 26);
      p.s.scale.setScalar(70 + p.u * 130);
      const grey = 0.03 + p.u * 0.13;
      p.s.material.color.setRGB(grey, grey, grey * 1.05);
      p.s.material.opacity = 0.92 * Math.pow(1 - p.u, 0.6) * Math.min(1, p.u * 10) * fade;
    }
    const t = typeof performance !== 'undefined' ? performance.now() / 1000 : 0;
    for (const f of this.flames) {
      if (!on) {
        if (f.s.visible) f.s.visible = false;
        continue;
      }
      const flick = 0.75 + 0.25 * Math.sin(t * 9 + f.ph) * Math.sin(t * 5.3 + f.ph * 2);
      f.s.visible = true;
      f.s.position.set(S.x + Math.cos(f.a) * f.r, S.y + 14 + flick * 10, S.z + Math.sin(f.a) * f.r);
      f.s.scale.setScalar(34 * flick + 10);
      f.s.material.opacity = 0.9 * fade;
    }
  }

  updateMeteors(dt, camera) {
    const M = this.meteors;
    if (M) {
      M.left -= dt;
      M.next -= dt;
      if (M.left <= 0) this.meteors = null;
      else if (M.next <= 0 && camera) {
        M.next = 0.6 + Math.random() * 0.7;
        this.spawnStreak(camera);
      }
    }
    for (const k of this.streaks) {
      if (!k.on) continue;
      k.t += dt;
      if (k.t >= k.life) {
        k.on = false;
        k.head.visible = false;
        k.tail.visible = false;
        continue;
      }
      k.pos.addScaledVector(k.vel, dt);
      const a = Math.min(1, k.t / 0.2) * Math.min(1, (k.life - k.t) / 0.8);
      k.head.position.copy(k.pos);
      k.head.scale.setScalar(k.size);
      k.head.material.opacity = a;
      // The tail, behind the head along its path, as long as the last second of it.
      const speed = k.vel.length() || 1;
      const len = Math.min(k.t, 1) * speed * 0.9 + 20;
      this._v.copy(k.vel).multiplyScalar(-1 / speed);
      k.tail.quaternion.setFromUnitVectors(this._y, this._v);
      k.tail.position.copy(k.pos).addScaledVector(this._v, len / 2);
      k.tail.scale.set(k.size * 0.22, len, k.size * 0.22);
      k.tail.material.opacity = 0.75 * a;
    }
  }

  /** One shooting star, somewhere in front of whoever is looking: high, fast, and gone before it gets anywhere near the ground. */
  spawnStreak(camera) {
    const k = this.streaks.find((x) => !x.on);
    if (!k) return;
    const fwd = this._v.set(0, 0, -1).applyQuaternion(camera.quaternion);
    const yaw = Math.atan2(fwd.x, -fwd.z) + (Math.random() - 0.5) * 1.8;
    const dist = 1300 + Math.random() * 1300;
    const cx = camera.position.x + Math.sin(yaw) * dist;
    const cz = camera.position.z - Math.cos(yaw) * dist;
    k.pos.set(cx, Math.max(camera.position.y, 0) + 520 + Math.random() * 380, cz);
    // Across the line of sight, one way or the other, and down.
    const side = Math.random() < 0.5 ? -1 : 1;
    const sp = 240 + Math.random() * 110;
    k.vel.set(Math.cos(yaw) * side * sp, -(80 + Math.random() * 70), Math.sin(yaw) * side * sp);
    k.t = 0;
    k.life = 2.2 + Math.random() * 1.1;
    k.size = 30 + Math.random() * 18;
    k.on = true;
    k.head.visible = true;
    k.tail.visible = true;
    this.stats.streaks++;
  }

  /** For the tests and the minimap. */
  state() {
    return {
      smoke: this.smoke ? { x: Math.round(this.smoke.x), z: Math.round(this.smoke.z), left: Math.round(this.smoke.left) } : null,
      meteors: this.meteors ? { left: Math.round(this.meteors.left), lit: this.streaks.filter((k) => k.on).length } : null,
      stats: { ...this.stats },
    };
  }
}
