/**
 * PvP — "able to shoot people — pvp off/on" (the owner's list, list 2).
 *
 * WHAT A KID SEES. On the Multiplayer screen, and on the badge in the game,
 * a PvP switch: OFF until they turn it on. With it ON they can tag other
 * players who have it on too — and only them. Space (in the air, on the
 * water or on the road) or the big FIRE button shoots bright paint pellets
 * from the nose; a hit is a coloured SPLAT and a "POW!", and takes one of
 * five hearts. The last heart is a TAG: a cartoon POOF with stars, "TAGGED!"
 * across the screen, the camera circling the puff — and three seconds later
 * they are back in the air where they were, a little higher, inside a shield
 * bubble for five seconds. A small scoreboard on the badge counts tags. A
 * player with PvP OFF sees the pellets and the puffs, and nothing can touch
 * them.
 *
 * Nothing here is a real weapon or a real wound: pellets, puffs, stars and
 * comic words (./mpplay/shared.js).
 *
 * WHO DECIDES (./pvp/rules.js has the rules in full). The HOST. The
 * shooter's game sees its own pellet meet somebody — where it draws them —
 * and claims the hit; the host checks both have PvP on and are in play, that
 * the shooter was firing, and that they were near enough, and only then
 * says "pvp:ouch" or "pvp:down" to everybody. The scores are the host's
 * shared state, which everybody keeps, so a new host after a lobby re-forms
 * carries on the same game. Everything on the wire is numbers and player
 * ids; nothing anybody could type.
 *
 * Wired through the plug-in layer and multiplayer.events; the only thing it
 * asks of multiplayer.js is the switch it keeps in the profile (setPvp).
 */

import * as THREE from '../vendor/three.module.js';
import { registerExtension, extLayer } from '../game/extensions.js';
import { registerActions, isKey, keyName, live as liveText } from '../flight/input.js';

/*
 * The trigger, in the one registry: Settings → Controls → Multiplayer & PvP.
 * Space by default, which it shares by design with the brakes, the van's
 * handbrake and the boat's crash stop — PvP takes it only in the air.
 */
registerActions({
  pvpFire: { label: 'PvP: shoot paint pellets', group: 'Multiplayer & PvP', ctx: ['plane', 'heli', 'boat', 'car'], default: ['Space'] },
});
import { heightAt } from '../world/terrain.js';
import { performanceFor } from '../aircraft/types.js';
import * as R from './pvp/rules.js';
import { mp, ch, ride, forwardOf, inGame, who, esc, blip, toon, chip, bigCard, feed, ghost, ghostReasons, injectStyle } from './mpplay/shared.js';

export const FIRE_HZ = 8;
export const PELLET_SPEED = 430;
export const PELLET_LIFE = 1.3;

ch.define('pvp:want', { validate: R.cleanWant, rate: 1 });
ch.define('pvp:fire', { validate: R.cleanFire, rate: 4 });
ch.define('pvp:hit', { validate: R.cleanHit, rate: 12 });
ch.define('pvp:ram', { validate: R.cleanRam, rate: 2 });
ch.define('pvp:ouch', { from: 'host', validate: R.cleanOuch, rate: 60 });
ch.define('pvp:down', { from: 'host', validate: R.cleanDown, rate: 20 });
ch.define('pvp', { from: 'host', validate: R.cleanState });

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

const P = {
  sim: null,
  judge: null,
  timer: null,
  lastPub: -Infinity,
  state: null,
  fireKey: false,
  fireBtn: false,
  fireAcc: 0,
  sentFire: false,
  shots: 0,
  side: 1,
  down: null,
  shieldUntil: 0,
  remoteFiring: new Map(),
  remoteAcc: new Map(),
  saidSpace: new Set(),
  blurHooked: false,
  fireSpot: null,
  lastWord: 0,
  lastWantAt: -Infinity,
  els: null,
  stats: { shots: 0, claims: 0, ouch: 0, downs: 0, respawns: 0, tagsByMe: 0, spaceLines: 0 },
};

/* ---- reading the shared state ---------------------------------------------------- */

export function row(id) {
  return R.rowOf(P.state, id);
}
export function myRow() {
  return inGame() ? row(mp.meId) : null;
}
function live(r) {
  return !!(r && r.on && !r.arming && !r.down);
}
function hearts(hp) {
  return '♥'.repeat(Math.max(0, hp)) + '♡'.repeat(Math.max(0, R.HEARTS - hp));
}
function where(id) {
  if (id === mp.meId) {
    const r = ride(P.sim);
    return r ? r.pos : null;
  }
  const p = ch.players().find((x) => x.id === id);
  return p && p.pos ? p.pos : null;
}

/* ---- the host --------------------------------------------------------------------- */

function publish(force = false) {
  const j = P.judge;
  if (!j || !ch.isHost) return;
  const t = now();
  if (!j.dirty && !force) return;
  if (!force && t - P.lastPub < 200) return;
  j.dirty = false;
  P.lastPub = t;
  ch.setState('pvp', j.state(t));
}

