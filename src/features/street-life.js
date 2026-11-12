/**
 * Street life: the highways made into highways, and people in the towns.
 *
 * The owner, after the class demo: "and npc cars also", "cars there, people there",
 * "please add actual highways, and elevated highways etc". The cars are
 * features/ambient.js's (they now keep their lanes on a carriageway, their distance from
 * each other, and stop for an aeroplane on the ground). This is the rest:
 *
 *   HIGHWAYS  world/highway-plan.js reads the map's dual carriageways and plans, for each,
 *             a central barrier, lane lines, and a flyover — a deck on piers over a local
 *             road, with the carriageways either side as its slip roads. Drawn by
 *             ./streetlife/highway-look.js, driven by the ambient cars (ambient's `extend`:
 *             the flyover's two lanes), and solid to an aeroplane: its ramps, its deck (with
 *             the air under it left open) and its piers are crash boxes, there while you
 *             are low and near, as the towns' houses are (worldmap/town-stream.js).
 *   STREETS   on the World Map every town's main streets are lanes, not only the departure
 *             field's town: cars drive through whichever town you are over.
 *   PEOPLE    ./streetlife/walkers.js: walkers on the pavements of the town you are near.
 *
 * TIERS (settings.quality; Performance mode counts as Low):
 *   Low      the barrier and the flyovers within 3 km; no lane paint, no people — two or
 *            three more draw calls beside a highway, none anywhere else
 *   Medium   and the lane paint, and PEOPLE.medium people
 *   High, Ultra   out to 6 and 9 km, shadows, PEOPLE.high / .ultra people
 *
 * In the second bundle (features/later.js): none of it is needed to take off, and none of
 * it is in the first load. Everything is planned from the map as it stands and changes no
 * ground, so a flight that started before this joined simply gains it.
 */
import * as THREE from '../vendor/three.module.js';
import { registerExtension } from '../game/extensions.js';
import { MAP, FLATS, heightAt, groundHeightAt, isOnAnyRunway, addObstacle, OBSTACLES } from '../world/terrain.js';
import { ribbonSampler } from '../world/roads.js';
import { makeRandom } from '../core/noise.js';
import { planHighways } from '../world/highway-plan.js';
import { buildLinkDress, buildFlyoverLook, disposeLook } from './streetlife/highway-look.js';
import { planWalkers, StreetWalkers, PEOPLE, PEOPLE_CAP } from './streetlife/walkers.js';
import { Crowd } from './life/people.js';
import { onFoot } from './onfoot.js';

/** Metres: how far out a link's dress and a flyover are drawn, per tier. */
export const SEE = Object.freeze({ low: 3000, medium: 4500, high: 6000, ultra: 9000 });
/** The flyover's crash boxes are in the world while the aeroplane is this low and this near. */
const SOLID_AGL = 160;
const SOLID_NEAR = 900;
/**
 * The people are round the player, not spread over the town (a city is two kilometres across and
 * a person is four pixels at 650 m): they are planned within PEOPLE_R of the camera while it is
 * in a town and under PEOPLE_ALT over its ground, and whoever is left more than that behind is
 * given a new place ahead, never nearer than PEOPLE_IN (nobody appears beside you).
 */
const TOWN_NEAR = 150;
const PEOPLE_R = 520;
const PEOPLE_IN = 170;
const PEOPLE_ALT = 330;

const S = {
  sim: null,
  group: null,
  gen: 0,
  tier: 'high',
  plan: null, // planHighways' answer for this world
  looks: [], // the groups drawn: links' dress and flyovers
  streets: null, // the World Map's towns' streets, for the cars' lanes
  towns: [], // [{ x, z, r, streets }] where people may be
  ready: Promise.resolve(false),
  solid: [], // crash boxes now in the world
  solidOf: -1,
  seeT: 0,
  crowd: null,
  walkers: null,
  town: null,
  on: false,
  ms: new Float32Array(300),
  n: 0,
  danger: { x: 0, z: 0, r: 2 },
  rnd: Math.random,
};

function tierOf(sim) {
  const st = (sim && sim.settings) || {};
  if (st.performanceMode) return 'low';
  return SEE[st.quality] ? st.quality : 'high';
}

function clearSolid() {
  if (S.solid.length) {
    const gone = new Set(S.solid);
    let w = 0;
    for (let i = 0; i < OBSTACLES.length; i++) if (!gone.has(OBSTACLES[i])) OBSTACLES[w++] = OBSTACLES[i];
    OBSTACLES.length = w;
  }
  S.solid.length = 0;
  S.solidOf = -1;
}

