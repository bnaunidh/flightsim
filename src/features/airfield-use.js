/**
 * The airfield, usable on foot: every hangar opens and closes, its lights
 * come on, a spare aeroplane waits in the empty ones, the fuel pump fills
 * your tanks, the tower door opens and the car park's barrier lifts.
 *
 * The owner, 2026-10-12: "you can open and close hangars everything should
 * be interactable". Each thing here is one candidate for interact.js — one
 * prompt, "E — Open the hangar", and one key — listed only while you are on
 * foot near it.
 *
 * THE HANGARS are the airport's own (world/airport.js): their door leaves
 * already slide, opened by the ground crew when an aeroplane rolls up
 * (airport-services.js watchHangars). Worked by hand they stay the way you
 * left them (`hs.manual`, which watchHangars respects). The lamps inside are
 * this file's: steady emissive strips that ease up with the doors — no
 * light objects, nothing that flashes.
 *
 * A SPARE. An empty hangar opened by hand has a Courier in it (one of the
 * aeroplanes everybody has from the start), so after an ejection or a
 * runaway "you need to go to the hangar to find another plane" (the owner)
 * is something you can actually do: walk in, and the prompt is "Press O to
 * get in the Kestrel Courier" (rides.js).
 */

import * as THREE from '../vendor/three.module.js';
import { registerExtension } from '../game/extensions.js';
import { Batch, vcMaterial, bakeModel, disposeBake } from '../world/airport-kit.js';
import { addObstacle } from '../world/terrain.js';
import { getAircraft } from '../aircraft/types.js';
import { schemeFor } from '../aircraft/liveries.js';
import { createAircraftModel } from '../aircraft/model-adapter.js';
import * as Physics from '../aircraft/physics.js';
import { onFoot } from './onfoot.js';
import { addInteractSource } from './interact.js';
import { addRideSource } from './rides.js';

const D2R = Math.PI / 180;

const A = {
  sim: null,
  group: null,
  hangars: [],
  pump: null,
  tower: null,
  barrier: null,
  refuels: 0,
  materials: [],
  geometries: [],
  bakes: [],
};

function notify(sim, text, kind = 'info', secs = 3) {
  try {
    if (sim && sim.hud && sim.hud.notify) sim.hud.notify(text, kind, secs);
  } catch (e) {
    /* no HUD, no words */
  }
}

function freeFlight(sim) {
  return !!(sim && sim.mode === 'free' && !(sim.runner && sim.runner.status === 'running'));
}

function disposeAll() {
  for (const g of A.geometries) g.dispose();
  for (const m of A.materials) m.dispose();
  for (const b of A.bakes) disposeBake(b);
  A.geometries = [];
  A.materials = [];
  A.bakes = [];
  A.hangars = [];
  A.pump = null;
  A.tower = null;
  A.barrier = null;
}

/* ------------------------------------------------------------------ */
/* Hangars                                                             */
/* ------------------------------------------------------------------ */

function buildHangars(sim, group) {
  const ap = sim.airport;
  const lay = ap && ap.layout;
  if (!ap || !Array.isArray(ap.doorState) || !lay) return;
  const F = lay.frame;
  const elev = lay.elev;
  const lampMat = new THREE.MeshStandardMaterial({ color: 0x3a3a36, emissive: 0xfff1d0, emissiveIntensity: 0, roughness: 0.5 });
  A.materials.push(lampMat);
  for (const hs of ap.doorState) {
    const h = hs.hangar;
    if (!h || !h.rect || !F) continue;
    const cx = F.x(h.u);
    const fz = F.z(h.w0);
    const bz = F.z(h.w0 + h.depth);
    const face = h.slot ? h.slot.headingDeg : fz < bz ? 0 : 180;
    // This hangar's own lamps, a material each so each lights with its doors.
    const mat = lampMat.clone();
    A.materials.push(mat);
    const b = new Batch();
    const W = h.width;
    for (let i = 0; i < 3; i++) {
      const z = F.z(h.w0 + h.depth * (0.22 + i * 0.28));
      for (const s of [-0.32, 0, 0.32]) b.box(Math.max(1.6, W * 0.08), 0.16, 0.7, cx + s * W, elev + h.H - 1.55, z, 0xffffff);
    }
    const lm = b.mesh(mat, { cast: false, name: `airfield-lamps:${h.id}` });
    A.geometries.push(lm.geometry);
    group.add(lm);
    const rec = { hs, h, cx, fz, face, mat, light: 0, spare: null, spareTaken: false, opened: false };
    A.hangars.push(rec);
  }
}

