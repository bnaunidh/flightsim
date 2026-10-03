/**
 * Air Force One — Under Attack: the drones, their missiles, the flares/chaff
 * and the escort's gun. One shared engine, driven by whichever seat is a
 * person's:
 *
 *   - src/features/events/afo.js drives it when you are the CAPTAIN: the
 *     drones and their missiles come for your own aircraft, and the escort
 *     (an NPC, src/game/roles/npc-flyer.js) shoots the drones down for you;
 *   - src/game/roles/afo-lead.js drives it when you are the ESCORT: they
 *     come for the NPC airliner instead, and your own gun defends it.
 *
 * KID-SAFE, ON PURPOSE, THROUGHOUT:
 *   - the attackers are UNMANNED drones ("unidentified drones" on the radio
 *     — no country, no person, ever named); nobody is ever aboard one;
 *   - destroying one is explosions.js's 'sparkle' kind — the same gentle
 *     puff of sparks a burning-up meteor gets in the dodge missions, never a
 *     fireball, never a scorch mark, never anywhere near the jet;
 *   - a missile that is not stopped does not crash anybody. It is a FAIL,
 *     with a kind word about decoying it earlier, exactly the way other
 *     missions here fail on a `failIf` message rather than a wreck;
 *   - the gun only ever hits a drone or a missile — never the airliner,
 *     never the escort, never the ground. There is nothing else it can aim
 *     at: `AttackField` tracks nothing else as a target.
 *
 * Every vector here is THREE.Vector3; nothing imports a seat, a story or the
 * mission runner, so a node test can drive the whole engine with a bare
 * scene and the real terrain module (see tests/features/afo-lead.mjs).
 */

import * as THREE from '../../vendor/three.module.js';
import { heightAt } from '../../world/terrain.js';
import { explode } from '../explosions.js';
import { segmentHitsSphere } from '../pvp/rules.js';
import { registerBody, unregisterBody } from '../sky.js';

let DRONE_N = 0;

const DEG = Math.PI / 180;
const UP = new THREE.Vector3(0, 1, 0);
/** A gun pellet's speed relative to whoever fired it, m/s. */
const PELLET_SPEED = 340;

function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

function wrap(h) {
  return ((h % 360) + 360) % 360;
}

function adiff(a, b) {
  return ((b - a + 540) % 360) - 180;
}

function headingOf(v) {
  return wrap((Math.atan2(v.x, -v.z) * 180) / Math.PI);
}

/** Steer `vel` (length kept, or ramped to `wantSpeed`) towards `toward`, at most `turnDeg` of heading this frame. */
function steer(vel, toward, dt, turnRateDeg, wantSpeed, accel) {
  const cur = headingOf(vel);
  const want = headingOf(toward);
  const err = adiff(cur, want);
  const turn = clamp(err, -turnRateDeg * dt, turnRateDeg * dt);
  const h = (cur + turn) * DEG;
  const speed = Math.hypot(vel.x, vel.z);
  const nextSpeed = speed + clamp(wantSpeed - speed, -accel * dt, accel * dt);
  vel.x = Math.sin(h) * nextSpeed;
  vel.z = -Math.cos(h) * nextSpeed;
}

/* ------------------------------------------------------------------ *
 * A small additive glow sprite, cached. Used for the missile's flame
 * and the flare — the same idea as aircraft/models/civil-build.js's
 * glowSprite(), kept local so this file has no reason to pull in the
 * whole aircraft-model kit for two sprites.
 * ------------------------------------------------------------------ */

let glowTex = null;
function glowMat(color, opacity = 0.9) {
  if (!glowTex) {
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 32, 32);
    glowTex = new THREE.CanvasTexture(c);
  }
  return new THREE.SpriteMaterial({ map: glowTex, color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending });
}

function glowSprite(color, size, opacity = 0.9) {
  const s = new THREE.Sprite(glowMat(color, opacity));
  s.scale.setScalar(size);
  return s;
}

/* ================================================================== *
 * A drone: a small unmanned aircraft that orbits the target and, every
 * so often, launches a missile at it. One gun hit and it is done.
 * ================================================================== */

const DRONE_GEO = { body: null, wing: null, fin: null };
function droneGeo() {
  if (!DRONE_GEO.body) {
    DRONE_GEO.body = new THREE.ConeGeometry(0.55, 3.6, 6);
    DRONE_GEO.body.rotateX(Math.PI / 2);
    DRONE_GEO.wing = new THREE.BoxGeometry(5.2, 0.12, 0.9);
    DRONE_GEO.fin = new THREE.BoxGeometry(0.1, 0.7, 0.8);
  }
  return DRONE_GEO;
}
let droneMat = null;
function droneMaterial() {
  if (!droneMat) droneMat = new THREE.MeshStandardMaterial({ color: 0x2b2f33, roughness: 0.65, metalness: 0.35 });
  return droneMat;
}

