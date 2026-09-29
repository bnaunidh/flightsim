/**
 * The water: how it gets aboard, how it comes out, and where it lands.
 *
 * TWO WAYS TO CARRY IT.
 *
 * The Skyhook carries a BUCKET on an 18 m line. It swings (a pendulum solved
 * as a position constraint, so the line never stretches and never needs a
 * spring constant tuned), and it fills when the bucket itself is under the
 * surface of the sea — so the thing you actually do is the thing real crews
 * do: come to a low, slow hover over the water, low enough for the bucket to
 * dip, and wait for it. 18 m of line plus the belly puts the skids about
 * twenty metres up when it dips: under 65 ft on the altimeter.
 *
 * An aeroplane carries a SCOOPING TANK. It fills while it skims the sea:
 * over open water, under 100 ft, flaps out, at a moderate speed and wings
 * level. The speed band is worked out from the aeroplane's own full-flap
 * stall speed (performanceFor in types.js) — 1.1x to 2.4x of it, which on the
 * Tempest is 72 to 156 kt and on the Skylark 44 to 96 — so it is the same
 * instruction whatever you fly. It does not touch the water: in this game the
 * sea is a crash (physics.js, "You flew into the sea"), so the probe is
 * imaginary and the height band is the honest compromise.
 *
 * HOW MUCH. The bucket holds 320 L. That number is set by the rotor, not by
 * taste: ROTOR_TUNE.maxLift is 1.3 x the machine's weight, and 320 kg on a
 * 2,200 kg Skyhook leaves 1.13 x — it still climbs with a full bucket, a
 * little slower, which is exactly the feeling you want. The scooping tank is
 * a fifth of the aeroplane's mass, 250 L to 3,000 L; the Tempest's is
 * 2,700 L. The load goes on as ac.extraMass, added and taken off as a
 * DIFFERENCE so it never tramples anybody else's use of that field.
 *
 * WHERE IT LANDS. Water leaves as a stream of parcels, one every 60 ms, each
 * carried along at the aircraft's speed, pulled down by gravity and slowed by
 * the air (k = 0.7/s — water breaks up into rain and stops dead quickly).
 * From 100 ft at 90 kt that puts it about sixty metres ahead of where you let
 * go, which is why real tankers release early. Each parcel that reaches the
 * ground puts the fire out in a disc and soaks a ring round it. A tanker
 * lays a long line (the parcels are spread along its track); a helicopter
 * dumps a round splash. Dropped from too high it turns to mist: full effect
 * below 200 ft, fading to a third by 800 ft.
 */

import * as THREE from '../../vendor/three.module.js';
import { heightAt } from '../../world/terrain.js';
import { performanceFor } from '../../aircraft/types.js';

export const BUCKET_LINE = 18;
const DRAG = 0.7;
const G = 9.81;
const KTS = 1.94384;
const FT = 3.28084;

/** What this aircraft carries, from its roster entry. */
export function tankSpec(type) {
  const rotor = !!(type && type.shape && type.shape.power && type.shape.power.rotor);
  if (rotor) {
    return { kind: 'bucket', capacity: 320, releaseTime: 0.9, radius: 36, fillSeconds: 3.2, vmin: 0, vmax: 0 };
  }
  const mass = (type && type.aero && type.aero.mass) || 1100;
  const cap = Math.round(Math.min(3000, Math.max(250, mass * 0.2)) / 50) * 50;
  let stall = 50;
  try {
    stall = performanceFor(type.id).stallLanding || 50;
  } catch (e) {
    /* an aeroplane the roster does not know keeps the default band */
  }
  return {
    kind: 'scooper',
    capacity: cap,
    releaseTime: 1 + cap / 1400,
    radius: 22 + 8 * Math.sqrt(cap / 2500),
    fillSeconds: 6,
    vmin: Math.max(40, Math.round(stall * 1.1)),
    vmax: Math.round(stall * 2.4),
  };
}

/**
 * Where a parcel of water let go at `p` with velocity `v` would come down.
 * Integrates the same equation the parcels do. Writes into `out` and returns
 * the seconds it took.
 */
export function predictLanding(p, v, wind, floor, out) {
  let x = p.x;
  let y = p.y;
  let z = p.z;
  let vx = v.x;
  let vy = v.y;
  let vz = v.z;
  const dt = 0.05;
  let t = 0;
  for (; t < 14; t += dt) {
    vx += (wind.x - vx) * DRAG * dt;
    vz += (wind.z - vz) * DRAG * dt;
    vy += (-G - vy * DRAG) * dt;
    x += vx * dt;
    y += vy * dt;
    z += vz * dt;
    if (y <= floor(x, z)) break;
  }
  out.x = x;
  out.y = y;
  out.z = z;
  return t;
}

