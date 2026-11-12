/**
 * TSUNAMI — a natural disaster (game/disasters.js lists it; this file is
 * loaded the first time one is set going, never before).
 *
 * A warning. The sea draws back from the shore. A minute or so later a long,
 * tall wave comes in from offshore, stands up in the shallows, breaks on the
 * coast and runs a few hundred metres over the low ground; one or two
 * smaller ones follow; the water drains back and it is over.
 *
 * It is ONE wave in ONE place: the sea itself (world/sea-state.js). The
 * shader draws it and waveAt/swellAt answer it from the same numbers, so
 * everything that already asks the sea how high it is — boats, the carrier,
 * a floatplane's floats, a ditched aeroplane, the rafts — rides it without
 * knowing. What is added here is only what the sea does not already do:
 *
 *   - the plan and the clock (world/tsunami.js), and the words;
 *   - the aeroplane on flooded ground: it is slid along by the water, its
 *     undercarriage and hull take damage (physics.js takeHit, the game's own
 *     damage model), the engine drowns, and in deep water it is a wreck. If
 *     the water carries it off the shore, it is in the sea, and the game's
 *     own water crash is what ends the flight;
 *   - flying into the wave is flying into the sea;
 *   - the tower closes the runway while there is water on it;
 *   - the cars and boats along the flooded shore are kept away (the ambient
 *     layer's own thinAround), and the people and vans of a flooded airfield
 *     are not drawn until it drains. Nobody is ever shown in the water.
 *
 * Nothing flashes: the wave is a slow change, and its foam is a band that
 * moves, never a blink. It ends with the flight: back to the runway or the
 * menu, or a new world, and the sea is the ordinary sea again.
 */

import { registerExtension } from '../game/extensions.js';
import { groundHeightAt as heightAt, MAP, SEA_CUT } from '../world/terrain.js';
import { RUNWAY } from '../world/airport.js';
import { SPEC } from '../aircraft/physics.js';
import { setTsunami, tsunamiAt, waveHeightAt } from '../world/sea-state.js';
import { planTsunami, buildField, stateAt, waveFor, mapSpan } from '../world/tsunami.js';
import { thinAround, unthin } from './ambient.js';

/** Water this deep over the ground starts to move an aeroplane; this deep, it is a wreck. */
export const SWEEP_DEPTH = 0.3;
export const LOST_DEPTH = 1.7;
/** The fastest the water carries anything, m/s. */
export const CARRY_MAX = 5;
/** The tower calls the runway closed with this much water on it, and open again once it has been dry this long. */
export const CLOSE_DEPTH = 0.12;
export const REOPEN_S = 6;

const S = {
  on: false,
  sim: null,
  sea: null,
  plan: null,
  wave: null,
  t: 0,
  said: {},
  thin: [],
  hidden: [],
  surf: [],
  closed: false,
  dryT: 0,
  hitT: 0,
  flow: 1,
  lastDepth: 0,
  swept: 0,
  maxDepth: 0,
  once: null,
  checkT: 0,
  buildMs: 0,
};
const _t = {};

function say(sim, text, kind = 'warn', secs = 6) {
  if (sim.hud && sim.hud.notify) sim.hud.notify(text, kind, secs);
}

function radio(sim, text) {
  const atc = sim.atc;
  if (!atc || typeof atc.say !== 'function') return;
  // A warning does not wait for the frequency.
  atc.cool = 0;
  atc.say(`${atc.callsign}, ${text}`, 'tower', 1);
}

function button(sim, left) {
  const ev = (sim.activeEvents = sim.activeEvents || {});
  if (left > 0) ev.tsunami = left;
  else {
    delete ev.tsunami;
    if (sim.menus && sim.menus.syncNatural) sim.menus.syncNatural(ev);
  }
}

/** Water over the ground at (x, z), in metres; 0 where there is none, or where that is simply the sea. */
export function floodDepth(x, z) {
  if (!S.on) return 0;
  const g = heightAt(x, z);
  if (g < 0) return 0;
  return Math.max(0, waveHeightAt(S.sea, x, z) - g);
}