export class Drone {
  /**
   * `firstLaunch`: the soonest it may launch, in seconds from now; it fires
   * within 3 s of that. The default (3–6 s) is the captain's and the
   * President's seats; the escort's seat holds fire longer (afo-lead.js).
   */
  constructor(scene, pos, { speed = 55, r = 9, firstLaunch = 3 } = {}) {
    this.scene = scene;
    this.pos = pos.clone();
    this.vel = new THREE.Vector3(speed, 0, 0);
    this.speed = speed;
    this.r = r;
    this.hp = 1;
    this.alive = true;
    this.t = 0;
    this.orbitSign = Math.random() < 0.5 ? 1 : -1;
    /** Seconds until this drone may launch again. */
    this.cooldown = firstLaunch + Math.random() * 3;
    this.launches = 0;

    const g = droneGeo();
    const m = droneMaterial();
    this.model = new THREE.Group();
    this.model.name = 'afo-drone';
    const body = new THREE.Mesh(g.body, m);
    const wing = new THREE.Mesh(g.wing, m);
    wing.position.z = 0.2;
    const finL = new THREE.Mesh(g.fin, m);
    finL.position.set(-1.1, 0.3, 1.3);
    const finR = new THREE.Mesh(g.fin, m);
    finR.position.set(1.1, 0.3, 1.3);
    this.model.add(body, wing, finL, finR);
    this.model.position.copy(this.pos);
    scene.add(this.model);
    /*
     * In the sky's list (../sky.js): a red diamond on the minimap, and
     * solid — ram one and it pops in the same sparkles a gun hit gives it
     * (nobody is aboard; the attack field tidies a dead drone away at the
     * end of its frame). You have a mid-air bump: a drone is still an aircraft.
     */
    const self = this;
    this.body = registerBody({
      id: `drone-${++DRONE_N}`,
      kind: 'enemy',
      name: 'a drone',
      pos: this.pos,
      vel: this.vel,
      radius: this.r,
      small: true,
      crew: 0,
      onGround: false,
      hit: (sim) => {
        if (!self.alive) return;
        self.alive = false;
        explode(sim, self.pos, { kind: 'sparkle', size: 0.9 });
      },
      get heading() {
        return headingOf(self.vel);
      },
    });
  }

  /** Fly a loose racetrack round `targetPos`, below and off to one side. */
  update(dt, targetPos) {
    if (!this.alive) return;
    this.t += dt;
    const orbitR = 650;
    const ang = (this.t * 0.11 + 2) * this.orbitSign;
    const want = new THREE.Vector3(
      targetPos.x + Math.sin(ang) * orbitR,
      0,
      targetPos.z + Math.cos(ang) * orbitR
    );
    const toward = want.clone().sub(this.pos);
    toward.y = 0;
    steer(this.vel, toward, dt, 32, this.speed, 30);
    this.pos.addScaledVector(this.vel, dt);
    const wantY = targetPos.y - 35;
    const floor = heightAt(this.pos.x, this.pos.z) + 25;
    this.pos.y += clamp(wantY - this.pos.y, -8 * dt, 8 * dt);
    if (this.pos.y < floor) this.pos.y = floor;
    this.model.position.copy(this.pos);
    const h = headingOf(this.vel) * DEG;
    this.model.rotation.set(0, -h, 0);
    this.cooldown -= dt;
  }

  /** Ready to fire, and close enough: drones do not launch from far away. */
  readyToLaunch(targetPos) {
    return this.alive && this.cooldown <= 0 && Math.hypot(this.pos.x - targetPos.x, this.pos.z - targetPos.z) < 2800;
  }

  hit() {
    if (!this.alive) return false;
    this.hp -= 1;
    if (this.hp <= 0) this.alive = false;
    return !this.alive;
  }

  dispose() {
    unregisterBody(this.body);
    if (this.model.parent) this.model.parent.remove(this.model);
  }
}

/* ================================================================== *
 * A missile: homes on the target, or on the nearest live flare while
 * one is within its seeker's reach. Gives up (harmlessly) after a
 * while, so flying well clear of the drones is always a way to win.
 * ================================================================== */

