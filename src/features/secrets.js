/**
 * SECRET PLANES IN HIDDEN HANGARS.
 *
 * The owner: "if you eject, i think itd be fun for you to find another
 * plane/vechile, in a closed garage or carrier you have to open", "*even
 * some secret planes you cant select unless you fin them", and on 2026-10-12
 * "add the secret planes in hangars thing if u explore yk and you can open
 * and close hangars".
 *
 * ON EVERY MAP, one or two hiding places (./secrets/data.js, by named
 * landmark): a locked shed by a farm strip, a cave hangar in a hillside, an
 * old bunker, the hangar at the far end of the air base, a hatch in the
 * carrier's deck. Each has one clue outside — a faint light under the door,
 * tyre tracks in the grass, a windsock where no airfield needs one — and
 * if a while goes by on that map without it being found, hints: a rumour,
 * the clue in words, then a rough mark on the map. Fly low over one, or walk
 * near it, and it is spotted: marked on the map exactly.
 *
 * FINDING ONE. Walk up on foot, hold E (interact.js) and the door rolls up
 * — the lights come on inside, slowly — and there it is: a secret plane, a
 * version of one you know in a special form (aircraft/extra/secret.js). Walk
 * in and it is found: a short title card (./secrets/reveal.js), the "Secret
 * Found" achievement, and it is in your Hangar from then on — progression.js's
 * own `unlocked` list, the one the Hangar reads — with "Found at …" on its
 * card. Unfound ones are silhouettes with a hint (./secrets/menu.js). In Free
 * Flight you can get straight in (rides.js): it starts in front of the door.
 *
 * AIR FORCE ONE (af1.md item 7): scoring 80 or more on "Air Force One —
 * Under Attack", in any seat, unlocks it for Free Flight for good; the
 * debrief says AIR FORCE ONE UNLOCKED, once.
 *
 * Doors open and close again (E at the door), and the light switch inside
 * works. The world is the same for everyone in multiplayer, but what each
 * player has FOUND is theirs alone, saved in their own browser
 * (./secrets/store.js) and never in a snapshot.
 *
 * What a mission does is never changed: a hiding place can be opened during
 * one, and what is inside is found, but getting in to fly it is Free Flight's
 * (rides.js refuses it while a mission runs).
 */

import * as THREE from '../vendor/three.module.js';
import { registerExtension } from '../game/extensions.js';
import { MAP, addObstacle, addPlatform, OBSTACLES } from '../world/terrain.js';
import { MAPS } from '../world/maps.js';
import { getAircraft, AIRCRAFT } from '../aircraft/types.js';
import { schemeFor } from '../aircraft/liveries.js';
import { createAircraftModel } from '../aircraft/model-adapter.js';
import { typeSize } from '../world/airport-layout.js';
import * as Prog from '../game/progression.js';
import { onFoot } from './onfoot.js';
import { addInteractSource } from './interact.js';
import { addRideSource } from './rides.js';
import { drawnHeight } from './staff/walk.js';
import { planeProfile } from './staff/jobs.js';
import { noteSecretFound, noteSecretEarned } from './achievements/index.js';
import { SPOTS, spotsFor, spotById, KIND_WORDS, hintLines } from './secrets/data.js';
import { findSite } from './secrets/sites.js';
import { worldEnv } from './secrets/env.js';
import { Hideout } from './secrets/build.js';
import * as Store from './secrets/store.js';
import { showReveal, updateReveal, hideReveal, revealState } from './secrets/reveal.js';
import { installMenu, refreshMenu } from './secrets/menu.js';

const D2R = Math.PI / 180;
/** The secret planes hidden in hangars (Air Force One is earned, not hidden). */
const HIDDEN_PLANES = [...new Set(SPOTS.map((s) => s.plane))];

const S = {
  sim: null,
  store: null,
  hideouts: [],
  group: null,
  /** Which spots of this map could not be sited this build, and why (the tests read it). */
  unsited: [],
  reveal: null,
  pins: [],
  pinMap: new Map(),
  saveT: 0,
  spotT: 0,
  hintT: 0,
  /** For the tests: every find and every door moved. */
  finds: 0,
  doors: 0,
  af1Pending: false,
  profiles: new Map(),
};

