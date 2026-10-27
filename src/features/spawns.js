/**
 * Spawns: where a Free Flight starts, by aircraft class, with a "Start at"
 * picker on the Free Flight screen.
 *
 * The data and the resolver are in src/world/spawns.js (pure, node-tested).
 * This is the runtime: the picker, the saved choice, and the one hook that
 * moves the aeroplane after main.js has put it on the runway.
 *
 * WHEN IT ACTS — and only then:
 *   mode === 'free' AND opts.startAt is set, which the Free Flight screen's
 *   wrapped startFree does. It does nothing for
 *     - a programmatic sim.startMode('free', {...}) with no startAt: every
 *       existing test keeps today's runway start, byte for byte;
 *     - missions (they have their own spawns);
 *     - an airborne start (opts.airborne);
 *     - taxi mode (opts.taxi ?? settings.startAtGate): taxi.js keeps its route;
 *     - a multiplayer joiner (multiplayer.role && multiplayer.transition):
 *       they keep applySpawn's offsets, so two players never share a stand;
 *     - startAt 'carrier': carrier-ops places that one itself (the catapult,
 *       Paddles, its objective text), so the two never both move the aircraft;
 *     - startAt 'runway': today's start, already in place.
 *
 * THE PICKER is installed after carrier-ops so its startFree wrapper is the
 * outermost one. Its entries come from spawnChoices() — at most six, "Auto
 * (fits your aircraft)" first, the runway last — saved per class in
 * localStorage under islandsim.startAt.v1. A saved choice this map has not
 * got (a gate chosen on Gateway, flown from the air base) is Auto here, in
 * the picker and in the flight alike; it is kept for the map it was made on.
 * A military aeroplane's Carrier
 * entry, or an Auto that resolves to the carrier, is passed on as
 * startAt 'carrier' for carrier-ops; the old Carrier / Airbase buttons hide
 * themselves while this picker is installed (carrier-ops.js looks for the
 * wrapper's `_spawns` flag).
 *
 * After placing: the objective text names the place, and the tower is told
 * the right words — "on stand 4", "on the pad". An airliner nose-in on a
 * contact stand gets its jet bridge from airport-services's own visitor scan
 * (setVisitors, twice a second), with no apron.js edit.
 */

import * as THREE from '../vendor/three.module.js';
import { registerExtension } from '../game/extensions.js';
import { MAP, AIRPORT } from '../world/terrain.js';
import { airportLayout } from '../world/airport-layout.js';
import { spawnClassOf, resolveSpawn, spawnChoices, CLASSES } from '../world/spawns.js';
import { getAircraft, AIRCRAFT } from '../aircraft/types.js';
import { SPEC } from '../aircraft/physics.js';
import { keyLabel } from '../flight/input.js';
import { multiplayer } from './multiplayer.js';
import { takeCraft } from './traffic.js';
import * as UI from './spawns/ui.js';

const STORE = 'islandsim.startAt.v1';

const S = {
  sim: null,
  /** Saved choice per class: { airliner: 'gate', heli: 'pad:hospital', ... }. */
  choice: null,
  /** The last placement this extension made (for the tests and the console). */
  last: null,
  /** The last start it was asked about and what it decided. */
  decided: null,
  installed: false,
  placed: 0,
};

/* ------------------------------------------------------------------ */
/* The saved choice                                                    */
/* ------------------------------------------------------------------ */

function loadChoice() {
  if (S.choice) return S.choice;
  let v = null;
  try {
    const raw = localStorage.getItem(STORE);
    v = raw ? JSON.parse(raw) : null;
  } catch (e) {
    v = null;
  }
  S.choice = v && typeof v === 'object' ? v : {};
  return S.choice;
}

function choiceFor(cls) {
  const c = loadChoice()[cls];
  return typeof c === 'string' && c ? c : 'auto';
}

function saveChoice(cls, id) {
  const c = loadChoice();
  c[cls] = id || 'auto';
  try {
    localStorage.setItem(STORE, JSON.stringify(c));
  } catch (e) {
    /* storage blocked: the choice lasts for this session */
  }
}

/* ------------------------------------------------------------------ */
/* What the game knows                                                 */
/* ------------------------------------------------------------------ */

function typeChosen(sim) {
  const menus = sim.menus;
  const id = menus && menus.chosenAircraft;
  let t = null;
  try {
    t = sim.findAircraft ? sim.findAircraft(id) : null;
  } catch (e) {
    t = null;
  }
  return t || AIRCRAFT.find((a) => a.id === id) || getAircraft(id);
}

function ctxNow(sim) {
  let layout = null;
  try {
    layout = airportLayout();
  } catch (e) {
    layout = null;
  }
  return { layout, traffic: Array.isArray(sim.traffic) ? sim.traffic : [], carrier: sim.carrier || null };
}