const MISSILE_GEO = { body: null, nose: null, fin: null };
function missileGeo() {
  if (!MISSILE_GEO.body) {
    MISSILE_GEO.body = new THREE.CylinderGeometry(0.22, 0.22, 2.6, 8);
    MISSILE_GEO.body.rotateX(Math.PI / 2);
    MISSILE_GEO.nose = new THREE.ConeGeometry(0.22, 0.6, 8);
    MISSILE_GEO.nose.rotateX(Math.PI / 2);
    MISSILE_GEO.fin = new THREE.BoxGeometry(0.06, 0.4, 0.5);
  }
  return MISSILE_GEO;
}
let missileMat = null;
function missileMaterial() {
  if (!missileMat) missileMat = new THREE.MeshStandardMaterial({ color: 0xcfd4d8, roughness: 0.45, metalness: 0.5 });
  return missileMat;
}

export class Missile {
  constructor(scene, pos, headingDeg, { r = 6 } = {}) {
    this.scene = scene;
    this.pos = pos.clone();
    this.r = r;
    this.alive = true;
    this.t = 0;
    this.speed = 85;
    this.seeking = 'jet'; // 'jet' | 'flare'
    this.flare = null; // the Flare object it has been decoyed onto
    const h = headingDeg * DEG;
    this.vel = new THREE.Vector3(Math.sin(h) * this.speed, 4, -Math.cos(h) * this.speed);

    const g = missileGeo();
    const m = missileMaterial();
    this.model = new THREE.Group();
    this.model.name = 'afo-missile';
    this.model.add(new THREE.Mesh(g.body, m));
    const nose = new THREE.Mesh(g.nose, m);
    nose.position.z = -1.6;
    this.model.add(nose);
    for (const s of [-1, 1]) {
      const fin = new THREE.Mesh(g.fin, m);
      fin.position.set(s * 0.22, 0, 1.0);
      this.model.add(fin);
    }
    this.flame = glowSprite(0xffb060, 1.4, 0.95);
    this.flame.position.z = 1.4;
    this.model.add(this.flame);
    this.model.position.copy(this.pos);
    scene.add(this.model);
  }

  /** `aimPos`: the jet, or a flare's position when `decoyed`. */
  update(dt, aimPos, decoyed) {
    if (!this.alive) return;
    this.t += dt;
    if (this.seeking !== (decoyed ? 'flare' : 'jet')) this.seeking = decoyed ? 'flare' : 'jet';
    const wantSpeed = Math.min(235, 85 + this.t * 42);
    const toward = aimPos.clone().sub(this.pos);
    steer(this.vel, toward, dt, 50, wantSpeed, 140);
    // A little gravity-drop compensation is baked into vel.y chasing the aim point's height, not simulated separately.
    const dy = aimPos.y - this.pos.y;
    this.vel.y += clamp(dy * 0.8 - this.vel.y, -60 * dt, 60 * dt);
    this.pos.addScaledVector(this.vel, dt);
    const floor = heightAt(this.pos.x, this.pos.z) + 2;
    if (this.pos.y < floor) {
      this.pos.y = floor;
      this.alive = false; // flew itself into the sea; a quiet end, not a "hit".
    }
    this.model.position.copy(this.pos);
    const dir = this.vel.clone().normalize();
    if (dir.lengthSq() > 0.001) this.model.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), dir);
    this.flame.material.opacity = 0.7 + Math.random() * 0.25;
  }

  dispose() {
    if (this.model.parent) this.model.parent.remove(this.model);
  }
}

/* ================================================================== *
 * A flare (and its chaff cloud): dropped behind and below the jet, a
 * hot point a seeking missile can be pulled onto instead. Fades after
 * a few seconds.
 * ================================================================== */

class Flare {
  constructor(scene, pos, vel) {
    this.pos = pos.clone();
    this.vel = vel.clone().multiplyScalar(0.3);
    this.vel.y -= 6;
    this.life = 5;
    this.sprite = glowSprite(0xffd27a, 3.5, 1);
    this.sprite.position.copy(this.pos);
    scene.add(this.sprite);
    this.scene = scene;
  }

  update(dt) {
    this.life -= dt;
    this.vel.y -= 2.5 * dt; // falls
    this.pos.addScaledVector(this.vel, dt);
    const floor = heightAt(this.pos.x, this.pos.z);
    if (this.pos.y < floor) this.pos.y = floor;
    this.sprite.position.copy(this.pos);
    this.sprite.material.opacity = Math.max(0, Math.min(1, this.life / 1.2));
    this.sprite.scale.setScalar(3.5 * (1 + (5 - this.life) * 0.12));
  }