/** The circles the flood can reach, for the cars and the boats to keep out of: the field's floodable land, in 500 m boxes. */
function shoreCircles(plan, field) {
  const box = new Map();
  const { n, size, cx, cz, data } = field;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = (j * n + i) * 4;
      const land = (data[k + 2] / 255) * 32;
      // Land the water can stand on: reached, and lower than a crest gets there.
      if (land <= 0 || data[k] < 12 || land > (plan.H * data[k]) / 255) continue;
      const x = cx - size / 2 + ((i + 0.5) * size) / n;
      const z = cz - size / 2 + ((j + 0.5) * size) / n;
      const key = `${Math.floor(x / 500)},${Math.floor(z / 500)}`;
      const b = box.get(key) || { x: 0, z: 0, c: 0 };
      b.x += x;
      b.z += z;
      b.c++;
      box.set(key, b);
    }
  }
  return [...box.values()]
    .sort((a, b) => b.c - a.c)
    .slice(0, 24)
    .map((b) => ({ x: b.x / b.c, z: b.z / b.c, r: 420 }));
}

function runwayDepth() {
  const a = RUNWAY.thresholdWest;
  const b = RUNWAY.thresholdEast;
  let worst = 0;
  for (let i = 0; i <= 8; i++) {
    const k = i / 8;
    worst = Math.max(worst, floodDepth(a.x + (b.x - a.x) * k, a.z + (b.z - a.z) * k));
  }
  return worst;
}

/** The airfield's people and vans (features/life), while the field is under water. */
function hideField(sim, hide) {
  if (hide) {
    if (S.hidden.length || !sim.scene) return;
    for (const name of ['world-life:people', 'world-life:vans']) {
      const g = sim.scene.getObjectByName(name);
      if (g && g.visible) {
        g.visible = false;
        S.hidden.push(g);
      }
    }
  } else {
    for (const g of S.hidden) g.visible = true;
    S.hidden.length = 0;
  }
}

function closeRunway(sim, closed) {
  if (S.closed === closed) return;
  S.closed = closed;
  const atc = sim.atc;
  hideField(sim, closed);
  if (!atc) return;
  if (closed) {
    // No clearance on to a flooded runway (atc-director.js asks once() before each call).
    if (!S.once && typeof atc.once === 'function') {
      S.once = atc.once;
      atc.once = function once(key) {
        if (S.closed && (key === 'clearance' || key === 'final' || key === 'shortfinal')) return false;
        return S.once.call(this, key);
      };
    }
    radio(sim, `${atc.field} Tower, the runway is closed, there is water on it. Stay airborne or hold on high ground.`);
    say(sim, 'Runway closed: it is under water', 'warn', 6);
  } else {
    radio(sim, `${atc.field} Tower, the water has drained, the runway is open again.`);
    say(sim, 'Runway open again', 'good', 5);
  }
}

