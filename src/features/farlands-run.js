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
 * A discovery, twice, the first time only: a calm notice on crossing into the
 * Farlands and on reaching the edge, in the line that names the islands. Then
 * the end: past VOID_RUN_ON, or down under VOID_FLOOR_Y with no ground below
 * you, the game's calm card (no wreck, no spin: you are just gone). The furthest
 * anyone has got is kept and said.
 */
import { FARLANDS, depthOf, wanderOf, edgeAt, EDGE_D, RANGE_DEEP, VOID_FLOOR_Y, VOID_RUN_ON } from '../world/worldmap/farlands.js';
import { FarRim, VoidSky, RING_LOOK } from '../world/worldmap/farlands-look.js';
import { heightAt } from '../world/terrain.js';
import { tierFor as streamTier } from '../world/worldmap/stream.js';

export { FARLANDS, RING_LOOK };
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
    if (v && typeof v === 'object') return { seen: !!v.seen, edge: !!v.edge, furthest: Number(v.furthest) || 0 };
  } catch (e) {
    /* private window, blocked storage: start fresh */
  }
  return { seen: false, edge: false, furthest: 0 };
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
    this.wrapWeather();
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
    if (cam.y < VOID_FLOOR_Y && heightAt(cam.x, cam.z) < -99) {
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
    if (dirty) writeStore(st);
    // Off the land the run has a floor and an end.
    if ((ac.pos.y < VOID_FLOOR_Y && heightAt(x, z) < -99) || d > EDGE_D + VOID_RUN_ON) this.lost(d);
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
    this.store = readStore();
    this.settle();
  }

  roots() {
    return [this.rim.mesh, this.sky.mesh];
  }

  stats() {
    return { thin: this.thin, farK: this.sky.farK, voidK: this.sky.voidK, rimDone: this.rim.done, store: { ...this.store }, seaOn: !!(this.sim.ocean && this.sim.ocean.deep.visible), ended: this.ended };
  }

  dispose() {
    const { clouds, rain, ocean } = this.sim;
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

export function createFarlands(sim, group, quality) {
  return new Farlands(sim, group, quality);
}