  dispose() {
    if (this.sprite.parent) this.sprite.parent.remove(this.sprite);
  }
}

/* ================================================================== *
 * The gun: a pellet per shot (the same "a pellet meets a sphere" rule
 * PvP uses, src/features/pvp/rules.js), fired from whoever has it —
 * the player, in either seat, or the NPC escort's own fair aim when
 * you are the captain.
 * ================================================================== */

class Pellet {
  constructor(scene, pos, vel) {
    this.prev = pos.clone();
    this.pos = pos.clone();
    this.vel = vel.clone();
    this.life = 1.1;
    this.mesh = glowSprite(0xfff3b0, 0.9, 1);
    this.mesh.position.copy(pos);
    scene.add(this.mesh);
    this.dead = false;
  }

  step(dt) {
    this.prev.copy(this.pos);
    this.pos.addScaledVector(this.vel, dt);
    this.mesh.position.copy(this.pos);
    this.life -= dt;
    if (this.life <= 0) this.dead = true;
  }

  dispose() {
    if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
  }
}

/* ================================================================== *
 * AttackField: one wave of drones over one jet, and everything thrown
 * at or dropped for it. Pure orchestration — no camera, no cards, no
 * mission steps; the callers add those.
 * ================================================================== */

export class AttackField {
  /** @param {object} sim the real game object — explode() wants it for the light, the camera distance and the sound. */
  constructor(sim) {
    this.sim = sim;
    this.scene = sim.scene;
    this.drones = [];
    this.missiles = [];
    this.flares = [];
    this.pellets = [];
    this.t = 0;
    /** Tallies the callers read for scoring and for fail checks. */
    this.stats = { launched: 0, decoyed: 0, shotDrones: 0, shotMissiles: 0, hits: 0, selfExpired: 0 };
    this._v = new THREE.Vector3();
  }

  /** Bring on a wave of drones at these positions (world space). */
  spawnWave(positions, opts) {
    for (const p of positions) this.drones.push(new Drone(this.scene, p, opts));
  }

  get dronesAlive() {
    return this.drones.filter((d) => d.alive).length;
  }

  get missilesInbound() {
    return this.missiles.filter((m) => m.alive).length;
  }

  /** Drop flares/chaff from here, travelling at `vel`: a kind word for "deployed". */
  deployDecoy(originPos, originVel) {
    for (let i = 0; i < 3; i++) {
      const p = originPos.clone().addScaledVector(originVel, -0.15 * i);
      p.x += (Math.random() - 0.5) * 6;
      p.z += (Math.random() - 0.5) * 6;
      this.flares.push(new Flare(this.scene, p, originVel));
    }
    // Every missile still some way out gets a fair chance to be pulled off.
    for (const m of this.missiles) {
      if (!m.alive || m.t < 0.4) continue;
      if (Math.random() < 0.72) {
        const f = this.flares[this.flares.length - 1 - Math.floor(Math.random() * 3)];
        if (f) m.flare = f;
      }
    }
  }

  /** Fire one shot from `pos`, aimed along the unit vector `dir`. */
  fireGun(pos, dir, muzzleVel = null) {
    const vel = dir.clone().normalize().multiplyScalar(PELLET_SPEED);
    if (muzzleVel) vel.add(muzzleVel);
    this.pellets.push(new Pellet(this.scene, pos, vel));
  }

  /**
   * The NPC escort's own fair aim, for whichever seat has one (the
   * captain's, afo.js; the President's, afo-president.js): the nearest
   * missile in the air if there is one — the more urgent target — else the
   * nearest drone, within `range`. Written into `out` as a unit vector, or
   * null when there is nothing to shoot at.
   *
   * LED, for the pellet's time of flight: a straight shot at where a drone
   * IS is a shot at where it no longer is. And led by the target's velocity
   * RELATIVE to the shooter, because fireGun() adds the shooter's own
   * velocity to the pellet — leading by the target's velocity alone still
   * misses by the shooter's own speed times the flight time (~65 m at
   * 300 m). Measured over 600 s (tests/features/afo-lead.mjs): no lead, 0
   * drones down; target-velocity lead, still 0; relative lead, both down by
   * t ≈ 45 s, every run.
   */
  aimFrom(pos, vel, out, range = 1300) {
    let best = null;
    let bd = Infinity;
    for (const pool of [this.missiles, this.drones]) {
      for (const t of pool) {
        if (!t.alive) continue;
        const dd = t.pos.distanceToSquared(pos);
        if (dd < bd) {
          bd = dd;
          best = t;
        }
      }
      if (best) break;
    }
    if (!best || bd > range * range) return null;
    const lead = Math.sqrt(bd) / PELLET_SPEED;
    out.copy(best.pos).addScaledVector(best.vel, lead);
    if (vel) out.addScaledVector(vel, -lead);
    return out.sub(pos).normalize();
  }