/** The aeroplane and the water. */
function aircraft(sim, dt) {
  const ac = sim.aircraft;
  if (!ac || ac.crashed || sim.mode === 'drive') return;
  const x = ac.pos.x;
  const z = ac.pos.z;
  const g = heightAt(x, z);
  const level = waveHeightAt(S.sea, x, z);
  const w = S.wave;
  tsunamiAt(S.sea, x, z, _t);
  // A floatplane on its floats is carried along with the wave as it goes by. A ditched aeroplane and its rafts
  // (features/ditching) rise and fall on it together, where they are: none of them is carried off from the others.
  if (g < 0) {
    if (ac.ditched) return;
    if (SPEC.floats && ac.pos.y < level + 3) {
      const v = CARRY_MAX * Math.max(0, Math.min(1, _t.h / (w.H * w.off)));
      ac.pos.x += w.dx * v * dt;
      ac.pos.z += w.dz * v * dt;
      if (v > 0.5) S.swept += v * dt;
    } else if (!ac.onGround && _t.h > 1.5 && ac.pos.y < level - 0.6) {
      ac.crash('You flew into the wave', { worldPoint: ac.pos.clone(), surfaceKind: 'water' });
    }
    return;
  }
  const depth = level - g;
  if (depth <= 0) return;
  // The wheels are this far under the aeroplane's origin.
  const wheels = ac.pos.y - g;
  if (wheels > 6) return;
  if (!ac.onGround) {
    // Low over the flood: the water is the surface.
    if (ac.pos.y < level - 0.6 && depth > 1) ac.crash('You flew into the wave', { worldPoint: ac.pos.clone(), surfaceKind: 'water' });
    return;
  }
  S.maxDepth = Math.max(S.maxDepth, depth);
  // Which way the water is going: inland while it rises, back to the sea (more slowly) as it drains.
  S.flow += ((depth >= S.lastDepth ? 1 : -0.6) - S.flow) * Math.min(1, dt * 1.5);
  S.lastDepth = depth;
  if (depth < SWEEP_DEPTH) return;
  // Slid along with it: gently in a little water, at a walk in a metre of it.
  const v = S.flow * Math.min(CARRY_MAX, 1 + 3 * depth) * Math.min(1, (depth - SWEEP_DEPTH) / 0.5);
  ac.pos.x += w.dx * v * dt;
  ac.pos.z += w.dz * v * dt;
  S.swept += Math.abs(v) * dt;
  if (!S.said.swept) {
    S.said.swept = true;
    say(sim, 'The water has the aeroplane: it is being swept along', 'warn', 6);
  }
  // Salt water and whatever is in it: the undercarriage first, then the hull; and an engine does not run under water.
  S.hitT -= dt;
  if (S.hitT <= 0) {
    S.hitT = 1;
    ac.takeHit('gear', 0.05 + 0.05 * depth, 'tsunami');
    if (depth > 0.8) ac.takeHit('fuselage', 0.04 * depth, 'tsunami');
    if (depth > 0.9 && ac.engineOn && typeof ac.stopEngine === 'function') {
      ac.stopEngine('flood');
      say(sim, 'The engine has drowned', 'warn', 5);
    }
  }
  // In deep water it is a wreck: it will not fly again, and it goes where the water goes. If that is out to sea,
  // the sea is the game's own sea and its own water crash ("You flew into the sea") is what ends the flight.
  if (depth > LOST_DEPTH && !S.said.lost) {
    S.said.lost = true;
    ac.takeHit('gear', 1, 'tsunami');
    ac.takeHit('fuselage', 0.5, 'tsunami');
    if (ac.engineOn && typeof ac.stopEngine === 'function') ac.stopEngine('flood');
    say(sim, 'The aeroplane is wrecked by the water. Restart, or return to the airport.', 'warn', 8);
  }
}

function end(sim, why = '') {
  if (!S.on) return;
  S.on = false;
  if (S.sea) setTsunami(S.sea, null);
  SEA_CUT.d = 0;
  for (const m of S.surf) m.visible = true;
  S.surf.length = 0;
  for (const t of S.thin) unthin(t);
  S.thin.length = 0;
  hideField(sim, false);
  S.closed = false;
  if (S.once && sim.atc) sim.atc.once = S.once;
  S.once = null;
  S.sea = null;
  S.wave = null;
  button(sim, 0);
  if (why === 'over') say(sim, 'The water has drained back. The tsunami is over.', 'good', 6);
}