/* ------------------------------------------------------------------ */

export class WaterTank {
  constructor(type) {
    const s = tankSpec(type);
    Object.assign(this, s);
    this.litres = 0;
    this.filling = false;
    this.fillWhy = '';
    this.releasing = false;
    this.relRate = 0;
    this.relAcc = 0;
    this.massApplied = 0;
    this.drops = 0;
    this.dropId = 0;
    this.lastResult = null;
    // Parcels in flight.
    this.parcels = [];
    for (let i = 0; i < 64; i++) {
      this.parcels.push({ live: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, strength: 1, r: 30, id: 0 });
    }
    this.pending = []; // per-drop tallies
    this._v = new THREE.Vector3();
    this._o = new THREE.Vector3();
  }

  get fraction() {
    return this.capacity ? this.litres / this.capacity : 0;
  }

  /** Keep ac.extraMass in step with what is aboard. */
  applyMass(ac) {
    if (!ac) return;
    const want = this.litres; // a litre of water is a kilogram
    const d = want - this.massApplied;
    if (Math.abs(d) < 0.5) return;
    ac.extraMass = Math.max(0, (ac.extraMass || 0) + d);
    this.massApplied = want;
  }

  /** Take our weight back off, when the tank goes away. */
  removeMass(ac) {
    if (ac && this.massApplied) ac.extraMass = Math.max(0, (ac.extraMass || 0) - this.massApplied);
    this.massApplied = 0;
  }

  /**
   * Is the water coming in? Sets `filling` and, when not, `fillWhy` — the one
   * thing to change, in the words the HUD shows.
   * @param bucketPos  Vector3 of the bucket, for the helicopter
   */
  checkFill(ac, bucketPos) {
    this.filling = false;
    this.fillWhy = '';
    if (this.releasing || this.litres >= this.capacity - 0.5) return false;
    if (this.kind === 'bucket') {
      const b = bucketPos;
      if (!b) return false;
      const sea = heightAt(b.x, b.z) < -1.5;
      // Above the sea surface. Not ac.agl: over the sea that is measured
      // from the sea BED, forty metres down off Firewatch, so the radar
      // altimeter reads 190 ft at the height the bucket dips.
      const hw = ac.pos.y;
      if (!sea) {
        this.fillWhy = heightAt(ac.pos.x, ac.pos.z) < -1.5 ? 'Get the bucket over open water' : '';
        return false;
      }
      if (b.y > 0.7) {
        this.fillWhy = hw < 120
          ? `Lower — you are ${Math.round(hw * FT)} ft above the water. Under 60 ft and the bucket dips in`
          : '';
        return false;
      }
      if (ac.groundSpeed > 14) {
        this.fillWhy = `Slow down — hover while it fills (${Math.round(ac.groundSpeed * KTS)} kt)`;
        return false;
      }
      this.filling = true;
      return true;
    }
    // Scooper.
    const p = ac.pos;
    const f = ac.forward ? ac.forward(this._v) : null;
    const aheadX = f ? p.x + f.x * 40 : p.x;
    const aheadZ = f ? p.z + f.z * 40 : p.z;
    const sea = heightAt(p.x, p.z) < -2 && heightAt(aheadX, aheadZ) < -2;
    const hw = p.y;
    if (!sea) return false;
    if (hw > 150) return false; // not trying
    const kts = ac.ias * KTS;
    // The panel says 100 ft; it fills to 118. A child holding 105 ft over the
    // sea in a heavy twin is doing the thing right, and should be told so.
    if (hw > 36) {
      this.fillWhy = `Lower — skim under 100 ft (you are at ${Math.round(hw * FT)} ft)`;
      return false;
    }
    if ((ac.flapStep ? ac.flapStep() : 0) < 1) {
      this.fillWhy = 'Flaps out — press F';
      return false;
    }
    if (kts < this.vmin) {
      this.fillWhy = `Faster — keep above ${this.vmin} kt`;
      return false;
    }
    if (kts > this.vmax) {
      this.fillWhy = `Slower — under ${this.vmax} kt`;
      return false;
    }
    const bank = ac.bankAngleDeg ? Math.abs(ac.bankAngleDeg()) : 0;
    if (bank > 25) {
      this.fillWhy = 'Wings level to scoop';
      return false;
    }
    this.filling = true;
    return true;
  }

