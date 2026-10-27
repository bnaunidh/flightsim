/**
 * WHAT FRIENDS SEE OF YOU that the snapshot does not carry — scuffs #8, #9
 * and #10 of the multiplayer audit (live v64, .claude/devtools/briefs/mp-scuffs.md):
 *
 *   SMOKE (#8)   C turned the 💨 trail on and saw a big white cloud behind
 *                them; B, flying behind C, saw no trail at all. Now a friend's
 *                smoke is drawn behind their aeroplane on everybody's screen,
 *                in their colour (rainbow too) — the same cloud as your own
 *                (./fun/fx.js), one trail of its own per friend.
 *   PAINT (#9)   the plane is in the hangar livery you picked; your colour
 *                is still on it, as its accent (and on your tag and your
 *                dot on the map). House colours, the default, is the
 *                lobby's "your plane's colour" as before. (The boat and the
 *                van keep their own paint, with your colour as the stripe:
 *                ./multiplayer/remotes.js tintVehicle.)
 *   AWAY (#10)   paused, or in another tab: "⏸ away" on your tag on every
 *                screen — it used to hang in the sky looking alive, and with
 *                PvP on was a free target. While away you are a ghost too
 *                (../multiplayer.js myState): nobody bumps or tags you.
 *   A WRECK (#13) a friend who crashed used to vanish on the spot. Their
 *                wreck stays where it came down for a few seconds
 *                (./multiplayer/remotes.js), and a grey puff of smoke goes up
 *                from it here — smoke, no fire.
 *
 * Small, and rarely changing, so not in the fifteen-a-second snapshot (whose
 * flag byte is full): each player tells the host when theirs changes
 * (look:me, at most four a second), and the host keeps everybody's in one
 * shared value (looks) — so somebody who joins later has it at once, with
 * the rest of the game's state. Checked on the way in: a smoke colour from
 * the list, a livery the game has, two yes/no's. No text.
 */

import * as THREE from '../vendor/three.module.js';
import { registerExtension } from '../game/extensions.js';
import { multiplayer as mp } from './multiplayer.js';
import { getAircraft } from '../aircraft/types.js';
import { LIVERIES } from '../aircraft/liveries.js';
import { currentLivery } from '../core/plane-paint.js';
import { SMOKE_COLOURS, smokeLight } from './fun/smoke.js';
import { SmokeTrail, rainbowAt, linearRGB } from './fun/fx.js';
import { smokeNow } from './fun.js';

const ch = mp.events;
const LIVERY_IDS = new Set(LIVERIES.map((l) => l.id));
/** Puffs per friend's trail: half of your own, and seven friends at most. */
const TRAIL_POOL = 1200;
/** Past this a friend's smoke is not worth laying (it is a few pixels, and their aeroplane is a dot). */
const SMOKE_RANGE_M = 6000;
/** A friend's wreck smokes this long (ms), then the cloud thins away by itself. */
const WRECK_SMOKE_MS = 5000;
const WRECK_GREY = linearRGB([0.42, 0.42, 0.44], [1, 1, 1]);

/** One player's look, checked: anything else is not one. */
export function cleanLook(d) {
  if (!d || typeof d !== 'object' || Array.isArray(d)) return null;
  const c = Number.isInteger(d.c) && d.c >= 0 && d.c < SMOKE_COLOURS.length ? d.c : 0;
  const l = typeof d.l === 'string' && LIVERY_IDS.has(d.l) ? d.l : 'house';
  return { s: d.s === true, c, l, p: d.p === true };
}

/** Everybody's, by player number. */
export function cleanLooks(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const out = {};
  let n = 0;
  for (const k of Object.keys(v)) {
    if (!/^\d{1,3}$/.test(k) || Number(k) > 255) return null;
    const c = cleanLook(v[k]);
    if (!c) return null;
    out[k] = c;
    if (++n > 16) return null;
  }
  return out;
}

ch.define('look:me', { validate: cleanLook, rate: 4 });
ch.define('looks', { from: 'host', validate: cleanLooks });

const K = {
  sim: null,
  /** What this tab last told the host, and over which session (a lobby that re-formed is told again). */
  sent: null,
  sentOn: null,
  /** The host's: everybody's look. */
  map: {},
  timer: null,
  /** Friends' trails: id → { trail, lastSeen }. */
  trails: new Map(),
  group: null,
  time: 0,
  maxPx: 0,
  light: { sun: [1, 1, 1], amb: [1, 1, 1] },
  wind: new THREE.Vector3(),
  rgb: [1, 1, 1],
  stats: { sent: 0, published: 0, emitted: 0 },
};
const _fwd = new THREE.Vector3();
const _tail = new THREE.Vector3();
const _q = new THREE.Quaternion();

