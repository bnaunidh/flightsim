/**
 * The one door between the event missions and the flight-events feature.
 *
 * The missions (src/game/extra/events.js) used to import
 * src/features/flight-events.js directly. The mission list is always loaded,
 * so that import registered the whole feature, dice and all, whatever
 * src/features/index.js said: taking the feature's line out of the index —
 * the one-line off switch the plug-in layer promises — turned nothing off.
 *
 * Now the feature fills this in when (and only if) it is loaded, and the
 * missions read it. With the feature out, `api` stays null, the missions
 * read a quiet "nothing happening" instead, and each step that waits on a
 * story gives up politely after a few seconds (orSkip in events.js).
 *
 * Nothing here registers anything or builds anything.
 */

export const BRIDGE = { api: null };

/* The same shapes as hijackInfo() and breakInInfo(), with nothing going on. */
const IDLE_HIJACK = Object.freeze({
  phase: 'idle', version: 'film', owner: null, squawked: false, answered: 0, choosing: false,
  escorts: 0, escortFormed: false, escortBroke: false, acked: false, talked: false, tension: 0.6,
  released: false, onRemote: false, landed: false, police: 0, stairs: false, stand: null,
  guide: null, lead: null, remote: null, landHdg: null, comeToYou: false, done: false, score: 0, stars: 0, paid: 0,
  crewCalled: false, foSquawked: false, radioDone: false, radio: null, landSignal: false, leadGear: false, gearAck: false,
  leaving: false, onApproach: false, wantAlt: null, leadAim: null,
});

const IDLE_BREAKIN = Object.freeze({
  phase: 'idle', owner: null, police: 0, car: false, progress: 0, clear: false, done: false,
  breach: null, holdPos: null, ground: true, warned: false, siteOk: false,
});

export function forceHijack(sim, o) {
  return BRIDGE.api ? BRIDGE.api.forceHijack(sim, o) : false;
}

export function hijackInfo() {
  return BRIDGE.api ? BRIDGE.api.hijackInfo() : IDLE_HIJACK;
}

export function forceBreakIn(sim, o) {
  return BRIDGE.api ? BRIDGE.api.forceBreakIn(sim, o) : false;
}

export function breakInInfo() {
  return BRIDGE.api ? BRIDGE.api.breakInInfo() : IDLE_BREAKIN;
}

/** Counts up every frame the feature runs; stands still (-1) when it is not loaded. */
export function eventsHeartbeat() {
  return BRIDGE.api ? BRIDGE.api.heartbeat() : -1;
}