  fill(dt) {
    if (!this.filling) return 0;
    const before = this.litres;
    this.litres = Math.min(this.capacity, this.litres + (this.capacity / this.fillSeconds) * dt);
    return this.litres - before;
  }

  /** X. Returns 'dropped' | 'empty' | 'busy'. */
  release() {
    if (this.releasing) return 'busy';
    if (this.litres < this.capacity * 0.05) return 'empty';
    this.releasing = true;
    this.relRate = this.litres / (this.releaseTime * Math.max(0.35, this.fraction));
    this.relAcc = 0;
    this.dropId = (this.dropId + 1) & 0xffff || 1;
    this.drops++;
    this.pending.push({ id: this.dropId, parcels: 0, landed: 0, doused: 0, wetted: 0, onLand: 0, sea: 0, agl: 0, hit: false });
    return 'dropped';
  }

  /**
   * Let water out while releasing. `origin` and `vel` are where it leaves
   * from and how fast; `agl` is how high that is above the ground below.
   * Calls emit(parcel) for each new parcel so the painter can spray.
   */
  emitParcels(dt, origin, vel, agl, emit) {
    if (!this.releasing) return;
    this.relAcc += dt;
    const every = 0.06;
    const tally = this.pending[this.pending.length - 1];
    while (this.relAcc >= every && this.litres > 0) {
      this.relAcc -= every;
      const vol = Math.min(this.litres, this.relRate * every);
      this.litres -= vol;
      let p = null;
      for (let k = 0; k < this.parcels.length; k++) {
        if (!this.parcels[k].live) {
          p = this.parcels[k];
          break;
        }
      }
      if (!p) continue;
      p.live = true;
      p.x = origin.x;
      p.y = origin.y;
      p.z = origin.z;
      p.vx = vel.x;
      p.vy = vel.y - 2.5;
      p.vz = vel.z;
      // Full strength under 200 ft, a third by 800 ft; and it spreads a little.
      const hFt = agl * FT;
      p.strength = hFt <= 200 ? 1 : Math.max(0.3, 1 - ((hFt - 200) / 600) * 0.7);
      p.r = this.radius * (1 + Math.min(0.5, Math.max(0, (hFt - 200) / 1200)));
      p.id = this.dropId;
      if (tally) {
        tally.parcels++;
        tally.agl = Math.max(tally.agl, agl);
      }
      if (emit) emit(p);
    }
    if (this.litres <= 0.01) {
      this.litres = 0;
      this.releasing = false;
    }
  }

  /**
   * Move parcels; call land(parcel, onLand) for each that comes down, where
   * onLand is true over ground and false over the sea.
   */
  updateParcels(dt, wind, floor, land) {
    for (const p of this.parcels) {
      if (!p.live) continue;
      p.vx += (wind.x - p.vx) * DRAG * dt;
      p.vz += (wind.z - p.vz) * DRAG * dt;
      p.vy += (-G - p.vy * DRAG) * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      const fy = floor(p.x, p.z);
      if (p.y <= fy) {
        p.live = false;
        p.y = fy;
        land(p, heightAt(p.x, p.z) > 0.3);
      }
    }
  }

  get inFlight() {
    for (const p of this.parcels) if (p.live) return true;
    return false;
  }
}

/* ------------------------------------------------------------------ */

/**
 * The bucket on its line, for the helicopter: a swinging weight you can see
 * and a position the fill test reads.
 */
