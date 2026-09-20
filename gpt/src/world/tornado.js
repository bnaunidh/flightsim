/**
 * A tornado.
 *
 * The other weather events change numbers — the wind, the cloud, the visibility.
 * A tornado is a *place*, and that is what makes it interesting to fly near:
 * you can see it, you can decide how close to go, and the air around it does
 * something violent and specific rather than generally worse.
 *
 * So this is two things kept in step:
 *
 *   what you see   a funnel of rotating dust that reaches from cloud to ground,
 *                  wider at the top, ragged at the bottom, with debris circling
 *                  the base and a dust skirt where it touches down
 *   what you feel  a vortex in the wind field — tangential flow around it,
 *                  inflow towards it and a violent updraught up the core, all
 *                  falling off with distance so that staying away really is the
 *                  answer
 *
 * It wanders across the map like a real one rather than standing still.
 */

import * as THREE from '../vendor/three.module.js';
import { heightAt, OBSTACLES } from './terrain.js';
import { fbm, clamp } from '../core/noise.js';

/**
 * The Enhanced Fujita scale.
 *
 * `windMs` is the real EF band's 3-second gust converted from mph to metres a
 * second; the rest is what that means in here — how wide the violent core is,
 * how far out you can feel it at all, how fat the funnel looks, and how much
 * of the airport it can pick up and throw.
 */
export const EF_SCALE = [
  { id: 0, label: 'EF0', windMs: 34, coreR: 90, reach: 900, girth: 0.62, debris: 3, damage: 'Branches down, a few tiles off' },
  { id: 1, label: 'EF1', windMs: 44, coreR: 110, reach: 1150, girth: 0.8, debris: 6, damage: 'Roofs stripped, light aircraft flipped' },
  { id: 2, label: 'EF2', windMs: 55, coreR: 130, reach: 1400, girth: 1.0, debris: 10, damage: 'Roofs torn off, large trees snapped' },
  { id: 3, label: 'EF3', windMs: 67, coreR: 165, reach: 1750, girth: 1.28, debris: 16, damage: 'Whole storeys destroyed, heavy cars thrown' },
  { id: 4, label: 'EF4', windMs: 81, coreR: 205, reach: 2150, girth: 1.6, debris: 24, damage: 'Well-built houses levelled' },
  { id: 5, label: 'EF5', windMs: 98, coreR: 255, reach: 2600, girth: 2.0, debris: 34, damage: 'Everything swept away' },
];

/** Weak ones are common, violent ones are rare — as in life. */
function weightedRating() {
  const r = Math.random();
  return r < 0.3 ? 0 : r < 0.58 ? 1 : r < 0.8 ? 2 : r < 0.93 ? 3 : r < 0.985 ? 4 : 5;
}

/** How far out the wind is affected at all. */
const REACH = 1400;
/** Radius of the core, where the wind is strongest. */
const CORE = 130;