/*
 * The airport's traffic parks on the same stands the player starts on, and it
 * is started first. At Gateway an A321neo (44.5 m) fits only the four heavy
 * gates; the airport parks its own jumbos on three, and a parked freighter of
 * the traffic's sat on the fourth — so "Gate" put every A321 on the runway
 * with "Nowhere free to start there", and there was no pushback to film.
 * The player is who the airport is for: a traffic aeroplane that is only
 * PARKED (not taxiing, not on the runway) in the way of the place asked for
 * leaves (takeCraft, the owner's teleport's own exit), and the traffic fills
 * the gap later somewhere the player is not (playerOnSlot). Never the
 * airport's own parked aeroplanes, and never anything moving.
 */
function makeRoom(sim, cls, type, id, ctx) {
  const traffic = Array.isArray(ctx.traffic) ? ctx.traffic : [];
  const parked = traffic.filter((t) => t && t.pos && t.onGround && (t.phase === 'parked' || t.activity === 'parked') && !(Math.abs(t.speed || 0) > 0.3));
  if (!parked.length) return null;
  const rest = traffic.filter((t) => parked.indexOf(t) < 0);
  const r = resolveSpawn(MAP.id, cls, { type, choice: id, random: true, ctx: { ...ctx, traffic: rest } });
  if (!r || r.kind === 'runway') return null;
  const reach = (t) => (r.span || 12) / 2 + 5 + (t.span || 12) / 2;
  const inWay = parked.filter((t) => Math.hypot(t.pos.x - r.x, t.pos.z - r.z) < reach(t));
  for (const t of inWay) {
    try {
      takeCraft(sim, t.id);
    } catch (e) {
      return null;
    }
  }
  // Moved out of the way: check again against what is left, as the start would have.
  const again = resolveSpawn(MAP.id, cls, { type, choice: id, random: false, ctx: ctxNow(sim) });
  if (again.kind === 'runway') return null;
  S.madeRoom = inWay.map((t) => t.callsign || t.id);
  return again;
}

