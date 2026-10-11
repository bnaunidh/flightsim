/**
 * The ambient air layer: helicopters on a light orbit-and-transit stepper,
 * and en-route aeroplanes on the roles' NpcFlyer. Also the emergency scene's
 * helicopters (../emergency-scene.js borrows HeliFlyer).
 *
 * THE RULES every flyer keeps, measured every frame and proved for every map
 * by tests/features/ambient.mjs's soak:
 *
 *   FLOOR       never under FLOOR_AGL (150 m) over the ground ahead — the
 *               ground along the next 20 s of flight, not just underneath —
 *               plus 60 m over any obstacle box within 300 m (a tower, a
 *               shelter). A medevac on final to its own pad is the one
 *               exception, and only while the player is 1.5 km away.
 *   CORRIDOR    never under CORRIDOR_MIN (600 m) above the field inside the
 *               player's runway approach corridors (CORRIDOR / CORRIDOR2
 *               boxes), nor within 15 s of entering one.
 *   SEPARATION  at least SEP (300 m) from the player's 20-second predicted
 *               path, the traffic's rule: when the predicted miss is under
 *               SEP_WANT it turns away and changes height.
 *   NO-FLY      circles handed in (an emergency scene's 3x radius, a
 *               thinAround) are kept out of.
 *   RUNWAYS     never: the orbits and transits are in the data, and nothing
 *               here lands except the medevac, on a pad.
 *
 * Each flyer is a SOLID SKY BODY in single player (sky.js registerBody,
 * kind 'npc', rotor:true for a helicopter, crew 2): the minimap draws it
 * with no change of its own, and flying into it is a mid-air bump that
 * knocks it down — it falls, spinning, its crew out under parachutes (the
 * sky's doing), and is gone when it reaches the ground. Nobody is hurt.
 *
 * Nothing is allocated per frame: the scratch vectors live at module scope
 * and every flyer owns its own.
 */

import * as THREE from '../../vendor/three.module.js';
import { heightAt, OBSTACLES, AIRPORT, CORRIDOR, CORRIDOR2 } from '../../world/terrain.js';
import { createAircraftModel } from '../../aircraft/model-adapter.js';
import { AIRCRAFT, getAircraft } from '../../aircraft/types.js';
import { registerBody, unregisterBody, radiusOfType } from '../sky.js';
import { NpcFlyer } from '../../game/roles/npc-flyer.js';
import * as LOD from '../traffic/lod.js';

/** Beyond this a flyer's model is not drawn (the traffic's own figure); it is still a body. */
export const DRAW_FAR = 3600;
/**
 * Small parts (lamps, aerials, wheels) are hidden beyond DETAIL_NEAR; parts
 * under 4 m beyond DETAIL_FAR (a helicopter's skids, tail rotor and mast are
 * under a pixel there); and beyond DETAIL_SPECK, where an aircraft is a few
 * pixels, only the parts over 8 m (wings, body, the rotor disc) are drawn.
 * Measured on Fjord's town at Medium: the rescue helicopter at 1.6 km was 13
 * draws with the 2.5 m rule.
 */
const DETAIL_NEAR = 400;
const DETAIL_FAR = 1200;
const DETAIL_SPECK = 2000;
/** Parts up to this size are on the list showParts() may hide. */
const SMALL_PART = 10;
/** Nearer than this it casts a shadow (the traffic's figure): a second draw of every part otherwise. */
const SHADOW_NEAR = 350;

/**
 * Fewer draw calls for a flyer's model, the traffic's way (traffic/lod.js):
 * the parts that never move baked into one mesh per material, the small
 * parts hidden at range. Returns the small-parts list for showParts(), or
 * null. The fleet pack's aeroplanes are left whole (their crash code breaks
 * them up by the part), as the traffic leaves them.
 */
function bakeModel(m) {
  if (!m) return null;
  try {
    const probe = LOD.probeMotion(m, THREE);
    if (!m.userData.fleetBridge) LOD.mergeStatic(m, THREE, probe);
    return LOD.smallParts(m, THREE, probe.shownBySelf, SMALL_PART);
  } catch (e) {
    return null;
  }
}

/** Every mesh of a model, listed once, for the shadow switch. */
function meshesOf(m) {
  const out = [];
  if (m) m.traverse((o) => { if (o.isMesh) out.push(o); });
  return out;
}