function startHost(carry) {
  P.judge = new R.PvpJudge({ now });
  if (carry) P.judge.load(carry, now());
  for (const p of ch.players()) P.judge.join(p.id);
  publish(true);
}

function distance(a, b) {
  const pa = where(a);
  const pb = where(b);
  if (!pa || !pb) return null;
  return Math.hypot(pa.x - pb.x, pa.y - pb.y, pa.z - pb.z);
}

function isGhostNow(id) {
  if (id === mp.meId) return !!mp.extraFlags.ghost;
  const p = ch.players().find((x) => x.id === id);
  return !!(p && p.ghost);
}

ch.on('pvp:want', (d, from, meta) => {
  if (!ch.isHost || !meta || !meta.toHost || !P.judge) return;
  P.judge.want(from.id, d.on, now());
  publish(true);
});
ch.on('pvp:fire', (d, from) => {
  if (!from) return;
  if (ch.isHost && P.judge) P.judge.fire(from.id, d.on, now());
  if (from.id !== mp.meId) P.remoteFiring.set(from.id, !!d.on);
});
ch.on('pvp:hit', (d, from, meta) => {
  if (!ch.isHost || !meta || !meta.toHost || !P.judge) return;
  // On the ground, just arrived, racing: nobody is hit there, whatever a tab claims.
  if (isGhostNow(d.t)) {
    P.judge._refuse('target is safe (ground, spawn or race)');
    return;
  }
  // Part 3b: a player an admin has frozen hits nobody while frozen, whatever their tab claims.
  const shooter = ch.players().find((p) => p.id === from.id);
  if (shooter && shooter.frozen) {
    P.judge._refuse('shooter is frozen by an admin');
    return;
  }
  const r = P.judge.hit(from.id, d.t, distance(from.id, d.t), now());
  if (!r.ok) return;
  if (r.down) ch.send('pvp:down', { t: d.t, by: from.id, how: 0 }, { self: true });
  else ch.send('pvp:ouch', { t: d.t, by: from.id, hp: r.hp }, { self: true });
  publish(true);
});
ch.on('pvp:ram', (d, from, meta) => {
  if (!ch.isHost || !meta || !meta.toHost || !P.judge) return;
  if (mp.bumpRuleNow() !== 'pvp') return;
  const r = P.judge.ram(from.id, d.t, distance(from.id, d.t), now());
  if (!r.ok) return;
  ch.send('pvp:down', { t: from.id, by: -1, how: 1 }, { self: true });
  ch.send('pvp:down', { t: d.t, by: -1, how: 1 }, { self: true });
  publish(true);
});
ch.on('pvp:ouch', (d) => onOuch(d));
ch.on('pvp:down', (d) => onDown(d));
ch.onState('pvp', (v) => {
  P.state = v || null;
});

ch.on('mp:start', ({ role }) => {
  resetLocal();
  if (role === 'host') startHost(null);
  startTimer();
});
ch.on('mp:host', () => {
  // This tab hosts now (the lobby re-formed round it): carry on the same scores.
  startHost(ch.getState('pvp'));
});
ch.on('mp:end', () => {
  stopTimer();
  P.judge = null;
  P.state = null;
  resetLocal();
});
ch.on('mp:join', (p) => {
  if (ch.isHost && P.judge) {
    P.judge.join(p.id);
    publish(true);
  }
});
ch.on('mp:leave', (p) => {
  P.remoteFiring.delete(p.id);
  if (ch.isHost && P.judge) {
    P.judge.leave(p.id);
    publish(true);
  }
});
mp.onPvpChange(() => sendWant(true));

/** Tell the host what the switch says: at the start, on a change, and again if the host has not caught up. */
function sendWant(force = false) {
  if (!inGame()) return;
  const want = !!(mp.profile && mp.profile.pvp);
  const r = myRow();
  const t = now();
  if (!force) {
    if (r && (r.arming || r.on === want)) return;
    if (!r && !want) return;
    if (t - P.lastWantAt < 2500) return;
  }
  P.lastWantAt = t;
  ch.toHost('pvp:want', { on: want });
}

function startTimer() {
  stopTimer();
  // Ten times a second whatever the game is doing — paused, in a menu: the host's clock and the switch.
  P.timer = setInterval(() => {
    try {
      if (!ch.active) return;
      if (ch.isHost && P.judge) {
        P.judge.tick(now());
        publish(false);
      }
      sendWant(false);
      // Paused with the trigger down: stop firing, for everybody.
      if (P.sentFire && (!P.sim || P.sim.state !== 'flying')) setFiring(false);
    } catch (e) {
      /* next tick */
    }
  }, 100);
}
function stopTimer() {
  clearInterval(P.timer);
  P.timer = null;
}

function resetLocal() {
  if (P.down) endDown(false);
  P.down = null;
  P.fireKey = false;
  P.fireBtn = false;
  P.sentFire = false;
  P.shieldUntil = 0;
  P.remoteFiring.clear();
  P.remoteAcc.clear();
  P.lastWantAt = -Infinity;
  P.saidSpace.clear();
}

