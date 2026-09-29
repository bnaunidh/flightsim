/**
 * The ramp crew's jobs, as geometry and arithmetic: where an aeroplane's
 * doors and nose leg are, how a tug moves the aeroplane it is pinned to, what
 * counts as "docked", and a pilot who taxis in on a marshaller's signals.
 *
 * No DOM and no scene: tests/features/onfoot.mjs drives every one of these in
 * node. staff.js turns them into a game.
 *
 * Headings are compass degrees, pointing along (sin h, 0, -cos h). "Along" is
 * metres toward an aeroplane's nose, "side" metres toward its right wing.
 */

import * as THREE from '../../vendor/three.module.js';

const D2R = Math.PI / 180;

export function fwd(headingDeg) {
  const h = headingDeg * D2R;
  return { x: Math.sin(h), z: -Math.cos(h) };
}

/** Shortest signed turn from a to b, degrees, in (-180, 180]. */
export function angleDiff(b, a) {
  let d = (b - a) % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

/**
 * A point `along` ahead of and `side` right of (x, z), facing h. Pass `out`
 * in anything that runs every frame; without it a new object is returned.
 */
export function offset(x, z, headingDeg, along, side, out) {
  const h = headingDeg * D2R;
  const fx = Math.sin(h);
  const fz = -Math.cos(h);
  const o = out || { x: 0, z: 0 };
  o.x = x + fx * along - fz * side;
  o.z = z + fz * along + fx * side;
  return o;
}

/** (px, pz) in the frame of something at (x, z) facing h: { along, side }. */
export function local(x, z, headingDeg, px, pz, out) {
  const h = headingDeg * D2R;
  const fx = Math.sin(h);
  const fz = -Math.cos(h);
  const dx = px - x;
  const dz = pz - z;
  const o = out || { along: 0, side: 0 };
  o.along = dx * fx + dz * fz;
  o.side = dx * -fz + dz * fx;
  return o;
}

const _o1 = { x: 0, z: 0 };
const _o2 = { x: 0, z: 0 };
const _l1 = { along: 0, side: 0 };

/* ------------------------------------------------------------------ */
/* An aeroplane, measured                                              */
/* ------------------------------------------------------------------ */

/**
 * The numbers the ground crew needs about an aeroplane, measured off its
 * model where the model can say and taken from its type where it cannot.
 *
 * The fuselage is found as the longest mesh that is much longer than it is
 * wide and sits on the centreline. That matters: a model's overall box is no
 * use for doors — the Meridian's is thirty metres wide because of its wings
 * and nine and a half tall because of its fin — and the type's `bodyRadius`
 * is a lathe multiplier, not a radius (the Meridian's says 2.36 m; its
 * fuselage is 1.78 m).
 *
 * The height of the centre of gravity above the ground is the type's own
 * gear geometry, because that is where the flight model and the parked
 * aeroplanes on the apron both put it.
 */
export function planeProfile(type, model = null) {
  const sh = (type && type.shape) || {};
  const s = sh.scale || 1;
  const bl = sh.bodyLength || 1;
  let noseZ = -2.6 * bl * s;
  let tailZ = 3.95 * bl * s;
  let halfWidth = 0.75 * (sh.bodyRadius || 1) * s;
  let fuseY0 = -halfWidth;
  let fuseY1 = halfWidth;
  let halfSpan = ((sh.wingRootX || 0.6) + (sh.halfSpan || 5.5)) * s;
  if (model) {
    const m = measureModel(model);
    /*
     * A flying wing has no fuselage to find: the "longest thin mesh" on the
     * Nightjar is 0.6 m long, and the walker could stroll through the rest of
     * it. Anything that short against the whole aeroplane is not the body;
     * use the whole length instead.
     */
    if (m.fuse && m.all && m.fuse.max.z - m.fuse.min.z < 0.4 * (m.all.max.z - m.all.min.z)) {
      noseZ = m.all.min.z;
      tailZ = m.all.max.z;
      m.fuse = null;
    }
    if (m.fuse) {
      noseZ = m.fuse.min.z;
      tailZ = m.fuse.max.z;
      halfWidth = Math.max(0.35, (m.fuse.max.x - m.fuse.min.x) / 2);
      fuseY0 = m.fuse.min.y;
      fuseY1 = m.fuse.max.y;
    }
    if (m.all) halfSpan = Math.max(m.all.max.x, -m.all.min.x);
  }
  const gearLow = Math.min(sh.main ? sh.main.y : -1.5, sh.nose ? sh.nose.y : -1.42);
  const cgH = -gearLow * s;
  const len = tailZ - noseZ;
  const fuseMid = (fuseY0 + fuseY1) / 2;
  const fuseR = (fuseY1 - fuseY0) / 2;
  const noseGear = -(sh.nose ? sh.nose.z : -1.15) * s;
  const mainGear = (sh.main ? sh.main.z : 0.42) * s;
  const wz = sh.wingZ != null ? sh.wingZ : -1;
  const rc = sh.rootChord || 1.7;
  const tc = sh.tipChord || rc * 0.6;
  const sw = sh.sweep || 0;
  /*
   * How far the WING reaches, which is not always the widest thing on the
   * model: the Skyhook's is its rotor, 5.2 m out, over a stub wing that ends
   * 2.65 m out. Boxed at the rotor's width, the stub wing at 1.4 m up was an
   * invisible bar sticking five metres out of each side of the helicopter.
   */
  const shapeWing = ((sh.wingRootX != null ? sh.wingRootX : 0.62) + (sh.halfSpan || 5.5)) * s;
  const wingSpan = Math.min(halfSpan, shapeWing * 1.05);
  return {
    // Along the aeroplane, metres ahead of the CG (so the nose is positive).
    nose: -noseZ,
    tail: -tailZ,
    len,
    halfWidth,
    /** Half the width of the whole aeroplane, rotor and all. */
    halfSpan,
    /** Half the wing's own span: what the wing box is. */
    wingSpan,
    cgH,
    /** Height of the fuselage's bottom and top above the ground. */
    belly: cgH + fuseY0,
    top: cgH + fuseY1,
    noseGear,
    mainGear,
    wheelbase: noseGear + mainGear,
    /** Front passenger door, left side: metres ahead of the CG. */
    doorFront: -noseZ - 0.2 * len,
    /**
     * Galley door, right side, near the back. At 28% of the length from the
     * tail it was under the Meridian's swept trailing edge, where a catering
     * truck cannot reach without driving its box through the wing.
     */
    doorRear: -(tailZ - 0.22 * len),
    /** How high the door sill is above the ground. */
    sill: Math.max(0.6, cgH + fuseMid - 0.45 * fuseR),
    /**
     * The wing, for clearances: from its leading edge at the root back to
     * the trailing edge at the tip (a swept wing's tip sits well aft), and
     * how high it is. A walker goes under a wing that is higher than they
     * are; a stair truck does not.
     */
    wingFront: -(wz * s),
    /*
     * The trailing edge's furthest point aft: the root's, or the tip's
     * (swept back by `sweep`, with the tip's own chord). It added the ROOT
     * chord to the sweep, which put the Meridian's wing 2.8 m further back
     * than the wing model.js draws.
     */
    wingBack: -Math.max(wz + rc, wz + sw + tc) * s,
    wingH: cgH + (sh.wingY != null ? sh.wingY : 0.7) * s,
    /** The planform, for wingEdges(). Model units, and the scale. */
    wing: { rootX: sh.wingRootX != null ? sh.wingRootX : 0.62, z: wz, rc, tc, sw, span: sh.halfSpan || 5.5, s },
  };
}

/**
 * Where the wing is, along the aeroplane, at `side` metres out from the
 * centreline: its leading and trailing edges, or null past the tip. The same
 * interpolation model.js lofts the wing with — chord tapering root to tip on
 * f^1.25, sweep on f^1.1 — so a truck is stopped by the wing that is drawn,
 * not by a box round the whole swept planform.
 */
const EDGES = { le: 0, te: 0 };
export function wingEdges(prof, side) {
  const w = prof.wing;
  if (!w) {
    EDGES.le = prof.wingFront;
    EDGES.te = prof.wingBack;
    return Math.abs(side) <= prof.halfSpan ? EDGES : null;
  }
  const f = (Math.abs(side) / w.s - w.rootX) / w.span;
  if (f > 1.02) return null;
  const k = Math.max(0, Math.min(1, f));
  const le = w.z + w.sw * Math.pow(k, 1.1);
  const chord = w.rc + (w.tc - w.rc) * Math.pow(k, 1.25);
  EDGES.le = -le * w.s;
  EDGES.te = -(le + chord) * w.s;
  return EDGES;
}

/**
 * Boxes of a model in its own frame: all of it, and its fuselage. Puts the
 * model's transform back exactly as it found it.
 */
export function measureModel(model) {
  /*
   * Position and turn are taken off; the scale is NOT. A model scales its own
   * root to its type's size — the Meridian's is 2.05 — and measuring with the
   * scale reset gave a Meridian half its real size.
   */
  const pos = model.position.clone();
  const quat = model.quaternion.clone();
  const parent = model.parent;
  if (parent) parent.remove(model);
  model.position.set(0, 0, 0);
  model.quaternion.identity();
  model.updateMatrixWorld(true);
  const all = new THREE.Box3();
  const box = new THREE.Box3();
  let fuse = null;
  let best = 0;
  model.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    for (let p = o; p && p !== model; p = p.parent) if (!p.visible) return;
    box.setFromObject(o);
    if (box.isEmpty()) return;
    all.union(box);
    const lx = box.max.x - box.min.x;
    const lz = box.max.z - box.min.z;
    const cx = (box.max.x + box.min.x) / 2;
    if (lz > best && lx < 0.4 * lz && Math.abs(cx) < 0.5) {
      best = lz;
      fuse = box.clone();
    }
  });
  model.position.copy(pos);
  model.quaternion.copy(quat);
  if (parent) parent.add(model);
  model.updateMatrixWorld(true);
  return { all: all.isEmpty() ? null : all, fuse };
}