function setShadows(f, on) {
  if (f._shadows === on || !f._meshes) return;
  f._shadows = on;
  for (let i = 0; i < f._meshes.length; i++) f._meshes[i].castShadow = on;
}

/** Draw or not by distance from the camera, how much of it, and whether it casts a shadow. */
function lodModel(f, cam) {
  const m = f.model;
  if (!m || !cam) return;
  const d = Math.hypot(f.pos.x - cam.x, f.pos.y - cam.y, f.pos.z - cam.z);
  const near = d < DRAW_FAR;
  if (m.visible !== near) m.visible = near;
  if (!near) return;
  setShadows(f, d < SHADOW_NEAR);
  const tier = d < DETAIL_NEAR ? 0 : d < DETAIL_FAR ? 1 : d < DETAIL_SPECK ? 2 : 3;
  if (f._tier !== tier && f._small) {
    f._tier = tier;
    LOD.showParts(f._small, tier === 0 ? 0 : tier === 1 ? 0.9 : tier === 2 ? 4 : 8);
  }
}

export const FLOOR_AGL = 150;
export const CORRIDOR_MIN = 600;
export const SEP = 300;
/** Step aside when the predicted miss is under this (the traffic's own figure), and keep going until it is not. */
export const SEP_WANT = 700;
export const PREDICT_S = 20;
/** The medevac's pad: lands only with the player this far off; lifts off nearer than LIFT_OFF. */
export const LAND_FAR = 1500;
export const LIFT_OFF = 800;
/** Seconds looked ahead for ground under the floor. */
const AHEAD = [3, 6, 10, 14, 20];

const D2R = Math.PI / 180;
const _v = new THREE.Vector3();
const _e = new THREE.Euler();

/** Original liveries, by role: base and accent (no real operator's). */
export const LIVERIES = Object.freeze({
  police: { base: '#f4f6f8', accent: '#1d4fb8', name: 'a police helicopter' },
  news: { base: '#c8102e', accent: '#ffffff', name: 'a news helicopter' },
  medevac: { base: '#f2c230', accent: '#c8102e', name: 'an air ambulance' },
  tour: { base: '#2f8ac8', accent: '#f4f6f8', name: 'a sightseeing helicopter' },
  sar: { base: '#f07a1c', accent: '#1f2429', name: 'a rescue helicopter' },
  coastguard: { base: '#c8102e', accent: '#f4f6f8', name: 'a coastguard helicopter' },
  rescue: { base: '#f07a1c', accent: '#1f2429', name: 'a rescue helicopter' },
  crew: { base: '#e8e2d0', accent: '#d14a1f', name: 'a crew-change helicopter' },
  guard: { base: '#5a6670', accent: '#f4f6f8', name: 'a plane-guard helicopter' },
  bucket: { base: '#f2c230', accent: '#1f2429', name: 'a water-bomber helicopter' },
});

/* ------------------------------------------------------------------ */
/* Shared rules                                                        */
/* ------------------------------------------------------------------ */

/** The sea's surface or the ground: what a floor is measured from. */
function surface(x, z) {
  const h = heightAt(x, z);
  return h > 0 ? h : 0;
}

/** Inside (or within `pad` metres of) either approach corridor box. */
export function inCorridor(x, z, pad = 0) {
  const rw = AIRPORT && AIRPORT.runway;
  if (!rw) return false;
  if (Math.abs(x - rw.cx) < CORRIDOR.length + pad && Math.abs(z - rw.cz) < CORRIDOR.halfWidth + pad) return true;
  const r2 = AIRPORT.runway2;
  if (r2 && (CORRIDOR2.length || 0) > 0) {
    const alongX = Math.abs((((r2.headingDeg ?? 180) % 180) - 90)) < 45;
    const along = alongX ? Math.abs(x - r2.cx) : Math.abs(z - r2.cz);
    const across = alongX ? Math.abs(z - r2.cz) : Math.abs(x - r2.cx);
    if (along < CORRIDOR2.length + pad && across < CORRIDOR2.halfWidth + pad) return true;
  }
  return false;
}

