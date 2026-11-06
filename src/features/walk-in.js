/**
 * Walking into the terminal (the owner: "wheres the inside of the airport",
 * "with shops ... and with lounges aswell"). Out of the aeroplane and on foot,
 * walk up to the doors, kerb or apron, and go in: no loading screen, the same
 * world, the apron out of the windows. See terminal/plan.js for the building.
 *
 * This file is only the trigger, small and always there. Everything else is
 * fetched the first time a walker comes within LOAD_M of a terminal that can be
 * walked into, built a few milliseconds a frame (terminal/interior.js), and
 * thrown away with the world. Nobody who stays in the seat loads a byte of it.
 * WALK_IN = false puts every terminal back to the solid box it was.
 *
 * Also here, because it is the same job: the forecourt's furniture (benches,
 * bins, lamp posts, the canopy columns, the lobbies' sides) was drawn and the
 * crowd kept off it, but a walker went straight through it.
 */
import * as THREE from '../vendor/three.module.js';
import { registerExtension } from '../game/extensions.js';
import { AIRPORT } from '../world/terrain.js';
import { onFoot } from './onfoot.js';
import { terminalSolids } from './life/plan.js';
import { canWalkIn } from './terminal/plan.js';

/** The one switch. */
export const WALK_IN = true;

/** Metres from the building: start building it. */
const LOAD_M = 150;
/** Metres from the building: open it. Far enough that it is open before anyone can see a door up close. */
const SHOW_M = 70;
/** ...and shut it again, this much further out. */
const HIDE_M = 110;

/** Metres from the building: say it is open. */
const TELL_M = 45;
/** Seconds back in the seat before the building is let go. */
const DROP_S = 25;

const CELL = 8;
const W = {
  sim: null,
  lay: null,
  group: null,
  /** The module, once fetched; the interior of this world, once started. */
  mod: null,
  fetching: false,
  inside: null,
  kerb: new Map(),
  indoors: false,
  idle: 0,
  told: false,
  guide: null,
  lit: null,
  /** Each of the walker's materials, in the building's light. */
  basic: new Map(),
};

const inRange = (rect, x, z) => Math.hypot(Math.max(rect.x0 - x, 0, x - rect.x1), Math.max(rect.z0 - z, 0, z - rect.z1));

function kerbGrid(lay) {
  W.kerb = new Map();
  let list = [];
  try {
    list = terminalSolids(lay) || [];
  } catch (e) {
    console.warn('[walk-in] no forecourt solids here', e);
  }
  for (const q of list) {
    const r = q.r || 0;
    const x0 = r ? q.x - r : Math.min(q.x0, q.x1);
    const x1 = r ? q.x + r : Math.max(q.x0, q.x1);
    const z0 = r ? q.z - r : Math.min(q.z0, q.z1);
    const z1 = r ? q.z + r : Math.max(q.z0, q.z1);
    const box = { x: (x0 + x1) / 2, z: (z0 + z1) / 2, hw: (x1 - x0) / 2, hl: (z1 - z0) / 2, mark: 0 };
    for (let i = Math.floor(x0 / CELL); i <= Math.floor(x1 / CELL); i++) {
      for (let j = Math.floor(z0 / CELL); j <= Math.floor(z1 / CELL); j++) {
        const k = i * 100003 + j;
        let l = W.kerb.get(k);
        if (!l) W.kerb.set(k, (l = []));
        l.push(box);
      }
    }
  }
}

let stamp = 0;
const PROVIDER = {
  solids(sim, add) {
    const w = onFoot.walker;
    if (!w || !onFoot.active) return;
    const e = AIRPORT.elev;
    stamp++;
    const i = Math.floor(w.x / CELL);
    const j = Math.floor(w.z / CELL);
    for (let a = i - 1; a <= i + 1; a++) {
      for (let c = j - 1; c <= j + 1; c++) {
        const l = W.kerb.get(a * 100003 + c);
        if (!l) continue;
        for (const q of l) {
          if (q.mark === stamp) continue;
          q.mark = stamp;
          if (Math.abs(q.x - w.x) < q.hw + 2 && Math.abs(q.z - w.z) < q.hl + 2) add(q.x, q.z, 0, q.hl, q.hw, e - 1, e + 2.2, 'something in the way');
        }
      }
    }
    const I = W.inside;
    if (I && I.open) {
      I.grid.near(w.x, w.z, 1.6, (q) => {
        add((q.x0 + q.x1) / 2, (q.z0 + q.z1) / 2, 0, (q.z1 - q.z0) / 2, (q.x1 - q.x0) / 2, q.y0, q.y1, q.tag);
      });
    }
  },
  camBlock(x, y, z) {
    const I = W.inside;
    return !!(I && I.open && I.camBlocked(x, y, z));
  },
};

