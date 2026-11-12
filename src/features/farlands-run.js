/**
 * World Map: flying out past the sea (the ground is world/worldmap/farlands.js,
 * its look farlands-look.js). Fetched when the World Map is first chosen
 * (features/world-preview.js), so no other map loads any of this.
 *
 * The sky, the sea and the clouds are the game's own and do not know the
 * world ends, so they are told here, from outside, and nothing in the first
 * load changes:
 *   - the sea plane is switched off once it could only be under the land, and
 *     stays off, so there is none under the void;
 *   - the clouds and the rain are handed the weather with less and less in
 *     it as you near the edge (they fade by their own rules, and none past it);
 *   - the dome and the fog are worldmap/farlands-look.js VoidSky.
 *
 * A discovery, three times, the first time only: a calm notice on crossing
 * into the Farlands, on reaching the edge, and on finding Nullspire, in the
 * line that names the islands. The void itself never ends (owner, 2026-11-08:
 * "let the void go on forever"): you fly on for as long as the fuel lasts.
 * The one end is the floor: down under VOID_FLOOR_Y with no ground below you,
 * the game's calm card (no wreck, no spin: you are just gone). The furthest
 * anyone has got is kept and said.
 *
 * LANTERNREACH (worldmap/void-city.js, drawn by void-city-look.js): built
 * when the eye comes within BUILD_WITHIN of it, let go past DROP_BEYOND. It
 * is on no chart: the live map and the pin's map stop at CHART_HALF, and the
 * minimap's close-in window is told to look away (FARLANDS.hush) for as long
 * as it samples, by wrapping the minimap's chartFor from here, so nothing in
 * the first load changes.
 */
import { FARLANDS, depthOf, wanderOf, edgeAt, RANGE_DEEP, EDGE_D, VOID_FLOOR_Y } from '../world/worldmap/farlands.js';
import { CITY, CITY_FIELD, BUILD_WITHIN, DROP_BEYOND, FOUND_WITHIN, cityDist, cityRunway, approachStart, SLAB_Y } from '../world/worldmap/void-city.js';
import { CityLook } from '../world/worldmap/void-city-look.js';
import { javelinAt } from '../world/worldmap/void-city.js';
import { heightAt as groundAt, isOnAnyRunway } from '../world/terrain.js';
import { extKeyContext } from '../game/extensions.js';
import * as Prog from '../game/progression.js';
import { FarRim, VoidSky, RING_LOOK } from '../world/worldmap/farlands-look.js';
import { tierFor as streamTier } from '../world/worldmap/stream.js';

export { FARLANDS, RING_LOOK, CITY, CITY_FIELD, cityRunway, approachStart, SLAB_Y };
export { clampFar, farStart, zoneOf } from '../world/worldmap/pin-far.js';

const STORE_KEY = 'islandsim.farlands.v1';
/** The sea plane is 56 km square and follows the eye (world/water.js): from here all of it is under the land. */
const SEA_OFF_D = 45000;
/** D where the weather starts to thin, and where it has gone. */
const CLOUDS_FROM = EDGE_D - 26000;
const CLOUDS_GONE = EDGE_D - 2000;
const THIN = ['cloud', 'deck', 'cu', 'tcu', 'cb', 'scud', 'stratus', 'cirrus', 'rain', 'snow', 'hfA'];

function readStore() {
  try {
    const v = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    if (v && typeof v === 'object') return { seen: !!v.seen, edge: !!v.edge, city: !!v.city, javelin: !!v.javelin, furthest: Number(v.furthest) || 0 };
  } catch (e) {
    /* private window, blocked storage: start fresh */
  }
  return { seen: false, edge: false, city: false, javelin: false, furthest: 0 };
}

function writeStore(v) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(v));
  } catch (e) {
    /* nothing to do: a first-time notice may come twice */
  }
}

const km = (m) => Math.round(m / 1000);