/* ------------------------------------------------------------------ */
/* Pushback                                                            */
/* ------------------------------------------------------------------ */

/**
 * Where a tug's towbar tip is: `hitch` metres ahead of its middle.
 */
export function hitchPoint(tx, tz, tugHeading, hitch, out) {
  return offset(tx, tz, tugHeading, hitch, 0, out);
}

/** Where an aeroplane's nose leg is. */
export function noseGearPoint(plane, prof, out) {
  return offset(plane.x, plane.z, plane.heading, prof.noseGear, 0, out);
}

const HOOK = { ok: false, dist: 0, face: 0 };

/**
 * Can this tug pin to this aeroplane's nose leg? The answer object is reused. Tip within `reach` metres
 * of the leg, and the tug facing the aeroplane head-on within `slack`.
 */
export function hookable(tug, plane, prof, hitch, reach = 2.4, slack = 30) {
  const tip = hitchPoint(tug.x, tug.z, tug.heading, hitch, _o1);
  const ng = noseGearPoint(plane, prof, _o2);
  const d = Math.hypot(tip.x - ng.x, tip.z - ng.z);
  const face = Math.abs(angleDiff(tug.heading + 180, plane.heading));
  const out = HOOK;
  out.ok = d < reach && face < slack;
  out.dist = d;
  out.face = face;
  return out;
}