function update(sim, dt) {
  if (!S.on) return;
  // A new world (another map, another quality) has a new sea with no wave on it.
  if (!sim.ocean || sim.ocean.sea !== S.sea) return end(sim);
  const p = S.plan;
  S.t += dt;
  const st = stateAt(p, S.t);
  if (st.over) return end(sim, 'over');
  const w = S.wave;
  w.U = st.U;
  w.D = st.D;
  button(sim, Math.max(1, p.tEnd - S.t));

  // The sea bed the sea has drawn back from is drawn (terrain.js SEA_CUT), for an eye near enough and low enough to see it.
  const ac = sim.aircraft;
  const near = ac && Math.hypot(ac.pos.x - p.fx, ac.pos.z - p.fz) < 3200 && ac.pos.y < 900;
  SEA_CUT.d = near && st.D > 0.05 ? -(st.D + 0.6) : 0;
  // The surf line traced along the old waterline has no water under it.
  const surf = st.D < 0.15;
  if (S.surfOn !== surf) {
    S.surfOn = surf;
    if (!S.surf.length && sim.ocean.group) sim.ocean.group.traverse((o) => o.name === 'surf' && S.surf.push(o));
    for (const m of S.surf) m.visible = surf;
  }

  if (p.coast) {
    if (S.t > 6 && !S.said.draw) {
      S.said.draw = true;
      say(sim, 'The sea is drawing back from the shore. The wave is coming.', 'warn', 7);
    }
    if (S.t > p.tArrive - 25 && !S.said.thin) {
      S.said.thin = true;
      for (const c of shoreCircles(p, w.field)) S.thin.push(thinAround(c.x, c.z, c.r));
    }
    if (S.t > p.tArrive - 14 && !S.said.sight) {
      S.said.sight = true;
      say(sim, 'The wave is in sight offshore. It reaches the coast in seconds.', 'warn', 7);
      radio(sim, 'the wave is about to reach the coast. Stay clear of the shore and the low ground.');
    }
    S.checkT -= dt;
    if (S.checkT <= 0) {
      S.checkT = 0.5;
      const d = runwayDepth();
      if (d > CLOSE_DEPTH) {
        S.dryT = 0;
        closeRunway(sim, true);
      } else if (S.closed && d < 0.03 && (S.dryT += 0.5) >= REOPEN_S) closeRunway(sim, false);
    }
  }
  aircraft(sim, dt);
}

/** Set one going where the aeroplane is. False (and the reason said) where there is no sea to bring one. */
export function start(sim) {
  if (S.on) return true;
  const sea = sim.ocean && sim.ocean.sea;
  const ac = sim.aircraft;
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  const quality = (sim.ocean && sim.ocean.quality) || 'high';
  const plan = sea && ac ? planTsunami({ x: ac.pos.x, z: ac.pos.z, span: mapSpan(MAP), quality, bearing: Math.random() * Math.PI * 2 }) : null;
  if (!plan) {
    button(sim, 0);
    say(sim, 'No tsunami here: the sea is too far away.', 'info', 5);
    return false;
  }
  const field = buildField(plan);
  Object.assign(S, { on: true, sim, sea, plan, wave: waveFor(plan, field), t: 0, said: {}, closed: false, dryT: 0, hitT: 0, swept: 0, maxDepth: 0, checkT: 0, surfOn: true, flow: 1, lastDepth: 0 });
  setTsunami(sea, S.wave);
  S.buildMs = typeof performance !== 'undefined' ? performance.now() - t0 : 0;
  button(sim, plan.tEnd);
  radio(sim, `tsunami warning for ${(sim.atc && sim.atc.field) || 'the field'}. Get airborne or get to high ground.`);
  return true;
}

/** For the tests and the console: where it is, and a way to move its clock. */
export function tsunamiState() {
  const p = S.plan;
  return {
    on: S.on,
    t: S.t,
    plan: p,
    U: S.wave ? S.wave.U : 0,
    D: S.wave ? S.wave.D : 0,
    closed: S.closed,
    swept: S.swept,
    maxDepth: S.maxDepth,
    thinned: S.thin.length,
    hidden: S.hidden.length,
    seaCut: SEA_CUT.d || 0,
    buildMs: S.buildMs,
    verts: S.sea && S.sea.mesh ? S.sea.mesh.geometry.attributes.position.count : 0,
  };
}
export function skipTo(t) {
  if (S.on) S.t = t;
}
export function stop(sim = S.sim) {
  if (sim) end(sim);
}

registerExtension({
  id: 'tsunami',
  update,
  // It ends with the flight: back to the runway, back to the menu, a new flight.
  stop: (sim) => end(sim),
  startMode: (sim) => end(sim),
});

if (typeof window !== 'undefined') window.__tsunami = { start, stop, skipTo, state: tsunamiState, floodDepth };