/** The highest obstacle top within `r` of (x, z), or -Infinity. */
function obstacleTop(x, z, r) {
  let top = -Infinity;
  for (let i = 0; i < OBSTACLES.length; i++) {
    const o = OBSTACLES[i];
    if (x < o.x0 - r || x > o.x1 + r || z < o.z0 - r || z > o.z1 + r) continue;
    if (o.y1 > top) top = o.y1;
  }
  return top;
}

/**
 * The lowest a flyer at (x, z) heading h (deg) at speed v may be now:
 * FLOOR_AGL over the ground ahead, 60 m over any obstacle near, and
 * CORRIDOR_MIN over the field in or near a corridor.
 */
export function floorFor(x, z, headingDeg, v, climb = 4) {
  const h = headingDeg * D2R;
  const fx = Math.sin(h);
  const fz = -Math.cos(h);
  let need = surface(x, z);
  for (let i = 0; i < AHEAD.length; i++) {
    const s = AHEAD[i];
    const d = v * s;
    const g = surface(x + fx * d, z + fz * d) - (s > 4 ? climb * 0.6 * (s - 4) : 0);
    if (g > need) need = g;
  }
  let floor = need + FLOOR_AGL;
  const ot = obstacleTop(x, z, 300);
  if (ot + 60 > floor) floor = ot + 60;
  if (inCorridor(x, z, v * 15)) {
    const elev = (AIRPORT && AIRPORT.elev) || 0;
    if (elev + CORRIDOR_MIN > floor) floor = elev + CORRIDOR_MIN;
  }
  return floor;
}

/**
 * The closest the player's predicted straight path over PREDICT_S seconds
 * comes to (x, y, z), in metres (3-D). `P` is { pos, vel }.
 */
export function missDistance(P, x, y, z) {
  if (!P || !P.pos) return Infinity;
  const vx = P.vel ? P.vel.x : 0;
  const vy = P.vel ? P.vel.y : 0;
  const vz = P.vel ? P.vel.z : 0;
  const dx = x - P.pos.x;
  const dy = y - P.pos.y;
  const dz = z - P.pos.z;
  const v2 = vx * vx + vy * vy + vz * vz;
  let t = v2 > 1e-6 ? (dx * vx + dy * vy + dz * vz) / v2 : 0;
  t = t < 0 ? 0 : t > PREDICT_S ? PREDICT_S : t;
  const ex = dx - vx * t;
  const ey = dy - vy * t;
  const ez = dz - vz * t;
  return Math.sqrt(ex * ex + ey * ey + ez * ez);
}

/**
 * The closest the player's predicted path comes to OUR predicted path over
 * the next 40 s, both straight lines: the long look an aeroplane needs.
 */
export function missFar(P, x, y, z, v, headingDeg) {
  if (!P || !P.pos) return Infinity;
  const h = headingDeg * D2R;
  const ux = Math.sin(h) * v;
  const uz = -Math.cos(h) * v;
  const vx = P.vel ? P.vel.x : 0;
  const vy = P.vel ? P.vel.y : 0;
  const vz = P.vel ? P.vel.z : 0;
  let best = Infinity;
  for (let t = 0; t <= 40; t += 4) {
    const dx = x + ux * t - (P.pos.x + vx * t);
    const dy = y - (P.pos.y + vy * t);
    const dz = z + uz * t - (P.pos.z + vz * t);
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d < best) best = d;
  }
  return best;
}

/** Heading (deg) from a to b. */
export function bearing(ax, az, bx, bz) {
  return ((Math.atan2(bx - ax, -(bz - az)) * 180) / Math.PI + 360) % 360;
}

function adiff(a, b) {
  return ((b - a + 540) % 360) - 180;
}

/**
 * The heading to fly round a circle: at radius r from (cx, cz), the tangent,
 * bent in or out by how far off the radius we are. Clockwise seen from above.
 */
export function orbitHeading(x, z, cx, cz, r) {
  const brg = bearing(cx, cz, x, z); // from the centre to us
  const d = Math.hypot(x - cx, z - cz);
  const tangent = brg + 90;
  const err = (d - r) / Math.max(50, r * 0.25); // + outside, - inside
  return (tangent + Math.max(-70, Math.min(70, err * 60)) + 360) % 360;
}

/* ------------------------------------------------------------------ */
/* Helicopters                                                         */
/* ------------------------------------------------------------------ */