function dropPeople() {
  if (S.crowd) S.crowd.dispose();
  S.crowd = null;
  S.walkers = null;
  S.town = null;
}


function teardown() {
  S.gen++;
  clearSolid();
  dropPeople();
  for (const g of S.looks) disposeLook(g);
  S.looks = [];
  S.plan = null;
  S.streets = null;
  S.towns = [];
  if (S.tarmac) S.tarmac.dispose();
  S.tarmac = null;
}

/** The road ribbon's tarmac, two-sided (a deck is seen from underneath too): its textures, shared. */
function tarmacOf(sim) {
  const m = sim.roadMesh && Array.isArray(sim.roadMesh.material) ? sim.roadMesh.material[1] : null;
  if (!m) return null;
  const c = m.clone();
  c.side = THREE.DoubleSide;
  return c;
}

/**
 * Plan and build this world's highways and find its towns. Returns a promise of whether
 * there is anything; the heavy parts give the thread back between links.
 */
async function prepare(sim, group) {
  const gen = S.gen;
  const roads = (sim.roads && sim.roads.list) || (MAP.waters && MAP.waters.roads) || [];
  const tier = (S.tier = tierOf(sim));
  let towns = [];
  let airports = [];
  if (MAP.worldPreview) {
    // Both already in memory on the World Map (features/world-preview.js has them).
    const [PV, TG] = await Promise.all([import('../world/worldmap/preview.js'), import('../world/worldmap/town-grid.js')]);
    if (gen !== S.gen) return false;
    const P = PV.PREVIEW;
    towns = P.towns || [];
    airports = P.airports || [];
    try {
      const ctx = TG.townContext(P, FLATS, (MAP.waters && MAP.waters.roads) || []);
      S.streets = [];
      for (const F of ctx.towns) {
        const streets = TG.townStreets(F).map((st) => ({ ...st, walk: TG.GRID.WALK_MAIN }));
        for (const st of streets) S.streets.push(st);
        S.towns.push({ x: F.cx, z: F.cz, r: Math.max(F.hx, F.hz), streets });
      }
    } catch (e) {
      console.warn('[street-life] the towns\' streets could not be read; the cars keep to the roads', e);
      S.streets = null;
    }
  } else {
    const t = MAP.scenery && MAP.scenery.town;
    if (t) S.towns.push({ x: t.cx, z: t.cz, r: t.radius || 600, streets: null });
  }
  if (gen !== S.gen) return false;
  const lift = (sim.roadMesh && sim.roadMesh.userData && sim.roadMesh.userData.lift) || 0.06;
  const plan = planHighways(roads, { heightAt: groundHeightAt, towns, airports, lift });
  plan.mapId = MAP.id;
  S.plan = plan;
  if (plan.links.length) {
    const shadows = tier === 'high' || tier === 'ultra';
    S.tarmac = tarmacOf(sim);
    // The tarmac's own top, read back from the ribbon (a dash laid on the height function floats or sinks by centimetres).
    const top = tier !== 'low' && sim.roadMesh ? ribbonSampler(sim.roadMesh) : null;
    const surface = top ? (x, z) => {
      const y = top(x, z);
      return (y === -Infinity ? heightAt(x, z) : y) + lift;
    } : null;
    const pause = () => new Promise((r) => setTimeout(r, 0));
    for (const link of plan.links) {
      await pause();
      if (gen !== S.gen) return false;
      const g = buildLinkDress(link, { surface, paint: tier !== 'low', every: tier === 'ultra' ? 12 : 15, shadows });
      g.visible = false;
      group.add(g);
      S.looks.push(g);
      if (link.flyover) {
        const f = buildFlyoverLook(link.flyover, { tarmac: S.tarmac, lift, shadows });
        f.userData.fly = link.flyover;
        f.visible = false;
        group.add(f);
        S.looks.push(f);
      }
    }
  }
  S.seeT = 0;
  // The cars' lanes: the flyovers' and the towns' streets (planned again now that they are known).
  if (sim.ambient && (plan.flyovers.length || (S.streets && S.streets.length))) sim.ambient.replan();
  return plan.links.length > 0 || S.towns.length > 0;
}

/** Ambient's lanes: every town's streets on the World Map, and each flyover's two lanes. */
function moreLanes(more) {
  if (!S.plan || S.plan.mapId !== MAP.id) return;
  if (S.streets) {
    for (const st of S.streets) more.streets.push(st);
    for (const t of S.towns) more.towns.push({ cx: t.x, cz: t.z, r: t.r * 1.15 });
  }
  for (const f of S.plan.flyovers) for (const l of f.lanes) more.lanes.push(l);
}