/** A Courier on the floor of an empty hangar, the first time somebody opens it by hand. */
function addSpare(sim, rec) {
  if (rec.spare || rec.h.occupant || !A.group) return;
  // Not on top of an aeroplane the traffic has parked in there.
  const r = rec.h.rect;
  for (const t of sim.traffic || []) {
    if (t && t.pos && t.pos.x > r.x0 && t.pos.x < r.x1 && t.pos.z > r.z0 && t.pos.z < r.z1) return;
  }
  const type = getAircraft('courier');
  try {
    const model = createAircraftModel({ type, livery: schemeFor(type, 'house'), landingLight: false });
    if (model.userData && model.userData.update) {
      model.userData.update(0.016, {
        controls: { pitch: 0, roll: 0, yaw: 0, throttle: 0, brakes: 1 }, rpm: 0, flaps: 0, gearPos: 1, gearDown: true,
        onGround: true, groundSpeed: 0, agl: 0, engineOn: false,
      }, { isNight: false, cond: { cloud: 0 } });
    }
    const bake = bakeModel(model);
    A.bakes.push(bake);
    const g = new THREE.Group();
    g.name = `airfield-spare:${rec.h.id}`;
    for (const p of bake.parts) {
      const m = new THREE.Mesh(p.geometry, p.material);
      m.castShadow = true;
      g.add(m);
    }
    const s = rec.h.slot;
    g.position.set(s.x, sim.airport.layout.elev - bake.box.min.y, s.z);
    g.rotation.y = -s.headingDeg * D2R;
    A.group.add(g);
    rec.spare = { type, x: s.x, z: s.z, headingDeg: s.headingDeg, mesh: g };
  } catch (e) {
    console.warn('[airfield] could not put a spare in the hangar', e);
  }
}

function setHangar(sim, rec, open) {
  const hs = rec.hs;
  hs.manual = true;
  hs.target = open ? 1 : 0;
  hs.hold = open ? Infinity : 0;
  if (open && !rec.opened) {
    rec.opened = true;
    addSpare(sim, rec);
  }
}

/* ------------------------------------------------------------------ */
/* The pump, the tower door, the barrier                                */
/* ------------------------------------------------------------------ */