/**
 * Move a pinned aeroplane after its tug has moved, then say where the tug's
 * towbar tip must be to stay on the nose leg.
 *
 * `tipX, tipZ` is where the tug's physics has just put the tip. How far that
 * went along the aeroplane's own axis is how far the aeroplane goes — it
 * rolls on its main wheels, and main wheels roll along the fuselage, not
 * sideways. While it rolls it turns toward lining up with the tug, at the bar
 * angle over `align` metres: THE TAIL GOES THE WAY YOU STEER. (A real towbar
 * does the opposite — pushing is reversing a trailer, which jack-knifes the
 * moment a ten-year-old lets go of the steering — and this is deliberately
 * not that.)
 *
 * What it replaced put the nose leg wherever the tip went, sideways included.
 * With the bar held over, the tip runs round an arc tilted by the bar angle,
 * so a quarter-turn push finished with the aeroplane twenty metres to the
 * side of its stand and no further back than it started — alongside the
 * next stand, where the apron parks another airliner. Measured with the old
 * function and a bar of 50 degrees: 22.6 m over, 0.3 m back. With this one
 * the same push ends 14.2 m back and 12.5 m over (three metres of straight
 * included), on the taxilane behind the stand, which is where a pushback goes.
 *
 * Writes the tip's pinned position into `out` (or a new object) and returns it.
 */