/**
 * Once a game for each ride, the moment PvP is live in it: what Space does
 * now. In the van Space was the handbrake and in the boat the crash stop, and
 * with PvP on it shoots — the controls card still says the old thing.
 */
function sayWhatSpaceDoes(sim, me) {
  const k = me.kind === 'air' ? (me.heli ? 'heli' : 'air') : me.kind;
  if (P.saidSpace.has(k)) return;
  P.saidSpace.add(k);
  const touch = typeof document !== 'undefined' && document.documentElement.classList.contains('is-touch-device');
  const f = keyName('pvpFire', sim);
  const line = touch
    ? 'PvP is on: tap the red FIRE button to shoot paint pellets'
    : liveText(k === 'car'
      ? `PvP is on: ${f} shoots paint pellets now — brake with ${keyName('carBrake', sim)} (${keyName('carHandbrake', sim)} is the handbrake again with PvP off)`
      : k === 'boat'
        ? `PvP is on: ${f} shoots paint pellets now — slow her down with ${keyName('boatSlower', sim)}`
        : `PvP is on: ${f} or FIRE shoots paint pellets in the air — on the ground ${keyName('brakes', sim)} is still the brakes`);
  P.stats.spaceLines++;
  if (sim.hud && typeof sim.hud.notify === 'function') sim.hud.notify(line, 'info', 6);
}

/* ---- hits and tags, on every screen ------------------------------------------------ */

function onOuch(d) {
  const pos = where(d.t);
  const by = who(d.by);
  P.stats.ouch++;
  if (pos) {
    toon.puff(pos, by.colour, { n: 5, size: 3.5, spread: 5, life: 0.8, up: 1 });
    const t = now();
    if (t - P.lastWord > 350 && P.sim) {
      P.lastWord = t;
      toon.word(Math.random() < 0.5 ? 'POW!' : 'SPLAT!', pos, P.sim.camera, 0.7);
    }
  }
  if (d.t === mp.meId) {
    flash(by.colour);
    blip(P.sim, 'bonk');
  }
  if (d.by === mp.meId) {
    hitMarker();
    blip(P.sim, 'ding');
  }
}

function onDown(d) {
  P.stats.downs++;
  const pos = where(d.t);
  const t = who(d.t);
  const by = d.by >= 0 ? who(d.by) : null;
  if (pos) {
    const c = pos.clone ? pos.clone() : new THREE.Vector3(pos.x, pos.y, pos.z);
    toon.puff(c, '#ffffff', { n: 10, size: 9, spread: 14, life: 1.6, up: 3 });
    toon.puff(c, by ? by.colour : t.colour, { n: 8, size: 6, spread: 10, life: 1.3, up: 2 });
    toon.starBurst(c, 7, 12);
    if (P.sim) toon.word(d.how === 1 ? 'BONK!' : 'POOF!', c, P.sim.camera, 1.2);
  }
  if (by) feed(`<b>${esc(by.name)}</b> tagged <b>${esc(t.name)}</b>`, by.colour);
  else feed(`<b>${esc(t.name)}</b> crashed out — bumped in PvP`, t.colour);
  if (d.t === mp.meId) startDown(d, by);
  else if (d.by === mp.meId) {
    P.stats.tagsByMe++;
    bigCard('TAGGED!', `You tagged ${t.name}! +1`, 1.8);
    blip(P.sim, 'pop');
  }
}

/* ---- being tagged: the moment, and coming back ------------------------------------- */

function startDown(d, by) {
  const sim = P.sim;
  const r = ride(sim);
  if (!sim || !r) return;
  setFiring(false);
  P.down = {
    t0: now(), until: now() + R.DOWN_MS - 120, by: d.by, how: d.how, kind: r.kind, heli: r.heli,
    pos: r.pos.clone(), quat: r.quat.clone(), heading: r.kind === 'air' ? headingOf(r.quat) : (r.obj.heading || 0),
    agl: r.kind === 'air' ? Math.max(0, r.pos.y - Math.max(0, heightAt(r.pos.x, r.pos.z))) : 0, spin: 0, left: 3,
  };
  if (r.model) r.model.visible = false;
  bigCard(d.how === 1 ? 'BONK!' : 'TAGGED!', by ? `${by.name} got you — back in 3…` : 'You crashed into each other — back in 3…', 2.9);
  blip(sim, 'pop');
}

function headingOf(q) {
  const f = forwardOf(q, new THREE.Vector3());
  let h = (Math.atan2(f.x, -f.z) * 180) / Math.PI;
  if (h < 0) h += 360;
  return h;
}

/** Held where it was while the puff clears: no falling out of the sky, no crash. */
function holdDown(sim) {
  const D = P.down;
  const r = ride(sim);
  if (!D || !r) return;
  if (r.kind === 'air') {
    const ac = r.obj;
    ac.pos.copy(D.pos);
    ac.vel.set(0, 0, 0);
    if (ac.omega) ac.omega.set(0, 0, 0);
    ac.quat.copy(D.quat);
  } else {
    r.obj.pos.copy(D.pos);
    r.obj.speed = 0;
    r.obj.vel.set(0, 0, 0);
  }
  if (r.model) r.model.visible = false;
  const left = Math.max(1, Math.ceil((D.until - now()) / 1000));
  if (left !== D.left) {
    D.left = left;
    bigCard(D.how === 1 ? 'BONK!' : 'TAGGED!', `Back in ${left}…`, 1.2);
  }
}