/** This player's look now. Away is paused or a hidden tab; nothing comes out of a paused aeroplane. */
export function myLook(sim = K.sim) {
  let smoke = { on: false, colour: 'white' };
  try {
    smoke = smokeNow();
  } catch (e) {
    /* no smoke feature: no smoke */
  }
  const away = !!sim && (sim.state === 'paused' || (typeof document !== 'undefined' && document.hidden === true));
  const ci = SMOKE_COLOURS.findIndex((c) => c.id === smoke.colour);
  // PAINT PER PLANE: the paint of the aeroplane being flown (core/plane-paint.js).
  const paint = sim && sim.settings ? currentLivery(sim) : 'house';
  const l = LIVERY_IDS.has(paint) ? paint : 'house';
  const inPlane = !!sim && sim.mode !== 'drive';
  return { s: !!smoke.on && !away && inPlane, c: ci < 0 ? 0 : ci, l: inPlane ? l : 'house', p: away };
}

/** A friend's look, from the host's shared value — or null. */
export function lookOf(id) {
  const v = ch.active ? ch.getState('looks') : null;
  return v && v[id] ? v[id] : null;
}

function publish() {
  if (!ch.isHost) return;
  K.stats.published++;
  ch.setState('looks', { ...K.map });
}

/** Four times a second while in a game, paused or not: tell the host when this player's look has changed. */
function tick() {
  const sim = K.sim;
  if (!sim || !ch.active || !mp.ready) return;
  const look = myLook(sim);
  const key = `${look.s ? 1 : 0}${look.c}${look.l}${look.p ? 1 : 0}`;
  const on = mp.session;
  if (key === K.sent && on === K.sentOn) return;
  let ok;
  if (ch.isHost) {
    K.map[mp.meId] = look;
    publish();
    ok = true;
  } else ok = ch.toHost('look:me', look);
  if (ok) {
    K.sent = key;
    K.sentOn = on;
    K.stats.sent++;
  }
}

function startTimer() {
  if (K.timer || typeof setInterval !== 'function') return;
  K.timer = setInterval(() => {
    try {
      tick();
    } catch (e) {
      /* next time */
    }
  }, 250);
}
function stopTimer() {
  clearInterval(K.timer);
  K.timer = null;
}

ch.on('look:me', (d, from, meta) => {
  if (!ch.isHost || !meta || !meta.toHost || !from || from.id === mp.meId) return;
  K.map[from.id] = d;
  publish();
});
ch.on('mp:leave', (p) => {
  if (!ch.isHost || !p || !(p.id in K.map)) return;
  delete K.map[p.id];
  publish();
});
ch.on('mp:start', () => {
  K.map = {};
  K.sent = null;
  K.sentOn = null;
  clearTrails();
  startTimer();
});
ch.on('mp:host', () => {
  // The lobby re-formed round this tab: the numbers may be new, so everybody says theirs again (their sessions are new too).
  K.map = {};
  K.sent = null;
  K.sentOn = null;
});
ch.on('mp:end', () => {
  K.map = {};
  K.sent = null;
  K.sentOn = null;
  stopTimer();
  clearTrails();
});

/* ---- friends' smoke ---------------------------------------------------------------------------------- */

function clearTrails() {
  for (const t of K.trails.values()) {
    t.trail.points.removeFromParent();
    t.trail.dispose();
  }
  K.trails.clear();
}

function pixelScale(sim) {
  const cam = sim.camera;
  const r = sim.renderer;
  const pr = r && r.getPixelRatio ? r.getPixelRatio() : 1;
  const hgt = (typeof window !== 'undefined' ? window.innerHeight : 800) * pr;
  return hgt / (2 * Math.tan((((cam && cam.fov) || 68) * Math.PI) / 360));
}

function trailFor(id, sim) {
  let t = K.trails.get(id);
  if (t && t.trail.points.parent) return t;
  if (t) {
    t.trail.dispose();
    K.trails.delete(id);
  }
  const root = K.group && K.group.parent ? K.group : sim && sim.scene;
  if (!root) return null;
  t = { trail: new SmokeTrail(TRAIL_POOL), lastSeen: 0 };
  t.trail.points.name = `mp-smoke-${id}`;
  if (!K.maxPx) {
    try {
      const gl = sim.renderer.getContext();
      const r = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE);
      K.maxPx = r && r[1] > 0 ? r[1] : 64;
    } catch (e) {
      K.maxPx = 64;
    }
  }
  t.trail.setMaxPointPx(K.maxPx);
  root.add(t.trail.points);
  K.trails.set(id, t);
  return t;
}