export function towStep(plane, prof, tipX, tipZ, tugHeading, align, out) {
  const ng = noseGearPoint(plane, prof, _o2);
  const h0 = plane.heading * D2R;
  // Along the tail: +sin/-cos is the nose, so the tail is the opposite.
  const dist = (tipX - ng.x) * -Math.sin(h0) + (tipZ - ng.z) * Math.cos(h0);
  const bar = angleDiff(tugHeading + 180, plane.heading);
  const k = Math.min(1, Math.abs(dist) / Math.max(0.5, align));
  plane.heading = (plane.heading + bar * k + 360) % 360;
  // Roll along the axis, half before the turn and half after, so a long
  // step does not cut the corner.
  const h1 = plane.heading * D2R;
  const bx = -(Math.sin(h0) + Math.sin(h1)) * 0.5;
  const bz = (Math.cos(h0) + Math.cos(h1)) * 0.5;
  plane.x += bx * dist;
  plane.z += bz * dist;
  const o = out || { x: 0, z: 0 };
  offset(plane.x, plane.z, plane.heading, prof.noseGear, 0, o);
  return o;
}

/** Where a tug must stand for its towbar tip to be at (x, z). */
export function tugAtTip(tipX, tipZ, tugHeading, hitch, out) {
  return offset(tipX, tipZ, tugHeading, -hitch, 0, out);
}

/**
 * How far the towbar is bent: the tug's heading against the aeroplane's.
 * Past `limit` the bar is on its stop and the tug cannot turn further.
 */
export function towAngle(tugHeading, planeHeading) {
  return angleDiff(tugHeading + 180, planeHeading);
}

/** The heading a tug must have for the towbar to sit at `angle`. */
export function tugHeadingFor(planeHeading, angle) {
  return (planeHeading + angle - 180 + 720) % 360;
}

/**
 * Is the aeroplane where the pushback wants it? Within `radius` of the box's
 * centre and pointing within `slack` degrees of the way it should.
 */
const INBOX = { ok: false, dist: 0, head: 0 };

/** The answer object is reused. */
export function inPushBox(plane, box, radius = 12, slack = 35) {
  const d = Math.hypot(plane.x - box.x, plane.z - box.z);
  const h = Math.abs(angleDiff(box.heading, plane.heading));
  INBOX.ok = d < radius && h < slack;
  INBOX.dist = d;
  INBOX.head = h;
  return INBOX;
}

/**
 * Where to push an aeroplane back to from a nose-in stand, turned a quarter
 * to face along the apron. `side` is +1 to finish facing right of the stand
 * (tail swung left), -1 left.
 *
 * Found by DOING the push, with towStep, rather than by a formula. The box
 * used to be put "straight back far enough for the wings to clear": 36 m back
 * and 4.5 m over for the Meridian. No push ever went there — a quarter turn
 * swings the aeroplane sideways as much as back — and the scripted driver in
 * the browser check pushed for ninety seconds and finished 190 m away, lined
 * up perfectly, beside it. So: straight back until the nose is off the stand,
 * bar held at 50 degrees until it faces the right way, three metres more, and
 * the box is wherever that left it. For the Meridian that is 14.2 m back and
 * 12.5 m over.
 */
export function pushBoxFor(stand, prof, side = 1) {
  const plane = { x: stand.x, z: stand.z, heading: stand.heading };
  const target = (stand.heading + side * 90 + 360) % 360;
  const align = Math.max(6, prof.wheelbase * 1.6);
  const straight = Math.max(4, prof.nose * 0.6);
  const tip = noseGearPoint(plane, prof, { x: 0, z: 0 });
  const stepLen = 0.1;
  let tugH = (stand.heading + 180) % 360;
  let turned = false;
  let after = 0;
  for (let i = 0; i < 3000 && after < 3; i++) {
    const back = -local(stand.x, stand.z, stand.heading, plane.x, plane.z, _l1).along;
    if (!turned && Math.abs(angleDiff(target, plane.heading)) < 2) turned = true;
    if (turned) {
      tugH = tugHeadingFor(plane.heading, 0);
      after += stepLen;
    } else if (back >= straight) {
      tugH = tugHeadingFor(plane.heading, side * 50);
    }
    const h = tugH * D2R;
    tip.x += Math.sin(h) * stepLen;
    tip.z -= Math.cos(h) * stepLen;
    towStep(plane, prof, tip.x, tip.z, tugH, align, tip);
  }
  return { x: plane.x, z: plane.z, heading: target, side };
}