/** Back in the game: where you were, a bit higher, going fast enough to fly, inside a shield. */
function endDown(respawn = true) {
  const D = P.down;
  P.down = null;
  const sim = P.sim;
  const r = ride(sim);
  if (r && r.model) r.model.visible = true;
  if (!respawn || !D || !r) return;
  P.stats.respawns++;
  if (r.kind === 'air') {
    const ac = r.obj;
    const ground = Math.max(0, heightAt(D.pos.x, D.pos.z));
    let altAGL;
    let speed;
    if (D.heli) {
      altAGL = Math.max(40, Math.min(250, D.agl + 20));
      speed = 0;
    } else {
      altAGL = Math.max(260, Math.min(900, D.agl + 120));
      let stall = 30;
      let vne = 250;
      try {
        const perf = performanceFor(sim.aircraftType ? sim.aircraftType.id : 'skylark');
        stall = perf.stallClean / 1.94384;
        vne = perf.vne / 1.94384;
      } catch (e) {
        /* a trainer's numbers */
      }
      speed = Math.min(stall * 1.6, vne * 0.7);
    }
    ac.reset({ pos: new THREE.Vector3(D.pos.x, 0, D.pos.z), headingDeg: D.heading, speed, altAGL, engineOn: true, gearDown: false });
    if (ac.pos.y < ground + 20) ac.pos.y = ground + 20;
    ac.controls.throttle = D.heli ? 0.5 : 0.7;
    if (sim.input) {
      sim.input.throttleTarget = ac.controls.throttle;
      if (sim.input.out) sim.input.out.throttle = ac.controls.throttle;
    }
  } else {
    r.obj.reset({ pos: D.pos.clone(), headingDeg: D.heading });
  }
  if (typeof mp.snapCamera === 'function') mp.snapCamera(sim);
  P.shieldUntil = now() + R.SHIELD_MS;
  bigCard('BACK IN!', 'Shield on for five seconds', 1.4);
}

/* ---- shooting ------------------------------------------------------------------------- */

function setFiring(on) {
  if (on === P.sentFire) return;
  P.sentFire = on;
  if (inGame()) ch.send('pvp:fire', { on }, { self: true });
  if (on) P.shieldUntil = 0;
}

const RIGHT = new THREE.Vector3();
const UPV = new THREE.Vector3();
const FROM = new THREE.Vector3();
const VEL = new THREE.Vector3();
const FW = new THREE.Vector3();

function emit(pos, quat, vel, radius, colour, mine, owner, kind) {
  forwardOf(quat, FW);
  RIGHT.set(1, 0, 0).applyQuaternion(quat);
  UPV.set(0, 1, 0).applyQuaternion(quat);
  P.side = -P.side;
  FROM.copy(pos).addScaledVector(FW, radius * 0.7).addScaledVector(RIGHT, P.side * radius * 0.35).addScaledVector(UPV, kind === 'air' ? 0.2 : 1.4);
  if (vel) VEL.set(vel.x || 0, vel.y || 0, vel.z || 0);
  else VEL.set(0, 0, 0);
  VEL.addScaledVector(FW, kind === 'air' ? PELLET_SPEED : PELLET_SPEED * 0.75);
  return toon.pellet(FROM, VEL, colour, PELLET_LIFE, mine, owner);
}

function shoot(sim) {
  const r = ride(sim);
  if (!r) return;
  emit(r.pos, r.quat, r.vel, r.radius, mp.profile.colour, true, mp.meId, r.kind);
  P.stats.shots++;
  if (P.stats.shots % 2 === 0) blip(sim, 'pew');
}

/** My pellets against everybody I can hit, where I draw them. */
function hitTest() {
  const targets = [];
  for (const p of ch.players()) {
    if (p.me || !p.pos || !p.visible || !p.pvp || p.ghost) continue;
    if (!live(row(p.id))) continue;
    const rr = row(p.id);
    if (rr && rr.shield) continue;
    targets.push({ id: p.id, pos: p.pos, r: Math.max(5, (p.radius || 6) * 0.8) });
  }
  for (const pel of toon.pel) {
    if (!pel.mine || pel.dead) continue;
    // Into the ground or the sea: gone, with a little puff of dust.
    const g = heightAt(pel.pos.x, pel.pos.z);
    if (pel.pos.y < Math.max(g, 0)) {
      pel.dead = true;
      continue;
    }
    for (const t of targets) {
      if (R.segmentHitsSphere(pel.prev.x, pel.prev.y, pel.prev.z, pel.pos.x, pel.pos.y, pel.pos.z, t.pos.x, t.pos.y, t.pos.z, t.r)) {
        pel.dead = true;
        P.stats.claims++;
        ch.toHost('pvp:hit', { t: t.id });
        toon.puff(pel.pos, mp.profile.colour, { n: 2, size: 2, spread: 3, life: 0.4, up: 0 });
        break;
      }
    }
  }
}

