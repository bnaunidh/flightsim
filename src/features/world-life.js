/**
 * World life: people on the airfield and service vehicles on their rounds.
 *
 * The owner wanted the airport to feel worked: "more ambient life in free
 * flight and missions". What lives here, and where, is planned by
 * ./life/plan.js from the airport layout and what the apron parked; this
 * module runs it — walks the people (./life/people.js draws all of them in
 * six instanced meshes), drives the vehicles (./life/vans.js) — every frame
 * of a free flight or a mission.
 *
 *   free flight   everything the tier allows, thinned at night
 *   a mission     its own share: `def.ambient === false` none, 'thin' half,
 *                 { ground: k } k of it, anything else 0.6 — a story scene
 *                 keeps a quieter apron
 *   driving, the tutorial, the ramp-crew shift: none (staff.js has its own
 *                 people, and nobody walks into the tutorial's taxi lesson)
 *
 * NEVER IN THE WAY. Nobody is planned onto a runway or a taxiway. Here, a
 * walker stops where it is while an aeroplane — yours or the traffic — is
 * within its wingspan and a margin, and the vehicles stop for aeroplanes,
 * for people and for each other (vans.js). Nothing is solid: a stopped
 * walker is never a reason your aeroplane cannot move.
 *
 * COST. Measured by ambientState-style stats (`sim.worldLife.state()`): the
 * update's running median, the people drawn. No allocation per frame.
 */

import * as THREE from '../vendor/three.module.js';
import { registerExtension } from '../game/extensions.js';
import { AIRPORT, heightAt } from '../world/terrain.js';
import { typeSize } from '../world/airport-layout.js';
import { terrainMeshSampler } from '../world/roads.js';
import { makeRandom } from '../core/noise.js';
import { planLife, PEOPLE_CAP } from './life/plan.js';
import { Crowd } from './life/people.js';
import { VanFleet, Route } from './life/vans.js';
import { makeWalkers, ApronLife } from './life/crowd.js';

const TIERS = ['low', 'medium', 'high', 'ultra'];

/*
 * The ground as the terrain mesh DRAWS it (world/roads.js terrainMeshSampler:
 * the chunk triangles, not the height function, which runs under them by up
 * to half a metre where the ground curves), or the height function, or the
 * field, whichever is highest: what a foot or a paving slab stands on.
 */
let drawnAt = null;
function groundY(x, z) {
  const m = drawnAt ? drawnAt(x, z) : -Infinity;
  return Math.max(AIRPORT.elev, heightAt(x, z), Number.isFinite(m) ? m : -Infinity);
}

const L = {
  sim: null,
  group: null,
  on: false,
  mode: null,
  level: 0,
  plan: null,
  walkers: [],
  crowd: null,
  vans: null,
  life: null,
  aircraft: [],
  time: null,
  stats: { ms: new Float32Array(600), n: 0, msMax: 0, frames: 0, msSum: 0, waits: 0 },
  key: '',
  paused: false,
  thinned: false,
};

function tierOf(sim) {
  const q = sim && sim.settings && sim.settings.quality;
  return TIERS.includes(q) ? q : 'high';
}

/** This flight's share of the life (1 free flight; a mission its own; 0 none). */
function levelFor(sim, mode) {
  if (mode === 'free') return 1;
  if (mode !== 'mission') return 0;
  const def = sim.runner && sim.runner.def;
  const want = def && def.ambient;
  if (want === false) return 0;
  if (want === 'thin') return 0.5;
  if (want === 'full' || want === true) return 1;
  if (want && typeof want === 'object' && Number.isFinite(want.ground)) return Math.max(0, Math.min(1, want.ground));
  return 0.6;
}

function clear() {
  if (L.crowd) L.crowd.dispose();
  if (L.vans) L.vans.dispose();
  if (L.life && L.life.apron) L.life.apron.peopleNear = null;
  L.life = null;
  L.crowd = null;
  L.vans = null;
  L.walkers = [];
  L.plan = null;
}