/** Who flies the helicopter: the Skyhook's type. */
export function heliType() {
  return AIRCRAFT.find((a) => a.id === 'harrier') || getAircraft('harrier');
}

/**
 * A helicopter on an orbit or a transit. Build with `new HeliFlyer(scene,
 * { id, role, orbit: {x, z, r}, agl, transit: [{x,z},{x,z}], land: pad,
 * shy, sep })`; call place(x, z, y), then update(dt, ctx) each frame with
 * ctx = { player: {pos, vel}, noFly: [{x, z, r}], weather, missionPads: Set }.
 */
export class HeliFlyer {
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.id = opts.id || `ambient-heli-${Math.floor(Math.random() * 1e6)}`;
    this.role = opts.role || 'tour';
    this.orbit = opts.orbit || null; // { x, z, r }
    this.transit = opts.transit || null; // [{x,z},{x,z}]
    this.leg = 0;
    this.agl = Math.max(FLOOR_AGL, opts.agl || 250);
    this.alt = opts.alt || null;
    this.land = opts.land || null; // { x, z, y, r } a pad
    this.shy = opts.shy || 0;
    this.sep = Math.max(SEP, opts.sep || 0);
    this.cruise = opts.speed || (this.role === 'tour' ? 30 : 40);
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.heading = 0;
    this.speed = this.cruise;
    this.vs = 0;
    this.bank = 0;
    this.mode = 'fly'; // fly | descend | down | lift
    this.sat = 0;
    this.t = 0;
    this.knocked = false;
    this.gone = false;
    this.onGround = false;
    this.minClear = Infinity;
    this.evading = 0;
    this.floorNow = 0;
    this.stats = { evades: 0, floorPushes: 0 };
    this.type = heliType();
    this.model = null;
    this._state = {
      controls: { pitch: 0, roll: 0, yaw: 0, throttle: 0.7, brakes: 0 },
      rpm: 0.9, flaps: 0, gearPos: 1, gearDown: true, onGround: false, groundSpeed: 0, engineOn: true,
      agl: 300, alt: 0, airspeed: 0, ias: 0, propBlur: 1, vel: this.vel, pos: this.pos, quat: this.quat, winchLength: 0,
    };
    const liv = LIVERIES[this.role] || LIVERIES.tour;
    this.name = opts.name || liv.name;
    try {
      this.model = createAircraftModel({ type: this.type, livery: { base: liv.base, accent: liv.accent } });
      this.model.name = `ambient-heli:${this.role}`;
      // Any light the model carries would light the ground; the lamps stay.
      const lights = [];
      this.model.traverse((o) => { if (o.isLight) lights.push(o); });
      for (const l of lights) if (l.parent) l.parent.remove(l);
      this._small = bakeModel(this.model);
      this._tier = -1;
      this._meshes = meshesOf(this.model);
      this._shadows = null;
      setShadows(this, false);
      scene.add(this.model);
    } catch (e) {
      console.warn('[ambient] the helicopter model could not be built; it flies unseen.', e);
      this.model = null;
    }
    const self = this;
    this.body = registerBody({
      id: this.id,
      kind: 'npc',
      name: this.name,
      pos: this.pos,
      vel: this.vel,
      radius: Math.max(5.5, radiusOfType(this.type)),
      rotor: true,
      crew: 2,
      uniform: 'casual',
      typeId: this.type.id,
      hit: () => self.knock(),
      tick: (dt) => { if (self.knocked && !self.gone) self._fall(dt); },
      get heading() { return self.heading; },
      get onGround() { return self.onGround; },
      get model() { return self.model; },
    });
  }

  place(x, z, y = null, headingDeg = 0) {
    const ground = surface(x, z);
    this.pos.set(x, y != null ? y : ground + this.agl, z);
    this.heading = headingDeg;
    this.speed = this.cruise;
    this.vel.set(Math.sin(headingDeg * D2R) * this.speed, 0, -Math.cos(headingDeg * D2R) * this.speed);
    this.sync(0, null);
    return this;
  }

  /** Where it wants to be heading, by its pattern. */
  _patternHeading() {
    if (this.transit && this.transit.length > 1) {
      const to = this.transit[this.leg];
      const d = Math.hypot(to.x - this.pos.x, to.z - this.pos.z);
      if (d < 120) this.leg = (this.leg + 1) % this.transit.length;
      const t2 = this.transit[this.leg];
      return bearing(this.pos.x, this.pos.z, t2.x, t2.z);
    }
    if (this.orbit) return orbitHeading(this.pos.x, this.pos.z, this.orbit.x, this.orbit.z, this.orbit.r);
    return this.heading;
  }

  /** The height it wants, by its pattern. */
  _patternAlt() {
    if (this.alt != null) return this.alt;
    return surface(this.pos.x, this.pos.z) + this.agl;
  }

  update(dt, ctx) {
    if (this.gone || !(dt > 0)) return;
    this.t += dt;
    if (this.knocked) return; // the sky's tick brings it down
    const P = ctx && ctx.player;
    const px = P && P.pos ? P.pos.x : NaN;
    const pz = P && P.pos ? P.pos.z : NaN;
    const dPlayer = P && P.pos ? Math.hypot(px - this.pos.x, pz - this.pos.z) : Infinity;

    // The medevac's own pad.
    if (this.land && this.mode !== 'fly') {
      this._landStep(dt, dPlayer);
      this.sync(dt, ctx && ctx.weather, ctx && ctx.cam);
      return;
    }
    let wantH = this._patternHeading();
    let wantAlt = this._patternAlt();
    let wantV = this.cruise;

    // Shy: hold off round its first point while the player is near.
    if (this.shy && dPlayer < this.shy && this.transit) {
      let far = this.transit[0];
      let farD = -1;
      for (let i = 0; i < this.transit.length; i++) {
        const d = Math.hypot(this.transit[i].x - px, this.transit[i].z - pz);
        if (d > farD) {
          farD = d;
          far = this.transit[i];
        }
      }
      wantH = orbitHeading(this.pos.x, this.pos.z, far.x, far.z, 300);
      wantAlt = Math.max(wantAlt, surface(this.pos.x, this.pos.z) + 300);
    }

    // No-fly circles: steer out of any we are in or about to enter.
    const nf = ctx && ctx.noFly;
    if (nf && nf.length) {
      for (let i = 0; i < nf.length; i++) {
        const c = nf[i];
        const d = Math.hypot(this.pos.x - c.x, this.pos.z - c.z);
        if (d < c.r + this.speed * 8) {
          wantH = bearing(c.x, c.z, this.pos.x, this.pos.z);
          break;
        }
      }
    }

    // Separation from the player's predicted path: step aside while the miss
    // is under SEP_WANT, and for a few seconds after it is not.
    const miss = missDistance(P, this.pos.x, this.pos.y, this.pos.z);
    if (miss < Math.max(SEP_WANT, this.sep * 1.6)) {
      if (this.evading <= 0) this.stats.evades++;
      this.evading = 3;
    }
    if (this.evading > 0) {
      this.evading -= dt;
      // Away from the player, and a height step away from theirs.
      wantH = bearing(px, pz, this.pos.x, this.pos.z);
      const py = P.pos.y;
      wantAlt = this.pos.y >= py ? Math.max(wantAlt, py + 250) : Math.min(wantAlt, py - 250);
      wantV = Math.min(50, this.cruise * 1.3);
    }

    // The floor wins over everything.
    const floor = floorFor(this.pos.x, this.pos.z, this.heading, this.speed, 6);
    this.floorNow = floor;
    if (wantAlt < floor) {
      wantAlt = floor + 10;
      this.stats.floorPushes++;
    }

    // Turn, at a helicopter's easy rate; climb or descend at 6 m/s.
    const dh = adiff(this.heading, wantH);
    const maxTurn = 24 * dt;
    const turn = Math.max(-maxTurn, Math.min(maxTurn, dh));
    this.heading = (this.heading + turn + 360) % 360;
    this.bank += ((turn / dt / 24) * 18 - this.bank) * Math.min(1, dt * 2.5);
    this.speed += Math.max(-4 * dt, Math.min(3 * dt, wantV - this.speed));
    const dy = wantAlt - this.pos.y;
    const wantVs = Math.max(-5, Math.min(7, dy * 0.4));
    this.vs += (wantVs - this.vs) * Math.min(1, dt * 1.5);
    const h = this.heading * D2R;
    this.vel.set(Math.sin(h) * this.speed, this.vs, -Math.cos(h) * this.speed);
    this.pos.x += this.vel.x * dt;
    this.pos.y += this.vel.y * dt;
    this.pos.z += this.vel.z * dt;
    // Never through the floor, whatever the smoothing did, and never under
    // FLOOR_AGL over the ground where it now is: a crag's crest can sit
    // between the look-ahead samples (Ravencrag's rescue went 9 m under).
    const here = surface(this.pos.x, this.pos.z) + FLOOR_AGL;
    const hold = here > floor ? here : floor;
    if (this.pos.y < hold) {
      this.pos.y = hold;
      if (this.vs < 0) this.vs = 0;
    }
    const clear = this.pos.y - surface(this.pos.x, this.pos.z);
    if (clear < this.minClear) this.minClear = clear;

    // A medevac may go down to its pad when nobody is about and the pad is nobody's mission.
    if (this.land && this.mode === 'fly' && dPlayer > LAND_FAR && this.t > 40 && !(ctx && ctx.missionPads && ctx.missionPads.has(this.land.id))) {
      const d = Math.hypot(this.land.x - this.pos.x, this.land.z - this.pos.z);
      if (d < 400) this.mode = 'descend';
    }
    this.sync(dt, ctx && ctx.weather, ctx && ctx.cam);
  }

  /** Down to the pad, sit a while, and up again — aborted if the player comes near. */
  _landStep(dt, dPlayer) {
    const L = this.land;
    const padY = L.y + 1.2;
    if (this.mode === 'descend' || this.mode === 'down') {
      if (dPlayer < LIFT_OFF && this.mode !== 'lift') {
        this.mode = 'lift';
      }
    }
    if (this.mode === 'descend') {
      const dx = L.x - this.pos.x;
      const dz = L.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      this.heading = d > 5 ? bearing(this.pos.x, this.pos.z, L.x, L.z) : this.heading;
      const v = Math.min(this.speed, Math.max(2, d * 0.25));
      this.speed += (v - this.speed) * Math.min(1, dt * 1.5);
      const h = this.heading * D2R;
      const dyWant = padY - this.pos.y;
      const vs = Math.max(-4, Math.min(2, dyWant * 0.3 * Math.min(1, 120 / Math.max(1, d))));
      this.vel.set(Math.sin(h) * this.speed, vs, -Math.cos(h) * this.speed);
      this.pos.x += this.vel.x * dt;
      this.pos.y += this.vel.y * dt;
      this.pos.z += this.vel.z * dt;
      if (this.pos.y < padY) this.pos.y = padY;
      if (d < 3 && Math.abs(this.pos.y - padY) < 0.5) {
        this.mode = 'down';
        this.onGround = true;
        this.sat = 0;
        this.speed = 0;
        this.vel.set(0, 0, 0);
      }
    } else if (this.mode === 'down') {
      this.sat += dt;
      if (this.sat > 25) this.mode = 'lift';
    } else if (this.mode === 'lift') {
      this.onGround = false;
      const want = surface(this.pos.x, this.pos.z) + this.agl;
      this.vel.set(0, 5, 0);
      this.pos.y += 5 * dt;
      this.speed = Math.min(this.cruise, this.speed + 2 * dt);
      // Back to the pattern only once it is above the floor again: the pad
      // counts as the ground under it (heightAt knows the platform).
      if (this.pos.y >= want || this.pos.y >= L.y + FLOOR_AGL + 10) {
        this.mode = 'fly';
        this.t = 0; // a while before the next landing
      }
    }
  }

  knock() {
    if (this.knocked) return;
    this.knocked = true;
    this.onGround = false;
    this.mode = 'fly';
    this._spin = 3.0;
  }

  _fall(dt) {
    this.vel.y -= 6 * dt;
    if (this.vel.y < -25) this.vel.y = -25;
    this.vel.x *= Math.max(0, 1 - 0.4 * dt);
    this.vel.z *= Math.max(0, 1 - 0.4 * dt);
    this.pos.x += this.vel.x * dt;
    this.pos.y += this.vel.y * dt;
    this.pos.z += this.vel.z * dt;
    this.heading = (this.heading + this._spin * 60 * dt) % 360;
    this.bank = Math.min(60, this.bank + 30 * dt);
    const g = surface(this.pos.x, this.pos.z);
    this.sync(dt, null);
    if (this.pos.y <= g + 1) {
      this.pos.y = g + 1;
      this.dispose();
    }
  }

  sync(dt, weather, cam = null) {
    _e.set((this.vs * -0.6) * D2R, -this.heading * D2R, -this.bank * D2R, 'YXZ');
    this.quat.setFromEuler(_e);
    if (!this.model) return;
    this.model.position.copy(this.pos);
    this.model.quaternion.copy(this.quat);
    lodModel(this, cam);
    if (!this.model.visible || !this.model.userData.update) return;
    const s = this._state;
    s.onGround = this.onGround;
    s.engineOn = !this.knocked;
    s.rpm = this.knocked ? 0.3 : 0.9;
    s.propBlur = this.knocked ? 0.5 : 1;
    s.alt = this.pos.y;
    s.agl = this.pos.y - surface(this.pos.x, this.pos.z);
    s.groundSpeed = this.speed;
    s.airspeed = s.ias = this.speed;
    s.controls.roll = Math.max(-1, Math.min(1, this.bank / 25));
    try {
      this.model.userData.update(dt, s, weather || DAY);
    } catch (e) {
      this.model.userData.update = null;
    }
  }

  dispose() {
    if (this.gone) return;
    this.gone = true;
    unregisterBody(this.body);
    if (!this.model) return;
    this.scene.remove(this.model);
    disposeModel(this.model);
    this.model = null;
  }
}