/** Everybody else who is firing: their pellets, drawn from where I see them (looks only — never hit-tested here). */
function remoteFire(dt) {
  if (!P.remoteFiring.size) return;
  const list = ch.players();
  for (const [id, on] of P.remoteFiring) {
    if (!on) continue;
    const p = list.find((x) => x.id === id);
    if (!p || !p.pos || !p.quat || !p.visible) continue;
    let acc = (P.remoteAcc.get(id) || 0) + dt;
    const q = new THREE.Quaternion(p.quat.x, p.quat.y, p.quat.z, p.quat.w);
    const kind = p.ride && (p.ride.game === 'boat' || p.ride.game === 'car') ? p.ride.game : 'air';
    while (acc >= 1 / FIRE_HZ) {
      acc -= 1 / FIRE_HZ;
      emit(p.pos, q, p.vel, Math.max(3, (p.radius || 6)), p.colour, false, id, kind);
    }
    P.remoteAcc.set(id, acc);
  }
}

/* ---- on the screen ---------------------------------------------------------------------- */

const UI_CSS = `
.pvp-reticle { position: fixed; left: 0; top: 0; width: 34px; height: 34px; margin: -17px 0 0 -17px; pointer-events: none; z-index: 29;
  border: 2px solid rgba(255,255,255,0.85); border-radius: 50%; box-shadow: 0 0 0 1px rgba(0,0,0,0.35); transition: border-color 0.1s, transform 0.1s; }
.pvp-reticle::before, .pvp-reticle::after { content: ''; position: absolute; left: 50%; top: 50%; background: rgba(255,255,255,0.9); }
.pvp-reticle::before { width: 2px; height: 10px; margin: -5px 0 0 -1px; }
.pvp-reticle::after { width: 10px; height: 2px; margin: -1px 0 0 -5px; }
.pvp-reticle.is-on { border-color: #ff5a4f; }
.pvp-reticle.is-hit { transform: scale(1.35); border-color: #ffd23f; }
.pvp-reticle[hidden], .pvp-fire[hidden] { display: none !important; }
.pvp-fire { position: fixed; right: 18px; top: 46%; width: 88px; height: 88px; border-radius: 50%; z-index: 32; pointer-events: auto; touch-action: none;
  user-select: none; -webkit-user-select: none; cursor: pointer; border: 3px solid #1b1030;
  background: radial-gradient(circle at 35% 30%, #ff9a7a, #ff5a4f 60%, #c8372f); color: #fff; font: 900 20px "Arial Black", Impact, sans-serif;
  display: flex; flex-direction: column; align-items: center; justify-content: center; box-shadow: 0 5px 0 #1b1030, 0 8px 18px rgba(0,0,0,0.35); }
.pvp-fire small { font: 700 10px var(--font), sans-serif; opacity: 0.85; }
.pvp-fire.is-down { transform: translateY(3px); box-shadow: 0 2px 0 #1b1030; }
.is-touch-device .pvp-fire small { display: none; }
.pvp-flash { position: fixed; inset: 0; pointer-events: none; z-index: 28; opacity: 0; transition: opacity 0.35s; box-shadow: inset 0 0 90px 30px var(--pvp-flash, #ff5a4f); }
.pvp-flash.is-on { opacity: 0.8; transition: none; }
`;

function els() {
  if (P.els || typeof document === 'undefined') return P.els;
  injectStyle();
  if (!document.getElementById('ifs-pvp-style')) {
    const st = document.createElement('style');
    st.id = 'ifs-pvp-style';
    st.textContent = UI_CSS;
    document.head.appendChild(st);
  }
  const layer = extLayer();
  const reticle = document.createElement('div');
  reticle.className = 'pvp-reticle';
  reticle.hidden = true;
  const fire = document.createElement('button');
  fire.type = 'button';
  fire.className = 'pvp-fire';
  fire.hidden = true;
  fire.setAttribute('aria-label', 'Fire');
  fire.innerHTML = `FIRE<small>or ${keyName('pvpFire')}</small>`;
  const press = (on) => (e) => {
    if (e && e.cancelable) e.preventDefault();
    P.fireBtn = on;
    fire.classList.toggle('is-down', on);
  };
  fire.addEventListener('pointerdown', press(true));
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) fire.addEventListener(ev, press(false));
  const flashEl = document.createElement('div');
  flashEl.className = 'pvp-flash';
  layer.append(reticle, fire, flashEl);
  P.els = { reticle, fire, flash: flashEl, board: null };
  return P.els;
}

export const FIRE_PX = 88;