function store() {
  if (!S.store) S.store = Store.load();
  return S.store;
}

function notify(sim, text, kind = 'info', secs = 4) {
  try {
    if (sim && sim.hud && sim.hud.notify) sim.hud.notify(text, kind, secs);
  } catch (e) {
    /* no HUD, no words */
  }
}

function chime(sim) {
  try {
    const a = sim && sim.audio;
    if (!a || !a.available || !a.mixer || !a.mixer.tone) return;
    a.mixer.tone({ bus: 'alerts', freq: 523, duration: 0.18, gain: 0.04, type: 'sine' });
    setTimeout(() => {
      try { a.mixer.tone({ bus: 'alerts', freq: 784, duration: 0.3, gain: 0.04, type: 'sine' }); } catch (e) { /* ignore */ }
    }, 160);
  } catch (e) {
    /* sound is a nicety */
  }
}

function mapName(id) {
  const m = MAPS.find((q) => q.id === id);
  return m ? m.name : id;
}

function freeFlight(sim) {
  return !!(sim && sim.mode === 'free' && !(sim.runner && sim.runner.status === 'running'));
}

/* ------------------------------------------------------------------ */
/* Unlocking                                                           */
/* ------------------------------------------------------------------ */

/** Put an aeroplane in the player's Hangar for good (progression.js's own list). */
function unlockPlane(sim, id) {
  const p = (sim && sim.prog) || Prog.load();
  if (!p.unlocked.includes(id)) {
    p.unlocked.push(id);
    Prog.save(p);
  }
  refreshMenu();
}

function allHiddenFound() {
  const st = store();
  return HIDDEN_PLANES.every((id) => st.planes[id]);
}

/** A hiding place found: the card, the achievement, the Hangar. */
function find(sim, h) {
  const st = store();
  const spot = h.spot;
  const type = h.type;
  const res = Store.markFound(st, spot, { mapName: mapName(spot.map) });
  Store.save(st);
  unlockPlane(sim, type.id);
  S.finds++;
  removePin(spot.id);
  showReveal({
    kicker: 'SECRET FOUND',
    name: type.name,
    where: res.newPlane ? `In your Hangar now · found at ${res.where}` : `Another one — yours since ${res.where}`,
  }, 3.6);
  chime(sim);
  try {
    noteSecretFound(sim, { plane: type.id, allFound: allHiddenFound() });
  } catch (e) {
    /* achievements are a nicety */
  }
}

/** Air Force One, for 80+ on Under Attack: in the Hangar for good, said once. */
function earnAf1(sim, where = 'Air Force One — Under Attack') {
  const st = store();
  const first = Store.markEarned(st, 'af1', where);
  Store.save(st);
  unlockPlane(sim, 'af1');
  try {
    noteSecretEarned(sim, { plane: 'af1' });
  } catch (e) {
    /* achievements are a nicety */
  }
  return first;
}

/* ------------------------------------------------------------------ */
/* The world                                                           */
/* ------------------------------------------------------------------ */

function makeModel(type) {
  return createAircraftModel({ type, livery: schemeFor(type, 'house'), landingLight: false });
}

/** The ground as drawn, so a decal lies on it, never under it. */
function groundY(heightAt) {
  return (x, z) => {
    const h = heightAt(x, z);
    const d = drawnHeight(x, z);
    return d != null && Number.isFinite(d) ? Math.max(h, d) : h;
  };
}

/** Trees in the way are cleared for the building: their trunks unregistered, their instances put away. */
function clearTrees(sim, site) {
  const r = site.rect;
  if (!r) return 0;
  // The trunks.
  const gone = new Set(site.trees || []);
  if (gone.size) {
    for (let i = OBSTACLES.length - 1; i >= 0; i--) if (gone.has(OBSTACLES[i])) OBSTACLES.splice(i, 1);
  }
  // The drawn trees (and the small ones nobody registered): every 'trees:*' instance inside the rectangle.
  let n = 0;
  const root = sim.scenery && sim.scenery.group;
  if (!root) return n;
  const m = new THREE.Matrix4();
  const p = new THREE.Vector3();
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  root.traverse((o) => {
    if (!o.isInstancedMesh || !/^trees:/.test(o.name || '')) return;
    let changed = false;
    for (let i = 0; i < o.count; i++) {
      o.getMatrixAt(i, m);
      p.setFromMatrixPosition(m);
      if (p.x > r.x0 - 3 && p.x < r.x1 + 3 && p.z > r.z0 - 3 && p.z < r.z1 + 3) {
        o.setMatrixAt(i, zero);
        changed = true;
        n++;
      }
    }
    if (changed) o.instanceMatrix.needsUpdate = true;
  });
  return n;
}

