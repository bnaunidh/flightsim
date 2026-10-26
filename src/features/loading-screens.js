/**
 * Map loading screens, about three seconds, for every way into a map.
 *
 * The owner: "add a cool loading screen for maps thats 3 seconds like the
 * fortnite one". A full-screen shot of the map in golden light, its name, what
 * you are flying, a tip and a slim bar (src/ui/loading-screen.js is the screen;
 * assets/loading/<map>.jpg is the picture, made from this game by
 * tools/loading-art/). This is what decides WHEN, and what the bar means.
 *
 * WHEN. A flight that starts from the menus (Free Flight, the lessons, a
 * mission, a Story chapter, a multiplayer join, a boat or a van), or that
 * starts on another map than the one built. Not a restart on the same map
 * ("Fly again", back to the runway): those are not a place you are arriving at.
 *   - startMode() is wrapped here, on the game itself;
 *   - startDrive() is NOT: it is synchronous, and the race and the multiplayer
 *     join start one and carry on with the vehicle at once. The buttons call
 *     launchDrive() (main.js), which asks us;
 *   - a multiplayer join (enterWorld) is wrapped so the boat and the van are
 *     covered too.
 *
 * WHAT HAPPENS, in order, behind the screen:
 *   1. the screen goes up and paints;
 *   2. if the map is not the one built, the world is built for it in stages
 *      (main.js buildWorldStaged), the bar and the line under it following the
 *      real stages;
 *   3. it waits out the three seconds (or a key/tap after one second);
 *   4. the flight itself starts (startMode / startDrive, the part that was
 *      always there), and the screen fades out onto it.
 * So the aeroplane never starts moving behind the screen, and the screen is
 * gone when the loading is.
 *
 * AUTOMATED BROWSERS skip it (navigator.webdriver, a headless Chrome), as the
 * suites call startMode hundreds of times. `?loading=1` forces it on,
 * `?loading=0` off, and sim.loading.enabled is the switch in code. The
 * self-test turns it off for itself (tests/selftest.js) and tests it in
 * tests/features/loading-screens.browser.js.
 *
 * SOUND: none. The music and the engine do what they did.
 */

import { registerExtension } from '../game/extensions.js';
import { LoadingScreen } from '../ui/loading-screen.js';
import { nextTip, tipsFor, renderTip } from '../ui/loading-tips.js';
import { getMap } from '../world/maps.js';
import { getAircraft } from '../aircraft/types.js';
import { pickMissionAircraft } from '../game/mission-aircraft.js';
import { VEHICLES } from '../vehicles/surface.js';
import { keyName } from '../flight/input.js';
import { FOCUS } from '../ui/loading-focus.js';

/** The three seconds, and the other numbers the owner's brief gave. */
export const LOADING_CONFIG = Object.freeze({
  minMs: 3000,
  skipAfterMs: 1000,
  fadeInMs: 320,
  fadeOutMs: 480,
  tipEveryMs: 4200,
});

/** Where a map's picture is. Same name as the map's id. */
export function artPath(mapId) {
  return `assets/loading/${mapId}.jpg`;
}

/**
 * The credit a map must show on its loading screen, or null. The real-world
 * San Francisco Bay map is built from OpenStreetMap, whose licence asks for a
 * visible "© OpenStreetMap contributors"; a map says so with `attribution`
 * (the exact line) or `osm: true`. Any other credit a map owes goes the same way.
 */
export function attributionFor(map) {
  if (!map) return null;
  if (map.attribution) return String(map.attribution);
  if (map.osm || /^(sfbay|sf-bay|sanfrancisco|san-francisco)$/.test(map.id || '')) return '© OpenStreetMap contributors';
  return null;
}

/** A golden-hour wash from the map's own sea colour, for the moment before its picture is in (or offline). */
export function fallbackFor(map) {
  const hex = map && map.palette && Number.isFinite(map.palette.deepWater) ? map.palette.deepWater : 0x123a5e;
  const c = `#${(hex & 0xffffff).toString(16).padStart(6, '0')}`;
  return `linear-gradient(180deg, #f3b27a 0%, #d9784a 24%, #4a5f8c 52%, ${c} 78%, #070c15 100%)`;
}

/** Is a robot driving this page? (The suites are; players are not.) */
export function isAutomated() {
  try {
    if (navigator.webdriver) return true;
    if (/HeadlessChrome/.test(navigator.userAgent || '')) return true;
  } catch (e) {
    /* a browser that will not say is a player's */
  }
  return false;
}

function urlSwitch() {
  try {
    const v = new URLSearchParams(location.search).get('loading');
    if (v === '1' || v === 'on') return true;
    if (v === '0' || v === 'off') return false;
  } catch (e) {
    /* no URL to read */
  }
  return null;
}