const DAY = { isNight: false, cond: { cloud: 0 } };

function disposeModel(model) {
  const seen = new Set();
  model.traverse((o) => {
    if (o.geometry && !seen.has(o.geometry)) {
      seen.add(o.geometry);
      o.geometry.dispose();
    }
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) {
      if (seen.has(m)) continue;
      seen.add(m);
      m.dispose();
    }
  });
}

/* ------------------------------------------------------------------ */
/* Aeroplanes                                                          */
/* ------------------------------------------------------------------ */

/** Speeds a type is flown at here, m/s: cruise, and the floor/ceiling for NpcFlyer. */
function speedsFor(type) {
  const span = (type.aero && type.aero.wingSpan) || 12;
  if (span > 50) return { cruise: 170, vMin: 110, vMax: 240 };
  if (span > 20) return { cruise: 110, vMin: 75, vMax: 180 };
  if (/fighter|carrier/i.test(type.class || '')) return { cruise: 150, vMin: 100, vMax: 260 };
  return { cruise: 50, vMin: 36, vMax: 70 };
}

/**
 * An aeroplane on an orbit or a transit, on NpcFlyer in 'direct' mode. The
 * same ctx as HeliFlyer.update(). NpcFlyer keeps its own 300 m floor; this
 * adds the obstacle, corridor and separation rules on top.
 */