/**
 * Has a push got the aeroplane off the stand and turned? The answer object
 * is reused. `clear` is what the job needs; the box is for the stars.
 */
const OFFSTAND = { away: 0, turned: 0, clear: false };
export function offStand(plane, stand, prof) {
  OFFSTAND.away = Math.hypot(plane.x - stand.x, plane.z - stand.z);
  OFFSTAND.turned = Math.abs(angleDiff(plane.heading, stand.heading));
  OFFSTAND.clear = OFFSTAND.away > prof.len * 0.6 && OFFSTAND.turned > 55;
  return OFFSTAND;
}

/* ------------------------------------------------------------------ */
/* Docking at a door                                                   */
/* ------------------------------------------------------------------ */

/**
 * Where a vehicle's front must be to serve a door, and which way it must
 * face. The front door is on the left and the galley door on the right, as
 * on real aeroplanes; the vehicle comes at the fuselage square-on.
 */
export function doorPose(plane, prof, which = 'front', out = null) {
  const front = which !== 'rear';
  const along = front ? prof.doorFront : prof.doorRear;
  const side = front ? -prof.halfWidth - 0.15 : prof.halfWidth + 0.15;
  const o = out || { x: 0, z: 0, heading: 0, sill: 0, along: 0, side: 0 };
  offset(plane.x, plane.z, plane.heading, along, side, o);
  o.heading = (plane.heading + (front ? 90 : -90) + 360) % 360;
  o.sill = prof.sill;
  o.along = along;
  o.side = side;
  return o;
}

/** How far a vehicle is from serving a door. */
const DOCKERR = { dist: 0, head: 0 };

/** The answer object is reused. */
export function dockError(v, reach, pose) {
  const tip = offset(v.x, v.z, v.heading, reach, 0, _o1);
  DOCKERR.dist = Math.hypot(tip.x - pose.x, tip.z - pose.z);
  DOCKERR.head = Math.abs(angleDiff(pose.heading, v.heading));
  return DOCKERR;
}

export function docked(v, reach, pose, dist = 1.8, head = 22) {
  const e = dockError(v, reach, pose);
  return e.dist < dist && e.head < head;
}

/** The vehicle position that puts its front exactly on the door. */
export function dockedPlace(reach, pose) {
  const p = offset(pose.x, pose.z, pose.heading, -reach, 0);
  return { x: p.x, z: p.z, heading: pose.heading };
}

/**
 * Is a point inside the aeroplane's footprint, grown by `margin`? The
 * fuselage and the wing, as two boxes — enough to tell a stair truck it is
 * parked under the wing.
 */
export function inFootprint(plane, prof, px, pz, margin = 0, height = 99) {
  const l = local(plane.x, plane.z, plane.heading, px, pz, _l1);
  if (l.along < prof.nose + margin && l.along > prof.tail - margin && Math.abs(l.side) < prof.halfWidth + margin) return true;
  if (height < prof.wingH - 0.2) return false;
  if (Math.abs(l.side) > prof.halfSpan + margin) return false;
  const e = wingEdges(prof, Math.max(0, Math.abs(l.side) - margin));
  return !!e && l.along < e.le + margin && l.along > e.te - margin;
}

/* ------------------------------------------------------------------ */
/* Marshalling                                                         */
/* ------------------------------------------------------------------ */

/**
 * An aeroplane taxiing onto a stand, flown by a pilot who does what the
 * marshaller's wands say and nothing else.
 *
 *   'come'   keep coming (slowing as the stop line gets close — a pilot
 *            creeps the last few metres whatever the wands are doing)
 *   'left' / 'right'   keep coming and turn toward the marshaller's left or
 *            right, which is the screen's left or right from behind them
 *   'stop'   brakes
 *   null     no signal: the pilot eases to a halt and waits
 *
 * Everything is measured in the stand's frame: `along` is how far the CG is
 * past the parking spot (negative while still coming), `side` is how far it
 * is to the stand's right.
 */