class Farlands {
  constructor(sim, group, quality) {
    this.sim = sim;
    const range = streamTier(quality).range;
    this.rim = new FarRim({ hideWithin: range, detail: quality === 'low' ? 0.6 : 1 });
    group.add(this.rim.mesh);
    // Haze thick enough that the streamed range is lost in it, at every tier.
    this.sky = new VoidSky({
      scene: sim.scene,
      haze: 1.4 / range,
      day: () => {
        const p = sim.weather && sim.weather.palette && sim.weather.palette();
        return p && Number.isFinite(p.daylight) ? p.daylight : 1;
      },
    });
    group.add(this.sky.mesh);
    this.store = readStore();
    this.thin = 0;
    this.view = null;
    this.ended = false;
    this.group = group;
    this.quality = quality;
    /** Nullspire, while the eye is near it (void-city-look.js CityLook), else null. */
    this.city = null;
    this.cityBuilt = 0;
    this.found = false;
    this.wrapWeather();
    this.wrapMinimap();
  }

  /** The minimap looks away from the city while it samples its close-in window: the charts never show it. */
  wrapMinimap() {
    const mm = this.sim.minimap;
    if (!mm || mm._farOwn || typeof mm.chartFor !== 'function') return;
    mm._farOwn = mm.chartFor;
    mm.chartFor = function chartFor(mode, craft) {
      FARLANDS.hush(true);
      try {
        return this._farOwn.call(this, mode, craft);
      } finally {
        FARLANDS.hush(false);
      }
    };
  }

  /** The city comes and goes with the eye: built within BUILD_WITHIN (a few milliseconds, once), dropped past DROP_BEYOND. */
  settleCity(cam) {
    const d = cityDist(cam.x, cam.z);
    if (!this.city && d < BUILD_WITHIN) {
      try {
        this.city = new CityLook(this.quality, { obstacles: this.cityBuilt === 0 });
        this.cityBuilt++;
        this.group.add(this.city.root);
        if (typeof this.sim.warmShaders === 'function') this.sim.warmShaders(this.city.root, { chunked: true });
      } catch (e) {
        console.warn('[farlands] Nullspire could not be built', e);
        this.city = null;
        this.cityBuilt = -1e9;
      }
    } else if (this.city && d > DROP_BEYOND) {
      this.city.dispose();
      this.city = null;
    } else if (this.city && !this.city.field) {
      // The frame after the city: its field.
      this.city.addField();
      if (typeof this.sim.warmShaders === 'function') this.sim.warmShaders(this.city.field, { chunked: true });
    }
    if (this.city) this.city.update(cam);
  }

  /** The weather as the clouds and the rain should see it: this far out, less of it. */
  thinned(weather) {
    const k = this.thin;
    if (k <= 0 || !weather) return weather;
    let v = this.view;
    if (!v || Object.getPrototypeOf(v) !== weather) {
      v = this.view = Object.create(weather);
      // Its own: `cond` on the weather is a getter, and what it returns is the shared table of skies.
      Object.defineProperty(v, 'cond', { value: {}, writable: true });
    }
    Object.assign(v.cond, weather.cond);
    for (const f of THIN) if (typeof v.cond[f] === 'number') v.cond[f] *= 1 - k;
    return v;
  }

  wrapWeather() {
    const { clouds, rain } = this.sim;
    const self = this;
    if (clouds && !clouds._farOwn) {
      clouds._farOwn = { update: clouds.update, cloudImmersion: clouds.cloudImmersion };
      clouds.update = function update(dt, w, cam) {
        this._farOwn.update.call(this, dt, self.thinned(w), cam);
        // The high veil has a floor of its own that no weather takes away.
        if (self.thin > 0) {
          for (const ci of this.cirrus || []) {
            ci.material.opacity *= 1 - self.thin;
            if (self.thin >= 1) ci.visible = false;
          }
        }
      };
      clouds.cloudImmersion = function cloudImmersion(y, w) {
        return this._farOwn.cloudImmersion.call(this, y, self.thinned(w));
      };
    }
    if (rain && !rain._farOwn) {
      rain._farOwn = rain.update;
      rain.update = function update(dt, w, cam, vel) {
        return this._farOwn.call(this, dt, self.thinned(w), cam, vel);
      };
    }
  }

  /** No sim rate past the mountains: a wall comes up faster than the rule that drops it. */
  noWarp(ac) {
    return !!ac && depthOf(ac.pos.x, ac.pos.z) > RANGE_DEEP - 6000;
  }

  update() {
    this.settle();
    if (this.sim.state === 'flying' && this.sim.camera) this.watch(this.sim.camera.position);
  }

