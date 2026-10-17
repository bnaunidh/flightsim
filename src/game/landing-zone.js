/**
 * Easy landings: a secret hitbox round every runway, and the three-second rule.
 *
 * The owner, 2026-10-16: "for things where u need aland on runway just add a
 * runway hitbox thats secret and if you land on there for more than 3 seconds
 * you land."
 *
 * Every objective that says "land" used to ask for more than that. "Landed and
 * stopped" wanted the wheels down, the aeroplane under 2.5 m/s, more than 1.2 s
 * of ground roll and, in most places, a touchdown inside six metres of the
 * paint. A child who put it down long and fast, rolled the length of the
 * runway at forty knots and off the end had landed, as far as anybody watching
 * could tell, and the game sat there waiting for a stop. So a landing COUNTS
 * here when the aeroplane is
 *
 *   - in one piece (not crashed),
 *   - on the ground (the flight model's own wheel/body contact, `ac.onGround`),
 *   - inside the runway's hidden box,
 *   - and has stayed inside it for three seconds without a break.
 *
 * A bounce shorter than 0.3 s is not a break (the clock keeps running through
 * it); a longer one, leaving the box or a crash starts it again. Speed is not
 * asked about at all: the touchdown zone, the stop and the centreline are what
 * the landing GRADE scores (physics.js gradeTouchdown), never what lets a step
 * finish.
 *
 * THE BOX. Built from the map's airport data, never drawn: the whole runway
 * plus 60 m past each end, its width plus 15 m of shoulder each side, and a
 * slab round the runway's surface tall enough for an A380's centre (6.8 m up
 * on its wheels) and no more. A box is the same box whichever way you land on
 * it, so 09 and 27 (and 18 and 36) are one zone each. A map that brings its
 * own airport — or a list of extra `runways` — gets its boxes for free; so
 * will SF Bay, LA and New York when they arrive, because nothing here names a
 * map.
 *
 * Pads (the helicopter's hospital roof, the medevac's strip) are a disc with
 * the same dwell. Carrier traps are not touched: a wire catches it.
 *
 * ONE HELPER. Every landing check in the game calls `landedOnRunway(ctx)` or
 * `landedOnPad(ctx, …)` (a mission step, through the runner's ctx), or keeps a
 * `LandingDwell` of its own (a feature with its own frame loop). Nobody copies
 * the rule.
 *
 * The dwell is driven by the mission clock, not by the dt a caller happens to
 * have: the same check is asked from a step, from a tick and from failIf, and
 * the answer must not depend on how many of them asked in a frame. A gap in
 * the samples longer than a frame can be (0.6 s; the frame loop clamps dt to
 * 0.25) is a gap nobody watched, so it starts the clock again — "continuously"
 * has to be seen.
 */

import { AIRPORT } from '../world/terrain.js';

export const LANDING_RULE = Object.freeze({
  /** Seconds continuously inside the box, on the ground, in one piece. */
  hold: 0, // owner 2026-10-16: "you land you land" — a touchdown inside the box counts at once, everywhere incl. free flight
  /** Seconds a bounce may last without starting the clock again. */
  bounce: 0.3,
  /** Metres past each end of the runway. */
  endMargin: 60,
  /** Metres of shoulder either side of the paved width. */
  sideMargin: 15,
  /** Metres below the runway surface the aeroplane's centre may be. */
  below: 5,
  /** And above it: an A380's centre rides 6.8 m up on its wheels. */
  above: 12,
  /** Seconds between two samples past which the clock starts again. */
  maxGap: 0.6,
});

const DEG = Math.PI / 180;

/** "09", "27", "18": the designator a runway heading is painted with. */
function designator(headingDeg) {
  const n = Math.round((((headingDeg % 360) + 360) % 360) / 10) || 36;
  return String(n).padStart(2, '0');
}

/**
 * One runway's box. Heading 0 is north (-Z) and 90 is east (+X), the game's
 * own convention (physics.js, airport.js's designators), so a runway's own
 * axis is (sin h, -cos h).
 */
function runwayBox(id, r, headingDeg, elev, rule = LANDING_RULE) {
  const h = headingDeg * DEG;
  const a = designator(headingDeg);
  const b = designator(headingDeg + 180);
  return {
    id,
    name: Number(a) < Number(b) ? `${a}/${b}` : `${b}/${a}`,
    kind: 'runway',
    shape: 'box',
    cx: r.cx,
    cz: r.cz,
    elev,
    ux: Math.sin(h),
    uz: -Math.cos(h),
    headingDeg,
    halfLength: r.length / 2 + rule.endMargin,
    halfWidth: r.halfWidth + rule.sideMargin,
    below: rule.below,
    above: rule.above,
    runway: { length: r.length, halfWidth: r.halfWidth },
  };
}

const ok = (r) => !!r && Number.isFinite(r.cx) && Number.isFinite(r.cz) && r.length > 0 && r.halfWidth > 0;

let cacheAirport = null;
let cacheKey = '';
let cacheZones = [];