  /**
   * @param {THREE.Vector3} targetPos the jet's position
   * @param {THREE.Vector3} targetVel the jet's velocity (for lead, cosmetic only)
   * @returns {{hit: boolean, decoyed: number}} what happened to missiles this frame
   */
  update(dt, targetPos, targetVel) {
    this.t += dt;
    let hitThisFrame = false;

    for (const d of this.drones) if (d.alive) d.update(dt, targetPos);
    for (const d of this.drones) {
      if (d.readyToLaunch(targetPos)) {
        const hdg = headingOf(targetPos.clone().sub(d.pos));
        const m = new Missile(this.scene, d.pos, hdg);
        this.missiles.push(m);
        this.stats.launched++;
        d.cooldown = 10 + Math.random() * 5;
        d.launches++;
      }
    }

    for (const f of this.flares) f.update(dt);
    for (let i = this.flares.length - 1; i >= 0; i--) {
      if (this.flares[i].life <= 0) {
        this.flares[i].dispose();
        this.flares.splice(i, 1);
      }
    }

    for (const m of this.missiles) {
      if (!m.alive) continue;
      let aim = targetPos;
      let decoyed = false;
      if (m.flare && m.flare.life > 0) {
        aim = m.flare.pos;
        decoyed = true;
      } else if (m.flare) {
        m.flare = null; // the flare it was chasing burned out; back onto the jet.
      }
      m.update(dt, aim, decoyed);
      if (!m.alive) continue;
      if (m.t > 42) {
        m.alive = false;
        this.stats.selfExpired++;
        continue;
      }
      const d3 = m.pos.distanceTo(aim);
      if (decoyed && d3 < 22) {
        m.alive = false;
        this.stats.decoyed++;
        explode(this.sim, m.pos, { kind: 'sparkle', size: 0.5 });
      } else if (!decoyed && d3 < 20) {
        m.alive = false;
        this.stats.hits++;
        hitThisFrame = true;
        // Never literally on the jet: a near miss you are told about, not shown on it.
        const off = targetVel ? targetVel.clone().normalize().multiplyScalar(-22) : new THREE.Vector3(0, 0, 22);
        explode(this.sim, m.pos.clone().add(off), { kind: 'sparkle', size: 0.7 });
      }
    }
    for (const p of this.pellets) p.step(dt);
    const live = [...this.drones.filter((d) => d.alive), ...this.missiles.filter((m) => m.alive)];
    for (const p of this.pellets) {
      if (p.dead) continue;
      for (const t of live) {
        if (!t.alive) continue;
        if (segmentHitsSphere(p.prev.x, p.prev.y, p.prev.z, p.pos.x, p.pos.y, p.pos.z, t.pos.x, t.pos.y, t.pos.z, t.r)) {
          p.dead = true;
          const wasDrone = t instanceof Drone;
          t.alive = false;
          if (wasDrone) this.stats.shotDrones++;
          else this.stats.shotMissiles++;
          explode(this.sim, t.pos, { kind: 'sparkle', size: wasDrone ? 0.9 : 0.5 });
          break;
        }
      }
    }
    for (let i = this.pellets.length - 1; i >= 0; i--) {
      if (this.pellets[i].dead) {
        this.pellets[i].dispose();
        this.pellets.splice(i, 1);
      }
    }
    // Anything the gun or the terrain took out this frame (or the missile
    // resolution above, or a drone's cooldown never mattering once it is
    // dead) loses its model now and leaves the live lists for good.
    for (const d of this.drones) if (!d.alive) d.dispose();
    for (const m of this.missiles) if (!m.alive) m.dispose();
    this.drones = this.drones.filter((d) => d.alive);
    this.missiles = this.missiles.filter((m) => m.alive);

    return { hit: hitThisFrame };
  }

  dispose() {
    for (const d of this.drones) d.dispose();
    for (const m of this.missiles) m.dispose();
    for (const f of this.flares) f.dispose();
    for (const p of this.pellets) p.dispose();
    this.drones = [];
    this.missiles = [];
    this.flares = [];
    this.pellets = [];
  }
}

export { Drone as _Drone, Missile as _Missile };
