/**
 * The sky's heat-seekers: every missile in flight, every flare burning, and
 * the smoke they leave. One list for all of them, whoever fired:
 *
 *   - the player's own, locked on a drone or (PvP on) another player;
 *   - a launcher's, in the Heat-Seeker disaster, flying at the player;
 *   - a cosmetic copy of another player's, so everybody in a lobby sees it go.
 *
 * The flying itself is ./rules.js stepMissile() — plain numbers — and this
 * file wraps it in a mesh, a flame and a trail, hands it the flares of
 * whoever it is chasing, and tells its maker how it ended.
 *
 * A missile is told what it chases by a TARGET: { id, owner, aim(out), g() }.
 * `aim` fills { x, y, z, vx, vy, vz } and returns false when there is nothing
 * to see (the target is gone); `owner` names whose flares can fool it ('me',
 * or 'p3' for player 3); `g()` is how hard the target is turning, in g,
 * because a flare works better with a hard break behind it.
 */

import * as THREE from '../../vendor/three.module.js';
import { heightAt } from '../../world/terrain.js';
import { explode } from '../explosions.js';
import * as Rules from './rules.js';
import * as Fly from './fly.js';

export const HS = {
  sim: null,
  group: null,
  trails: null,
  flareFx: null,
  missiles: [],
  flares: [],
  salvoSeq: 0,
  idSeq: 0,
  clock: 0,
  stats: { launched: 0, hits: 0, decoyed: 0, spent: 0, lost: 0, ground: 0, flares: 0 },
  /** The last few endings, for the console and the tests. */
  log: [],
};

const FWD = new THREE.Vector3(0, 0, -1);
const _dir = new THREE.Vector3();
const _v2 = new THREE.Vector2();
const _cam = new THREE.Vector3();
const AIM = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, isTarget: true };
const OWN = [];

function say(line) {
  HS.log.push(line);
  if (HS.log.length > 24) HS.log.shift();
}

/**
 * Where a bang of ours may go off: no nearer to the camera than `min` metres (on the line from the camera
 * through `p`). The game's explosions are real light — a burst 15-60 m from the chase camera lit the whole view
 * in the flicker probe, however small (see heatseek-disaster.js __tune for the numbers) — so a missile popping on
 * a flare behind you, or a drone going up close alongside, is shown just beyond where it happened instead.
 */
export function standoff(sim, p, min = 150) {
  const cam = sim && sim.camera;
  if (!cam || !p) return p;
  cam.getWorldPosition(_cam);
  const dx = p.x - _cam.x;
  const dy = p.y - _cam.y;
  const dz = p.z - _cam.z;
  const d = Math.hypot(dx, dy, dz);
  if (d >= min) return p;
  if (d < 1e-3) return { x: _cam.x, y: _cam.y, z: _cam.z - min };
  const k = min / d;
  return { x: _cam.x + dx * k, y: _cam.y + dy * k, z: _cam.z + dz * k };
}

/* ------------------------------------------------------------------ *
 * The world's group
 * ------------------------------------------------------------------ */

/** A new world was built: make the smoke and the flares in its group, and forget everything in the old one. */
export function ensureWorld(sim, group) {
  clearWorld();
  if (HS.trails) HS.trails.dispose();
  if (HS.flareFx) HS.flareFx.dispose();
  HS.sim = sim;
  HS.group = group;
  HS.trails = new Fly.Trails();
  HS.flareFx = new Fly.FlareSprites();
  group.add(HS.trails.points);
  group.add(HS.flareFx.group);
  return HS;
}

/** Remove every missile and every flare (a new flight, a quit). The smoke fades on its own — cleared too, for a clean start. */
export function clearWorld() {
  for (const m of HS.missiles) m.dispose();
  HS.missiles.length = 0;
  for (const f of HS.flares) if (f.sprite) f.sprite.visible = false;
  HS.flares.length = 0;
  if (HS.trails) HS.trails.clear();
}

/* ------------------------------------------------------------------ *
 * Flares
 * ------------------------------------------------------------------ */

/**
 * Drop a salvo of flares from `pos` while flying at `vel`. Returns the salvo
 * id (a missile rolls once per salvo). `owner` says whose they are.
 */
