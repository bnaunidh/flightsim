/**
 * The walking pilot, in multiplayer.
 *
 * "people on other computers should see you, the human" and "if someone
 * hits you with anything, a plane etc, you get pushed to the ground" — the
 * owner. Three small jobs that join ./onfoot.js and ./knockdown.js to the
 * multiplayer game, so neither of those has to know multiplayer exists:
 *
 *   1. WHERE YOU ARE. multiplayer.walkState says where your pilot is while you
 *      are out on foot, and every snapshot you send carries it
 *      (multiplayer/protocol.js, the walker's tail: 19 bytes, only while
 *      walking). Everybody else's game draws your pilot walking, with your
 *      name tag and your crown if you host (multiplayer/walkers.js).
 *
 *   2. WHAT CAN HIT YOU. Everybody else's aeroplane, helicopter, car and boat,
 *      where YOUR game draws them and at their real size, and the host's AI
 *      aeroplanes as your game draws them, are movers for knockdown.js. Your
 *      own game decides you were hit — nobody else's can say so.
 *
 *   3. EVERYBODY SEES YOU FALL. The moment you are knocked down, one
 *      'pilot:down' event says where, which way you faced, the push and how
 *      high it struck; every other game runs the same ragdoll from there.
 *      WASTED is on your screen only. Your snapshots say you are down until
 *      you are up.
 *
 * Everything on the wire is numbers, checked on the way in (cleanDown).
 */

import { registerExtension } from '../game/extensions.js';
import { multiplayer } from './multiplayer.js';
import { headingOf } from './multiplayer/remotes.js';
import { mirrorTraffic } from './mpworld.js';
import { onFoot } from './onfoot.js';
import { knockdown, onKnock, addMoverSource, profileOf } from './knockdown.js';
import { groundAt } from './staff/walk.js';

const ch = multiplayer.events;
const D2R = Math.PI / 180;

const stats = { sent: 0, heard: 0, drawn: 0, refused: 0 };

/* ---- 1. where you are ------------------------------------------------- */

const WALK = { x: 0, y: 0, z: 0, heading: 0, speed: 0, air: false, down: false, wave: false, wading: false, outfit: 'pilot', knock: 0 };
multiplayer.walkState = () => {
  if (!onFoot.active) return null;
  const w = onFoot.walker;
  const m = onFoot.model;
  WALK.x = w.x;
  WALK.y = w.y;
  WALK.z = w.z;
  WALK.heading = w.heading;
  WALK.down = knockdown.down;
  WALK.speed = WALK.down ? 0 : w.speed;
  WALK.air = !!w.air;
  WALK.wave = !!onFoot.waving;
  WALK.wading = !!w.wading;
  WALK.outfit = (m && m.userData && m.userData.outfit) || 'pilot';
  WALK.knock = knockdown.count & 0xff;
  return WALK;
};

/* ---- 3. everybody sees you fall --------------------------------------- */

const fin = (v, lo, hi) => (Number.isFinite(v) && v >= lo && v <= hi ? v : null);

/** A knock-down off the wire: plain numbers in range, or null. */
export function cleanDown(d) {
  if (!d || typeof d !== 'object') return null;
  const n = Number(d.n);
  if (!Number.isInteger(n) || n < 0 || n > 255) return null;
  const out = {
    n,
    x: fin(Number(d.x), -1e5, 1e5),
    y: fin(Number(d.y), -1e4, 1e4),
    z: fin(Number(d.z), -1e5, 1e5),
    h: fin(Number(d.h), 0, 360),
    vx: fin(Number(d.vx), -150, 150),
    vy: fin(Number(d.vy), -150, 150),
    vz: fin(Number(d.vz), -150, 150),
    hy: fin(Number(d.hy), 0, 3),
  };
  for (const k in out) if (out[k] === null) return null;
  const by = Number(d.by);
  out.by = Number.isInteger(by) && by >= -1 && by < 8 ? by : -1;
  return out;
}

ch.define('pilot:down', { validate: cleanDown, rate: 2 });