/** Show what is near enough to see, and keep the flyover's crash boxes round a low aeroplane. */
function look(sim, cam) {
  const see = SEE[S.tier] || SEE.high;
  for (const g of S.looks) {
    const u = g.userData;
    g.visible = Math.hypot(u.x - cam.x, u.z - cam.z) < see + u.r;
  }
  const ac = sim.aircraft;
  const p = sim.mode === 'drive' && sim.vehicle && sim.vehicle.pos ? sim.vehicle.pos : ac && ac.pos;
  let want = -1;
  if (p && S.plan && !(ac && sim.mode !== 'drive' && ac.agl != null && ac.agl > SOLID_AGL)) {
    let best = SOLID_NEAR;
    S.plan.flyovers.forEach((f, i) => {
      const d = Math.hypot(f.mid.x - p.x, f.mid.z - p.z);
      if (d < best) {
        best = d;
        want = i;
      }
    });
  }
  if (want !== S.solidOf) {
    clearSolid();
    if (want >= 0) for (const b of S.plan.flyovers[want].solids) S.solid.push(addObstacle({ ...b }));
    S.solidOf = want;
  }
}

/** The town the camera is in or beside, or null. */
function townNear(cam) {
  let best = null;
  let bd = Infinity;
  for (const t of S.towns) {
    const d = Math.hypot(t.x - cam.x, t.z - cam.z) - t.r;
    if (d < TOWN_NEAR && d < bd) {
      bd = d;
      best = t;
    }
  }
  return best;
}

/** How many people this town gets at this tier. */
export function peopleFor(tier, r) {
  return Math.min(PEOPLE_CAP, Math.round((PEOPLE[tier] || 0) * Math.max(0.5, Math.min(1.7, (r || 600) / 600))));
}

function streetsOf(sim, town) {
  if (town.streets) return town.streets;
  const net = sim.ambient && sim.ambient.net ? sim.ambient.net() : null;
  if (!net) return [];
  return net.polylines.filter((p) => p.kind === 'street' && !p.structure).map((p) => ({ pts: p.pts, hw: p.hw || 5, walk: 2.2 }));
}

/** The streets of `town` that pass within reach of (x, z). */
function streetsNear(sim, town, x, z) {
  const reach = PEOPLE_R + 60;
  return streetsOf(sim, town).filter((st) => st.pts.some((p) => Math.abs(p[0] - x) < reach && Math.abs(p[1] - z) < reach));
}

/** Plan `count` people round the camera, in `town`. `fresh`: nobody is here yet, so they may be close. */
function planPeople(sim, town, cam, count, fresh) {
  const rnd = S.rnd;
  return planWalkers(streetsNear(sim, town, cam.x, cam.z), {
    count, centre: { x: cam.x, z: cam.z, r: PEOPLE_R }, rnd, ground: heightAt,
    // Dry, off every runway and its margin, and not on a made road (a high street's own tarmac runs through a town).
    blocked: (x, z) => heightAt(x, z) < 0.6 || isOnAnyRunway(x, z, 30) || (typeof sim.onRoad === 'function' && sim.onRoad(x, z, 0.5)),
    keep: (x, z) => {
      const d = Math.hypot(x - cam.x, z - cam.z);
      return d < PEOPLE_R && (fresh || d > PEOPLE_IN);
    },
  });
}

/** Twice a second: the people of the town the camera is low over, kept round the camera. */
function peopleTick(sim, cam) {
  const town = townNear(cam);
  const n = town ? peopleFor(S.tier, town.r) : 0;
  if (!town || !n || cam.y - heightAt(cam.x, cam.z) > PEOPLE_ALT) {
    if (S.crowd) dropPeople();
    return;
  }
  if (!S.crowd || S.town !== town) {
    dropPeople();
    S.town = town;
    S.rnd = makeRandom(Math.round(town.x * 7 + town.z * 13) >>> 0 || 5);
    S.walkers = new StreetWalkers(planPeople(sim, town, cam, n, true), S.rnd, n);
    S.crowd = new Crowd(n, { shadows: S.tier === 'high' || S.tier === 'ultra', rnd: S.rnd });
    S.crowd.group.name = 'street-life:people';
    if (S.group) S.group.add(S.crowd.group);
  } else {
    // Whoever has been left behind (or was never placed): a new place within reach.
    const far = [];
    const P = S.walkers.people;
    for (let i = 0; i < P.length; i++) if (!P[i].w || Math.hypot(P[i].x - cam.x, P[i].z - cam.z) > PEOPLE_R + 70) far.push(i);
    if (far.length >= Math.max(4, P.length >> 3)) {
      const plan = planPeople(sim, town, cam, far.length, false);
      for (let k = 0; k < plan.length; k++) S.walkers.put(far[k], plan[k]);
    }
  }
  S.crowd.setBounds(cam.x, heightAt(cam.x, cam.z), cam.z, PEOPLE_R + 400);
}