  /** The sky, the sea and the weather, for where the eye is. */
  settle() {
    const sim = this.sim;
    const cam = sim.camera && sim.camera.position;
    if (!cam) return;
    this.rim.update(cam, sim.state === 'flying' ? 1.2 : 4, this.sky.day());
    this.sky.update(cam);
    this.settleCity(cam);
    const d = wanderOf(cam.x, cam.z);
    const sea = sim.ocean && sim.ocean.deep;
    if (sea) {
      const on = d < SEA_OFF_D;
      if (sea.visible !== on) sea.visible = on;
    }
    const t = Math.min(1, Math.max(0, (d - CLOUDS_FROM) / (CLOUDS_GONE - CLOUDS_FROM)));
    this.thin = t * t * (3 - 2 * t);
  }

  /** A notice in the line the islands' names use, waiting its turn; `true` once it has been up. */
  notice(name, title, sub) {
    const sim = this.sim;
    const b = sim.location && sim.location.banner;
    if (!b) {
      sim.hud && sim.hud.showBanner(name, sub, 'good', 6);
      return true;
    }
    if (b.shown.some((e) => e.name === name)) return true;
    b.push({ kind: 'far', title, name, sub, id: `far:${name}`, prio: 4 });
    return false;
  }

  /** The two notices, the furthest yet, and the end of the run. */
  watch(cam) {
    const sim = this.sim;
    const ac = sim.aircraft;
    if (!ac || this.ended) return;
    const x = ac.pos.x;
    const z = ac.pos.z;
    const d = wanderOf(x, z);
    if (d < RANGE_DEEP) return;
    // The eye too: a pilot hanging under a parachute is not in the aeroplane, which may be long gone.
    if (cam.y < VOID_FLOOR_Y && groundAt(cam.x, cam.z) < -99) {
      this.lost(d);
      return;
    }
    if (ac.crashed) return;
    const st = this.store;
    let dirty = false;
    if (d > st.furthest + 1000) {
      st.furthest = d;
      dirty = true;
    }
    if (!st.seen && this.notice('The Farlands', 'YOU HAVE COME TO', 'Past the mountains the ground forgets what it was')) {
      st.seen = true;
      dirty = true;
    }
    if (!st.edge && d >= edgeAt(x, z) - 1500 && this.notice('The Edge of the World', 'THIS IS', `${km(d)} km past the coast. Nothing goes on from here`)) {
      st.edge = true;
      dirty = true;
    }
    // Nullspire, found: the notice, once ever; and `found` for this flight (the secrets read it).
    if (cityDist(x, z) < FOUND_WITHIN) {
      if (!this.found) this.found = true;
      if (!st.city && this.notice(CITY.name, 'YOU HAVE FOUND', `A city of spires, ${km(CITY.pastEdge)} km out in the void, with its lights on`)) {
        st.city = true;
        dirty = true;
        earnSpireline(sim);
      }
    }
    if (dirty) writeStore(st);
    if (this.found && !st.javelin) this.watchJavelin(ac, cam);
    // Off the land the run has a floor, and no other end: the void goes on for ever.
    if (ac.pos.y < VOID_FLOOR_Y && groundAt(x, z) < -99) this.lost(d);
  }

  /**
   * The secret aeroplane (aircraft/extra/javelin.js): a full stop on the
   * city's runway, or walking up to it on the ramp, puts it in the Hangar for
   * good. Said once; the roster gets it the moment it is earned.
   */
  watchJavelin(ac, cam) {
    const j = javelinAt();
    const onFoot = extKeyContext(this.sim) === 'foot';
    const near = onFoot && cam && Math.hypot(cam.x - j.x, cam.z - j.z) < 40;
    const landed = ac.onGround && !ac.crashed && ac.readouts().groundKts < 5 && isOnAnyRunway(ac.pos.x, ac.pos.z, 20) && Math.hypot(ac.pos.x - j.x, ac.pos.z - j.z) < 6000;
    if (!near && !landed) return;
    this.store.javelin = true;
    writeStore(this.store);
    earnJavelin(this.sim, near ? 'on the ramp' : 'a landing at Nullspire');
  }