function buildHideouts(sim, group) {
  S.hideouts = [];
  S.unsited = [];
  const spots = spotsFor(MAP && MAP.id);
  if (!spots.length) return;
  const env = worldEnv(sim);
  const ground = groundY(env.heightAt);
  for (const spot of spots) {
    const type = getAircraft(spot.plane);
    if (!type || type.id !== spot.plane) {
      S.unsited.push({ id: spot.id, why: 'no such plane' });
      continue;
    }
    let site = null;
    try {
      site = findSite(spot, typeSize(spot.plane), env, { budgetMs: 70 });
    } catch (e) {
      console.warn(`[secrets] could not site ${spot.id}`, e);
    }
    if (!site) {
      S.unsited.push({ id: spot.id, why: JSON.stringify(findSite.lastRefused || {}) });
      continue;
    }
    if (!site.hatch) {
      // The floor stands over the ground as drawn as well as the height field.
      let top = site.floorY;
      for (let i = 0; i <= 4; i++) {
        for (let j = 0; j <= 4; j++) {
          const d = drawnHeight(site.x - site.hx + (site.hx * i) / 2, site.z - site.hz + (site.hz * j) / 2);
          if (d != null && d + 0.06 > top) top = d + 0.06;
        }
      }
      site.floorY = Math.min(top, site.floorY + 1);
      clearTrees(sim, site);
    }
    let h = null;
    try {
      h = new Hideout(spot, site, type, { makeModel, ground });
    } catch (e) {
      console.warn(`[secrets] could not build ${spot.id}`, e);
      S.unsited.push({ id: spot.id, why: 'build failed' });
      continue;
    }
    group.add(h.group);
    group.add(h.world);
    for (const o of h.obstacles) addObstacle(o);
    if (!site.hatch) addPlatform(site.x, site.z, site.hx * 2, site.hz * 2, site.floorY, `secret:${spot.id}`);
    h.planeProfile = profileOf(type);
    S.hideouts.push(h);
  }
}

function profileOf(type) {
  let p = S.profiles.get(type.id);
  if (p === undefined) {
    try {
      p = planeProfile(type, null);
    } catch (e) {
      p = null;
    }
    S.profiles.set(type.id, p);
  }
  return p;
}

/* ------------------------------------------------------------------ */
/* Doors, lights and what can be used                                   */
/* ------------------------------------------------------------------ */

function setDoor(h, open) {
  h.target = open ? 1 : 0;
  if (open && !h.lightsTouched) h.lightsOn = true;
  S.doors++;
}