export function deployFlares(owner, pos, vel, { count = 2, back = 6 } = {}) {
  const salvo = ++HS.salvoSeq;
  const sp = Math.hypot(vel.x, vel.y, vel.z) || 1;
  for (let i = 0; i < count; i++) {
    const sprite = HS.flareFx ? HS.flareFx.take() : null;
    const f = {
      id: ++HS.idSeq,
      salvo,
      owner,
      // Out the back and a little below, as they leave the dispenser.
      x: pos.x - (vel.x / sp) * (back + i * 3) + (Math.random() - 0.5) * 3,
      y: pos.y - 2 - i * 0.6,
      z: pos.z - (vel.z / sp) * (back + i * 3) + (Math.random() - 0.5) * 3,
      vx: vel.x * 0.38 + (Math.random() - 0.5) * 8,
      vy: vel.y * 0.2 - 5,
      vz: vel.z * 0.38 + (Math.random() - 0.5) * 8,
      age: 0,
      life: Rules.FLARE_LIFE,
      sprite,
      puffT: 0,
    };
    if (sprite) {
      sprite.visible = true;
      sprite.position.set(f.x, f.y, f.z);
      sprite.material.opacity = 1;
    }
    HS.flares.push(f);
    HS.stats.flares++;
  }
  return salvo;
}

function stepFlares(dt) {
  for (let i = HS.flares.length - 1; i >= 0; i--) {
    const f = HS.flares[i];
    f.age += dt;
    f.vy -= 2.2 * dt;
    // The air takes the speed off a flare quickly: it hangs behind the aeroplane that dropped it.
    const damp = Math.exp(-0.9 * dt);
    f.vx *= damp;
    f.vz *= damp;
    f.x += f.vx * dt;
    f.y += f.vy * dt;
    f.z += f.vz * dt;
    const floor = Math.max(0, heightAt(f.x, f.z));
    if (f.y < floor + 0.5) f.y = floor + 0.5;
    f.puffT += dt;
    if (f.puffT > 0.12 && HS.trails && f.age < f.life * 0.9) {
      f.puffT = 0;
      HS.trails.emit(f.x, f.y, f.z, 1.6, 2.4);
    }
    if (f.sprite) {
      f.sprite.position.set(f.x, f.y, f.z);
      const left = f.life - f.age;
      // Steady glow, fading over the last second: no flicker.
      f.sprite.material.opacity = Math.max(0, Math.min(1, left / 1.2));
      f.sprite.scale.setScalar(3.6 * (1 + f.age * 0.1));
    }
    if (f.age >= f.life) {
      if (f.sprite) f.sprite.visible = false;
      HS.flares.splice(i, 1);
    }
  }
}

/** Flares of one owner that are still burning (a shared array: use it now, do not keep it). */
export function flaresOf(owner) {
  OWN.length = 0;
  for (const f of HS.flares) if (f.owner === owner && f.age < f.life) OWN.push(f);
  return OWN;
}

/* ------------------------------------------------------------------ *
 * A missile in flight
 * ------------------------------------------------------------------ */

export class HsMissile {
  /**
   * @param o.pos,o.vel   where it leaves, and how fast (world, {x,y,z})
   * @param o.params      Rules.FLIGHT.player | threat | slow
   * @param o.target      see the header
   * @param o.owner       'me' | 'threat' | 'remote'
   * @param o.onEnd(m, why)  why: 'hit' | 'decoyed' | 'ground' | 'spent' | 'lost'
   * @param o.cosmetic    somebody else's: shown, never judged
   */
  constructor(o) {
    this.id = ++HS.idSeq;
    this.owner = o.owner || 'me';
    this.target = o.target;
    this.label = o.label || '';
    this.cosmetic = !!o.cosmetic;
    this.onEnd = o.onEnd || null;
    this.s = Rules.newMissile(o.pos, o.vel, o.params || Rules.FLIGHT.player);
    this.dead = false;
    this.why = null;
    this.puffT = 0;
    this.mesh = Fly.makeMissileMesh();
    this.flame = Fly.makeFlame(3.4);
    this.mesh.add(this.flame);
    this.mesh.position.set(o.pos.x, o.pos.y, o.pos.z);
    this.orient();
    if (HS.group) HS.group.add(this.mesh);
    this.first = true;
    /** Metres to its target as of the last step, and how fast it is closing: what a warning reads. */
    this.range = Infinity;
    this.closing = 0;
    /** True once a flare has pulled it off. */
    this.fooled = false;
    this.warned = false;
  }

  get pos() {
    return this.s;
  }

  orient() {
    const s = this.s;
    _dir.set(s.vx, s.vy, s.vz);
    if (_dir.lengthSq() > 1e-6) {
      _dir.normalize();
      this.mesh.quaternion.setFromUnitVectors(FWD, _dir);
    }
    this.mesh.position.set(s.x, s.y, s.z);
  }