/**
 * Every runway of an airport (the loaded map's by default), as a hidden box.
 *
 * The main runway lies along the airport's heading (always 090 today — it is
 * drawn along X whatever the map says); the second one along its own; any
 * `runways` list a future map brings, each along its own. Cached on the
 * numbers, so asking every frame is free and a map change is noticed.
 */
export function runwayZones(airport = AIRPORT) {
  if (!airport) return [];
  const r1 = airport.runway;
  const r2 = airport.runway2;
  const more = Array.isArray(airport.runways) ? airport.runways : [];
  const elev = Number.isFinite(airport.elev) ? airport.elev : 0;
  const key = [r1, r2, ...more]
    .map((r) => (r ? `${r.cx},${r.cz},${r.length},${r.halfWidth},${r.headingDeg ?? ''},${r.elev ?? ''}` : '-'))
    .join('|') + `|${elev}|${airport.headingDeg ?? ''}`;
  if (airport === cacheAirport && key === cacheKey) return cacheZones;
  const zones = [];
  if (ok(r1)) zones.push(runwayBox('runway', r1, r1.headingDeg ?? airport.headingDeg ?? 90, Number.isFinite(r1.elev) ? r1.elev : elev));
  if (ok(r2)) zones.push(runwayBox('runway2', r2, r2.headingDeg ?? 180, Number.isFinite(r2.elev) ? r2.elev : elev));
  more.forEach((r, i) => {
    if (ok(r)) zones.push(runwayBox(r.id || `runway${i + 3}`, r, r.headingDeg ?? 90, Number.isFinite(r.elev) ? r.elev : elev));
  });
  cacheAirport = airport;
  cacheKey = key;
  cacheZones = zones;
  return zones;
}

/**
 * A round landing area: a helicopter pad, a strip somebody is sent to "get
 * down on". No height limit unless one is asked for — the old pad checks had
 * none, and the ground contact test already says whether you are down.
 */
export function padZone(pos, radius, { id = 'pad', below = null, above = null } = {}) {
  return {
    id,
    name: id,
    kind: 'pad',
    shape: 'disc',
    cx: pos.x,
    cz: pos.z,
    elev: Number.isFinite(pos.y) ? pos.y : null,
    r: Math.max(0, radius),
    below,
    above,
  };
}

/** Is `pos` inside `zone`? Plan first (cheap), then the slab, if the zone has one. */
export function zoneContains(zone, pos) {
  if (!zone || !pos) return false;
  const dx = pos.x - zone.cx;
  const dz = pos.z - zone.cz;
  if (zone.shape === 'disc') {
    if (dx * dx + dz * dz > zone.r * zone.r) return false;
  } else {
    const along = dx * zone.ux + dz * zone.uz;
    const across = dz * zone.ux - dx * zone.uz;
    if (Math.abs(along) > zone.halfLength || Math.abs(across) > zone.halfWidth) return false;
  }
  if (zone.elev != null && Number.isFinite(pos.y)) {
    const dy = pos.y - zone.elev;
    if (zone.below != null && dy < -zone.below) return false;
    if (zone.above != null && dy > zone.above) return false;
  }
  return true;
}

/** The first zone `pos` is in, or null. */
export function zoneAt(pos, zones = runwayZones()) {
  for (let i = 0; i < zones.length; i++) if (zoneContains(zones[i], pos)) return zones[i];
  return null;
}

/** Inside any of them (the loaded map's runways by default). */
export function inZone(pos, zones = runwayZones()) {
  return zoneAt(pos, zones) !== null;
}

/**
 * The three-second rule, as a little state machine.
 *
 * `update(dt, { intact, onGround, inside })` once a frame; true while the
 * hold has been met. Nothing latches: leave the box after three seconds and
 * it is false again, which is what a check asked every frame wants.
 */
export class LandingDwell {
  constructor({ hold = LANDING_RULE.hold, bounce = LANDING_RULE.bounce, maxGap = LANDING_RULE.maxGap } = {}) {
    this.hold = hold;
    this.bounce = bounce;
    this.maxGap = maxGap;
    this.reset();
  }

  reset() {
    /** Seconds inside the box since the wheels first touched in it. */
    this.held = 0;
    /** Seconds of the bounce in progress, if one is. */
    this.air = 0;
    /** The clock at the last sample(), if driven by one. */
    this.last = null;
  }

  /** Seconds still to hold, for anybody who wants to show "Hold it… 3". */
  get remaining() {
    return Math.max(0, this.hold - this.held);
  }

  get done() {
    return this.held >= this.hold;
  }

  update(dt, s) {
    const step = Number.isFinite(dt) && dt > 0 ? dt : 0;
    if (!s || !s.intact || !s.inside) {
      // A crash, or out of the box (taken off over the grass, rolled off the
      // side, never there): start again.
      this.held = 0;
      this.air = 0;
      return false;
    }
    if (s.onGround) {
      this.air = 0;
      this.held += step;
    } else if (this.held > 0) {
      // A bounce. Short ones keep the clock running; a real one is a take-off.
      this.air += step;
      if (this.air >= this.bounce) {
        this.held = 0;
        this.air = 0;
        return false;
      }
      this.held += step;
    } else {
      // Over the box but never down in it: nothing has started.
      return false;
    }
    return this.held >= this.hold;
  }