const _w = {};
addInteractSource({
  id: 'secrets',
  list(sim, w, add) {
    for (const h of S.hideouts) {
      const words = KIND_WORDS[h.kind] || KIND_WORDS.shed;
      const opening = h.target < 0.5;
      if (h.kind === 'hatch') {
        const c = h.toWorld(h.switchLocal.x, h.switchLocal.z, _w);
        add({
          id: `secret-door:${h.spot.id}`, label: opening ? words.open : words.close, short: opening ? 'Open' : 'Close',
          x: c.x, z: c.z, reach: 3.2, hold: 1.0,
          run: () => {
            setDoor(h, opening);
            return opening ? 'The hatch doors part, and the lift starts to hum.' : '';
          },
        });
        continue;
      }
      const d = h.site.door;
      const reach = h.doorW / 2 + 2.6;
      if ((d.x - w.x) ** 2 + (d.z - w.z) ** 2 < reach * reach) {
        add({
          id: `secret-door:${h.spot.id}`, label: opening ? words.open : words.close, short: opening ? 'Open' : 'Close',
          x: d.x, z: d.z, reach, look: 80,
          // A locked shed's bolt is stiff: a longer hold than an ordinary door.
          hold: opening ? 1.1 : 0.6,
          run: () => {
            setDoor(h, opening);
            return opening && h.open < 0.05 && h.kind === 'shed' ? 'The bolt gives. The door rattles up…' : '';
          },
        });
      }
      const s = h.toWorld(h.switchLocal.x, h.switchLocal.z, _w);
      if ((s.x - w.x) ** 2 + (s.z - w.z) ** 2 < 2.4 * 2.4) {
        add({
          id: `secret-lights:${h.spot.id}`, label: h.lightsOn ? 'Lights off' : 'Lights on', short: 'Lights',
          x: s.x, z: s.z, reach: 2.4, look: 100,
          run: () => {
            h.lightsTouched = true;
            h.lightsOn = !h.lightsOn;
            return '';
          },
        });
      }
    }
  },
});

addRideSource({
  id: 'secrets',
  list(sim, w, add) {
    for (const h of S.hideouts) {
      if (!h.plane || h.taken || h.open < 0.6) continue;
      if (h.kind === 'hatch' && (h.liftT || 0) < 0.95) continue;
      if (!Store.isFound(store(), h.spot.id) && !Prog.isUnlocked((sim && sim.prog) || Prog.load(), h.type.id)) continue;
      const p = h.planeWorld();
      if (!p) continue;
      if ((p.x - w.x) ** 2 + (p.z - w.z) ** 2 > 60 * 60) continue;
      add({
        typeId: h.type.id,
        x: p.x,
        z: p.z,
        headingDeg: p.headingDeg,
        reach: 2.6,
        where: `the ${(KIND_WORDS[h.kind] || KIND_WORDS.shed).noun} at ${h.spot.place}`,
        spawn: h.spawnWorld(),
        onTake: () => {
          h.taken = true;
          h.plane.visible = false;
        },
      });
    }
  },
});

/** The secret plane parked inside is solid, as any parked aeroplane is. */
const PROVIDER = {
  solids(sim, addSolid) {
    for (const h of S.hideouts) {
      if (!h.plane || h.taken || !h.plane.visible) continue;
      const pr = h.planeProfile;
      const p = h.planeWorld();
      if (!pr || !p) continue;
      const y = p.y;
      const mid = (pr.nose + pr.tail) / 2;
      const cx = p.x + Math.sin(p.headingDeg * D2R) * mid;
      const cz = p.z - Math.cos(p.headingDeg * D2R) * mid;
      addSolid(cx, cz, p.headingDeg, (pr.nose - pr.tail) / 2, pr.halfWidth, y - 0.5, y + Math.max(1.2, pr.top || 2), `the ${h.type.name}`);
    }
  },
};

/* ------------------------------------------------------------------ */
/* The reveal                                                          */
/* ------------------------------------------------------------------ */

function startReveal(sim, h) {
  const prev = onFoot.control;
  const p = h.planeWorld();
  const w = onFoot.walker;
  const yaw = p ? (Math.atan2(p.x - w.x, -(p.z - w.z)) * 180) / Math.PI : w.heading;
  S.reveal = { h, t: 0, prev, view: onFoot.view };
  onFoot.setControl({ locked: true, face: (yaw + 360) % 360, prompt: '', secretReveal: true });
  onFoot.setView('wide');
  onFoot.setCamera((yaw + 200) % 360, -10);
  find(sim, h);
}

function updateRevealPhase(sim, dt) {
  const r = S.reveal;
  if (!r) return;
  r.t += dt;
  // The camera drifts slowly round the aeroplane while the card is up.
  if (onFoot.active) {
    const w = onFoot.walker;
    const p = r.h.planeWorld();
    if (p) {
      const yaw = (Math.atan2(p.x - w.x, -(p.z - w.z)) * 180) / Math.PI;
      onFoot.setCamera((yaw + 200 - r.t * 9 + 360) % 360, -10);
    }
  }
  if (r.t >= 3.6 || !onFoot.active) endReveal();
}