export class BucketRig {
  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'wildfire-bucket';
    const shell = new THREE.CylinderGeometry(1.15, 0.8, 1.7, 14, 1, true);
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xd9531e, roughness: 0.7, side: THREE.DoubleSide });
    this.body = new THREE.Mesh(shell, bodyMat);
    const bottom = new THREE.Mesh(new THREE.CircleGeometry(0.8, 14), bodyMat);
    bottom.rotation.x = Math.PI / 2;
    bottom.position.y = -0.85;
    const waterMat = new THREE.MeshStandardMaterial({ color: 0x3a8fd0, roughness: 0.2, metalness: 0.1 });
    this.water = new THREE.Mesh(new THREE.CircleGeometry(1.05, 14), waterMat);
    this.water.rotation.x = -Math.PI / 2;
    this.water.visible = false;
    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(1.15, 0.07, 6, 18),
      new THREE.MeshStandardMaterial({ color: 0x2b2b2b, roughness: 0.6 })
    );
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.85;
    this.bucket = new THREE.Group();
    this.bucket.add(this.body, bottom, this.water, rim);
    this.group.add(this.bucket);
    const lg = new THREE.BufferGeometry();
    this.linePos = new THREE.BufferAttribute(new Float32Array(6), 3).setUsage(THREE.DynamicDrawUsage);
    lg.setAttribute('position', this.linePos);
    this.line = new THREE.Line(lg, new THREE.LineBasicMaterial({ color: 0x1b1b1b }));
    this.line.frustumCulled = false;
    this.group.add(this.line);

    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.prev = new THREE.Vector3();
    this.hook = new THREE.Vector3();
    this._d = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0);
    this.ready = false;
  }

  /**
   * Hang it straight down under the machine, at rest — or, on the ground,
   * lying behind it on its line. Straight down from a machine sitting on its
   * skids put the bucket inside the fuselage.
   */
  reset(ac) {
    this.hookOf(ac);
    this.pos.copy(this.hook);
    this.pos.y -= BUCKET_LINE;
    const ground = heightAt(this.pos.x, this.pos.z);
    const floorY = Math.max(0, ground) + 0.9;
    if (ground < 0) {
      // Over the sea it hangs in the water, not on it.
      if (this.pos.y < -0.55) this.pos.y = -0.55;
    } else if (this.pos.y < floorY) {
      // Behind, along the tail: +Z in the body frame.
      this._d.set(0, 0, 1).applyQuaternion(ac.quat);
      this._d.y = 0;
      if (this._d.lengthSq() < 1e-6) this._d.set(0, 0, 1);
      this._d.normalize();
      const back = Math.sqrt(Math.max(0, BUCKET_LINE * BUCKET_LINE - (this.hook.y - floorY) ** 2)) * 0.8;
      this.pos.set(this.hook.x + this._d.x * back, 0, this.hook.z + this._d.z * back);
      this.pos.y = Math.max(0, heightAt(this.pos.x, this.pos.z)) + 0.9;
    }
    this.vel.set(0, 0, 0);
    this.ready = true;
  }

  hookOf(ac) {
    this.hook.set(0, -1.7, 0.2).applyQuaternion(ac.quat).add(ac.pos);
    return this.hook;
  }

  update(dt, ac, wind, floor, fill01) {
    if (!this.ready) this.reset(ac);
    this.hookOf(ac);
    const steps = Math.max(1, Math.ceil(dt / (1 / 60)));
    const h = dt / steps;
    for (let s = 0; s < steps; s++) {
      this.prev.copy(this.pos);
      this.vel.x += (wind.x - this.vel.x) * 0.35 * h;
      this.vel.z += (wind.z - this.vel.z) * 0.35 * h;
      this.vel.y += -G * h;
      this.pos.addScaledVector(this.vel, h);
      const d = this._d.subVectors(this.pos, this.hook);
      const len = d.length();
      const taut = len > BUCKET_LINE;
      if (taut) this.pos.copy(this.hook).addScaledVector(d, BUCKET_LINE / len);
      // Sits in the water up to its rim; rests on the ground.
      const g = floor(this.pos.x, this.pos.z);
      let resting = false;
      if (g <= 0.01) {
        if (this.pos.y < -0.55) this.pos.y = -0.55;
      } else if (this.pos.y < g + 0.85) {
        this.pos.y = g + 0.85;
        resting = true;
      }
      // Lying on the ground it does not blow away: the wind term above is
      // air drag, and a bucket on grass has friction instead.
      if (resting && !taut) this.pos.set(this.prev.x + (this.pos.x - this.prev.x) * 0.1, this.pos.y, this.prev.z + (this.pos.z - this.prev.z) * 0.1);
      this.vel.subVectors(this.pos, this.prev).divideScalar(h);
      if (this.pos.y < 0.3 && g <= 0.01) this.vel.multiplyScalar(Math.max(0, 1 - 2.5 * h));
    }
    this.bucket.position.copy(this.pos);
    const dir = this._d.subVectors(this.hook, this.pos);
    if (dir.lengthSq() > 1e-6) this.bucket.quaternion.setFromUnitVectors(this._up, dir.normalize());
    this.water.visible = fill01 > 0.02;
    this.water.position.y = -0.8 + 1.55 * Math.min(1, fill01);
    const a = this.linePos.array;
    a[0] = this.hook.x;
    a[1] = this.hook.y;
    a[2] = this.hook.z;
    a[3] = this.pos.x + dir.x * 0.85;
    a[4] = this.pos.y + dir.y * 0.85;
    a[5] = this.pos.z + dir.z * 0.85;
    this.linePos.needsUpdate = true;
  }
}
