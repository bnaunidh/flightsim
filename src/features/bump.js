/**
 * Bumping into each other — "able to hit other planes, cars, boats and
 * helicopters" (the owner's list, list 2).
 *
 * Until now every other player was a ghost you flew straight through
 * (multiplayer/remotes.js). Now a game has a BUMPING RULE, the same for
 * everybody in it and shown on its lobby card before anybody joins, and on
 * the badge in the game (protocol.js BUMP_RULES):
 *
 *   'pvp'     the five lobbies' rule, and the default: gentle bumps — you
 *             bounce off each other with a BONK and a puff, nobody crashes —
 *             except between two players who BOTH have PvP on, where a hard
 *             knock (12 m/s between you or more) is a crash that tags you
 *             both out (the host decides, pvp.js 'pvp:ram');
 *   'gentle'  gentle bumps only, PvP or not;
 *   'off'     ghosts, as it always was.
 *
 * SAFE PLACES. Nobody is bumped, or hit in PvP, while they carry the ghost
 * bit (./mpplay/shared.js), which every snapshot says:
 *   - for six seconds after arriving in a game or starting again — no
 *     spawn-bumps, however many players start on the same runway;
 *   - an aeroplane or the helicopter with its wheels on the ground —
 *     the runway, the apron and the formation start are never a pile-up;
 *   - tagged out and coming back (pvp.js), and racing (race.js).
 * And never STUCK INSIDE somebody: two who find themselves more than half
 * inside each other at the first touch — somebody spawned or respawned
 * there — or still touching after a second, stop bumping each other until
 * they have properly drawn apart.
 *
 * HOW. Each game moves only its OWN ride: it sees the other where it draws
 * them (the same place its hit tests use), pushes itself out by half the
 * overlap and takes half the knock. The other game does the same from its
 * side, so the two always part, and nobody's game ever moves anybody else.
 */

import * as THREE from '../vendor/three.module.js';
import { registerExtension } from '../game/extensions.js';
import { mp, ch, ride, inGame, toon, blip, ghost } from './mpplay/shared.js';

/** A ride's bumping size: most of what is drawn, so wingtips can touch but a fin alone does not. */
export const BODY = 0.7;
export const SPAWN_SAFE_MS = 6000;
export const STUCK_START = 0.5;
export const STUCK_MS = 1000;
export const APART = 1.3;
export const RESTITUTION = 0.35;
export const MIN_PART = 2.5;
export const CRASH_SPEED = 12;
export const FX_COOL_MS = 800;
export const AIR_DV_MAX = 12;

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/*
 * Both sides of a bump feel it. Each game sees the other where IT draws
 * them, and at a closing speed of 90 m/s two games' guesses can disagree by
 * more than the few metres two aeroplanes overlap: measured in the eight-tab
 * playtest, one side felt the bump and the other flew straight through. So
 * whoever feels it first tells the other ('bump:knock', the push it took and
 * which way), and the other takes the matching push — unless it has just
 * felt the same bump itself. Numbers only; a knock from somebody nowhere near
 * is ignored, and the push is capped, so a modified tab cannot shove anybody
 * across the sky.
 */
export const KNOCK_MAX_DV = 20;
const okId = (v) => Number.isInteger(v) && v >= 0 && v <= 7;
const unit = (v) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1.01;
export const cleanKnock = (d) => (d && okId(d.t) && unit(d.nx) && unit(d.ny) && unit(d.nz) && typeof d.dv === 'number' && d.dv >= 0 && d.dv <= KNOCK_MAX_DV
  ? { t: d.t, nx: d.nx, ny: d.ny, nz: d.nz, dv: d.dv } : null);
ch.define('bump:knock', { validate: cleanKnock, rate: 6 });

const B = {
  sim: null,
  spawnUntil: 0,
  pairs: new Map(),
  stats: { bumps: 0, pushes: 0, stuck: 0, rams: 0, skippedGhost: 0, knocksSent: 0, knocked: 0, swept: 0 },
};

const N = new THREE.Vector3();
const VR = new THREE.Vector3();
const FWD = new THREE.Vector3();

/**
 * One contact, worked out: returns what this side should do, or null for no
 * contact. Pure maths on plain numbers, for the node tests.
 *   me, other: { x, y, z, vx, vy, vz, r, flat }  (`flat` for boats and cars: the push stays level)
 */