/** Plan and build the life for this world, this flight. */
function populate(sim) {
  clear();
  const ap = sim.apron;
  if (!L.group || !ap || !ap.lay || !L.level) return;
  const w = sim.weather || {};
  L.time = w.time || 'day';
  const seed = (ap.lay.key ? String(ap.lay.key).length : 7) * 131 + TIERS.indexOf(tierOf(sim)) * 17;
  const rnd = makeRandom(seed);
  L.plan = planLife({
    lay: ap.lay,
    parked: ap.parked || [],
    crews: (ap.crews || []).filter((c) => c && c.tg && !(c.opts && c.opts.spare)),
    bridges: ap.bridges || [],
    entrances: ap.entrances || null,
    ground: (x, z) => groundY(x, z) - AIRPORT.elev,
    tier: tierOf(sim),
    time: L.time,
    condition: w.effectiveCondition || w.condition || 'clear',
    rnd,
    level: L.level,
  });
  const elev = AIRPORT.elev;
  const shadows = tierOf(sim) === 'high' || tierOf(sim) === 'ultra';
  // The walkers, as the runtime moves them (life/crowd.js: they keep out of each other's and the vehicles' way).
  L.walkers = makeWalkers(L.plan.walkers, elev, rnd, Route);
  if (L.walkers.length) {
    // Low: the two-mesh figure (life/people.js simpleGeometries) — the budget's share.
    L.crowd = new Crowd(L.walkers.length, { shadows, rnd, simple: tierOf(sim) === 'low' });
    const b = L.plan.bounds;
    if (b) L.crowd.setBounds(b.x, elev + 1, b.z, b.r);
    L.group.add(L.crowd.group);
  }
  if (L.plan.vans.length) {
    L.vans = new VanFleet(L.plan.vans, elev, { shadows });
    L.group.add(L.vans.group);
  }
  // People and vehicles stepped together: the vans, the apron crews' baggage
  // trains, the spare crew driving in and the follow-me van all stop for
  // people, and people wait for them (wave 18).
  L.life = new ApronLife({ walkers: L.walkers, vans: L.vans, apron: ap, obs: L.plan.obs, elev });
  L.life.onWait = () => L.stats.waits++;
  L.stats.n = 0;
  L.stats.frames = 0;
  L.stats.msSum = 0;
  L.stats.msMax = 0;
  L.stats.waits = 0;
}

/** Every aeroplane about, with the room it wants kept clear: yours and the traffic's. */
function aircraftAbout(sim) {
  const out = L.aircraft;
  out.length = 0;
  const ac = sim.aircraft;
  if (ac && ac.pos && sim.state === 'flying' && (sim.mode === 'free' || sim.mode === 'mission')) {
    const fg = sim.model && sim.model.userData && sim.model.userData.flightGeometry;
    const span = fg && Number.isFinite(fg.wingSpan) ? fg.wingSpan : 12;
    // Only near the ground: a low pass is not a reason to stand still.
    const agl = ac.pos.y - AIRPORT.elev;
    if (agl < 25) out.push({ x: ac.pos.x, z: ac.pos.z, r: span / 2 + 7 });
  }
  const tr = sim.traffic;
  if (Array.isArray(tr)) {
    for (const c of tr) {
      if (!c || !c.pos || !c.onGround) continue;
      const sz = typeSize(c.typeId);
      out.push({ x: c.pos.x, z: c.pos.z, r: (sz ? sz.span / 2 : 15) + 7 });
    }
  }
  return out;
}

/**
 * An emergency scene's ground (features/emergency-scene.js thins the ambient
 * layer within three times its radius, features/ambient.js thinAround): the
 * airfield's people inside it are gone — nobody boards the next aeroplane
 * along while the police cordon a hijacked one at its stand — and the service
 * vehicles, which do not know the scene's cars, are off the apron while any
 * of them is inside it. Back as they were when the scene clears.
 */