function endReveal() {
  const r = S.reveal;
  if (!r) return;
  S.reveal = null;
  const ctl = onFoot.control;
  if (ctl && ctl.secretReveal) onFoot.setControl(r.prev && !r.prev.secretReveal ? r.prev : null);
  if (onFoot.active && r.view) onFoot.setView(r.view);
  if (S.sim && onFoot.active) {
    notify(S.sim, freeFlight(S.sim)
      ? `It is yours. Press ${keyO()} beside it to fly it now — or pick it in the Hangar any time.`
      : 'It is yours now — fly it in Free Flight, from the Hangar.', 'good', 5);
  }
}

function keyO() {
  try {
    const b = S.sim && S.sim.input && S.sim.input.bindings && S.sim.input.bindings.getOut;
    const c = b && b[0];
    return c ? c.replace(/^Key/, '') : 'O';
  } catch (e) {
    return 'O';
  }
}

/* ------------------------------------------------------------------ */
/* Hints, spotting, the map                                             */
/* ------------------------------------------------------------------ */

function setPin(sim, id, x, z, label) {
  let pin = S.pinMap.get(id);
  if (!pin) {
    pin = { x, z, label, colour: '#d7b6ff' };
    S.pinMap.set(id, pin);
  }
  pin.x = x;
  pin.z = z;
  pin.label = label;
  syncPins(sim);
}

function removePin(id) {
  if (!S.pinMap.has(id)) return;
  const pin = S.pinMap.get(id);
  S.pinMap.delete(id);
  const sim = S.sim;
  if (sim && Array.isArray(sim.mapPins)) {
    const i = sim.mapPins.indexOf(pin);
    if (i >= 0) sim.mapPins.splice(i, 1);
  }
}

/** Our pins, appended to whatever list is up (runaway.js and the emergency scene keep their own). */
function syncPins(sim) {
  if (!sim) return;
  if (!S.pinMap.size) return;
  if (!Array.isArray(sim.mapPins)) sim.mapPins = [];
  for (const pin of S.pinMap.values()) if (!sim.mapPins.includes(pin)) sim.mapPins.push(pin);
}

function clearPins(sim) {
  for (const id of [...S.pinMap.keys()]) removePin(id);
  if (sim && Array.isArray(sim.mapPins) && !sim.mapPins.length) sim.mapPins = null;
}

/** Re-mark what this map's hints and sightings have already marked, after a world build. */
function restorePins(sim) {
  const st = store();
  for (const h of S.hideouts) {
    const id = h.spot.id;
    if (Store.isFound(st, id)) continue;
    if (st.spotted[id]) setPin(sim, id, h.site.x, h.site.z, '?');
    else if ((st.hints[id] || 0) >= 3) {
      const m = Store.roughMark(h.spot, h.site);
      setPin(sim, id, m.x, m.z, '?');
    }
  }
}

function hintTick(sim, dt) {
  if (!freeFlight(sim) || sim.state !== 'flying' || !S.hideouts.length) return;
  const st = store();
  const secs = Store.addMapTime(st, MAP.id, dt);
  S.hintT -= dt;
  if (S.hintT > 0) return;
  S.hintT = 2;
  for (const h of S.hideouts) {
    const lv = Store.nextHint(st, h.spot, secs);
    if (!lv) continue;
    Store.giveHint(st, h.spot, lv);
    const lines = hintLines(h.spot);
    if (lv >= 3) {
      if (!st.spotted[h.spot.id]) {
        const m = Store.roughMark(h.spot, h.site);
        setPin(sim, h.spot.id, m.x, m.z, '?');
      }
      notify(sim, `A hint: ${lines[0]} ${lines[2]}`, 'info', 7);
    } else {
      notify(sim, `A hint: ${lines[lv - 1]}`, 'info', 7);
    }
    Store.save(st);
    break;
  }
}