function dangerOf(sim) {
  const D = S.danger;
  if (sim.mode === 'drive' && sim.vehicle && sim.vehicle.pos && !sim.vehicle.isBoat) {
    D.x = sim.vehicle.pos.x;
    D.z = sim.vehicle.pos.z;
    D.r = 2;
    return D;
  }
  const ac = sim.aircraft;
  if (!ac || !ac.pos || onFoot.active || !(ac.onGround || (ac.agl != null && ac.agl < 4))) return null;
  D.x = ac.pos.x;
  D.z = ac.pos.z;
  const type = sim.aircraftType;
  D.r = Math.max(4, Math.min(34, ((type && ((type.aero && type.aero.wingSpan) || (type.plan && type.plan.span))) || 11) / 2));
  return D;
}

const ORIGIN = new THREE.Vector3();

registerExtension({
  id: 'street-life',

  install(sim) {
    S.sim = sim;
    sim.streetLife = API;
    if (sim.ambient && sim.ambient.extend) {
      sim.ambient.setWalker(() => (onFoot.active && onFoot.walker ? onFoot.walker : null));
      sim.ambient.extend(moreLanes);
    }
  },

  buildWorld(sim, group) {
    teardown();
    S.group = group;
    S.ready = prepare(sim, group).catch((e) => {
      console.warn('[street-life] the highways could not be built', e);
      return false;
    });
  },

  startMode(sim, mode) {
    S.on = mode !== 'tutorial';
    S.seeT = 0;
    dropPeople();
  },

  stop(sim, why) {
    if (why === 'airport') return;
    S.on = false;
    dropPeople();
  },

  update(sim, dt) {
    if (!(dt > 0)) return;
    const t0 = performance.now();
    const cam = sim.camera ? sim.camera.position : ORIGIN;
    S.seeT -= dt;
    if (S.seeT <= 0) {
      S.seeT = 0.5;
      if (S.plan) look(sim, cam);
      if (S.on) peopleTick(sim, cam);
    }
    if (S.on && S.walkers && S.crowd) {
      const night = !!(sim.weather && sim.weather.isNight);
      S.walkers.step(dt, dangerOf(sim), night ? 0.35 : 1);
      S.crowd.draw(S.walkers.people, cam);
    }
    S.ms[S.n++ % S.ms.length] = performance.now() - t0;
  },

  devActions: [
    {
      label: 'Street life: go to the nearest flyover',
      hint: 'Puts the aeroplane 300 m up beside the nearest highway flyover',
      run(sim) {
        const p = sim.aircraft && sim.aircraft.pos;
        if (!p || !S.plan || !S.plan.flyovers.length) return;
        const f = S.plan.flyovers.slice().sort((a, b) => Math.hypot(a.mid.x - p.x, a.mid.z - p.z) - Math.hypot(b.mid.x - p.x, b.mid.z - p.z))[0];
        p.set(f.mid.x + 400, f.mid.y + 300, f.mid.z + 400);
      },
    },
  ],
});

const API = {
  /** Resolves when this world's highways are planned and built. */
  get ready() {
    return S.ready;
  },
  plan: () => S.plan,
  flyovers: () => (S.plan ? S.plan.flyovers : []),
  links: () => (S.plan ? S.plan.links : []),
  looks: () => S.looks,
  towns: () => S.towns,
  people: () => (S.walkers ? S.walkers.people.filter((p) => p.w) : []),
  state() {
    const ms = Array.from(S.ms.subarray(0, Math.min(S.n, S.ms.length))).sort((a, b) => a - b);
    return {
      tier: S.tier,
      links: S.plan ? S.plan.links.length : 0,
      flyovers: S.plan ? S.plan.flyovers.length : 0,
      shown: S.looks.filter((g) => g.visible).length,
      solids: S.solid.length,
      town: S.town ? { x: S.town.x, z: S.town.z, r: S.town.r } : null,
      people: S.walkers ? S.walkers.count : 0,
      drawn: S.crowd ? S.crowd.drawn : 0,
      shied: S.walkers ? S.walkers.shied : 0,
      msMedian: ms.length ? ms[ms.length >> 1] : 0,
      msMax: ms.length ? ms[ms.length - 1] : 0,
    };
  },
};