  /** Gone. Not a crash: nothing hit anything. */
  lost(d) {
    const sim = this.sim;
    this.ended = true;
    sim.clearCheckpoint && sim.clearCheckpoint();
    // A flight with its own ending (a mission) gets that ending: this is one more way to lose the aeroplane.
    if (sim.mode !== 'free' || !sim.menus || typeof sim.menus.showDebrief !== 'function') {
      sim.aircraft.crash('Lost in the void');
      return;
    }
    sim.state = 'debrief';
    sim.hud.setVisible(false);
    sim.menus.showDebrief({
      title: 'Lost in the void',
      kind: 'bad',
      body: `<p class="debrief-reason">The world ended a while back. There was nothing left to fly over, and nothing to fall on to.</p>`
        + `<p>You got ${km(Math.max(d, this.store.furthest))} km past the coast. Nobody has been further. No harm done: this is a simulator.</p>`,
      actions: [
        { label: 'Try again', onClick: () => sim.restart(), primary: true },
        { label: 'Main menu', onClick: () => sim.quitToMenu('main') },
      ],
    });
  }

  /** A new flight: the card can come again, and everything out here is worked out from the eye afresh. */
  start() {
    this.ended = false;
    this.found = false;
    this.store = readStore();
    this.settle();
  }

  /** The city as the dev workbench and the tests want it. */
  cityState() {
    return { built: !!this.city, counts: this.city ? this.city.counts : null, buildMs: this.city ? this.city.buildMs : 0, fieldMs: this.city ? this.city.fieldMs : 0, field: !!(this.city && this.city.field), found: this.found, seen: this.store.city, deepK: this.sky.deepK };
  }

  roots() {
    return [this.rim.mesh, this.sky.mesh];
  }

  stats() {
    return { thin: this.thin, farK: this.sky.farK, voidK: this.sky.voidK, deepK: this.sky.deepK, rimDone: this.rim.done, store: { ...this.store }, seaOn: !!(this.sim.ocean && this.sim.ocean.deep.visible), ended: this.ended, city: this.cityState() };
  }

  dispose() {
    const { clouds, rain, ocean, minimap } = this.sim;
    if (this.city) {
      this.city.dispose();
      this.city = null;
    }
    if (minimap && minimap._farOwn) {
      delete minimap.chartFor;
      delete minimap._farOwn;
    }
    if (clouds && clouds._farOwn) {
      delete clouds.update;
      delete clouds.cloudImmersion;
      delete clouds._farOwn;
    }
    if (rain && rain._farOwn) {
      delete rain.update;
      delete rain._farOwn;
    }
    if (ocean && ocean.deep) ocean.deep.visible = true;
    this.rim.dispose();
    this.sky.dispose();
  }
}

/** Spireline (aircraft/extra/spireline.js) into the picker, for good: the city's memory is the unlock. Said once. */
export async function earnSpireline(sim) {
  const m = await import('../aircraft/extra/spireline.js');
  const first = !m.spirelineRegistered();
  const l = m.registerSpireline();
  try {
    // Settings' paint list was written before the airline existed: one more option.
    const sel = sim && sim.menus && sim.menus.screens && document.querySelector('select[data-set="livery"]');
    if (sel && ![...sel.options].some((o) => o.value === l.id)) {
      const o = document.createElement('option');
      o.value = l.id;
      o.textContent = `${l.name} — ${l.blurb}`;
      sel.appendChild(o);
    }
  } catch (e) {
    /* the picker in the Hangar reads the live list anyway */
  }
  if (first && sim && sim.hud) sim.hud.showBanner(`Secret airline: ${l.name}`, 'In the paint picker now · Nullspire\'s own', 'good', 7);
  return first;
}

/** The Javelin into progression and the roster, the card and the Hangar repainted. Safe to call again. */
export async function earnJavelin(sim, how = 'Nullspire') {
  const m = await import('../aircraft/extra/javelin.js');
  const type = m.registerJavelin();
  if (!type) return false;
  const p = (sim && sim.prog) || Prog.load();
  const first = !p.unlocked.includes(m.JAVELIN_ID);
  if (first) {
    p.unlocked.push(m.JAVELIN_ID);
    Prog.save(p);
  }
  const menus = sim && sim.menus;
  try {
    if (menus && menus.syncProgression) menus.syncProgression(p);
  } catch (e) {
    /* the Hangar repaints itself when it is next opened */
  }
  m.addJavelinCard(menus, type);
  if (first && sim && sim.hud) sim.hud.showBanner(`Secret found: ${type.name}`, `In your Hangar now · ${how}`, 'good', 7);
  return first;
}

export function createFarlands(sim, group, quality) {
  return new Farlands(sim, group, quality);
}
