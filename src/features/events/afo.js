/**
 * Air Force One — the captain's side.
 *
 * The missions are src/game/extra/afo.js; the escort's own seat is
 * src/game/roles/afo-lead.js (castStart/castUpdate, wired generically by
 * src/features/roles.js, exactly as the hijacks' fighter seat is). This file
 * is the hijacks' flight-events.js/hijack.js equivalent for THIS pair of
 * missions: whatever runs only when you are the CAPTAIN —
 *
 *   - Air Force One: the escort, an NPC fighter (src/game/roles/npc-flyer.js)
 *     holding a wing slot on you through the cruise and the turn, then
 *     landing itself once you are clearly on your own approach — the same
 *     "any heading, any position, it still gets home" logic the hijacks'
 *     airliner relies on;
 *   - Air Force One — Under Attack: the drones and their missiles
 *     (src/features/events/afo-combat.js) coming for YOUR aircraft, your
 *     escort shooting them down for you, and your own flares/chaff (a key
 *     and a touch button) to decoy whatever gets through.
 *
 * `afoFire` and `afoFlare` are registered here, once, so Settings → Controls
 * shows them whichever seat a person is in — the escort's own gun
 * (afo-lead.js) reads `sim.input.held('afoFire')` back rather than
 * registering its own copy, the same key in the one registry either way.
 *
 * Kid-safe, as afo-combat.js is throughout: see that file's header.
 */

import * as THREE from '../../vendor/three.module.js';
import { registerExtension, extLayer } from '../../game/extensions.js';
import { RUNWAY } from '../../world/airport.js';
import { heightAt } from '../../world/terrain.js';
import {
  field, speak, notify, registerVoices, runwayFrame, RW, flat, FT,
} from './common.js';
import { NpcFlyer } from '../../game/roles/npc-flyer.js';
import { AttackField } from './afo-combat.js';

const ID_NORMAL = 'afo-normal';
const ID_ATTACK = 'afo-attack';
const LEAD = 'Guardian lead';

function homeRunway() {
  runwayFrame();
  const out = { thr: new THREE.Vector3(), dir: new THREE.Vector3(), hdg: RUNWAY.headingDeg ?? 90, td: new THREE.Vector3(), stop: new THREE.Vector3() };
  out.dir.copy(RW.f);
  out.thr.copy(RW.c).addScaledVector(RW.f, -RW.L / 2);
  out.thr.y = heightAt(out.thr.x, out.thr.z);
  out.td.copy(out.thr).addScaledVector(out.dir, Math.min(200, RW.L * 0.2));
  out.td.y = heightAt(out.td.x, out.td.z);
  out.stop.copy(out.thr).addScaledVector(out.dir, RW.L * 0.55);
  out.stop.y = heightAt(out.stop.x, out.stop.z);
  return out;
}

/* ------------------------------------------------------------------ *
 * State. One flight at a time, like every other story in this game.
 * ------------------------------------------------------------------ */

const S = {
  sim: null,
  active: false,
  kind: null, // 'normal' | 'attack'
  escort: null, // NpcFlyer
  attack: null, // AttackField, attack only
  escortGunCd: 0,
  decoysUsed: 0,
  decoyCd: 0,
  flareHeldLast: false,
  warned: false,
  waveSent: false,
  failWhy: null,
  home: false,
  t: 0,
  els: null,
  mode: null, // 'fire' | 'flare' | null, for the one touch button
  touchFire: false,
  /** Read live by NpcFlyer.follow() every frame — pos/vel are the same
   *  Vector3 objects as the player's aircraft, so only .heading (a number,
   *  copied rather than referenced) needs refreshing each frame. */
  leaderProxy: null,
};

/** Which seat of which AFO mission is running now, straight from the live runner — never cached. */
function currentSeat(sim) {
  const r = sim && sim.runner;
  const def = r && r.status === 'running' ? r.def : null;
  if (!def) return { mission: null, seat: null };
  const id = def.baseId || def.id;
  if (id !== ID_NORMAL && id !== ID_ATTACK) return { mission: null, seat: null };
  return { mission: id === ID_ATTACK ? 'attack' : 'normal', seat: def.roleId === 'escort' ? 'escort' : 'captain' };
}

export function touchFireHeld() {
  return !!S.touchFire;
}

/** For the mission steps in src/game/extra/afo.js. */
export function afoInfo() {
  const a = S.attack;
  return {
    active: S.active,
    kind: S.kind,
    warned: S.warned,
    waveSent: S.waveSent,
    dronesAlive: a ? a.dronesAlive : 0,
    missilesInbound: a ? a.missilesInbound : 0,
    stats: a ? { ...a.stats } : null,
    decoysUsed: S.decoysUsed,
    home: S.home,
    failWhy: S.failWhy,
  };
}