const CLEARED = { vans: false };
function keepClear(sim) {
  const zones = sim.ambient && typeof sim.ambient.thinZones === 'function' ? sim.ambient.thinZones() : null;
  const any = !!(zones && zones.length);
  if (!any && !L.thinned) {
    CLEARED.vans = false;
    return CLEARED;
  }
  const inside = (x, z) => {
    for (const t of zones) {
      const dx = x - t.x;
      const dz = z - t.z;
      if (dx * dx + dz * dz < t.r * t.r) return true;
    }
    return false;
  };
  let thinned = false;
  for (const w of L.walkers) {
    if (any && inside(w.x, w.z)) {
      w.hidden = true;
      w.cleared = true;
      thinned = true;
    } else if (w.cleared) {
      w.cleared = false;
      // A cycling walker's own step says whether it is in sight; everyone else is.
      if (w.mode !== 'cycle') w.hidden = false;
    }
  }
  let vans = false;
  if (any && L.vans) for (const v of L.vans.list) if (inside(v.pos.x, v.pos.z)) vans = true;
  L.thinned = thinned || vans;
  CLEARED.vans = vans;
  return CLEARED;
}

/**
 * The terminal's forecourt: paving from the landside wall out past the kerb
 * canopy's columns, the length of the canopy and a little more, laid on the
 * ground (it rises behind some terminals, up to 2 m: Fjord, the Cape) as a
 * 2 m grid a few centimetres proud of it — light concrete slabs, a granite
 * kerb line, and the first metres of the drop-off lane in asphalt. The
 * people of the kerb (plan.js) stand and walk on it. Only at a terminal
 * proper: a flying club's door opens onto the grass, an air base's
 * operations block onto its own yard.
 */