/**
 * Where FIRE goes: the first of a few places that covers nothing that stays
 * on the screen — the minimap, the instrument strip, the badge and, on a
 * tablet, every touch control. Pure, for the node tests: `avoid` is a list of
 * { l, t, r, b, touch } in screen pixels, `mm` the minimap's (or null).
 *
 * On a tablet it sits straight above the controls under the right thumb —
 * the throttle and the pads, the van's pedals, the boat's lever — lined up
 * with their right edge, so the thumb slides up to it. (It went "left of the
 * minimap", which on a tablet is the top-left corner: it covered the whole
 * minimap and was away from both thumbs — the reviewer's iPad, 1024x768.) On
 * a laptop, just left of the minimap, level with its middle, as before.
 */
export function fireSpot({ w, h, size = FIRE_PX, avoid = [], touch = false, mm = null }) {
  const gap = 12;
  const pad = 6;
  const hits = (x, y) => avoid.some((a) => x < a.r + pad && x + size > a.l - pad && y < a.b + pad && y + size > a.t - pad);
  const fits = (x, y) => x >= 8 && y >= 8 && x + size <= w - 8 && y + size <= h - 8;
  const cands = [];
  if (touch) {
    const right = avoid.filter((a) => a.touch && (a.l + a.r) / 2 > w / 2);
    if (right.length) {
      const top = Math.min(...right.map((a) => a.t));
      cands.push([Math.max(...right.map((a) => a.r)) - size, top - gap - size]);
      // A short screen (a phone on its side): left of that cluster, down by the bottom edge.
      cands.push([Math.min(...right.map((a) => a.l)) - gap - size, h - 20 - size]);
    }
    cands.push([w - size - 18, Math.round(h * 0.42)]);
  } else if (mm) {
    cands.push([mm.l - size - 14, Math.round(mm.t + (mm.b - mm.t) / 2 - size / 2)]);
  }
  cands.push([w - size - 18, Math.round(h * 0.46)]);
  for (const [x, y] of cands) if (fits(x, y) && !hits(x, y)) return { x: Math.round(x), y: Math.round(y), how: 'place' };
  // Nothing free there: anywhere on the right half, from the bottom up, nearest the right edge first.
  for (let y = h - size - 20; y >= 8; y -= 12) {
    for (let x = w - size - 18; x >= w / 2; x -= 12) if (!hits(x, y)) return { x: Math.round(x), y: Math.round(y), how: 'scan' };
  }
  const [x, y] = cands[0];
  return { x: Math.round(Math.min(Math.max(8, x), w - size - 8)), y: Math.round(Math.min(Math.max(8, y), h - size - 8)), how: 'squeezed' };
}

/** What FIRE must not cover, measured: only things that stay put — never a subtitle or a toast that comes and goes, or FIRE would jump from under a thumb. */
function screenToAvoid() {
  const out = [];
  const add = (el, touch = false) => {
    if (!el || el.hidden) return;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return;
    out.push({ l: r.left, t: r.top, r: r.right, b: r.bottom, touch });
  };
  for (const layer of document.querySelectorAll('.hud.is-touch .touch-layer')) for (const c of layer.children) add(c, true);
  for (const sel of ['.minimap', '.hud-buttons', '.hud-tray', '.hud-left', '.hud-rotor', '.mp-badge', '.race-hud']) for (const el of document.querySelectorAll(sel)) add(el);
  return out;
}

function placeFire(sim, fire) {
  const t = now();
  if (t - (fire._at || -Infinity) < 500) return;
  fire._at = t;
  const avoid = screenToAvoid();
  const mm = sim.minimap;
  const c = mm && mm.visible && mm.canvas && mm.canvas.getBoundingClientRect ? mm.canvas.getBoundingClientRect() : null;
  const spot = fireSpot({
    w: window.innerWidth, h: window.innerHeight, avoid, touch: avoid.some((a) => a.touch),
    mm: c && c.width > 20 ? { l: c.left, t: c.top, r: c.right, b: c.bottom } : null,
  });
  P.fireSpot = spot;
  const key = `${spot.x}|${spot.y}`;
  if (fire._key === key) return;
  fire._key = key;
  fire.style.left = `${spot.x}px`;
  fire.style.top = `${spot.y}px`;
  fire.style.right = 'auto';
}

let flashT = null;
function flash(colour) {
  const e = els();
  if (!e) return;
  e.flash.style.setProperty('--pvp-flash', colour);
  e.flash.classList.add('is-on');
  clearTimeout(flashT);
  flashT = setTimeout(() => e.flash.classList.remove('is-on'), 60);
}
let hitT = null;
function hitMarker() {
  const e = els();
  if (!e) return;
  e.reticle.classList.add('is-hit');
  clearTimeout(hitT);
  hitT = setTimeout(() => e.reticle.classList.remove('is-hit'), 140);
}