function teardown() {
  if (S.escort) {
    S.escort.dispose();
    S.escort = null;
  }
  if (S.attack) {
    S.attack.dispose();
    S.attack = null;
  }
  S.active = false;
  S.kind = null;
  S.escortGunCd = 0;
  S.decoysUsed = 0;
  S.decoyCd = 0;
  S.flareHeldLast = false;
  S.warned = false;
  S.waveSent = false;
  S.failWhy = null;
  S.home = false;
  S.t = 0;
  S.leaderProxy = null;
}

function leaderProxy(sim) {
  const ac = sim.aircraft;
  if (!S.leaderProxy) S.leaderProxy = { pos: ac.pos, vel: ac.vel, heading: ac.heading };
  S.leaderProxy.heading = ac.heading;
  return S.leaderProxy;
}

function setupCaptain(sim, kind) {
  teardown();
  S.sim = sim;
  S.active = true;
  S.kind = kind;
  registerVoices();
  try {
    S.escort = new NpcFlyer(sim.scene, 'vanguard', { name: 'afo-escort' });
  } catch (e) {
    console.warn('[afo] the escort could not be built; the flight carries on without one.', e);
    S.escort = null;
  }
  if (S.escort) {
    const ac = sim.aircraft;
    S.escort.place({ pos: ac.pos.clone(), headingDeg: ac.heading, speed: Math.max(60, Math.hypot(ac.vel.x, ac.vel.z)), onGround: false });
    // Tucked close, a little ahead and above — read live every frame
    // (leaderProxy()), so this one call is all .follow() ever needs.
    S.escort.follow(leaderProxy(sim), { back: 20, right: 70, down: -6, lookahead: 320 });
  }
  if (kind === 'attack') {
    S.attack = new AttackField(sim);
  }
}

/** Two drones, out of the sea ahead of the jet, one off each side of the nose. */
function droneWaveAhead(ac) {
  const h = (ac.heading * Math.PI) / 180;
  const fx = Math.sin(h);
  const fz = -Math.cos(h);
  const rx = Math.cos(h);
  const rz = Math.sin(h);
  const ahead = 3400;
  const spread = 900;
  const out = [];
  for (const side of [-1, 1]) {
    out.push(new THREE.Vector3(
      ac.pos.x + fx * ahead + rx * spread * side,
      Math.max(20, ac.pos.y - 300),
      ac.pos.z + fz * ahead + rz * spread * side
    ));
  }
  return out;
}

function runCaptainNormal(sim, dt) {
  const ac = sim.aircraft;
  if (!S.escort || !ac) return;
  leaderProxy(sim);
  runwayFrame();
  const closeIn = ac.onGround || (flat(ac.pos, RW.c) < 4000 && ac.agl * FT < 2200);
  if (closeIn && S.escort.mode !== 'land') {
    S.escort.rw = homeRunway();
    S.escort.vecAlt = S.escort.pos.y;
    S.escort.land(S.escort.rw);
    speak(sim, `${LEAD}, breaking off. See you on the ground.`, 'approach');
  }
  S.escort.update(dt, sim.weather);
}

function runCaptainAttack(sim, dt) {
  const ac = sim.aircraft;
  if (!ac) return;
  S.t += dt;
  if (S.escort) {
    leaderProxy(sim);
    S.escort.update(dt, sim.weather);
  }
  if (!S.warned && S.t > 8) {
    S.warned = true;
    speak(sim, `${LEAD}, ${field()} Approach. Unidentified drones, low, off your nose. No transponder, no response. Evasive action is authorised.`, 'approach', 1);
  }
  if (!S.waveSent && S.t > 11 && S.attack) {
    S.waveSent = true;
    S.attack.spawnWave(droneWaveAhead(ac));
  }
  if (!S.attack) return;
  S.attack.update(dt, ac.pos, ac.vel);

  // Your escort's own gun: a fair, steady aim at whichever drone is nearest.
  if (S.escort) {
    S.escortGunCd -= dt;
    if (S.escortGunCd <= 0) {
      let best = null;
      let bd = Infinity;
      for (const d of S.attack.drones) {
        if (!d.alive) continue;
        const dd = d.pos.distanceToSquared(S.escort.pos);
        if (dd < bd) {
          bd = dd;
          best = d;
        }
      }
      if (best && bd < 1300 * 1300) {
        const dir = best.pos.clone().sub(S.escort.pos).normalize();
        S.attack.fireGun(S.escort.pos.clone().addScaledVector(dir, 6), dir, S.escort.vel);
        S.escortGunCd = 0.45;
      } else {
        S.escortGunCd = 0.3;
      }
    }
  }

  // Your own flares/chaff: the key is edge-triggered here (one press, one
  // deploy); the touch button calls requestFlareDeploy() straight from its
  // own pointerdown, below, so it is not read again here.
  const heldNow = !!(sim.input && typeof sim.input.held === 'function' && sim.input.held('afoFlare'));
  if (heldNow && !S.flareHeldLast) requestFlareDeploy(sim);
  S.flareHeldLast = heldNow;
  S.decoyCd = Math.max(0, S.decoyCd - dt);

  if (S.attack.stats.hits >= 2 && !S.failWhy) {
    S.failWhy = 'A missile got through. Decoy with flares (4) earlier, or trust your escort to clear the drones first.';
  }
  runwayFrame();
  S.home = flat(ac.pos, RW.c) < 1500;
}