  step(dt) {
    if (this.dead) return;
    const s = this.s;
    const t = this.target;
    const sees = t && t.aim ? t.aim(AIM) !== false : false;
    AIM.isTarget = true;
    let aim = sees ? AIM : null;
    if (sees) {
      const flares = flaresOf(t.owner);
      const hadDecoy = !!s.decoy;
      Rules.considerDecoys(s, AIM, flares, t.g ? t.g() : 0);
      if (s.decoy) {
        const d = s.decoy;
        aim = { x: d.x, y: d.y, z: d.z, vx: d.vx, vy: d.vy, vz: d.vz, isTarget: false };
        if (!hadDecoy) this.fooled = true;
      }
    }
    const rx = sees ? AIM.x - s.x : 0;
    const ry = sees ? AIM.y - s.y : 0;
    const rz = sees ? AIM.z - s.z : 0;
    const before = Math.hypot(rx, ry, rz);
    Rules.stepMissile(s, aim, dt, { groundAt: heightAt });
    if (sees) {
      const after = Math.hypot(AIM.x - s.x, AIM.y - s.y, AIM.z - s.z);
      this.range = after;
      this.closing = dt > 0 ? (before - after) / dt : 0;
    }
    this.orient();
    // Boost glow while the motor burns; none on the coast.
    this.flame.visible = s.t <= s.params.boostS;
    // The white trail, a puff every few metres of flight, spaced evenly across the step.
    if (HS.trails) {
      const size = s.t <= s.params.boostS ? 3.0 : 2.2;
      this.puffT += dt;
      const gap = 0.04;
      while (this.puffT >= gap) {
        this.puffT -= gap;
        const bx = s.x - s.vx * this.puffT - (s.vx / (s.speed || 1)) * 1.5;
        const by = s.y - s.vy * this.puffT - (s.vy / (s.speed || 1)) * 1.5;
        const bz = s.z - s.vz * this.puffT - (s.vz / (s.speed || 1)) * 1.5;
        HS.trails.emit(bx, by, bz, size, 3.4);
      }
    }
    if (s.result) this.end();
  }

  end() {
    if (this.dead) return;
    const s = this.s;
    let why = s.result;
    if (why === 'hit') why = s.hitTarget ? 'hit' : 'decoyed';
    else if (why === 'spent' && s.lost) why = 'lost';
    this.dead = true;
    this.why = why;
    const key = why === 'hit' ? 'hits' : why;
    HS.stats[key] = (HS.stats[key] || 0) + 1;
    say(`${this.owner}#${this.id} ${why} t=${s.t.toFixed(1)}s`);
    if (why === 'decoyed' || why === 'ground') {
      // A flare popped it, or it flew into the ground: a small bang, nothing near anybody.
      if (HS.sim) explode(HS.sim, standoff(HS.sim, { x: s.x, y: s.y, z: s.z }), { kind: 'airburst', size: why === 'decoyed' ? 0.38 : 0.3 });
    }
    this.removeMesh();
    if (this.onEnd) {
      try {
        this.onEnd(this, why);
      } catch (e) {
        console.warn('[heatseek] a missile\'s ending threw:', e);
      }
    }
  }

  removeMesh() {
    if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
    this.flame.material.dispose();
  }

  /** Taken out of the sky without an ending (a new flight, a quit). */
  dispose() {
    if (this.dead) return;
    this.dead = true;
    this.why = 'disposed';
    this.removeMesh();
  }
}

/** Launch one. Returns the HsMissile. */
export function launchMissile(o) {
  const m = new HsMissile(o);
  HS.missiles.push(m);
  HS.stats.launched++;
  say(`${m.owner}#${m.id} launched`);
  return m;
}

/* ------------------------------------------------------------------ *
 * Every frame
 * ------------------------------------------------------------------ */

/** Pixels per metre at one metre, for the smoke's point size. */
function pixelScale(sim) {
  try {
    const r = sim.renderer;
    const cam = sim.camera;
    if (!r || !cam) return 0;
    r.getDrawingBufferSize(_v2);
    return _v2.y / (2 * Math.tan((cam.fov * Math.PI) / 360));
  } catch (e) {
    return 0;
  }
}

export function updateWorld(dt, sim) {
  HS.clock += dt;
  stepFlares(dt);
  for (let i = 0; i < HS.missiles.length; i++) {
    const m = HS.missiles[i];
    if (!m.dead) m.step(dt);
  }
  for (let i = HS.missiles.length - 1; i >= 0; i--) if (HS.missiles[i].dead) HS.missiles.splice(i, 1);
  if (HS.trails) HS.trails.update(dt, pixelScale(sim));
}

/** Live missiles, optionally those a test says yes to. */
export function liveMissiles(fn) {
  return HS.missiles.filter((m) => !m.dead && (!fn || fn(m)));
}