const AIM = new THREE.Vector3();
const TO = new THREE.Vector3();
function drawReticle(sim, r, on) {
  const e = els();
  if (!e) return;
  const show = on && r && sim.camera && !(sim.hud && sim.hud.hidden) && !P.down;
  if (!show) {
    if (!e.reticle.hidden) e.reticle.hidden = true;
    return;
  }
  forwardOf(r.quat, FW);
  AIM.copy(r.pos).addScaledVector(FW, 260).project(sim.camera);
  if (AIM.z > 1 || Math.abs(AIM.x) > 1.2 || Math.abs(AIM.y) > 1.2) {
    e.reticle.hidden = true;
    return;
  }
  e.reticle.hidden = false;
  e.reticle.style.transform = `translate(${((AIM.x + 1) / 2) * window.innerWidth}px, ${((1 - AIM.y) / 2) * window.innerHeight}px)`;
  // Red when somebody you can tag is along the line.
  let lined = false;
  for (const p of ch.players()) {
    if (p.me || !p.pos || !p.pvp || p.ghost || !live(row(p.id))) continue;
    TO.set(p.pos.x - r.pos.x, p.pos.y - r.pos.y, p.pos.z - r.pos.z);
    const d = TO.length();
    if (d > R.RANGE_M || d < 1) continue;
    if (TO.dot(FW) / d > Math.cos((5 * Math.PI) / 180)) {
      lined = true;
      break;
    }
  }
  e.reticle.classList.toggle('is-on', lined);
}

function paintChip() {
  const b = chip('pvp', 1, () => mp.setPvp(!(mp.profile && mp.profile.pvp)));
  if (!b) return;
  const r = myRow();
  const want = !!(mp.profile && mp.profile.pvp);
  let html;
  let cls = 'mpp-chip';
  if (r && r.arming) {
    html = `⚔ PvP ${want ? 'ON' : 'OFF'} in a moment…`;
    cls += ' is-armed';
  } else if (r && r.on) {
    html = `⚔ PvP ON <span class="mpp-hearts">${hearts(r.hp).replace(/♡/g, '<s>♥</s>')}</span>`;
    cls += ' is-hot';
  } else html = want ? '⚔ PvP ON…' : '⚔ PvP OFF';
  if (b._html !== html) {
    b._html = html;
    b.innerHTML = html;
    b.title = want ? `PvP is ON: tag players who have it on too — ${keyName('pvpFire')} or FIRE. Click to switch it OFF.` : 'PvP is OFF: nobody can tag you. Click to switch it ON.';
  }
  if (b.className !== cls) b.className = cls;
}

function paintBoard() {
  const row0 = mp.hud && mp.hud.ext;
  if (!row0) return;
  let board = row0.querySelector('.mpp-board');
  const list = R.standings(P.state, (id) => who(id));
  if (!list.length) {
    if (board && !board.hidden) board.hidden = true;
    return;
  }
  if (!board) {
    board = document.createElement('div');
    board.className = 'mpp-board';
    board.style.order = '9';
    row0.appendChild(board);
  }
  if (board.hidden) board.hidden = false;
  // With PvP off, one line — who is ahead — not the whole table: the badge stays small for somebody just flying.
  const mine = myRow();
  if (!(mine && (mine.on || mine.arming))) {
    const top = list[0];
    const w = who(top.id);
    const one = `<h6><span>PvP</span><span>tags</span></h6><div class="mpp-row"><i style="background:${esc(w.colour)}"></i><b>${esc(w.name)} ${top.tags ? 'leads' : ''}</b><span class="mpp-hearts"></span><em>${top.tags}</em></div>`;
    if (board._html !== one) {
      board._html = one;
      board.innerHTML = one;
    }
    return;
  }
  const html = `<h6><span>PvP</span><span>tags</span></h6>${list.slice(0, 8).map((r) => {
    const w = r.name || who(r.id);
    return `<div class="mpp-row${r.id === mp.meId ? ' is-me' : ''}${r.down ? ' is-down' : ''}"><i style="background:${esc(w.colour)}"></i><b>${esc(w.name)}</b>`
      + `<span class="mpp-hearts">${r.on ? hearts(r.hp).replace(/♡/g, '<s>♥</s>') : 'off'}</span><em>${r.tags}</em></div>`;
  }).join('')}`;
  if (board._html !== html) {
    board._html = html;
    board.innerHTML = html;
  }
}

/* ---- the plug-in ---------------------------------------------------------------------------- */