const r2 = (v) => Math.round(v * 100) / 100;
onKnock((k) => {
  if (!multiplayer.role) return;
  const ok = ch.send('pilot:down', {
    n: k.seq & 0xff, x: r2(k.x), y: r2(k.y), z: r2(k.z), h: r2(((k.heading % 360) + 360) % 360),
    vx: r2(k.vel.x), vy: r2(k.vel.y), vz: r2(k.vel.z), hy: r2(Math.min(3, Math.max(0, k.hitY))), by: k.by,
  });
  if (ok) stats.sent++;
});

ch.on('pilot:down', (d, from) => {
  if (!from || from.me) return;
  stats.heard++;
  if (multiplayer.remotes.knock(from.id, d)) stats.drawn++;
  else stats.refused++;
});

/* ---- 2. what can hit you ------------------------------------------------ */

const RIDE_WORD = { flight: 'plane', heli: 'helicopter', car: 'car', boat: 'boat' };
const pool = [];
function mover(i) {
  let m = pool[i];
  if (!m) {
    m = {};
    pool[i] = m;
  }
  m.prof = null;
  m.hl = 0;
  m.hw = 0;
  m.height = 0;
  m.lift = 0;
  m.vy = 0;
  m.label = '';
  return m;
}

function players(sim, add, w) {
  if (!multiplayer.role) return;
  const R = multiplayer.remotes;
  let n = 0;
  for (const p of ch.players()) {
    if (p.me || !p.visible || !p.pos || !p.quat || !p.vel || !p.ride) continue;
    if (Math.abs(p.pos.x - w.x) > 160 || Math.abs(p.pos.z - w.z) > 160) continue;
    let gone = false;
    try {
      gone = !!(R.hidden && R.hidden(p.id));
    } catch (e) {
      gone = false;
    }
    if (gone) continue;
    const game = p.ride.game;
    const m = mover(n++);
    m.x = p.pos.x;
    m.y = p.pos.y;
    m.z = p.pos.z;
    m.heading = headingOf(p.quat);
    m.vx = p.vel.x;
    m.vy = p.vel.y;
    m.vz = p.vel.z;
    if (game === 'car') {
      m.hl = 2.4;
      m.hw = 1.05;
      m.height = 2.2;
    } else if (game === 'boat') {
      m.hl = 3.5;
      m.hw = 1.15;
      m.height = 1.6;
    } else {
      const prof = profileOf(p.ride.type);
      if (!prof) continue;
      m.prof = prof;
      m.lift = p.onGround ? 0 : Math.max(0, p.pos.y - groundAt(p.pos.x, p.pos.z) - (prof.cgH || 1));
    }
    m.kind = 'player';
    m.by = p.id;
    m.words = `Hit by ${p.name}’s ${RIDE_WORD[game] || 'plane'}.`;
    add(m);
  }
  // The host's AI aeroplanes, where this game draws them (the host's own game has them in sim.traffic).
  if (!ch.isHost) {
    for (const t of mirrorTraffic().values()) {
      if (!(t.v > 1) || Math.abs(t.dx - w.x) > 160 || Math.abs(t.dz - w.z) > 160) continue;
      const prof = profileOf(t.type);
      if (!prof) continue;
      const m = mover(n++);
      const h = t.dh * D2R;
      m.x = t.dx;
      m.y = t.dy;
      m.z = t.dz;
      m.heading = t.dh;
      m.vx = Math.sin(h) * t.v;
      m.vz = -Math.cos(h) * t.v;
      m.vy = t.vs || 0;
      m.prof = prof;
      m.lift = t.f & 2 ? 0 : Math.max(0, t.dy - groundAt(t.dx, t.dz) - (prof.cgH || 1));
      m.kind = 'traffic';
      m.by = -1;
      m.words = t.f & 2 ? 'Hit by a taxiing aeroplane.' : 'Hit by a low aeroplane.';
      add(m);
    }
  }
}
addMoverSource(players);

registerExtension({ id: 'pilot-mp' });

/** For the tests and the console. */
export function pilotDebug() {
  return { stats: { ...stats }, walk: multiplayer.walkState ? multiplayer.walkState() : null };
}