function requestFlareDeploy(sim) {
  if (S.decoysUsed >= 4 || S.decoyCd > 0 || !S.attack) return;
  const ac = sim.aircraft;
  S.attack.deployDecoy(ac.pos, ac.vel);
  S.decoysUsed++;
  S.decoyCd = 1.2;
  notify(sim, `Flares/chaff away! (${4 - S.decoysUsed} left)`, 'warn', 3);
}

/* ------------------------------------------------------------------ *
 * The one touch button: FIRE for the escort seat, FLARE for the captain's.
 * ------------------------------------------------------------------ */

const CSS = `
.afo-action { position: fixed; right: 18px; bottom: 120px; width: 84px; height: 84px; border-radius: 50%; z-index: 31; pointer-events: auto;
  touch-action: none; user-select: none; -webkit-user-select: none; cursor: pointer; border: 3px solid #1b1030; color: #fff;
  font: 900 15px "Arial Black", Impact, sans-serif; display: flex; align-items: center; justify-content: center;
  box-shadow: 0 5px 0 #1b1030, 0 8px 18px rgba(0,0,0,0.35); }
.afo-action.is-fire { background: radial-gradient(circle at 35% 30%, #ff9a7a, #ff5a4f 60%, #c8372f); }
.afo-action.is-flare { background: radial-gradient(circle at 35% 30%, #ffd48a, #ffa63f 60%, #c97a12); }
.afo-action.is-down { transform: translateY(3px); box-shadow: 0 2px 0 #1b1030; }
.afo-action[hidden] { display: none !important; }
`;

function els() {
  if (S.els || typeof document === 'undefined') return S.els;
  const layer = extLayer();
  if (!document.getElementById('ifs-afo-style')) {
    const st = document.createElement('style');
    st.id = 'ifs-afo-style';
    st.textContent = CSS;
    document.head.appendChild(st);
  }
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'afo-action';
  btn.hidden = true;
  const press = (on) => (e) => {
    if (e && e.cancelable) e.preventDefault();
    btn.classList.toggle('is-down', on);
    if (S.mode === 'fire') S.touchFire = on;
    else if (S.mode === 'flare' && on) requestFlareDeploy(S.sim);
  };
  btn.addEventListener('pointerdown', press(true));
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) btn.addEventListener(ev, press(false));
  layer.appendChild(btn);
  S.els = { btn };
  return S.els;
}

function syncButton(mode) {
  const e = els();
  if (!e) return;
  S.mode = mode;
  e.btn.hidden = !mode;
  if (!mode) {
    S.touchFire = false;
    return;
  }
  e.btn.classList.toggle('is-fire', mode === 'fire');
  e.btn.classList.toggle('is-flare', mode === 'flare');
  e.btn.textContent = mode === 'fire' ? 'FIRE' : 'FLARE';
}

/* ------------------------------------------------------------------ */

registerExtension({
  id: 'afo',

  actions: {
    afoFire: { label: 'Air Force One: fire the gun (escort seat)', group: 'Missions & events', ctx: ['plane'], default: ['Digit3'] },
    afoFlare: { label: 'Air Force One: drop flares/chaff (captain seat)', group: 'Missions & events', ctx: ['plane'], default: ['Digit4'] },
  },

  install(sim) {
    S.sim = sim;
  },

  startMode(sim, mode) {
    const info = currentSeat(sim);
    if (info.mission && info.seat === 'captain') setupCaptain(sim, info.mission);
    else teardown();
  },

  stop() {
    teardown();
  },

  update(sim, dt) {
    const info = currentSeat(sim);
    syncButton(info.seat === 'escort' && info.mission === 'attack' ? 'fire' : info.seat === 'captain' && info.mission === 'attack' ? 'flare' : null);
    if (info.seat !== 'captain') return;
    if (!S.active || S.kind !== info.mission) setupCaptain(sim, info.mission);
    if (info.mission === 'attack') runCaptainAttack(sim, dt);
    else runCaptainNormal(sim, dt);
  },
});