export function contact(me, other) {
  let nx = me.x - other.x;
  let ny = me.flat ? 0 : me.y - other.y;
  let nz = me.z - other.z;
  let d = Math.hypot(nx, ny, nz);
  const reach = me.r + other.r + lagSlack(me, other, nx, ny, nz, d);
  if (!(d < reach)) return null;
  if (d < 1e-3) {
    // Exactly on top of each other: part sideways, the same way on both sides would push both one way — use the ids' order at the caller.
    nx = 1;
    ny = 0;
    nz = 0;
    d = 1e-3;
  }
  nx /= d;
  ny /= d;
  nz /= d;
  const pen = reach - d;
  const vn = (me.vx - other.vx) * nx + (me.vy - other.vy) * ny + (me.vz - other.vz) * nz;
  let dv = 0;
  if (vn < 0) dv = -(1 + RESTITUTION) * vn * 0.5;
  // Always parting afterwards, at least a little: no two rides grinding along each other.
  if (vn + 2 * dv < MIN_PART) dv = Math.max(dv, (MIN_PART - vn) * 0.5);
  return { nx, ny, nz, pen, push: pen * 0.5 + 0.05, dv, closing: Math.max(0, -vn), frac: pen / reach };
}

/*
 * Closing fast, a little more room. Each game sees the other where it DRAWS
 * them, and on a busy machine that picture can be ten or twenty metres off
 * (the eight-tab playtest: two aeroplanes flown dead level at each other drew
 * each other 21 m apart at the nearest, and passed through). So the faster
 * two are coming together, the less close they must be to meet: 0.08 s of
 * their closing speed, at most 10 m — nothing at all for a gentle drift, a
 * wingspan for a head-on at 110 m/s. At that speed, passing that close IS a
 * collision, for a ten-year-old.
 */
export const LAG_SLACK_S = 0.08;
export const LAG_SLACK_MAX = 10;
export function lagSlack(me, other, nx, ny, nz, d) {
  const rvx = me.vx - other.vx;
  const rvy = me.flat ? 0 : me.vy - other.vy;
  const rvz = me.vz - other.vz;
  const closing = d > 1e-3 ? -(rvx * nx + rvy * ny + rvz * nz) / d : Math.hypot(rvx, rvy, rvz);
  return Math.min(LAG_SLACK_MAX, Math.max(0, closing) * LAG_SLACK_S);
}

/**
 * Two who went THROUGH each other since the last frame — a hitch, or 100 m/s
 * and more between them: measured in the eight-tab playtest on a busy Mac, two
 * aeroplanes closing head-on at 110 m/s were 27 m apart one frame and past
 * each other the next, and neither game saw them touch. `prev` and `cur` are
 * where I was relative to them then and now: if the line between passes
 * within reach, it was a bump — taken from the side we came from, so both
 * bounce back the way they came, the same as if the frames had been there.
 */
export function swept(prev, cur, me, other) {
  const flat = me.flat;
  const py = flat ? 0 : prev.y;
  const cy = flat ? 0 : cur.y;
  const lp = Math.hypot(prev.x, py, prev.z);
  const reach = me.r + other.r + lagSlack(me, other, prev.x, py, prev.z, lp);
  if (!(lp >= reach)) return null;
  const dx = cur.x - prev.x;
  const dy = cy - py;
  const dz = cur.z - prev.z;
  const len2 = dx * dx + dy * dy + dz * dz;
  if (len2 < 1e-9) return null;
  const u = Math.max(0, Math.min(1, -(prev.x * dx + py * dy + prev.z * dz) / len2));
  if (Math.hypot(prev.x + dx * u, py + dy * u, prev.z + dz * u) >= reach) return null;
  const nx = prev.x / lp;
  const ny = py / lp;
  const nz = prev.z / lp;
  const along = cur.x * nx + cy * ny + cur.z * nz;
  const pen = reach - along;
  const vn = (me.vx - other.vx) * nx + (me.vy - other.vy) * ny + (me.vz - other.vz) * nz;
  let dv = 0;
  if (vn < 0) dv = -(1 + RESTITUTION) * vn * 0.5;
  if (vn + 2 * dv < MIN_PART) dv = Math.max(dv, (MIN_PART - vn) * 0.5);
  return { nx, ny, nz, pen, push: Math.min(30, pen * 0.5 + 0.05), dv, closing: Math.max(0, -vn), frac: 0, swept: true };
}

/**
 * Did we fly into each other (apart last frame, and no further since than
 * our speeds allow), or did one of us just appear there (a respawn, a
 * teleport)? Only the second is "stuck inside each other".
 */
export function flewInto(prev, cur, relVel, dt, reach, flat = false) {
  if (!prev || !(dt > 0)) return false;
  if (Math.hypot(prev.x, flat ? 0 : prev.y, prev.z) < reach) return false;
  const moved = Math.hypot(cur.x - prev.x, cur.y - prev.y, cur.z - prev.z);
  return moved <= Math.hypot(relVel.x, relVel.y, relVel.z) * dt * 2 + 10;
}