function fetchInside() {
  if (W.mod || W.fetching) return;
  W.fetching = true;
  import('./terminal/interior.js').then(
    (m) => {
      W.mod = m;
      W.fetching = false;
    },
    (e) => {
      W.fetching = false;
      console.warn('[walk-in] the terminal inside did not load; the doors stay shut', e);
      W.lay = null;
    }
  );
}

function drop() {
  setIndoors(false);
  if (W.inside) W.inside.dispose();
  W.inside = null;
}

/** The pilot in the building's light, not the sun's (or the night's). */
function setIndoors(on) {
  if (W.indoors === on) return;
  W.indoors = on;
  // The route line is drawn over everything: indoors it would run through the walls.
  const nav = W.sim && W.sim.navGuide;
  if (nav && on) {
    W.guide = nav.enabled;
    nav.setEnabled(false);
  } else if (nav && W.guide != null) {
    nav.setEnabled(W.guide);
    W.guide = null;
  }
  const model = onFoot.model;
  if (on && model) {
    W.lit = [];
    model.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      W.lit.push([o, o.material]);
      let m = W.basic.get(o.material);
      if (!m) {
        const q = o.material;
        m = new THREE.MeshBasicMaterial({ color: q.color ? q.color.clone().multiplyScalar(0.88) : 0xe0e0e0, map: q.map || null, vertexColors: !!q.vertexColors, fog: false });
        W.basic.set(q, m);
      }
      o.material = m;
    });
  } else if (W.lit) {
    for (const [o, m] of W.lit) o.material = m;
    W.lit = null;
  }
}

registerExtension({
  id: 'walk-in',

  install(sim) {
    W.sim = sim;
    onFoot.addProvider(PROVIDER);
    sim.walkIn = API;
  },

  buildWorld(sim, group) {
    drop();
    W.group = group;
    const lay = sim.apron && sim.apron.lay;
    kerbGrid(lay);
    W.lay = WALK_IN && canWalkIn(lay) ? lay : null;
  },

  startMode() {
    W.told = false;
  },

  stop() {
    if (W.inside) W.inside.hide();
    setIndoors(false);
  },

  update(sim, dt) {
    const lay = W.lay;
    if (!lay) return;
    const I = W.inside;
    if (!onFoot.active) {
      if (I && I.open) {
        setIndoors(false);
        I.hide();
      }
      if (I && !I.ready) I.pump(2);
      // Gone from the seat for a while: the memory is worth more than the 300 ms it takes to build again.
      W.idle += dt;
      if (I && W.idle > DROP_S) drop();
      return;
    }
    W.idle = 0;
    const w = onFoot.walker;
    const d = inRange(lay.terminal.rect, w.x, w.z);
    if (d > LOAD_M && !(I && I.open)) return;
    if (!I) {
      fetchInside();
      if (W.mod && W.group) {
        W.inside = W.mod.createInterior(sim, lay);
        W.group.add(W.inside.group);
      }
      return;
    }
    if (!I.ready) {
      I.pump(3);
      return;
    }
    if (!I.open && d < SHOW_M) I.show();
    else if (I.open && d > HIDE_M) {
      setIndoors(false);
      I.hide();
    }
    if (I.open) {
      // Once a flight: nothing else says the building is open.
      if (!W.told && d < TELL_M) {
        W.told = true;
        if (sim.hud && sim.hud.notify) sim.hud.notify('The terminal is open: walk in through the doors', 'info', 4);
      }
      setIndoors(I.under(w.x, w.z));
      I.update(dt, w, sim.camera.position);
      I.indoors = W.indoors;
    }
  },
});

const API = {
  /** For the tests and the console. */
  state() {
    const I = W.inside;
    return {
      lay: !!W.lay,
      fetched: !!W.mod,
      built: !!(I && I.ready),
      failed: !!(I && I.failed),
      open: !!(I && I.open),
      indoors: W.indoors,
      steps: I ? I.stepsDone : 0,
      longestStep: I ? I.longestStep : 0,
      people: I ? I.people.length : 0,
      kerb: W.kerb.size,
    };
  },
  get inside() {
    return W.inside;
  },
};