const MEM_KEY = 'islandsim.loadtip.v1';
function readMemory() {
  try {
    const m = JSON.parse(localStorage.getItem(MEM_KEY) || '{}');
    return m && typeof m === 'object' ? m : {};
  } catch (e) {
    return {};
  }
}
function writeMemory(m) {
  try {
    localStorage.setItem(MEM_KEY, JSON.stringify(m));
  } catch (e) {
    /* private mode: tips simply start somewhere new each time */
  }
}

const isRotor = (type) => !!(type && type.shape && type.shape.power && type.shape.power.rotor);

export class MapLoading {
  constructor(sim) {
    this.sim = sim;
    const forced = urlSwitch();
    /** On for players, off for robots; `?loading=` and this flag override. */
    this.enabled = forced == null ? !isAutomated() : forced;
    this.config = { ...LOADING_CONFIG };
    this.screen = new LoadingScreen({
      cfg: this.config,
      reducedMotion: () => this.reducedMotion(),
      touch: () => document.documentElement.classList.contains('is-touch-device'),
    });
    /** What the last screen did, for the tests and the console. */
    this.last = null;
    this.count = 0;
  }

  /** True while a screen is up (including its fade out). */
  get active() {
    return this.screen.active;
  }

  reducedMotion() {
    try {
      if (this.sim.settings && this.sim.settings.reducedMotion) return true;
      return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (e) {
      return false;
    }
  }

  /** Should a start from a button put the screen up? */
  wanted() {
    return this.enabled && !this.active && !this.sim._worldBuilding;
  }

  /* ---- what is about to be played ------------------------------------ */

  /** { mapId, game, vehicle, kicker } for startMode(mode, opts). */
  planMode(mode, opts = {}) {
    const sim = this.sim;
    const def = sim.defForMode(mode, opts);
    const mapId = getMap(def.map || sim.settings.map).id;
    // Mirrors startMode: the type the mission takes (game/mission-aircraft.js: the one asked for or picked in the
    // hangar if it accepts it — a UH-60 on Man Overboard, not the AW139 it recommends), else the mission's
    // aeroplane, else the one asked for, else the helicopter in the helicopter game, else the trainer.
    const picked = mode === 'mission'
      ? pickMissionAircraft(def, { asked: opts.aircraft, current: (sim.menus && sim.menus.chosenAircraft) || (sim.settings && sim.settings.aircraft) })
      : null;
    const want = picked || def.aircraft || opts.aircraft || (sim.game === 'heli' ? 'harrier' : 'skylark');
    const type = getAircraft(want);
    return {
      mapId,
      game: isRotor(type) ? 'heli' : 'flight',
      vehicle: type.name,
      kicker: def.name || 'Free Flight',
    };
  }

  /** The same for startDrive(kind, opts). */
  planDrive(kind, opts = {}) {
    const sim = this.sim;
    const def = sim.defForDrive(opts);
    const mapId = getMap((def && def.map) || sim.mapForGame(kind)).id;
    const spec = VEHICLES[kind] || VEHICLES.boat;
    return {
      mapId,
      game: kind === 'boat' ? 'boat' : 'car',
      vehicle: spec.name,
      kicker: (def && def.name) || (kind === 'boat' ? 'Patrol' : 'Free Drive'),
    };
  }

  /** The same for a multiplayer join: the server's map and game, and the seat the player takes. */
  planWorld(server, ride, mp) {
    const sim = this.sim;
    const g = server && server.game;
    const mapId = getMap((server && server.map) || sim.settings.map).id;
    if (g === 'boat' || g === 'car') {
      return { mapId, game: g, vehicle: (VEHICLES[g] || VEHICLES.boat).name, kicker: 'Multiplayer' };
    }
    // The ride, if it is one of the game's own kind: a helicopter server takes the helicopter picked (any of the hangar's rotorcraft).
    let id = ride && ride.game === g && ride.type && (g === 'heli') === isRotor(getAircraft(ride.type)) ? ride.type : null;
    if (!id) {
      try {
        id = g === 'heli' ? (mp && mp.myHeli ? mp.myHeli() : 'harrier') : mp && mp.myAircraft ? mp.myAircraft() : null;
      } catch (e) {
        id = null;
      }
    }
    const type = getAircraft(id || (g === 'heli' ? 'harrier' : 'skylark'));
    return { mapId, game: isRotor(type) ? 'heli' : 'flight', vehicle: type.name, kicker: 'Multiplayer' };
  }

  /** The screen's contents for a plan. */
  infoFor(plan) {
    const map = getMap(plan.mapId);
    const memory = readMemory();
    const first = nextTip(plan.game, memory);
    writeMemory(memory);
    const all = tipsFor(plan.game);
    const order = all.slice(first.index).concat(all.slice(0, first.index));
    const sim = this.sim;
    const tips = order.map((t) => renderTip(t, (a) => keyName(a, sim)));
    return {
      mapId: map.id,
      title: map.name,
      subtitle: map.subtitle || '',
      kicker: plan.kicker || '',
      vehicle: plan.vehicle || '',
      game: plan.game,
      art: artPath(map.id),
      // Where the picture's subject is, in percent, so a phone held upright crops round it (loading-focus.js is generated).
      focus: FOCUS[map.id] || null,
      credit: attributionFor(map),
      fallback: fallbackFor(map),
      tips,
      tip: tips[0],
    };
  }

  /* ---- the screen ----------------------------------------------------- */

  /**
   * Run `fn` (the start of a flight, or a join) behind the screen for `plan`.
   * Resolves with fn's result as soon as fn is done and the screen is on its
   * way out; the screen is gone `fadeOutMs` later (`loading.active`).
   */
  async around(plan, fn) {
    if (this.active) return fn();
    const sim = this.sim;
    const S = this.screen;
    let info;
    try {
      info = this.infoFor(plan);
    } catch (err) {
      console.warn('[loading-screens] could not make the screen; starting without it', err);
      return fn();
    }
    const rec = { mapId: info.mapId, game: info.game, title: info.title, tip: info.tip, credit: info.credit, art: info.art, startedAt: performance.now(), built: false, skipped: false, steps: 0, stages: [] };
    this.last = rec;
    this.count++;
    try {
      await S.show(info);
    } catch (err) {
      console.warn('[loading-screens] the screen would not go up; starting without it', err);
      S.destroy();
      return fn();
    }
    let failed = null;
    let result;
    try {
      S.setTarget(0.06, 'Preparing the flight…');
      // 2. The map, in stages, if it is not the one that is built.
      if (plan.mapId && sim.settings.map !== plan.mapId && typeof sim.borrowMapStaged === 'function') {
        rec.built = true;
        await sim.borrowMapStaged(plan.mapId, (st) => {
          rec.steps++;
          rec.stages.push(st.label);
          S.setTarget(0.06 + 0.74 * (st.at / st.of), st.label);
        });
      }
      S.setTarget(0.82, `Rolling out the ${plan.vehicle || 'aeroplane'}…`);
      // 3. The three seconds, or the skip.
      await S.ready();
      rec.skipped = S.skipRequested;
      rec.readyAt = S.elapsed;
      // 4. The flight itself. Let the line paint first: this part holds the thread.
      S.setTarget(0.95, 'Taking off…');
      await new Promise((r) => setTimeout(r, 40));
      result = await fn();
    } catch (err) {
      failed = err;
    }
    rec.doneAt = S.elapsed;
    rec.loadMs = performance.now() - rec.startedAt;
    // The fade is the screen's own business; whoever started the flight does not wait for it.
    rec.hiding = S.hide().then(() => {
      rec.goneAt = performance.now() - rec.startedAt;
    });
    if (failed) throw failed;
    return result;
  }

  /** A key or a tap, as the screen hears it. For the tests. */
  skip() {
    return this.screen.skip();
  }
}

/** Wrap the game's startMode so a start from the menus, or onto another map, goes behind the screen. */
function wrapStartMode(sim) {
  const orig = sim.startMode;
  sim.startMode = function startModeWithLoadingScreen(mode, opts = {}) {
    const L = sim.loading;
    if (!L || !L.wanted() || (opts && opts.loadingScreen === false)) return orig.call(sim, mode, opts);
    let plan = null;
    try {
      plan = L.planMode(mode, opts);
    } catch (err) {
      console.warn('[loading-screens] could not plan the start; starting without the screen', err);
    }
    if (!plan || !(sim.state === 'menu' || plan.mapId !== sim.settings.map)) return orig.call(sim, mode, opts);
    return L.around(plan, () => orig.call(sim, mode, opts));
  };
}

/** A multiplayer join, wherever the player lands: the aeroplane, the helicopter, the boat or the van. */
async function wrapJoin(sim) {
  try {
    const { multiplayer } = await import('./multiplayer.js');
    if (!multiplayer || typeof multiplayer.enterWorld !== 'function' || multiplayer._loadingWrapped) return;
    const orig = multiplayer.enterWorld;
    multiplayer._loadingWrapped = true;
    multiplayer.enterWorld = function enterWorldWithLoadingScreen(server, at, weather, ride = null) {
      const L = sim.loading;
      if (!L || !L.wanted()) return orig.call(this, server, at, weather, ride);
      let plan = null;
      try {
        plan = L.planWorld(server, ride, this);
      } catch (err) {
        console.warn('[loading-screens] could not plan the join; joining without the screen', err);
      }
      if (!plan || !(sim.state === 'menu' || plan.mapId !== sim.settings.map)) return orig.call(this, server, at, weather, ride);
      return L.around(plan, () => orig.call(this, server, at, weather, ride));
    };
  } catch (err) {
    console.warn('[loading-screens] multiplayer joins will not show the screen', err);
  }
}

registerExtension({
  id: 'loading-screens',
  install(sim) {
    sim.loading = new MapLoading(sim);
    wrapStartMode(sim);
    wrapJoin(sim);
  },
});