function forecourt(ap) {
  const lay = ap && ap.lay;
  const T = lay && lay.terminal;
  if (!T || !T.rect || lay.military || lay.shape === 'strip') return null;
  const F = lay.frame;
  const r = T.rect;
  const cx = (r.x0 + r.x1) / 2;
  const half = (r.x1 - r.x0) * 0.35 + 6;
  const elev = AIRPORT.elev;
  const D = 10.5;
  const nx = Math.max(2, Math.ceil((half * 2) / 2));
  const nw = Math.ceil(D / 0.5 / 2) * 2;
  const pos = [];
  const col = [];
  const idx = [];
  const c = new THREE.Color();
  const CONC = new THREE.Color(0xbfc2c4);
  const CONC2 = new THREE.Color(0xb3b7ba);
  const KERB = new THREE.Color(0xdcdedf);
  const ROAD = new THREE.Color(0x3c4147);
  for (let j = 0; j <= nw; j++) {
    const w = T.back + 0.2 + (D * j) / nw;
    const ww = w - T.back;
    for (let i = 0; i <= nx; i++) {
      const x = cx - half + (half * 2 * i) / nx;
      const z = F.z(w);
      const y = groundY(x, z) + 0.07;
      pos.push(x, y, z);
      if (ww > 8.6) c.copy(ROAD);
      else if (ww > 8.0) c.copy(KERB);
      else c.copy((Math.floor(x / 2) + Math.floor(ww / 2)) % 2 ? CONC : CONC2);
      col.push(c.r, c.g, c.b);
    }
  }
  const row = nx + 1;
  for (let j = 0; j < nw; j++) {
    for (let i = 0; i < nx; i++) {
      const a = j * row + i;
      // Wound so the face points up whichever side of the runway the terminal is.
      if (F.side < 0) idx.push(a, a + 1, a + row, a + 1, a + row + 1, a + row);
      else idx.push(a, a + row, a + 1, a + 1, a + row, a + row + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  m.name = 'world-life:forecourt';
  m.receiveShadow = true;
  m.castShadow = false;
  return m;
}

/* ------------------------------------------------------------------ */
/* The extension                                                       */
/* ------------------------------------------------------------------ */

const PV = new THREE.Vector3();

registerExtension({
  id: 'world-life',

  install(sim) {
    L.sim = sim;
    sim.worldLife = API;
  },

  /* Every world (re)build: the apron is new, so the plan is too, if a flight is on. */
  buildWorld(sim, group) {
    L.group = group;
    group.name = 'ext:world-life';
    L.crowd = null;
    L.vans = null;
    L.life = null;
    L.walkers = [];
    // The terminal's landside forecourt: paved, under the kerb canopy.
    try {
      drawnAt = terrainMeshSampler(sim.terrain);
    } catch (e) {
      drawnAt = null;
    }
    try {
      const f = forecourt(sim.apron);
      if (f) group.add(f);
    } catch (e) {
      /* the grass stays grass */
    }
    if (L.on && L.level) populate(sim);
  },

  startMode(sim, mode) {
    L.mode = mode;
    L.level = levelFor(sim, mode);
    L.on = L.level > 0;
    if (L.on) populate(sim);
    else clear();
  },

  /* "Return to the airfield" carries on with the same people; the menu ends them. */
  stop(sim, why) {
    if (why === 'airport') return;
    L.on = false;
    clear();
  },

  update(sim, dt) {
    if (!L.on || L.paused || !(dt > 0) || (!L.crowd && !L.vans)) return;
    const t0 = performance.now();
    dt = Math.min(dt, 0.1);
    const w = sim.weather;
    // The time of day changed under us (a story's cut to night): plan again.
    if (w && w.time && w.time !== L.time) populate(sim);
    const aircraft = aircraftAbout(sim);
    const cam = sim.camera ? sim.camera.position : PV;
    if (L.life) L.life.step(dt, aircraft, cam, !!(w && w.isNight));
    const cleared = keepClear(sim);
    if (L.crowd) L.crowd.draw(L.walkers, cam);
    if (L.vans) L.vans.setVisible(!cleared.vans);
    const ms = performance.now() - t0;
    const S = L.stats;
    S.frames++;
    S.msSum += ms;
    if (ms > S.msMax) S.msMax = ms;
    S.ms[S.n % 600] = ms;
    S.n++;
  },

  devActions: [
    {
      label: 'World life: plan again here',
      hint: 'Re-plans the airfield\'s people and service vehicles for this tier and time of day',
      run(sim) {
        if (!L.on) {
          L.level = 1;
          L.on = true;
        }
        populate(sim);
      },
    },
  ],
});

function median(ring, n) {
  if (!n) return 0;
  const s = Array.from(ring.subarray(0, Math.min(n, ring.length))).sort((a, b) => a - b);
  return s[s.length >> 1];
}

/** For the tests and the console. */
function state() {
  const roles = {};
  for (const w of L.walkers) roles[w.role] = (roles[w.role] || 0) + 1;
  return {
    on: L.on,
    mode: L.mode,
    level: L.level,
    time: L.time,
    people: L.walkers.length,
    drawn: L.crowd ? L.crowd.drawn : 0,
    roles,
    vans: L.vans ? L.vans.list.map((v) => ({ kind: v.kind, d: Math.round(v.d), v: +v.v.toFixed(2), yielding: v.yielding, x: Math.round(v.pos.x), z: Math.round(v.pos.z) })) : [],
    vanYields: L.vans ? L.vans.stats.yields : 0,
    crowd: L.life ? { ...L.life.stats } : null,
    waits: L.stats.waits,
    why: L.plan ? L.plan.why.slice() : [],
    cap: PEOPLE_CAP,
    update: { median: median(L.stats.ms, L.stats.n), max: L.stats.msMax, mean: L.stats.frames ? L.stats.msSum / L.stats.frames : 0, frames: L.stats.frames },
  };
}

const API = {
  state,
  /** The walkers' live records ({ role, x, y, z, hidden, held, ... }), for a test that watches them. */
  walkers: () => L.walkers,
  vans: () => (L.vans ? L.vans.list : []),
  plan: () => L.plan,
  replan: () => populate(L.sim),
  /**
   * Off: nothing updates and nothing is drawn, the forecourt included.
   * On: as it was. For a cost comparison (the tests).
   */
  setEnabled: (on) => {
    L.paused = !on;
    if (L.group) for (const c of L.group.children) c.visible = !!on;
    return !L.paused;
  },
  meshes: () => [...(L.crowd ? L.crowd.meshes : []), ...(L.vans ? Object.values(L.vans.meshes) : [])],
};
