/**
 * The Nullspire Javelin: the secret aeroplane parked on the hidden city's
 * ramp, a hundred kilometres out in the void (worldmap/void-city.js). The
 * owner, 2026-11-08: "add a secret aircraft there", "make the secret plane
 * super fast like mach 5".
 *
 * NOT IN THE ROSTER UNTIL FOUND. The other secret planes (./secret.js) are in
 * AIRCRAFT from the start and the Hangar draws them as silhouettes; this one
 * must appear nowhere until you have it, so it is a module nothing in the
 * first load imports. registerJavelin() puts it into AIRCRAFT: called by
 * features/secrets.js at load when progression says it is yours, and by
 * features/farlands-run.js the moment you earn it (a landing at Nullspire,
 * or walking up to it on the ramp). Every test that walks AIRCRAFT sees the
 * roster it always saw (fighters.mjs: Massimo stays the fastest thing in the
 * shop; this is not in the shop).
 *
 * WHAT IT IS. A version of the Massimo racer to the flight model, the
 * cockpit and the sound, in the city's own paint, with a scramjet's law in
 * place of the burners: ./reheat.js's jet law with a bigger ram term, a red line of
 * 490 m/s indicated and a ceiling of 120,000 ft, so from Mach 2.4 at 20 km
 * (65,000 ft, under the 70,000 ft top of the sky) it is at Mach 5 in forty
 * seconds and the inlets' wall holds it there (measured: 5.18). Low and slow
 * it is a Massimo: it lands on Nullspire's 3,600 m like one.
 *
 * WHAT IT LOOKS LIKE (v80): its own airframe, an original hypersonic research
 * aircraft, drawn by the fleet pack from ../../fleet/extra/javelin.js. That
 * module is imported here and nowhere else, so it is as hidden as this one;
 * registerJavelin() puts the airframe into the pack as it puts the type into
 * the roster, and model-adapter.js then draws a `variantOf` that the pack
 * covers under its own id as itself. The gear, the hard points and the eye
 * come from that model (fleet/aircraft-game-bridge.js configurePlayerAircraft),
 * as they do for every pack aeroplane; the aero below is untouched.
 */
import { AIRCRAFT, getAircraft } from '../types.js';
import { registerJavelinModel, drawJavelinPlan } from '../../fleet/extra/javelin.js';

export const JAVELIN_ID = 'javelin';
export const BASE_ID = 'massimo';

/** The scramjet's law (./reheat.js PROFILES' shape): Mach 5 at 26 km, the inlets' wall just over it. */
export const JAVELIN_REHEAT = Object.freeze({ mach: 5.0, alt: 20000, ram: 1.0, mdd: 0.93, wave: 0.008, choke: 5.1 });

/** The type, from the roster's Massimo. Null if there is no Massimo (there always is). */
export function javelinType() {
  const b = AIRCRAFT.find((t) => t.id === BASE_ID);
  if (!b) return null;
  return {
    ...b,
    id: JAVELIN_ID,
    variantOf: b.id,
    name: 'Nullspire Javelin',
    class: 'Hypersonic',
    category: 'special',
    blurb:
      'The one aeroplane that belongs to the city in the void. A racer’s airframe round a scramjet: at 85,000 ft it ' +
      'holds Mach 5 and the sky goes black. Low and slow it is a Massimo, and lands like one.',
    stats: { speed: 5, handling: 3, ease: 1 },
    livery: '#10131a',
    accent: '#ffb04a',
    callsign: 'Javelin one',
    secret: { how: 'found', hint: 'Parked at the city in the void, 100 km past the edge of the world' },
    // The drawn aeroplane seen from above (fleet/extra/javelin.js), for the airfield's stands and the Hangar's card.
    plan: { nose: -15.3, tail: 9.6, span: 9.5 },
    // The physics flies the Massimo's shape; the cards draw the Javelin's own airframe (ui/menus.js aircraftThumbnail).
    shape: b.shape,
    cardArt: drawJavelinPlan,
    aero: {
      ...b.aero,
      thrustMax: b.aero.thrustMax * 0.9,
      vne: 490,
      ceiling: 120000,
      fuelCapacity: b.aero.fuelCapacity * 1.6,
      // The scramjet, read by physics.js applyAircraft in place of ./reheat.js's table.
      reheat: JAVELIN_REHEAT,
    },
    buildModel: undefined,
  };
}

/** Put it in the roster, once. Returns the type, or null. */
export function registerJavelin() {
  const have = AIRCRAFT.find((t) => t.id === JAVELIN_ID);
  if (have) return have;
  const t = javelinType();
  if (!t) return null;
  delete t.buildModel;
  // Its airframe into the pack first, so the first model built for it is its own.
  try {
    registerJavelinModel();
  } catch (e) {
    console.warn('[javelin] the airframe did not register; drawn as the Massimo', e);
  }
  AIRCRAFT.push(t);
  return t;
}

/** Is it in the roster now? */
export function javelinRegistered() {
  return !!getAircraft && AIRCRAFT.some((t) => t.id === JAVELIN_ID);
}

/**
 * Free Flight's card for it: its floor is laid before the Javelin is in the roster. Cloned from the
 * Massimo's (the same flight model), with its own picture (menus.repaintFleetArt: a cloned canvas is blank).
 * Once; the fleet locks refreshed. From earning it (features/farlands-run.js) and every load after (features/secrets.js).
 */
export function addJavelinCard(menus, type = registerJavelin()) {
  try {
    const free = type && menus && menus.screens && menus.screens.free;
    const base = free && free.querySelector(`[data-aircraft="${type.variantOf}"]`);
    if (base && !free.querySelector(`[data-aircraft="${type.id}"]`)) {
      const card = base.cloneNode(true);
      card.dataset.aircraft = type.id;
      card.classList.remove('is-chosen', 'is-selected', 'is-on');
      const put = (sel, text) => {
        const el = card.querySelector(sel);
        if (el) el.textContent = text;
      };
      put('.fleet-name', type.name);
      put('.fleet-class', type.class);
      put('.fleet-blurb', type.blurb);
      const art = card.querySelector('[data-fleet-art]');
      if (art) art.dataset.fleetArt = type.id;
      base.parentNode.appendChild(card);
      if (menus.repaintFleetArt) menus.repaintFleetArt(type.id);
    }
    if (menus && menus.syncFleetLocks) menus.syncFleetLocks();
  } catch (e) {
    /* the Hangar repaints itself when it is next opened */
  }
}

/** On the menu with the Javelin as the saved pick: picked again (the boot's restore ran before it was in the roster). */
export function repickJavelin(sim) {
  const menus = sim && sim.menus;
  if (sim.state === 'menu' && sim.settings && sim.settings.aircraft === JAVELIN_ID && menus && menus.pickFreeAircraft && menus.chosenAircraft !== JAVELIN_ID) menus.pickFreeAircraft(JAVELIN_ID);
}