function onEnter() {
  B.spawnUntil = now() + SPAWN_SAFE_MS;
  B.pairs.clear();
}

ch.on('mp:start', onEnter);
ch.on('mp:end', () => {
  B.pairs.clear();
  B.spawnUntil = 0;
});
ch.on('mp:leave', (p) => B.pairs.delete(p.id));

ch.on('bump:knock', (d, from) => {
  if (!from || from.id === mp.meId || d.t !== mp.meId || !inGame()) return;
  const sim = B.sim;
  const me = ride(sim);
  if (!me || mp.bumpRuleNow() === 'off' || mp.extraFlags.ghost) return;
  const t = now();
  let pair = B.pairs.get(from.id);
  if (!pair) {
    pair = { since: 0, stuck: false, fxAt: -Infinity, ramAt: -Infinity, feltAt: -Infinity };
    B.pairs.set(from.id, pair);
  }
  // Felt it here already, or stuck inside each other: nothing more to do.
  if (t - (pair.feltAt || -Infinity) < 500 || pair.stuck) return;
  const p = ch.players().find((x) => x.id === from.id);
  if (!p || !p.pos) return;
  const reach = me.radius * BODY + Math.max(2, (p.radius || 6) * BODY);
  if (Math.hypot(p.pos.x - me.pos.x, p.pos.y - me.pos.y, p.pos.z - me.pos.z) > reach * 4 + 30) return;
  const flat = me.kind !== 'air';
  let nx = d.nx;
  let ny = flat ? 0 : d.ny;
  let nz = d.nz;
  const l = Math.hypot(nx, ny, nz) || 1;
  nx /= l;
  ny /= l;
  nz /= l;
  pair.feltAt = t;
  applyPush(me, { nx, ny, nz, push: 0.6, dv: d.dv });
  B.stats.pushes++;
  B.stats.knocked++;
  if (t - pair.fxAt > FX_COOL_MS) {
    pair.fxAt = t;
    B.stats.bumps++;
    toon.puff(me.pos, '#ffffff', { n: 6, size: 3, spread: 6, life: 0.9, up: 1 });
    blip(sim, 'bonk');
  }
});

function applyPush(r, c, sign = 1) {
  if (r.kind === 'air') {
    const ac = r.obj;
    ac.pos.x += c.nx * c.push * sign;
    ac.pos.y += c.ny * c.push * sign;
    ac.pos.z += c.nz * c.push * sign;
    // A knock, not a catapult: however hard the two met, an aeroplane is turned by 12 m/s at most,
    // so a head-on bump never leaves anybody flying backwards into a stall.
    const dv = Math.min(c.dv, AIR_DV_MAX);
    ac.vel.x += c.nx * dv;
    ac.vel.y += c.ny * dv;
    ac.vel.z += c.nz * dv;
    // A cartoon wobble: a little roll and yaw, gone in a second.
    if (ac.omega && c.dv > 1) {
      ac.omega.x += (Math.random() - 0.5) * 0.5;
      ac.omega.z += (Math.random() - 0.5) * 0.9;
    }
    return;
  }
  const v = r.obj;
  v.pos.x += c.nx * c.push;
  v.pos.z += c.nz * c.push;
  // Bounce back if it was driving into them, lose some speed if it was a glancing knock.
  FWD.set(Math.sin((v.heading * Math.PI) / 180), 0, -Math.cos((v.heading * Math.PI) / 180));
  const moving = v.speed || 0;
  // More than a glance, going towards them (forwards or in reverse): bounce back. Otherwise just lose some speed.
  const into = -(FWD.x * c.nx + FWD.z * c.nz) * (Math.sign(moving) || 1);
  if (c.dv > 0.5) v.speed = into > 0.35 ? -0.35 * moving : moving * 0.7;
  if ('jolt' in v) v.jolt = Math.max(v.jolt || 0, Math.min(1, c.dv / 6));
}