function buildExtras(sim, group) {
  const lay = sim.airport && sim.airport.layout;
  if (!lay) return;
  const elev = lay.elev;
  const rw = lay.runway || { cz: 0 };
  const vc = vcMaterial({ roughness: 0.7, metalness: 0.2 });
  A.materials.push(vc);
  // The pump: beside the fuel farm, on the side that faces the field.
  if (lay.fuel && lay.fuel.rect) {
    const r = lay.fuel.rect;
    const nearZ = Math.abs(r.z0 - rw.cz) < Math.abs(r.z1 - rw.cz) ? r.z0 : r.z1;
    const out = nearZ === r.z0 ? -1 : 1;
    const x = Math.min(r.x1, Math.max(r.x0, r.x1 - 4));
    const z = nearZ + out * 3.2;
    const b = new Batch();
    b.box(1.1, 1.9, 0.7, 0, 0.95, 0, 0xd8dcdf);
    b.box(1.14, 0.35, 0.74, 0, 1.75, 0, 0xc8322a);
    b.box(0.6, 0.4, 0.05, 0, 1.3, -out * 0.37, 0x1f252b);
    b.box(0.12, 0.6, 0.12, 0.62, 1.0, 0, 0x2b3036);
    b.box(1.6, 0.12, 1.2, 0, 0.06, 0, 0x9a9d98);
    const m = b.mesh(vc, { name: 'airfield-pump' });
    A.geometries.push(m.geometry);
    m.position.set(x, elev, z);
    m.rotation.y = out < 0 ? Math.PI : 0;
    group.add(m);
    addObstacle({ x0: x - 0.6, x1: x + 0.6, z0: z - 0.4, z1: z + 0.4, y0: elev, y1: elev + 2, what: 'You hit the fuel pump' });
    A.pump = { x, z: z + out * 1.2, face: out < 0 ? 0 : 180 };
  }
  // The tower's door, at the foot of the side that faces the runway.
  if (lay.tower) {
    const t = lay.tower;
    const toward = rw.cz > t.z ? 1 : -1;
    const half = (t.size || 12) / 2;
    const x = t.x + Math.min(half - 1.2, 2);
    const z = t.z + toward * (half + 0.06);
    const g = new THREE.BoxGeometry(1.3, 2.3, 0.08);
    // Hinged at one edge.
    g.translate(0.65, 1.15, 0);
    A.geometries.push(g);
    const mat = new THREE.MeshStandardMaterial({ color: 0x3e5568, roughness: 0.6, metalness: 0.3 });
    A.materials.push(mat);
    const door = new THREE.Mesh(g, mat);
    door.name = 'airfield-tower-door';
    door.position.set(x - 0.65, elev, z + toward * 0.05);
    group.add(door);
    const frame = new Batch();
    frame.box(1.6, 0.18, 0.2, x, elev + 2.4, z + toward * 0.06, 0xe8ecef);
    frame.box(0.12, 2.4, 0.2, x - 0.75, elev + 1.2, z + toward * 0.06, 0xe8ecef);
    frame.box(0.12, 2.4, 0.2, x + 0.75, elev + 1.2, z + toward * 0.06, 0xe8ecef);
    const fm = frame.mesh(vc, { name: 'airfield-tower-frame' });
    A.geometries.push(fm.geometry);
    group.add(fm);
    A.tower = { x, z: z + toward * 1.0, face: toward > 0 ? 180 : 0, door, toward, open: 0, until: 0 };
  }
  // The car park's barrier arm, across its landside edge.
  if (lay.carPark && lay.carPark.rect) {
    const r = lay.carPark.rect;
    const farZ = Math.abs(r.z0 - rw.cz) > Math.abs(r.z1 - rw.cz) ? r.z0 : r.z1;
    const out = farZ === r.z0 ? -1 : 1;
    const px = r.x0 + 2.2;
    const pz = farZ + out * 1.4;
    const post = new Batch();
    post.box(0.5, 1.1, 0.5, 0, 0.55, 0, 0xe8c547);
    post.box(0.56, 0.2, 0.56, 0, 1.12, 0, 0x2b3036);
    const pm = post.mesh(vc, { name: 'airfield-barrier-post' });
    A.geometries.push(pm.geometry);
    pm.position.set(px, elev, pz);
    group.add(pm);
    const len = Math.min(7, (r.x1 - r.x0) * 0.4);
    const ag = new THREE.BoxGeometry(len, 0.14, 0.14);
    ag.translate(len / 2, 0, 0);
    A.geometries.push(ag);
    // Red and white: a stripe texture would be another material; two boxes do it.
    const am = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.5 });
    A.materials.push(am);
    const arm = new THREE.Group();
    arm.position.set(px, elev + 1.0, pz);
    const white = new THREE.Mesh(ag, am);
    arm.add(white);
    const rg = new THREE.BoxGeometry(len * 0.25, 0.16, 0.16);
    A.geometries.push(rg);
    const rm = new THREE.MeshStandardMaterial({ color: 0xc8322a, roughness: 0.5 });
    A.materials.push(rm);
    for (const f of [0.2, 0.7]) {
      const red = new THREE.Mesh(rg, rm);
      red.position.x = len * f + len * 0.125;
      arm.add(red);
    }
    arm.name = 'airfield-barrier-arm';
    group.add(arm);
    A.barrier = { x: px + 1.2, z: pz + out * 1.0, arm, len, up: 0, until: 0, px, pz, elev };
  }
}