export class Arrival {
  constructor(stand, prof) {
    this.stand = stand;
    this.prof = prof;
    this.x = stand.x;
    this.z = stand.z;
    this.heading = stand.heading;
    this.speed = 0;
    this.state = 'idle';
    this.waitT = 0;
    this.stopped = false;
    this.result = null;
    this._err = { along: 0, side: 0, head: 0 };
    this._l = { along: 0, side: 0 };
  }

  /** Put it on the taxilane, `back` metres out, a little off the line. */
  begin(back = 70, side = 3, headErr = -5) {
    const p = offset(this.stand.x, this.stand.z, this.stand.heading, -back, side);
    this.x = p.x;
    this.z = p.z;
    this.heading = (this.stand.heading + headErr + 360) % 360;
    this.speed = 0;
    this.state = 'taxi';
    this.waitT = 0;
    this.stopped = false;
    this.result = null;
    return this;
  }

  /** Where it is against the parking spot. The object is reused. */
  errors() {
    const l = local(this.stand.x, this.stand.z, this.stand.heading, this.x, this.z, this._l);
    const e = this._err;
    e.along = l.along;
    e.side = l.side;
    e.head = angleDiff(this.heading, this.stand.heading);
    return e;
  }

  /** One frame. Returns 'parked' | 'overshot' | 'wide' | null. */
  step(dt, signal) {
    if (this.state !== 'taxi') return null;
    const e = this.errors();
    const toGo = -e.along;
    let want = 0;
    let decel = 0.8;
    if (signal === 'come' || signal === 'left' || signal === 'right') {
      // A brisk taxi far out, a crawl at the line. It was capped at 2.6 m/s
      // from sixty metres out: over half a minute of holding one key before
      // anything happened worth steering.
      want = Math.max(0.55, Math.min(4.5, 0.6 + Math.abs(toGo) * 0.14));
      this.stopped = false;
    } else if (signal === 'stop') {
      decel = 1.6;
      this.stopped = true;
    }
    if (want > this.speed) this.speed = Math.min(want, this.speed + 1.0 * dt);
    else this.speed = Math.max(want, this.speed - decel * dt);

    // Nose-wheel steering needs rolling wheels.
    const turn = signal === 'left' ? 1 : signal === 'right' ? -1 : 0;
    if (turn) {
      // The marshaller faces the aeroplane, so their left is the stand's right.
      const rate = 7 * Math.min(1, this.speed / 1.2);
      this.heading = (this.heading + turn * rate * dt + 360) % 360;
    }
    const h = this.heading * D2R;
    this.x += Math.sin(h) * this.speed * dt;
    this.z -= Math.cos(h) * this.speed * dt;

    const now = this.errors();
    if (now.along > 3.2) {
      // Nobody stopped them: the pilot stands on the brakes at the bridge.
      this.speed = 0;
      this.state = 'done';
      this.result = { kind: 'overshot', stars: 0, ...now };
      return 'overshot';
    }
    if (Math.abs(now.side) > 7) {
      this.speed = 0;
      this.state = 'done';
      this.result = { kind: 'wide', stars: 0, ...now };
      return 'wide';
    }
    /*
     * Stopped by the wands — the last signal was STOP, held or not. It had
     * to be held: tap Space and let go and the aeroplane stopped on the line
     * and then sat there, never "parked", with nothing on screen saying why.
     */
    if (this.speed < 0.02 && this.stopped) {
      this.waitT += dt;
      if (this.waitT > 0.4 && Math.abs(now.along) < 3) {
        this.state = 'done';
        this.result = { kind: 'parked', stars: Arrival.stars(now), ...now };
        return 'parked';
      }
    } else {
      this.waitT = 0;
    }
    return null;
  }

  static stars(e) {
    const a = Math.abs(e.along);
    const s = Math.abs(e.side);
    const h = Math.abs(e.head);
    if (a < 0.9 && s < 0.9 && h < 5) return 3;
    if (a < 1.8 && s < 1.6 && h < 9) return 2;
    return 1;
  }
}