function step(sim) {
  const me = ride(sim);
  const rule = mp.bumpRuleNow();
  const t = now();
  // My own safe reasons, for everybody's snapshot of me.
  ghost('bump-spawn', t < B.spawnUntil);
  ghost('bump-ground', !!(me && me.kind === 'air' && me.onGround));
  // A wreck is nobody's to bump into (or to hit in PvP) while the game brings the player back.
  ghost('bump-crashed', !!(me && me.obj && me.obj.crashed));
  if (!me || rule === 'off' || mp.extraFlags.ghost) {
    B.pairs.clear();
    return;
  }
  const mine = { x: me.pos.x, y: me.pos.y, z: me.pos.z, vx: me.vel.x, vy: me.vel.y, vz: me.vel.z, r: me.radius * BODY, flat: me.kind !== 'air' };
  for (const p of ch.players()) {
    if (p.me || !p.pos || !p.visible) continue;
    let pair = B.pairs.get(p.id);
    if (p.ghost) {
      B.stats.skippedGhost++;
      if (pair) pair.since = 0;
      continue;
    }
    const other = { x: p.pos.x, y: p.pos.y, z: p.pos.z, vx: p.vel ? p.vel.x : 0, vy: p.vel ? p.vel.y : 0, vz: p.vel ? p.vel.z : 0, r: Math.max(2, (p.radius || 6) * BODY), flat: false };
    const reach = mine.r + other.r;
    const d = Math.hypot(mine.x - other.x, mine.flat ? 0 : mine.y - other.y, mine.z - other.z);
    if (!pair) {
      pair = { since: 0, stuck: false, fxAt: -Infinity, ramAt: -Infinity, feltAt: -Infinity };
      B.pairs.set(p.id, pair);
    }
    if (pair.stuck) {
      if (d > reach * APART) pair.stuck = false;
      else continue;
    }
    const rel = { x: mine.x - other.x, y: mine.y - other.y, z: mine.z - other.z };
    const prevRel = pair.prev;
    pair.prev = rel;
    let c = contact(mine, other);
    const recent = prevRel && t - (pair.prevAt || 0) < 400;
    // Past each other since the last frame without ever overlapping in one: still a bump.
    if (!c && recent) {
      c = swept(prevRel, rel, mine, other);
      if (c) B.stats.swept++;
    }
    /*
     * Flew INTO each other — apart last frame, and no further since than the two could have flown —
     * however deep the first overlap, as it will be at 90 m/s between them. The eight-tab playtest
     * found a fast head-on taken for "spawned inside each other" and let through as ghosts.
     */
    const flew = !!(recent && flewInto(prevRel, rel, { x: mine.vx - other.vx, y: mine.vy - other.vy, z: mine.vz - other.vz }, (t - pair.prevAt) / 1000, reach, mine.flat));
    pair.prevAt = t;
    if (!c) {
      pair.since = 0;
      continue;
    }
    // Stuck inside each other: somebody arrived there (not by flying), or it has gone on too long. Part as ghosts.
    if ((!pair.since && c.frac > STUCK_START && !flew) || (pair.since && t - pair.since > STUCK_MS)) {
      pair.stuck = true;
      pair.since = 0;
      B.stats.stuck++;
      continue;
    }
    if (!pair.since) pair.since = t;
    // Exactly on top: the lower id goes one way, the higher the other.
    const sign = c.nx === 1 && c.ny === 0 && c.nz === 0 && d < 1e-3 && mp.meId > p.id ? -1 : 1;
    applyPush(me, c, sign);
    B.stats.pushes++;
    // Tell them, once a bump: their game may not have seen it (see bump:knock).
    if (t - (pair.feltAt || -Infinity) > 500) {
      B.stats.knocksSent++;
      ch.send('bump:knock', { t: p.id, nx: -c.nx, ny: -c.ny, nz: -c.nz, dv: Math.min(KNOCK_MAX_DV, c.dv) });
    }
    pair.feltAt = t;
    if (t - pair.fxAt > FX_COOL_MS && c.closing > 1) {
      pair.fxAt = t;
      B.stats.bumps++;
      const at = { x: (mine.x + other.x) / 2, y: (mine.y + other.y) / 2, z: (mine.z + other.z) / 2 };
      toon.puff(at, '#ffffff', { n: 6, size: 3 + Math.min(4, c.closing * 0.2), spread: 6, life: 0.9, up: 1 });
      if (c.closing > 4) toon.word('BONK!', at, sim.camera, 0.8);
      blip(sim, 'bonk');
    }
    // Two players both in PvP, a real knock: a crash — if the host agrees (pvp.js).
    if (rule === 'pvp' && mp.extraFlags.pvp && p.pvp && c.closing >= CRASH_SPEED && t - pair.ramAt > 2500) {
      pair.ramAt = t;
      B.stats.rams++;
      ch.toHost('pvp:ram', { t: p.id });
    }
  }
}

registerExtension({
  id: 'bump',
  startMode(sim) {
    B.sim = sim;
    // Starting again in the same game (back to the runway, a new flight): safe for a moment again.
    if (inGame()) onEnter();
  },
  update(sim) {
    B.sim = sim;
    if (!inGame()) {
      ghost('bump-spawn', false);
      ghost('bump-ground', false);
      ghost('bump-crashed', false);
      return;
    }
    step(sim);
  },
});

/** For the tests and the console. */
export function bumpDebug() {
  return { B, stats: { ...B.stats }, pairs: [...B.pairs.entries()].map(([id, p]) => ({ id, stuck: p.stuck })), rule: mp.bumpRuleNow() };
}