/* ------------------------------------------------------------------ */
/* What you can use                                                     */
/* ------------------------------------------------------------------ */

function parkedPlane(sim) {
  const f = onFoot.from;
  const ac = sim.aircraft;
  if (!f || f.type !== 'aircraft' || f.runaway || !ac || ac.crashed || !ac.onGround) return null;
  return ac;
}

addInteractSource({
  id: 'airfield',
  list(sim, w, add) {
    for (const rec of A.hangars) {
      const dx = rec.cx - w.x;
      const dz = rec.fz - w.z;
      const reach = rec.h.width / 2 + 3;
      if (dx * dx + dz * dz > reach * reach) continue;
      const open = rec.hs.target > 0.5 || rec.hs.open > 0.5;
      add({
        id: `hangar:${rec.h.id}`,
        label: open ? 'Close the hangar' : 'Open the hangar',
        short: open ? 'Close' : 'Open',
        x: rec.cx,
        z: rec.fz,
        reach,
        look: 80,
        hold: 0.6,
        run: (s) => {
          setHangar(s, rec, !open);
          return open ? '' : `Hangar ${rec.h.number} — the doors roll back and the lights come on.`;
        },
      });
    }
    const p = A.pump;
    if (p && (p.x - w.x) ** 2 + (p.z - w.z) ** 2 < 9) {
      const ac = parkedPlane(sim);
      const near = ac && Math.hypot(ac.pos.x - p.x, ac.pos.z - p.z) < 45;
      const cap = Physics.SPEC && Physics.SPEC.fuelCapacity;
      const full = near && cap && ac.fuel >= cap * 0.995;
      add({
        id: 'fuel-pump',
        label: near ? (full ? 'Tanks are full' : 'Refuel') : 'Refuel (bring your aircraft to the pump)',
        short: 'Refuel',
        x: p.x,
        z: p.z,
        reach: 2.6,
        look: 90,
        hold: near && !full ? 1.5 : 0,
        why: !near ? 'Park your aircraft by the pump first — then come and fill it up.' : full ? 'The tanks are already full.' : '',
        run: (s) => {
          const a = parkedPlane(s);
          if (!a || !cap) return '';
          a.fuel = cap;
          A.refuels++;
          return 'Topped up — full tanks.';
        },
      });
    }
    const t = A.tower;
    if (t && (t.x - w.x) ** 2 + (t.z - w.z) ** 2 < 9) {
      add({
        id: 'tower-door',
        label: t.until > 0 ? 'Close the tower door' : 'Open the tower door',
        short: 'Door',
        x: t.x,
        z: t.z,
        reach: 2.6,
        look: 90,
        run: (s) => {
          if (t.until > 0) {
            t.until = 0;
            return '';
          }
          t.until = 8;
          return 'Tower: “Hello down there! It is staff only up the stairs — but thanks for visiting.”';
        },
      });
    }
    const b = A.barrier;
    if (b && (b.x - w.x) ** 2 + (b.z - w.z) ** 2 < 12) {
      add({
        id: 'barrier',
        label: b.until > 0 ? 'Lower the barrier' : 'Lift the barrier',
        short: 'Barrier',
        x: b.x,
        z: b.z,
        reach: 3.4,
        look: 90,
        run: () => {
          b.until = b.until > 0 ? 0 : 10;
          return '';
        },
      });
    }
  },
});