function dustTexture() {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const img = g.createImageData(S, S);
  const d = img.data;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      // Streaks that wrap horizontally, so the funnel can spin without a seam.
      const n1 = fbm(x / 14, y / 42, { octaves: 4, seed: 91 });
      const n2 = fbm((x - S) / 14, y / 42, { octaves: 4, seed: 91 });
      const t = clamp((x / S - 0.7) / 0.3, 0, 1);
      const n = n1 * (1 - t) + n2 * t;
      const i = (y * S + x) * 4;
      const shade = 120 + n * 90;
      d[i] = shade;
      d[i + 1] = shade * 0.94;
      d[i + 2] = shade * 0.88;
      // Denser in the middle of the column, thinning at the edges.
      d[i + 3] = clamp(n * 2.1 - 0.25, 0, 1) * 255;
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class Tornado {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'tornado';
    this.group.visible = false;
    this.active = false;
    this.t = 0;
    this.pos = new THREE.Vector3();
    this.drift = new THREE.Vector3();
    this.strength = 0;
    this.girth = this.girth || 1;

    const tex = dustTexture();
    this.tex = tex;

    // The funnel: three nested cones, each spinning at its own rate, which is
    // what stops it reading as one solid painted shape.
    this.shells = [];
    for (let i = 0; i < 3; i++) {
      // Taller and denser than it was. It renders fine — measured — but at a
      // couple of kilometres a thin, pale, thousand-metre funnel is genuinely
      // hard to pick out of a bright sky, and "I cannot see the storm" is the
      // same bug as "it is not there".
      const geo = new THREE.CylinderGeometry(190 - i * 30, 42 - i * 9, 1600, 26, 8, true);
      const mat = new THREE.MeshBasicMaterial({
        map: tex.clone(),
        color: 0x6b6259,
        transparent: true,
        opacity: 0.62 - i * 0.1,
        depthWrite: false,
        side: THREE.DoubleSide,
        fog: true,
      });
      mat.map.wrapS = mat.map.wrapT = THREE.RepeatWrapping;
      mat.map.repeat.set(2 + i, 1);
      const m = new THREE.Mesh(geo, mat);
      m.position.y = 800;
      this.group.add(m);
      this.shells.push({ mesh: m, spin: 1.7 + i * 0.55, scroll: 0.35 + i * 0.12, base: 0.62 - i * 0.1 });
    }

    // Dust skirt where it touches the ground.
    const skirtGeo = new THREE.CylinderGeometry(230, 120, 90, 24, 1, true);
    this.skirt = new THREE.Mesh(
      skirtGeo,
      new THREE.MeshBasicMaterial({
        map: tex.clone(),
        transparent: true,
        opacity: 0.4,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
    );
    this.skirt.material.map.wrapS = THREE.RepeatWrapping;
    this.skirt.material.map.repeat.set(4, 1);
    this.skirt.position.y = 45;
    this.group.add(this.skirt);

    // Debris circling the base.
    //
    // Two sets: dirt and scrub it picks up anywhere, and — when it crosses the
    // airfield — bigger, brighter wreckage torn off the apron. A tornado that
    // goes through an airport and carries nothing but soil is a tornado you do
    // not believe in.
    this.debris = [];
    const debrisMat = new THREE.MeshBasicMaterial({ color: 0x4a4038 });
    const debrisGeo = new THREE.BoxGeometry(4, 1.2, 2.4);
    this.debrisMesh = new THREE.InstancedMesh(debrisGeo, debrisMat, 60);
    this.debrisMesh.frustumCulled = false;
    for (let i = 0; i < 60; i++) {
      this.debris.push({
        angle: Math.random() * Math.PI * 2,
        radius: 60 + Math.random() * 240,
        height: Math.random() * 420,
        rate: 1.1 + Math.random() * 1.6,
        rise: 6 + Math.random() * 22,
        spin: Math.random() * 6,
      });
    }
    this.group.add(this.debrisMesh);

    // Airport wreckage: panels, roofing, a cone or two, a baggage cart.
    this.junk = [];
    this.junkMeshes = [];
    const junkColours = [0xd8dde2, 0xf0561d, 0xf2c53d, 0x8d949c, 0x2f6fb0, 0xc23a2b];
    for (let i = 0; i < 26; i++) {
      const w = 2.5 + Math.random() * 9;
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(w, 0.4 + Math.random() * 1.6, 1.5 + Math.random() * 5),
        new THREE.MeshStandardMaterial({
          color: junkColours[i % junkColours.length],
          roughness: 0.7,
          metalness: 0.3,
          side: THREE.DoubleSide,
        })
      );
      m.visible = false;
      m.castShadow = true;
      this.group.add(m);
      this.junkMeshes.push(m);
      this.junk.push({
        angle: Math.random() * Math.PI * 2,
        radius: 40 + Math.random() * 200,
        height: -1,
        rate: 0.9 + Math.random() * 1.4,
        rise: 10 + Math.random() * 26,
        tumble: new THREE.Vector3(Math.random() * 5, Math.random() * 5, Math.random() * 5),
      });
    }
    /** How much airport it is currently carrying, 0..1. */
    this.carrying = 0;

    scene.add(this.group);
  }

  /** Put one down near — but not on top of — the aeroplane. */
  spawn(nearPos, seconds = 150, ef = null) {
    const a = Math.random() * Math.PI * 2;
    // Close enough that you cannot miss it, far enough that it is not on top
    // of you before you have seen it.
    const dist = 850 + Math.random() * 700;
    this.pos.set(nearPos.x + Math.cos(a) * dist, 0, nearPos.z + Math.sin(a) * dist);
    // It wanders. Real ones track with the storm rather than sitting still.
    const dA = Math.random() * Math.PI * 2;
    this.drift.set(Math.cos(dA) * 14, 0, Math.sin(dA) * 14);
    this.active = true;
    this.group.visible = true;
    this.t = 0;
    this.life = seconds;
    this.strength = 0;
    // Pick a rating. Left to itself the weaker ones are far commoner, which is
    // true of real tornadoes — an EF4 should feel like a bad day, not Tuesday.
    this.setRating(ef === null || ef === undefined ? weightedRating() : ef);
    return this.pos.clone();
  }

  /**
   * Set the Enhanced Fujita rating, and with it everything that follows from
   * it: how fast the wind turns, how wide the core is, how far out you can
   * feel it, how big the funnel looks and how much of the airport it takes.
   *
   * The numbers are the real EF wind bands, converted from the 3-second gust
   * in mph that the scale is defined in.
   */
  setRating(ef) {
    this.ef = clamp(Math.round(ef), 0, 5);
    const band = EF_SCALE[this.ef];
    this.label = band.label;
    this.peakWind = band.windMs;
    this.coreR = band.coreR;
    this.reach = band.reach;
    this.debrisCount = band.debris;
    /*
     * The funnel gets visibly fatter with the rating — an EF5 is not a thin
     * rope, and you should be able to tell what is coming.
     *
     * Kept as its own number rather than written straight onto the group,
     * because update() does scale.setScalar() every frame for the spin-up,
     * which is all three axes — so the girth was wiped one frame after it was
     * set and every rating looked identical.
     */
    this.girth = band.girth;
    return this.ef;
  }

  clear() {
    this.active = false;
    this.group.visible = false;
    this.strength = 0;
  }

  /**
   * The extra wind at a point, in world metres per second.
   *
   * Three parts, which is what a vortex actually is: flow *around* the core,
   * flow *towards* it, and a violent updraught in the middle. Written into
   * `out` so the flight model can add it without allocating every frame.
   */
  windAt(p, out) {
    out.set(0, 0, 0);
    if (!this.active || this.strength <= 0) return out;
    const core = this.coreR || CORE;
    const reach = this.reach || REACH;
    const peak = this.peakWind || 46;
    const dx = p.x - this.pos.x;
    const dz = p.z - this.pos.z;
    const r = Math.hypot(dx, dz);
    if (r > reach) return out;

    /*
     * Peaks at the core radius and falls off outside it, like a real vortex.
     *
     * Inside the core the ramp used to be linear, which made the middle of a
     * tornado the calmest place in it — you could fly through the centre and
     * barely notice. A square root keeps a small quiet eye but has the wind
     * up to full strength almost immediately, so the closer you get the worse
     * it gets, right up to the wall. Outside, a slower decay (0.7 rather than
     * 0.85) means the thing still has teeth at a distance.
     */
    const falloff = r < core ? Math.sqrt(r / core) : Math.pow(core / r, 0.7);
    const v = peak * this.strength * falloff;
    const nx = dx / (r || 1);
    const nz = dz / (r || 1);
    // Tangential: perpendicular to the radius, which is the spin.
    out.x += -nz * v;
    out.z += nx * v;
    // Inflow: sucked towards the core, and harder the nearer you are — this is
    // what makes it a trap rather than an obstacle. Get close and it takes you.
    const pull = 0.32 + 0.5 * clamp(1 - r / (core * 3), 0, 1);
    out.x += -nx * v * pull;
    out.z += -nz * v * pull;
    // Updraught, strongest in the middle and only in the lower few thousand feet.
    const high = clamp(1 - p.y / 2600, 0, 1);
    out.y += peak * 0.72 * this.strength * (r < core * 2.2 ? 1 - r / (core * 2.2) : 0) * high;
    return out;
  }

  /** How hard it is hitting you, 0..1 — for the warning and the buffeting. */
  proximity(p) {
    if (!this.active) return 0;
    const r = Math.hypot(p.x - this.pos.x, p.z - this.pos.z);
    return clamp(1 - r / (this.reach || REACH), 0, 1);
  }

  /**
   * How far inside the violent part you are, 0..1, where 1 is the core wall.
   *
   * Separate from `proximity` on purpose: proximity is the whole reach and is
   * what the warning uses, this is the part that hurts and is what the damage
   * uses. Flying into an EF4 should not be survivable just because you kept
   * the wings level.
   */
  bite(p) {
    if (!this.active) return 0;
    const core = this.coreR || CORE;
    const r = Math.hypot(p.x - this.pos.x, p.z - this.pos.z);
    return clamp(1 - r / (core * 2.4), 0, 1) * this.strength;
  }

  update(dt) {
    if (!this.active) return;
    this.t += dt;
    // Spins up over the first few seconds and dies away at the end, rather
    // than snapping into existence at full power.
    const f = this.t / this.life;
    this.strength = clamp(Math.min(this.t / 6, 1) * (1 - clamp((f - 0.82) / 0.18, 0, 1)), 0, 1);
    if (this.t > this.life) {
      this.clear();
      return;
    }

    this.pos.addScaledVector(this.drift, dt);
    const ground = heightAt(this.pos.x, this.pos.z);
    this.group.position.set(this.pos.x, Math.max(0, ground), this.pos.z);
    // Spin-up on all three axes, girth on the two horizontal ones.
    const grow = 0.55 + this.strength * 0.45;
    const girth = this.girth || 1;
    this.group.scale.set(girth * grow, grow, girth * grow);

    for (const s of this.shells) {
      s.mesh.rotation.y += s.spin * dt;
      s.mesh.material.map.offset.y -= s.scroll * dt;
      s.mesh.material.opacity = s.base * this.strength;
    }
    this.skirt.rotation.y -= 2.4 * dt;
    this.skirt.material.map.offset.x += 0.6 * dt;
    this.skirt.material.opacity = 0.4 * this.strength;

    const d = new THREE.Object3D();
    for (let i = 0; i < this.debris.length; i++) {
      const b = this.debris[i];
      b.angle += b.rate * dt * (1 + 60 / (b.radius + 40));
      b.height += b.rise * dt;
      if (b.height > 620) {
        b.height = 0;
        b.radius = 60 + Math.random() * 240;
      }
      // Debris spirals inwards as it climbs, which is what makes the shape read.
      const r = b.radius * (1 - b.height / 900);
      d.position.set(Math.cos(b.angle) * r, b.height + 6, Math.sin(b.angle) * r);
      d.rotation.set(b.spin + b.angle, b.angle * 1.7, b.spin * 0.6);
      d.scale.setScalar(this.strength);
      d.updateMatrix();
      this.debrisMesh.setMatrixAt(i, d.matrix);
    }
    this.debrisMesh.instanceMatrix.needsUpdate = true;

    /* ---- Airport wreckage ---- */
    // Anything solid it is standing on gets torn up and carried. The apron and
    // the buildings all register obstacles, so that list is exactly "the built
    // parts of the airfield" without the tornado needing to know about any of
    // them individually.
    const overBuilt = OBSTACLES.some(
      (o) =>
        this.pos.x > o.x0 - 260 && this.pos.x < o.x1 + 260 && this.pos.z > o.z0 - 260 && this.pos.z < o.z1 + 260
    );
    const want = overBuilt ? 1 : 0;
    this.carrying += (want - this.carrying) * Math.min(1, dt * (overBuilt ? 0.6 : 0.12));

    for (let i = 0; i < this.junk.length; i++) {
      const j = this.junk[i];
      const mesh = this.junkMeshes[i];
      // Pieces only exist while there is something to tear up, and they keep
      // circling for a while after it has moved on.
      if (j.height < 0) {
        if (this.carrying > Math.random() * 1.4) {
          j.height = 2;
          j.radius = 40 + Math.random() * 200;
          j.angle = Math.random() * Math.PI * 2;
        } else {
          mesh.visible = false;
          continue;
        }
      }
      mesh.visible = true;
      j.angle += j.rate * dt * (1 + 70 / (j.radius + 40));
      j.height += j.rise * dt;
      if (j.height > 900) j.height = -1;
      const r = j.radius * (1 - j.height / 1300);
      mesh.position.set(Math.cos(j.angle) * r, j.height, Math.sin(j.angle) * r);
      mesh.rotation.x += j.tumble.x * dt;
      mesh.rotation.y += j.tumble.y * dt;
      mesh.rotation.z += j.tumble.z * dt;
      mesh.scale.setScalar(this.strength);
    }
  }
}