export class PlaneFlyer {
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.id = opts.id || `ambient-plane-${Math.floor(Math.random() * 1e6)}`;
    this.role = opts.role || 'ga';
    this.typeId = opts.type || 'courier';
    this.orbit = opts.orbit || null;
    this.transit = opts.transit || null;
    this.leg = 0;
    this.agl = Math.max(FLOOR_AGL, opts.agl || 400);
    this.alt = opts.alt || null;
    this.sep = Math.max(SEP, opts.sep || 0);
    this.evading = 0;
    this.gone = false;
    this.minClear = Infinity;
    this.stats = { evades: 0, floorPushes: 0 };
    this.npc = new NpcFlyer(scene, this.typeId, { name: `ambient-${this.role}-${this.id}`, livery: opts.livery || null });
    const sp = speedsFor(this.npc.type);
    this.cruise = opts.speed || sp.cruise;
    this.npc.vMin = sp.vMin;
    this.npc.vMax = sp.vMax;
    this.npc.maxRate = sp.cruise > 100 ? 2.5 : 4;
    this.npc.maxClimb = sp.cruise > 100 ? 12 : 6;
    this.npc.maxDesc = this.npc.maxClimb;
    this.npc.accel = sp.cruise > 100 ? 3 : 1.5;
    this.npc.body.name = opts.name || (this.role === 'tanker' ? 'a tanker aeroplane' : this.role === 'transport' ? 'a transport aeroplane' : this.role === 'patrol' ? 'a patrol aeroplane' : this.role === 'guard' ? 'a jet' : 'a light aeroplane');
    this.npc.body.id = this.id;
    this.pos = this.npc.pos;
    this.vel = this.npc.vel;
    this.body = this.npc.body;
    this.model = this.npc.model;
    this._small = bakeModel(this.model);
    this._tier = -1;
    this._meshes = meshesOf(this.model);
    this._shadows = null;
    setShadows(this, false);
  }

  get knocked() {
    return this.npc.knocked;
  }

  get heading() {
    return this.npc.heading;
  }

  get speed() {
    return this.npc.speed;
  }

  place(x, z, y = null, headingDeg = 0) {
    const ground = surface(x, z);
    _v.set(x, y != null ? y : this.alt != null ? this.alt : ground + this.agl, z);
    this.npc.place({ pos: _v, headingDeg, speed: this.cruise, onGround: false, gearDown: false });
    this.npc.direct(headingDeg, _v.y, this.cruise);
    return this;
  }

  _patternHeading() {
    const p = this.npc.pos;
    if (this.transit && this.transit.length > 1) {
      const to = this.transit[this.leg];
      if (Math.hypot(to.x - p.x, to.z - p.z) < Math.max(400, this.cruise * 6)) this.leg = (this.leg + 1) % this.transit.length;
      const t2 = this.transit[this.leg];
      return bearing(p.x, p.z, t2.x, t2.z);
    }
    if (this.orbit) return orbitHeading(p.x, p.z, this.orbit.x, this.orbit.z, this.orbit.r);
    return this.npc.heading;
  }

  update(dt, ctx) {
    if (this.gone || !(dt > 0)) return;
    const n = this.npc;
    if (n.gone) {
      this.gone = true;
      return;
    }
    if (n.knocked) {
      n.update(dt, ctx && ctx.weather);
      return;
    }
    const p = n.pos;
    const P = ctx && ctx.player;
    let wantH = this._patternHeading();
    let wantAlt = this.alt != null ? this.alt : surface(p.x, p.z) + this.agl;
    let wantV = this.cruise;
    const nf = ctx && ctx.noFly;
    if (nf && nf.length) {
      for (let i = 0; i < nf.length; i++) {
        const c = nf[i];
        if (Math.hypot(p.x - c.x, p.z - c.z) < c.r + n.speed * 10) {
          wantH = bearing(c.x, c.z, p.x, p.z);
          break;
        }
      }
    }
    // An aeroplane turns slowly, so it looks twice as far ahead as a
    // helicopter and steps aside sooner: the predicted miss over 40 s.
    const miss = Math.min(missDistance(P, p.x, p.y, p.z), missFar(P, p.x, p.y, p.z, n.speed, n.heading));
    if (miss < Math.max(SEP_WANT, this.sep * 1.6)) {
      if (this.evading <= 0) this.stats.evades++;
      this.evading = 4;
    }
    if (this.evading > 0) {
      this.evading -= dt;
      // Across the player's track, away from their side of it, and a height step away.
      wantH = bearing(P.pos.x, P.pos.z, p.x, p.z);
      wantAlt = p.y >= P.pos.y ? Math.max(wantAlt, P.pos.y + 300) : Math.min(wantAlt, P.pos.y - 300);
      wantV = Math.min(n.vMax - 5, this.cruise * 1.2);
    }
    const floor = floorFor(p.x, p.z, n.heading, n.speed, n.maxClimb);
    if (wantAlt < floor + 20) {
      wantAlt = floor + 30;
      this.stats.floorPushes++;
    }
    n.direct(wantH, wantAlt, wantV);
    n.update(dt, ctx && ctx.weather);
    lodModel(this, ctx && ctx.cam);
    // NpcFlyer's own floor is 300 m; the corridor and obstacles are ours: hold them hard.
    if (p.y < floor) {
      p.y = floor;
      if (n.vs < 0) n.vs = 0;
    }
    const clear = p.y - surface(p.x, p.z);
    if (clear < this.minClear) this.minClear = clear;
  }

  dispose() {
    if (this.gone) return;
    this.gone = true;
    this.npc.dispose();
  }
}