function mpJoining() {
  try {
    return !!(multiplayer && multiplayer.role && multiplayer.transition);
  } catch (e) {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* The picker                                                          */
/* ------------------------------------------------------------------ */

function installPicker(sim) {
  const menus = sim.menus;
  if (!menus || !menus.hooks || typeof menus.hooks.startFree !== 'function') return;
  if (!menus.hooks.startFree._spawns) {
    const orig = menus.hooks.startFree;
    const wrapped = (cfg) => {
      let startAt = 'auto';
      try {
        const type = typeChosen(sim);
        const cls = spawnClassOf(type);
        const ctx = ctxNow(sim);
        startAt = choiceFor(cls);
        /*
         * The choice is saved per class, not per map. A gate chosen on
         * Gateway is nowhere on the air base, and a pad chosen on Harbour
         * City is not on Fjord: the picker shows Auto for it (ui.js), so
         * Auto is what the flight gets, not the stale id's "nowhere free to
         * start there" fallback and its toast. The saved choice is kept, for
         * the map it was made on.
         */
        if (startAt !== 'auto' && !spawnChoices(MAP.id, cls, { type, ctx }).some((e) => e.id === startAt)) startAt = 'auto';
        if (cls === 'military') {
          // The carrier stays carrier-ops's: its catapult, its words.
          if (startAt === 'carrier') startAt = 'carrier';
          else if (startAt === 'auto') {
            const r = resolveSpawn(MAP.id, cls, { type, ctx });
            if (r.kind === 'carrier') startAt = 'carrier';
          }
        }
      } catch (e) {
        startAt = 'auto';
      }
      return orig({ ...(cfg || {}), startAt });
    };
    wrapped._spawns = true;
    wrapped._carrier = orig._carrier;
    menus.hooks.startFree = wrapped;
  }
  const paint = () => {
    try {
      UI.picker(menus.root, {
        entries: () => {
          const type = typeChosen(sim);
          const cls = spawnClassOf(type);
          return spawnChoices(MAP.id, cls, { type, ctx: ctxNow(sim) });
        },
        get: () => choiceFor(spawnClassOf(typeChosen(sim))),
        set: (id) => saveChoice(spawnClassOf(typeChosen(sim)), id),
        // The Departure tab's "parking stand" (taxi) and "in the air" starts are their own thing.
        visible: () => !menus.chosenStart || menus.chosenStart === 'runway',
      });
      // The carrier's own buttons repaint themselves on the same click and hide.
    } catch (e) {
      /* no Free Flight screen in this build */
    }
  };
  paint();
  if (menus.root && menus.root.addEventListener) menus.root.addEventListener('click', () => setTimeout(paint, 0));
  S.installed = true;
}

/* ------------------------------------------------------------------ */
/* Placing                                                             */
/* ------------------------------------------------------------------ */

const V = new THREE.Vector3();

/** The player's key for an action, as the HUD would print it. */
function keyName(sim, action) {
  const codes = sim && sim.input && sim.input.bindings && sim.input.bindings[action];
  const c = codes && codes[0];
  if (!c) return action === 'starter' ? 'I' : 'P';
  try {
    return keyLabel(c);
  } catch (e) {
    return String(c).replace(/^Key|^Digit/, '');
  }
}

/** "09", from the runway this map actually has. */
function runwayNumber() {
  const deg = (AIRPORT && AIRPORT.headingDeg) || 90;
  const n = Math.round((((deg % 360) + 360) % 360) / 10) || 36;
  return String(n).padStart(2, '0');
}

/** A stand or a hangar is a parking place: engines off, as the airport parks its own. */
function parked(kind) {
  return kind === 'stand' || kind === 'hangar';
}

function words(r, sim) {
  const heli = !!SPEC.rotor;
  const rw = runwayNumber();
  const start = keyName(sim, 'starter');
  // The ground crew's action is 'services' (airport-services.js, P). There was no
  // 'crew' action, so this said "Y calls the ground crew" and Y is the autopilot.
  const crew = keyName(sim, 'services');
  switch (r.kind) {
    case 'stand':
      return heli
        ? `You are on ${r.label}. Lift when you are ready and keep clear of the runway.`
        : `You are on ${r.label}, nose-in at the terminal, engines off. ${start} starts up; ${crew} calls the ground crew for a push back. Then taxi to runway ${rw}.`;
    case 'hangar':
      return `You are in ${r.label}, nose out, engine off. ${start} starts up, then roll out onto the apron and taxi to runway ${rw}.`;
    case 'strip':
      return 'You are on the outpost strip. Take off and explore the islands.';
    case 'base':
      return `You are on the flight line in front of the shelters. Taxi to runway ${rw} and go.`;
    case 'pad':
      return `You are on ${r.label.replace(/^Helipad: /, '')}. Lift when you are ready and keep clear of the runway.`;
    case 'water':
      return 'You are at the harbour, on the water. Taxi out through the mouth and take off into wind.';
    case 'hover':
      return 'You are airborne offshore, lined up for runway 09. Land when you like, or go exploring.';
    case 'apron':
      return `You are on the open apron. Taxi to runway ${rw} when you are ready.`;
    default:
      return `Take off from runway ${rw}, explore the islands, and land whenever you like.`;
  }
}

/**
 * How much fuel is in the tanks at a STAND or in a hangar when nobody asked:
 * 35-60%, settled by the stand and the aircraft (the same every time, so a
 * player learns their aeroplane), so the bowser has something to do during
 * "Fuelling and loading" and the FUEL bar visibly fills (the owner,
 * 2026-10-17: "i spawn with full fuel" made fuelling pointless). Everywhere
 * else — the runway, airborne, the water, a pad — the tanks are full, as
 * they always were. A fuel the start options name (opts.fuel) always wins.
 */
export const STAND_FUEL = Object.freeze({ min: 0.35, max: 0.6 });
export function spawnFuel(r, typeId, optFuel) {
  if (optFuel != null) return Math.max(0.05, Math.min(1, optFuel));
  if (!r || !parked(r.kind)) return 1;
  let h = 2166136261;
  for (const ch of `${r.id || r.label || r.kind}|${typeId || ''}`) h = (h ^ ch.charCodeAt(0)) * 16777619 >>> 0;
  const u = (h % 1000) / 999;
  return Math.round((STAND_FUEL.min + u * (STAND_FUEL.max - STAND_FUEL.min)) * 100) / 100;
}

function place(sim, r, opts) {
  const ac = sim.aircraft;
  if (!ac) return false;
  const fuel = spawnFuel(r, sim.aircraftType && sim.aircraftType.id, opts.fuel);
  if (r.kind === 'hover') {
    V.set(r.x, 0, r.z);
    ac.reset({ pos: V, headingDeg: r.headingDeg, speed: r.speed || 60, altAGL: r.agl || 150, engineOn: true, fuel });
    ac.controls.throttle = 0.7;
    if (sim.input) {
      sim.input.throttleTarget = 0.7;
      if (sim.input.out) sim.input.out.throttle = 0.7;
    }
  } else {
    // The height comes from the aircraft's own gear: altAGL null runs settleOnGear,
    // over the ground or over a deck (heightAt knows the platforms). On a stand
    // or in a hangar the engines are off, the way the airport parks its own
    // (and an airliner at idle creeps off its stop, so the bridge never comes).
    V.set(r.x, 0, r.z);
    ac.reset({ pos: V, headingDeg: r.headingDeg, speed: 0, altAGL: null, engineOn: !parked(r.kind), fuel });
    if (sim.input) {
      sim.input.throttleTarget = 0;
      if (sim.input.out) sim.input.out.throttle = 0;
    }
  }
  // Whatever the taxi tutorial or the ATC had planned for a runway start.
  if (sim.taxi && sim.taxi.active && sim.taxi.stop) sim.taxi.stop();
  if (sim.hud && typeof sim.hud.setObjective === 'function') {
    sim.hud.setObjective(`Free Flight — ${MAP && MAP.name ? MAP.name : 'the islands'}`, words(r, sim));
  }
  const atc = sim.atc;
  if (atc && typeof atc.say === 'function' && r.kind !== 'hover') {
    try {
      atc.cool = 0;
      const where = r.atc || 'on the apron';
      atc.say(`${atc.callsign}, ${atc.field} Ground, you are ${where}. Call when you are ready to taxi.`, 'ground');
      // Not the runway start's "Taxi and hold" on top of it.
      if (atc.said) atc.said.start = true;
    } catch (e) {
      /* the tower is optional */
    }
  }
  // The chase camera starts afresh behind the new spot (as carrier-ops does).
  const rig = sim.rig;
  if (rig && typeof rig === 'object') {
    rig.initialised = false;
    if (rig.chaseVel && rig.chaseVel.set) rig.chaseVel.set(0, 0, 0);
  }
  S.placed++;
  return true;
}

/* ------------------------------------------------------------------ */
/* The extension                                                       */
/* ------------------------------------------------------------------ */

registerExtension({
  id: 'spawns',

  install(sim) {
    S.sim = sim;
    sim.spawns = API;
    installPicker(sim);
  },

  startMode(sim, mode, opts) {
    S.decided = null;
    S.madeRoom = null;
    if (mode !== 'free' || !opts || !opts.startAt) return;
    let id = String(opts.startAt);
    const skip = (why) => {
      S.decided = { startAt: id, placed: false, why };
    };
    if (id === 'carrier') return skip("carrier-ops's");
    if (id === 'runway') return skip("today's start");
    if (opts.airborne) return skip('airborne start');
    const heli = !!SPEC.rotor;
    if (!heli && (opts.taxi ?? (sim.settings && sim.settings.startAtGate))) return skip('taxi mode');
    if (mpJoining()) return skip('multiplayer joiner');
    if (!sim.aircraft || !MAP) return skip('no aircraft');
    // The carrier-ops choice that meant "not the carrier": the base's flight line.
    if (id === 'airbase') id = 'base';
    const type = sim.aircraftType;
    const cls = spawnClassOf(type);
    const ctx = ctxNow(sim);
    let r = resolveSpawn(MAP.id, cls, { type, choice: id, random: true, ctx });
    if (r.kind === 'runway' && r.fallback) r = makeRoom(sim, cls, type, id, ctx) || r;
    S.last = r;
    if (r.kind === 'carrier') return skip('resolved to the carrier without startAt carrier; left on the runway');
    if (r.kind === 'runway') {
      if (r.fallback && sim.hud && typeof sim.hud.notify === 'function') {
        sim.hud.notify('Nowhere free to start there — lined up on the runway instead.', 'info', 3.4);
      }
      return skip(r.fallback ? 'nothing was clear; runway' : 'the runway choice');
    }
    const did = place(sim, r, opts);
    S.decided = { startAt: id, placed: did, kind: r.kind, label: r.label, why: r.why };
  },

  stop() {
    S.decided = null;
  },
});

/** For the tests and the console. */
export function spawnsState() {
  return { installed: S.installed, last: S.last, decided: S.decided, madeRoom: S.madeRoom || null, placed: S.placed, choice: { ...loadChoice() }, picker: UI.pickerState(), classes: CLASSES };
}

const API = {
  state: spawnsState,
  choiceFor,
  saveChoice,
  /** Resolve for the current map and aircraft (or a given type id) without moving anything. */
  preview: (choice = 'auto', typeId = null) => {
    const sim = S.sim;
    const type = typeId ? getAircraft(typeId) : sim && sim.aircraftType;
    return resolveSpawn(MAP.id, spawnClassOf(type), { type, choice, ctx: sim ? ctxNow(sim) : {} });
  },
  choices: (typeId = null) => {
    const sim = S.sim;
    const type = typeId ? getAircraft(typeId) : sim ? typeChosen(sim) : null;
    return spawnChoices(MAP.id, spawnClassOf(type), { type, ctx: sim ? ctxNow(sim) : {} });
  },
  repaint: () => {
    const sim = S.sim;
    if (sim && sim.menus && sim.menus.root) {
      const box = sim.menus.root.querySelector('.sp-start');
      if (box && box.paint) box.paint();
    }
  },
};