function drawSmoke(sim, dt) {
  K.time += dt;
  const looks = ch.active ? ch.getState('looks') : null;
  let any = false;
  const wall = typeof performance !== 'undefined' ? performance.now() : 0;
  for (const p of mp.remotes.players.values()) {
    /*
     * A friend's wreck (scuffs #13; ./multiplayer/remotes.js keeps it drawn
     * where it came down): a grey puff of smoke over it for its first few
     * seconds — smoke, no fire, and everybody walked away.
     */
    if (p.wreck && wall - p.wreck.since < WRECK_SMOKE_MS && p.drawn && p.dist < SMOKE_RANGE_M) {
      const t = trailFor(p.id, sim);
      if (t) {
        t.lastSeen = K.time;
        _tail.set(p.drawn.x, p.drawn.y + 1.5, p.drawn.z);
        t.trail.emit(dt, K.time, _tail, WRECK_GREY);
        K.stats.wreckPuffs = (K.stats.wreckPuffs || 0) + 1;
        any = true;
      }
      continue;
    }
    const look = looks && looks[p.id];
    const snap = p.sample && p.sample.snap;
    const air = !!snap && snap.game !== 'boat' && snap.game !== 'car';
    // Not while parked (a smoking aeroplane standing on the apron is a fire: ../fun.js), nor out of sight or very far off.
    const parked = !!snap && snap.onGround && p.sample && Math.hypot(p.sample.vel.x, p.sample.vel.z) < 5;
    const want = !!(look && look.s && air && !parked && p.visible && p.drawn && p.quat && p.dist < SMOKE_RANGE_M);
    let t = K.trails.get(p.id);
    if (!want) {
      if (t) t.trail.cut();
      continue;
    }
    t = trailFor(p.id, sim);
    if (!t) continue;
    any = true;
    t.lastSeen = K.time;
    let back = 5;
    try {
      const ty = getAircraft(snap.type);
      back = (ty && ty.plan && ty.plan.tail) || 5;
    } catch (e) {
      back = 5;
    }
    _q.set(p.quat.x, p.quat.y, p.quat.z, p.quat.w);
    _fwd.set(0, 0, -1).applyQuaternion(_q);
    _tail.set(p.drawn.x, p.drawn.y, p.drawn.z).addScaledVector(_fwd, -back * 0.95);
    const c = SMOKE_COLOURS[look.c] || SMOKE_COLOURS[0];
    const rgb = c.rgb ? linearRGB(c.rgb, K.rgb) : rainbowAt(K.time + p.id * 1.7, K.rgb);
    t.trail.emit(dt, K.time, _tail, rgb);
    K.stats.emitted++;
  }
  if (!K.trails.size) return;
  const w = sim.weather;
  if (w) {
    smokeLight(w.time, w.cond ? w.cond.cloud : 0, K.light);
    if (w.windVector) w.windVector(K.wind);
  }
  const px = pixelScale(sim);
  for (const [id, t] of K.trails) {
    // A friend who has gone, and whose cloud has had its minute and a half: its trail goes.
    if (!mp.remotes.players.has(id) && K.time - t.lastSeen > 90) {
      t.trail.points.removeFromParent();
      t.trail.dispose();
      K.trails.delete(id);
      continue;
    }
    t.trail.update(K.time, px, K.light, w ? K.wind : null);
  }
  return any;
}

/* ---- the plug-in ------------------------------------------------------------------------------------- */

registerExtension({
  id: 'mplook',
  install(sim) {
    K.sim = sim;
    // The tags say "away", and the models wear the livery: asked by ./multiplayer/remotes.js.
    mp.remotes.away = (id) => {
      const l = lookOf(id);
      return !!(l && l.p);
    };
    mp.remotes.liveryOf = (id) => {
      const l = lookOf(id);
      return l ? l.l : null;
    };
  },
  buildWorld(sim, group) {
    // The world's group went with the old world, and every trail in it.
    for (const t of K.trails.values()) t.trail.dispose();
    K.trails.clear();
    K.group = group;
    K.maxPx = 0;
  },
  startMode(sim) {
    K.sim = sim;
  },
  update(sim, dt) {
    K.sim = sim;
    if (!ch.active) {
      if (K.trails.size) clearTrails();
      return;
    }
    drawSmoke(sim, dt);
  },
});

/** For the tests. */
export function lookDebug() {
  return {
    mine: myLook(),
    looks: ch.active ? ch.getState('looks') : null,
    map: { ...K.map },
    trails: [...K.trails.entries()].map(([id, t]) => ({ id, live: t.trail.liveCount(K.time) })),
    stats: { ...K.stats },
  };
}