addRideSource({
  id: 'airfield-spares',
  list(sim, w, add) {
    for (const rec of A.hangars) {
      const s = rec.spare;
      if (!s || rec.spareTaken || rec.hs.open < 0.5) continue;
      if ((s.x - w.x) ** 2 + (s.z - w.z) ** 2 > 50 * 50) continue;
      add({
        typeId: s.type.id,
        x: s.x,
        z: s.z,
        headingDeg: s.headingDeg,
        reach: 2.6,
        where: `hangar ${rec.h.number}`,
        onTake: () => {
          rec.spareTaken = true;
          s.mesh.visible = false;
        },
      });
    }
  },
});

/** The barrier arm, down, is in the way on foot; the spare in a hangar is solid. */
const PROVIDER = {
  solids(sim, addSolid) {
    const b = A.barrier;
    if (b && b.up < 0.5) {
      addSolid(b.px + b.len / 2, b.pz, 90, b.len / 2, 0.12, b.elev + 0.7, b.elev + 1.15, 'the barrier');
    }
  },
};

/* ------------------------------------------------------------------ */
/* The plug-in                                                          */
/* ------------------------------------------------------------------ */

registerExtension({
  id: 'airfield-use',

  install(sim) {
    A.sim = sim;
    onFoot.addProvider(PROVIDER);
  },

  buildWorld(sim, group) {
    disposeAll();
    A.group = group;
    try {
      buildHangars(sim, group);
    } catch (e) {
      console.warn('[airfield] the hangar lamps could not be built', e);
    }
    try {
      buildExtras(sim, group);
    } catch (e) {
      console.warn('[airfield] the pump, the tower door or the barrier could not be built', e);
    }
  },

  update(sim, dt) {
    for (const rec of A.hangars) {
      // The lamps follow the doors: up as they open, down as they shut. Steady, never blinking.
      const want = rec.hs.open > 0.05 ? Math.min(1, rec.hs.open * 1.6) : 0;
      if (Math.abs(rec.light - want) > 1e-3) {
        rec.light += Math.sign(want - rec.light) * Math.min(Math.abs(want - rec.light), dt * 1.2);
        rec.mat.emissiveIntensity = 1.5 * rec.light;
      }
      if (rec.spare && !rec.spareTaken) rec.spare.mesh.visible = rec.hs.open > 0.04;
    }
    const t = A.tower;
    if (t) {
      if (t.until > 0) t.until -= dt;
      const want = t.until > 0 ? 1 : 0;
      if (t.open !== want) {
        t.open = want > t.open ? Math.min(1, t.open + dt * 1.5) : Math.max(0, t.open - dt * 1.5);
        t.door.rotation.y = t.toward * t.open * 1.6;
      }
    }
    const b = A.barrier;
    if (b) {
      if (b.until > 0) b.until -= dt;
      const want = b.until > 0 ? 1 : 0;
      if (b.up !== want) {
        b.up = want > b.up ? Math.min(1, b.up + dt * 0.9) : Math.max(0, b.up - dt * 0.9);
        b.arm.rotation.z = b.up * 1.35;
      }
    }
  },
});

/** For the tests and the console. */
export function airfieldState() {
  return {
    hangars: A.hangars.map((r) => ({ id: r.h.id, number: r.h.number, x: Math.round(r.cx), z: Math.round(r.fz), face: r.face, open: +r.hs.open.toFixed(3), target: r.hs.target, manual: !!r.hs.manual, light: +r.light.toFixed(3), spare: !!r.spare, spareTaken: r.spareTaken, occupant: r.h.occupant || null })),
    pump: A.pump ? { x: +A.pump.x.toFixed(1), z: +A.pump.z.toFixed(1) } : null,
    tower: A.tower ? { x: +A.tower.x.toFixed(1), z: +A.tower.z.toFixed(1), open: +A.tower.open.toFixed(2) } : null,
    barrier: A.barrier ? { x: +A.barrier.x.toFixed(1), z: +A.barrier.z.toFixed(1), up: +A.barrier.up.toFixed(2) } : null,
    refuels: A.refuels,
  };
}