/** Flying low over one, or walking near it, spots it: marked on the map. */
function spotTick(sim, dt) {
  S.spotT -= dt;
  if (S.spotT > 0) return;
  S.spotT = 0.5;
  if (sim.state !== 'flying') return;
  const st = store();
  let at = null;
  let low = false;
  if (onFoot.active) {
    at = onFoot.walker;
  } else if (sim.aircraft && sim.mode !== 'drive') {
    const ac = sim.aircraft;
    at = ac.pos;
    const agl = ac.agl;
    low = Number.isFinite(agl) ? agl < 140 : ac.pos.y < 200;
  } else if (sim.vehicle && sim.vehicle.pos) {
    at = sim.vehicle.pos;
    low = true;
  }
  if (!at) return;
  for (const h of S.hideouts) {
    const id = h.spot.id;
    if (st.spotted[id] || Store.isFound(st, id)) continue;
    const d = Math.hypot(h.site.x - at.x, h.site.z - at.z);
    if ((onFoot.active && d < 90) || (low && d < 320)) {
      st.spotted[id] = true;
      Store.save(st);
      setPin(sim, id, h.site.x, h.site.z, '?');
      const noun = (KIND_WORDS[h.kind] || KIND_WORDS.shed).noun;
      notify(sim, h.kind === 'hatch'
        ? 'You spotted a hatch in the carrier’s deck. Get out on the deck and take a look.'
        : `You spotted a hidden ${noun}! It is on your map. Land nearby and take a look on foot.`, 'good', 6);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Air Force One                                                        */
/* ------------------------------------------------------------------ */

function wrapMissionComplete(sim) {
  if (typeof sim.onMissionComplete !== 'function' || sim.onMissionComplete._secrets) return;
  const orig = sim.onMissionComplete;
  const wrapped = function onMissionCompleteWithSecrets(result) {
    let earned = false;
    try {
      const flown = sim.runner && sim.runner.def;
      const baseId = flown && (flown.baseId || flown.id);
      earned = !!(result && !result.crashed && Number(result.score) >= 80 && (baseId === 'afo-attack' || result.id === 'afo-attack'));
    } catch (e) {
      earned = false;
    }
    const out = orig.call(sim, result);
    if (earned) {
      try {
        const first = earnAf1(sim);
        if (first) afoDebrief(sim);
      } catch (e) {
        console.warn('[secrets] could not unlock Air Force One', e);
      }
    }
    return out;
  };
  wrapped._secrets = true;
  sim.onMissionComplete = wrapped;
}

/** "AIR FORCE ONE UNLOCKED", at the top of the debrief, the first time. */
function afoDebrief(sim) {
  const s = sim.menus && sim.menus.screens && sim.menus.screens.debrief;
  const body = s && s.querySelector && s.querySelector('[data-body]');
  if (!body) return;
  const el = document.createElement('div');
  el.className = 'sec-afo-unlocked';
  el.setAttribute('role', 'status');
  el.innerHTML = '<b>AIR FORCE ONE UNLOCKED</b><span>Fly it in Free Flight — it is in your Hangar now.</span>';
  Object.assign(el.style, {
    margin: '2px 0 12px', padding: '12px 14px', borderRadius: '12px', textAlign: 'center',
    background: 'linear-gradient(180deg, rgba(14,22,38,0.92), rgba(8,12,20,0.92))', border: '1px solid rgba(214,184,96,0.6)',
    color: '#f4f1e6', letterSpacing: '0.02em',
  });
  const b = el.querySelector('b');
  Object.assign(b.style, { display: 'block', fontSize: '18px', fontWeight: '800', letterSpacing: '0.2em', color: '#f2d27a' });
  const sp = el.querySelector('span');
  Object.assign(sp.style, { display: 'block', marginTop: '4px', fontSize: '12.5px', color: '#cdd6e4' });
  body.insertBefore(el, body.firstChild);
}

/* ------------------------------------------------------------------ */
/* What the Hangar says                                                 */
/* ------------------------------------------------------------------ */

function menuInfo(type) {
  const st = store();
  const where = Store.foundAt(st, type.id);
  if (type.secret && type.secret.how === 'earned') {
    return { lock: type.secret.hint || 'Earned, not bought', hint: type.secret.hint || '', where: where || (Prog.isUnlocked(S.sim && S.sim.prog ? S.sim.prog : Prog.load(), type.id) ? 'Air Force One — Under Attack' : null) };
  }
  // The hint names a map where one is hidden: this one if it has one, else the first.
  const here = MAP && MAP.id;
  const spots = SPOTS.filter((s) => s.plane === type.id);
  const unfound = spots.filter((s) => !Store.isFound(st, s.id));
  const pick = unfound.find((s) => s.map === here) || unfound[0] || spots[0];
  const words = pick ? KIND_WORDS[pick.kind] || KIND_WORDS.shed : null;
  const hint = pick ? `Hidden in a ${words.noun} on ${mapName(pick.map)} — ${hintLines(pick)[1].toLowerCase()}` : 'Hidden somewhere on the islands.';
  return { lock: 'Hidden — explore to find it', hint, where };
}

/* ------------------------------------------------------------------ */
/* The plug-in                                                          */
/* ------------------------------------------------------------------ */

registerExtension({
  id: 'secrets',

  install(sim) {
    S.sim = sim;
    store();
    // The Javelin (aircraft/extra/javelin.js) is in the roster only once it is yours: found at Nullspire (features/farlands-run.js).
    const prog = sim.prog || Prog.load();
    if (prog.unlocked && prog.unlocked.includes('javelin')) {
      import('../aircraft/extra/javelin.js').then((m) => {
        if (m.registerJavelin()) refreshMenu();
      }).catch((e) => console.warn('[secrets] the Javelin did not load', e));
    }
    // ...and Spireline, the city's airline (aircraft/extra/spireline.js), once the city has been seen (the ring's own memory).
    try {
      const far = JSON.parse(localStorage.getItem('islandsim.farlands.v1') || 'null');
      if (far && far.city) import('../aircraft/extra/spireline.js').then((m) => m.registerSpireline()).catch((e) => console.warn('[secrets] Spireline did not load', e));
    } catch (e) {
      /* no storage: found again next time */
    }
    onFoot.addProvider(PROVIDER);
    wrapMissionComplete(sim);
    try {
      installMenu(sim, menuInfo);
    } catch (e) {
      console.warn('[secrets] the hangar cards could not be decorated', e);
    }
    sim.secrets = API;
  },

  buildWorld(sim, group) {
    for (const h of S.hideouts) h.dispose();
    S.group = group;
    S.reveal = null;
    hideReveal();
    clearPins(sim);
    buildHideouts(sim, group);
    restorePins(sim);
  },

  startMode(sim) {
    if (S.reveal) endReveal();
    syncPins(sim);
  },

  stop(sim) {
    if (S.reveal) endReveal();
    hideReveal();
    const st = store();
    Store.save(st);
  },

  update(sim, dt) {
    const wind = sim.weather && Number.isFinite(sim.weather.windDirDeg) ? sim.weather.windDirDeg : null;
    for (const h of S.hideouts) {
      if (!h.lightsTouched) h.lightsOn = h.target > 0.5 || h.open > 0.2;
      h.update(dt, wind);
    }
    updateReveal(dt);
    if (S.reveal) updateRevealPhase(sim, dt);
    else if (onFoot.active && !sim.riding) {
      const w = onFoot.walker;
      const st = store();
      for (const h of S.hideouts) {
        if (!h.plane || Store.isFound(st, h.spot.id)) continue;
        const seen = h.kind === 'hatch'
          ? (h.liftT || 0) > 0.9 && Math.hypot(h.site.x - w.x, h.site.z - w.z) < 18
          : h.open > 0.7 && h.inside(w.x, w.z, 1.5);
        if (seen) {
          startReveal(sim, h);
          break;
        }
      }
    }
    spotTick(sim, dt);
    hintTick(sim, dt);
    if (S.pinMap.size) syncPins(sim);
    S.saveT -= dt;
    if (S.saveT <= 0) {
      S.saveT = 8;
      Store.save(store());
    }
  },

  devActions: [
    {
      label: 'Secrets: open the nearest hidden hangar',
      hint: 'Rolls up the door of the nearest hiding place on this map',
      run(sim) {
        const h = nearestHideout(sim);
        if (!h) return notify(sim, 'No hiding place on this map.', 'info', 3);
        setDoor(h, true);
        notify(sim, `Opening the ${(KIND_WORDS[h.kind] || KIND_WORDS.shed).noun} at ${h.spot.place}.`, 'info', 3);
      },
    },
    {
      label: 'Secrets: unlock every secret plane (test)',
      hint: 'Every secret plane in the Hangar, Air Force One too — for testing',
      run(sim) {
        API.unlockAll();
        notify(sim, 'Every secret plane is in your Hangar.', 'good', 3);
      },
    },
    {
      label: 'Secrets: forget every find (test)',
      hint: 'Back to silhouettes: forgets every find, hint and sighting',
      run(sim) {
        API.forget();
        notify(sim, 'Every find forgotten.', 'info', 3);
      },
    },
  ],
});

function nearestHideout(sim) {
  const ref = onFoot.active ? onFoot.walker : sim && sim.aircraft ? sim.aircraft.pos : null;
  if (!ref) return S.hideouts[0] || null;
  let best = null;
  let bd = Infinity;
  for (const h of S.hideouts) {
    const d = Math.hypot(h.site.x - ref.x, h.site.z - ref.z);
    if (d < bd) {
      bd = d;
      best = h;
    }
  }
  return best;
}

/** For the tests, the console and the owner. */
const API = {
  state() {
    const st = store();
    return {
      map: MAP && MAP.id,
      hideouts: S.hideouts.map((h) => ({
        id: h.spot.id,
        kind: h.kind,
        plane: h.type.id,
        x: Math.round(h.site.x),
        z: Math.round(h.site.z),
        floorY: +h.site.floorY.toFixed(2),
        headingDeg: h.site.headingDeg,
        door: { x: +h.site.door.x.toFixed(1), z: +h.site.door.z.toFixed(1) },
        open: +h.open.toFixed(3),
        target: h.target,
        light: +h.light.toFixed(3),
        lift: h.liftT || 0,
        found: Store.isFound(st, h.spot.id),
        taken: !!h.taken,
        known: !!(h.site.from && h.site.from.known),
      })),
      unsited: S.unsited.slice(),
      found: { ...st.found },
      planes: { ...st.planes },
      hints: { ...st.hints },
      spotted: { ...st.spotted },
      mapTime: { ...st.mapTime },
      finds: S.finds,
      doors: S.doors,
      reveal: revealState(),
      revealing: !!S.reveal,
      pins: [...S.pinMap.entries()].map(([id, p]) => ({ id, x: Math.round(p.x), z: Math.round(p.z) })),
      counts: Store.counts(st),
    };
  },
  hideout(id) {
    return S.hideouts.find((h) => h.spot.id === id) || null;
  },
  open(id, open = true) {
    const h = API.hideout(id);
    if (!h) return false;
    setDoor(h, open);
    return true;
  },
  /** One call to put a secret plane (or all of them) in the Hangar — the owner's test switch. */
  unlock(id) {
    if (id === 'af1') return earnAf1(S.sim, 'the owner’s test switch');
    const st = store();
    const spot = SPOTS.find((s) => s.plane === id);
    if (!spot) return false;
    Store.markFound(st, spot, { mapName: mapName(spot.map) });
    Store.save(st);
    unlockPlane(S.sim, id);
    return true;
  },
  unlockAll() {
    for (const id of HIDDEN_PLANES) API.unlock(id);
    API.unlock('af1');
  },
  /** Forget every find, hint and sighting, and take the secret planes out of the Hangar again (tests, the owner). */
  forget() {
    S.store = Store.blank();
    Store.save(S.store);
    const p = (S.sim && S.sim.prog) || Prog.load();
    const ids = new Set(AIRCRAFT.filter((a) => a.secret).map((a) => a.id));
    p.unlocked = p.unlocked.filter((x) => !ids.has(x));
    Prog.save(p);
    clearPins(S.sim);
    for (const h of S.hideouts) {
      h.taken = false;
      if (h.plane) h.plane.visible = h.open > 0.01;
    }
    refreshMenu();
  },
  /** Every frame-independent fact a test may want about the spots of every map. */
  spots: () => SPOTS.map((s) => ({ ...s })),
  spotById,
};

export const secrets = API;