  /** The same, from a clock (seconds) instead of a dt. */
  sample(now, s) {
    let dt = 0;
    if (Number.isFinite(now)) {
      if (this.last != null) {
        dt = now - this.last;
        if (dt < 0 || dt > this.maxGap) {
          // Nobody watched in between (or the clock went back): not "continuously".
          this.held = 0;
          this.air = 0;
          dt = 0;
        }
      }
      this.last = now;
    }
    return this.update(dt, s);
  }
}

/** What the rule needs to know about an aeroplane (or a helicopter) right now. */
export function landingState(ac, zones, touchdown = null) {
  if (!ac || !ac.pos) return { intact: false, onGround: false, inside: false };
  return {
    intact: !ac.crashed && !(touchdown && touchdown.crashed),
    onGround: !!ac.onGround,
    inside: inZone(ac.pos, zones),
  };
}

/**
 * The check a mission step calls: three seconds down in one of `zones`.
 *
 * The tracker lives on the mission's own data (a new mission, a new clock),
 * one per key and per step, so a mission with two landings in it does not
 * carry the first one's seconds into the second. `needTouchdown` keeps the
 * old checks' one sensible extra: a real touchdown during this mission
 * (`ctx.data.lastTouchdown`, set by the runner) — an aeroplane that was put
 * on the runway rather than landed on it has not landed.
 */
export function landedInZone(ctx, zones, { key = 'runway', needTouchdown = true, hold, dt } = {}) {
  const ac = ctx && ctx.ac;
  if (!ac || !ac.pos) return false;
  const data = ctx.data || {};
  const t = data.lastTouchdown || null;
  if (needTouchdown && !t) return false;
  const store = data.landingDwell || (data.landingDwell = {});
  const stepIx = ctx.runner && Number.isInteger(ctx.runner.stepIndex) ? ctx.runner.stepIndex : '';
  const k = `${key}#${stepIx}`;
  const dwell = store[k] || (store[k] = new LandingDwell(hold != null ? { hold } : {}));
  const s = landingState(ac, zones, t);
  if (Number.isFinite(ctx.elapsed)) return dwell.sample(ctx.elapsed, s);
  return dwell.update(dt, s);
}

/**
 * Three seconds down on any runway of the loaded map.
 *
 * Fit to be a step's `check` as it stands: the runner calls check(ctx, dt),
 * and a number where the options go is simply no options.
 */
export function landedOnRunway(ctx, opts) {
  const o = opts && typeof opts === 'object' ? opts : {};
  return landedInZone(ctx, runwayZones(), { key: 'runway', ...o });
}

/**
 * Three seconds down on a pad: within `radius` of `pos` (no height limit, as
 * the old pad checks had none). Pads are where helicopters start, so a
 * touchdown during the mission is not asked for unless the caller wants it.
 */
export function landedOnPad(ctx, pos, radius, opts) {
  if (!pos) return false;
  const o = opts && typeof opts === 'object' ? opts : {};
  const key = o.key || `pad:${Math.round(pos.x)},${Math.round(pos.z)},${Math.round(radius)}`;
  return landedInZone(ctx, [padZone(pos, radius)], { needTouchdown: false, ...o, key });
}

/**
 * Debug only — the boxes as wire frames, for a developer to see where they
 * are. Never called by the game; the Dev panel's "Landing hitboxes" button
 * and `?lzdebug` (src/features/landing-zones.js) are the only ways in.
 */
export function landingZoneLines(THREE, zones = runwayZones()) {
  const group = new THREE.Group();
  group.name = 'landing-zone-debug';
  const mat = new THREE.LineBasicMaterial({ color: 0xff00ff, depthTest: false, transparent: true, opacity: 0.85 });
  for (const z of zones) {
    const solid = z.shape === 'disc'
      ? new THREE.CylinderGeometry(z.r, z.r, 6, 32, 1, true)
      : new THREE.BoxGeometry(z.halfWidth * 2, z.below + z.above, z.halfLength * 2);
    const geo = new THREE.EdgesGeometry(solid);
    solid.dispose();
    const line = new THREE.LineSegments(geo, mat);
    line.renderOrder = 999;
    if (z.shape === 'disc') {
      line.position.set(z.cx, (z.elev || 0) + 3, z.cz);
    } else {
      line.position.set(z.cx, z.elev + (z.above - z.below) / 2, z.cz);
      // The box's long side is local Z; turn it onto the runway's axis.
      line.rotation.y = Math.atan2(z.ux, z.uz);
    }
    line.name = `landing-zone-${z.id}`;
    group.add(line);
  }
  return group;
}