registerExtension({
  id: 'pvp',
  install(sim) {
    P.sim = sim;
    // The window losing focus with Space held: its key-up goes nowhere, so the trigger lets go here.
    if (typeof window !== 'undefined' && !P.blurHooked) {
      P.blurHooked = true;
      window.addEventListener('blur', () => {
        P.fireKey = false;
        P.fireBtn = false;
      });
    }
    // Their hearts on their tag while they play; nobody drawn while tagged out.
    mp.remotes.note = (id) => {
      const r = row(id);
      return r && r.on && !r.arming ? `⚔${hearts(r.hp)}` : '';
    };
    mp.remotes.hidden = (id) => {
      const r = row(id);
      return !!(r && r.down);
    };
  },
  startMode(sim) {
    P.sim = sim;
    if (P.down) endDown(false);
  },
  stop(sim, why) {
    if (why === 'airport') return;
    if (P.down) endDown(false);
    setFiring(false);
    const e = P.els;
    if (e) {
      e.reticle.hidden = true;
      e.fire.hidden = true;
    }
  },
  update(sim, dt) {
    P.sim = sim;
    const game = inGame();
    const r = game ? myRow() : null;
    mp.extraFlags.pvp = !!(r && r.on);
    const shielded = !!(r && r.shield) || now() < P.shieldUntil;
    ghost('pvp-down', !!P.down);
    ghost('pvp-shield', game && shielded && !!(r && r.on));
    if (!game) {
      const e = P.els;
      if (e && !e.fire.hidden) e.fire.hidden = true;
      if (e && !e.reticle.hidden) e.reticle.hidden = true;
      return;
    }
    if (P.down) {
      holdDown(sim);
      if (now() >= P.down.until) endDown(true);
      // Held still in the puff, the flying coach thought it was too slow ("Add power"): not now.
      else if (sim.hud && typeof sim.hud.setCoach === 'function') sim.hud.setCoach(null);
    }
    const me = ride(sim);
    if (live(r) && me && !P.down) sayWhatSpaceDoes(sim, me);
    // Touching down with Space still held (it was the trigger in the air): it is the brakes again, at once.
    if (P.fireKey && P.fireCode && me && me.kind === 'air' && me.onGround && !P.down && sim.input && sim.input.keys && !sim.input.keys.has(P.fireCode)) sim.input.keys.add(P.fireCode);
    // Not on the ground in an aeroplane (Space is the brakes there), and not while racing.
    // ...and not while an admin has frozen this player (part 3b).
    const canFire = live(r) && !P.down && !!me && !(me.kind === 'air' && me.onGround) && !ghostReasons().includes('race') && !(mp.me && mp.me.frozen);
    setFiring(canFire && (P.fireKey || P.fireBtn));
    if (P.sentFire) {
      P.fireAcc += dt;
      while (P.fireAcc >= 1 / FIRE_HZ) {
        P.fireAcc -= 1 / FIRE_HZ;
        shoot(sim);
      }
    } else P.fireAcc = 1 / FIRE_HZ;
    remoteFire(dt);
    hitTest();
    // Shield bubbles: mine, and everybody the host says has one.
    const bubbles = [];
    if (me && shielded && r && r.on && !P.down) bubbles.push({ pos: me.pos, r: me.radius * 1.15 });
    for (const p of ch.players()) {
      if (p.me || !p.pos || !p.visible) continue;
      const rr = row(p.id);
      if (rr && rr.shield && !rr.down) bubbles.push({ pos: p.pos, r: Math.max(4, (p.radius || 6) * 1.15) });
    }
    toon.bubblesAt(bubbles);
    const e = els();
    if (e) {
      const racing = ghostReasons().includes('race');
      const showFire = live(r) && !P.down && !racing && !(sim.hud && sim.hud.hidden);
      if (e.fire.hidden === showFire) e.fire.hidden = !showFire;
      if (showFire) placeFire(sim, e.fire);
      drawReticle(sim, me, live(r) && !racing);
    }
    paintChip();
    paintBoard();
  },
  camera(sim, dt, camera) {
    const D = P.down;
    if (!D) return false;
    D.spin += dt * 0.7;
    const rad = 38;
    camera.position.set(D.pos.x + Math.sin(D.spin) * rad, D.pos.y + 14, D.pos.z + Math.cos(D.spin) * rad);
    const floor = Math.max(heightAt(camera.position.x, camera.position.z), 0) + 3;
    if (camera.position.y < floor) camera.position.y = floor;
    camera.lookAt(D.pos);
    return true;
  },
  key(sim, code, down, e) {
    if (!isKey(sim, 'pvpFire', code)) return false;
    /*
     * A key-up is never swallowed. The game's own input may have seen this
     * Space go down — the brakes on the runway, a press while tagged out or
     * while PvP was switching on — and a release it never sees left the
     * aeroplane's brakes (or the van's handbrake) on for good: measured, an
     * aeroplane at full power on the runway made 1 kt in 4 s. A release the
     * input never saw pressed does no harm.
     */
    if (!down) {
      P.fireKey = false;
      return false;
    }
    if (!inGame()) return false;
    const r = myRow();
    // Tagged out and held in the puff — or back, with the host's word of it still on its way: the press
    // (the keyboard repeating a held Space) waits for the comeback, and never reaches the brakes.
    if (r && r.on && (P.down || r.down)) {
      P.fireKey = true;
      P.fireCode = code;
      return true;
    }
    const me = ride(sim);
    // On the ground in an aeroplane, Space is the brakes, as ever.
    if (!live(r) || !me || (me.kind === 'air' && me.onGround)) return false;
    P.fireKey = true;
    P.fireCode = code;
    // Space is the trigger now: if the game saw it go down before (the brakes, on the runway), it lets go of it.
    if (sim.input && sim.input.keys && typeof sim.input.keys.delete === 'function') sim.input.keys.delete(code);
    return true;
  },
});

/** For the tests and the console. */
export function pvpDebug() {
  return {
    P, judge: P.judge, state: P.state, me: myRow(), stats: { ...P.stats }, refused: P.judge ? P.judge.refused.slice() : [],
    pellets: toon.pel.length,
    fire(on) {
      P.fireKey = !!on;
    },
  };
}
