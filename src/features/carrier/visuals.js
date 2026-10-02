/**
 * What the carrier feature adds to the world: four arresting wires at their
 * real spacing (and the one that is paying out), the Fresnel lens — the
 * meatball — on the port deck edge, a jet blast deflector behind each bow
 * catapult, a puff of steam down the track after a shot, the pattern's guide
 * ring, and a tail hook for the jets whose model does not draw one.
 *
 * Everything is built into the feature's own world group (extensions.js
 * disposes it with the world), in world coordinates, from deck.js numbers.
 * Primitives and flat colours, like the rest of the world.
 */

import * as THREE from '../../vendor/three.module.js';
import { RingGate } from '../../game/markers.js';
import { wires as wireList, lensSpot, catapults, TUNE } from './deck.js';

const UP = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _m = new THREE.Vector3();
const _q = new THREE.Quaternion();

/** A thin cylinder stretched between two points. */
function stretch(mesh, a, b) {
  _m.subVectors(b, a);
  const len = _m.length();
  mesh.position.copy(a).addScaledVector(_m, 0.5);
  if (len > 1e-6) {
    _q.setFromUnitVectors(UP, _m.multiplyScalar(1 / len));
    mesh.quaternion.copy(_q);
  }
  mesh.scale.set(1, Math.max(len, 1e-3), 1);
}

export function buildCarrierGear(group, f, carrier) {
  const out = { group, f, wires: [], engaged: null, lens: null, jbd: [], steam: [], gate: null };
  const deckY = f.deckY;

  /*
   * The pack draws its four wires at its own 12 m spacing, scaled five times
   * with the ship — 60 m apart. These replace them at the real 12.2 m, where
   * the hook actually looks for them, so the wire you see is the wire you
   * catch.
   */
  if (carrier && carrier.ship) {
    carrier.ship.traverse((o) => {
      if (o.name === 'arresterGear') o.visible = false;
    });
  }
  const wireMat = new THREE.MeshStandardMaterial({ color: 0xb9c0c6, roughness: 0.45, metalness: 0.6 });
  const sheaveMat = new THREE.MeshStandardMaterial({ color: 0x2b3036, roughness: 0.7, metalness: 0.4 });
  const unit = new THREE.CylinderGeometry(0.075, 0.075, 1, 5, 1, true);
  for (const w of wireList(f)) {
    const m = new THREE.Mesh(unit, wireMat);
    _a.set(w.a.x, deckY + 0.07, w.a.z);
    _b.set(w.b.x, deckY + 0.07, w.b.z);
    stretch(m, _a, _b);
    m.name = `carrierWire${w.n}`;
    group.add(m);
    for (const p of [w.a, w.b]) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.35, 1.4), sheaveMat);
      s.position.set(p.x, deckY + 0.17, p.z);
      group.add(s);
    }
    out.wires.push({ n: w.n, mesh: m, a: new THREE.Vector3(w.a.x, deckY + 0.07, w.a.z), b: new THREE.Vector3(w.b.x, deckY + 0.07, w.b.z) });
  }
  // The engaged wire: two legs from the sheaves to the hook.
  const legA = new THREE.Mesh(unit, wireMat);
  const legB = new THREE.Mesh(unit, wireMat);
  legA.visible = legB.visible = false;
  group.add(legA, legB);
  out.legs = [legA, legB];

  out.lens = buildLens(group, f);
  out.jbd = buildJbds(group, f);
  return out;
}

/** Show wire `n` paying out to the hook at `hook` (world), or put it back with n = null. */
export function setEngaged(gear, n, hook) {
  if (!gear) return;
  for (const w of gear.wires) w.mesh.visible = w.n !== n;
  const [legA, legB] = gear.legs;
  if (n == null || !hook) {
    legA.visible = legB.visible = false;
    return;
  }
  const w = gear.wires.find((x) => x.n === n);
  if (!w) return;
  _m.set(hook.x, Math.max(hook.y, gear.f.deckY + 0.05), hook.z);
  stretch(legA, w.a, _m);
  stretch(legB, w.b, _m);
  legA.visible = legB.visible = true;
}

/* ------------------------------------------------------------------ */
/* The lens                                                             */
/* ------------------------------------------------------------------ */

/*
 * The Improved Fresnel Lens Optical Landing System, at the ship's scale:
 * a column of five cells, the ball a bright amber light in whichever cell
 * your eye is in (red in the bottom one), a row of green datum lights either
 * side, red wave-off lights down both sides and green cut lights on top.
 * It faces down the glideslope, standing on the port deck edge abeam the
 * touchdown point.
 */
const CELL = 1.8;
function buildLens(group, f) {
  const spot = lensSpot(f);
  const g = new THREE.Group();
  g.name = 'carrierLens';
  g.position.set(spot.world.x, f.deckY, spot.world.z);
  // Face aft along the approach: +z of the group points at the jet in the groove.
  const D = f.D;
  const dwx = -(D.x * f.cos + D.z * f.sin);
  const dwz = -(-D.x * f.sin + D.z * f.cos);
  g.rotation.y = Math.atan2(dwx, dwz);
  const dark = new THREE.MeshStandardMaterial({ color: 0x1b1f24, roughness: 0.8 });
  const grey = new THREE.MeshStandardMaterial({ color: 0x59626b, roughness: 0.7 });
  const base = 6.5; // the cells' bottom, over the deck
  const mast = new THREE.Mesh(new THREE.BoxGeometry(1.2, base, 1.2), grey);
  mast.position.y = base / 2;
  g.add(mast);
  const box = new THREE.Mesh(new THREE.BoxGeometry(5.2, CELL * 5 + 1.2, 2.4), dark);
  box.position.y = base + (CELL * 5) / 2;
  g.add(box);
  const lamp = (w, h, color) => new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color, toneMapped: false, side: THREE.DoubleSide }));
  // The datum: five green lamps each side, level with the middle cell.
  const datumY = base + CELL * 2.5;
  const datum = [];
  for (const side of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(22, 0.6, 0.6), grey);
    arm.position.set(side * 14, datumY, 0.2);
    g.add(arm);
    for (let i = 0; i < 5; i++) {
      const l = lamp(2.2, 1.3, 0x35ff6a);
      l.position.set(side * (6.5 + i * 4), datumY, 1.25);
      g.add(l);
      datum.push(l);
    }
  }
  // The ball.
  const ball = lamp(3.6, CELL * 0.92, 0xffa21a);
  ball.position.set(0, datumY, 1.3);
  g.add(ball);
  // Wave-off lights: four red down each side of the cells.
  const waveoff = [];
  for (const side of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const l = lamp(1.2, 1.2, 0x400606);
      l.position.set(side * 3.4, base + 0.8 + i * 2.2, 1.3);
      g.add(l);
      waveoff.push(l);
    }
  }
  // Cut lights: three green on top.
  const cut = [];
  for (let i = -1; i <= 1; i++) {
    const l = lamp(1.2, 1.0, 0x063a12);
    l.position.set(i * 1.6, base + CELL * 5 + 1.3, 1.3);
    g.add(l);
    cut.push(l);
  }
  group.add(g);
  return { group: g, ball, datum, waveoff, cut, datumY, base, t: 0 };
}

/**
 * Light the lens. `cells` is the ball's place (+ high, cells off the datum,
 * from deck.js ballCells), `off` 'high' hides it, `red` turns it red;
 * `waveoff` flashes the red lights, `cut` the green ones.
 */
export function updateLens(lens, dt, { cells = 0, off = null, red = false, waveoff = false, cut = false, visible = true }) {
  if (!lens) return;
  lens.t += dt;
  const flash = Math.floor(lens.t * 3.4) % 2 === 0;
  lens.ball.visible = visible && off !== 'high';
  lens.ball.position.y = lens.datumY + Math.max(-2.5, Math.min(2.5, cells)) * CELL;
  lens.ball.material.color.setHex(red ? (flash ? 0xff1f1f : 0x7a0a0a) : 0xffa21a);
  for (const l of lens.waveoff) l.material.color.setHex(waveoff && flash ? 0xff2020 : 0x400606);
  for (const l of lens.cut) l.material.color.setHex(cut && flash ? 0x3dff6e : 0x063a12);
}

/* ------------------------------------------------------------------ */
/* Catapults: blast deflectors and steam                               */
/* ------------------------------------------------------------------ */

function buildJbds(group, f) {
  const mat = new THREE.MeshStandardMaterial({ color: 0x5d666f, roughness: 0.75, metalness: 0.35 });
  const out = [];
  for (const c of catapults(f)) {
    // 14 m wide panel, hinged at the deck 22 m behind the shuttle's start.
    const back = { x: c.start.x - c.dir.x * 22, z: c.start.z - c.dir.z * 22 };
    const hinge = new THREE.Group();
    hinge.position.set(back.x, f.deckY + 0.05, back.z);
    hinge.rotation.y = Math.atan2(c.dir.x, c.dir.z) + Math.PI;
    const panel = new THREE.Mesh(new THREE.BoxGeometry(14, 0.35, 4.2), mat);
    panel.position.set(0, 0.17, 2.1);
    hinge.add(panel);
    group.add(hinge);
    out.push({ n: c.n, hinge, up: 0 });
  }
  return out;
}

/** Raise (1) or lower (0) cat n's deflector, eased. */
export function updateJbd(gear, dt, raised) {
  if (!gear) return;
  for (const j of gear.jbd) {
    const want = raised === j.n ? 1 : 0;
    j.up += (want - j.up) * Math.min(1, dt * 2.2);
    j.hinge.rotation.x = -j.up * 0.95;
  }
}

/** A puff of steam down cat n's track, fading over a few seconds. */
export function puffSteam(gear, f, cat) {
  if (!gear || !cat) return;
  const mat = new THREE.MeshBasicMaterial({ color: 0xf2f5f8, transparent: true, opacity: 0.55, depthWrite: false });
  const geo = new THREE.SphereGeometry(1, 8, 6);
  for (let i = 0; i < 7; i++) {
    const m = new THREE.Mesh(geo, mat.clone());
    const t = i / 6;
    m.position.set(cat.start.x + (cat.end.x - cat.start.x) * t, f.deckY + 1, cat.start.z + (cat.end.z - cat.start.z) * t);
    m.scale.setScalar(2 + Math.random() * 1.5);
    gear.group.add(m);
    gear.steam.push({ m, life: 3.5 + Math.random(), age: 0 });
  }
}

export function updateSteam(gear, dt) {
  if (!gear || !gear.steam.length) return;
  for (let i = gear.steam.length - 1; i >= 0; i--) {
    const s = gear.steam[i];
    s.age += dt;
    const k = s.age / s.life;
    s.m.position.y += dt * 2.2;
    s.m.scale.multiplyScalar(1 + dt * 0.5);
    s.m.material.opacity = Math.max(0, 0.55 * (1 - k));
    if (k >= 1) {
      gear.group.remove(s.m);
      s.m.material.dispose();
      gear.steam.splice(i, 1);
    }
  }
}

/* ------------------------------------------------------------------ */
/* The pattern's guide ring                                            */
/* ------------------------------------------------------------------ */

export function setGate(gear, scene, at) {
  if (!gear) return;
  if (!at) {
    if (gear.gate) gear.gate.group.visible = false;
    return;
  }
  const key = `${Math.round(at.x)},${Math.round(at.y)},${Math.round(at.z)},${at.radius}`;
  if (!gear.gate || gear.gate.key !== key) {
    if (gear.gate) {
      gear.group.remove(gear.gate.group);
      gear.gate.torus.geometry.dispose();
      gear.gate.halo.geometry.dispose();
    }
    const g = new RingGate(new THREE.Vector3(at.x, at.y, at.z), at.headingDeg, at.radius || 90);
    g.key = key;
    g.setActive(true);
    gear.group.add(g.group);
    gear.gate = g;
  }
  gear.gate.group.visible = true;
}

export function updateGate(gear, dt, camPos) {
  if (gear && gear.gate && gear.gate.group.visible) gear.gate.update(dt, camPos);
}

/* ------------------------------------------------------------------ */
/* A tail hook, for jets whose model has none                          */
/* ------------------------------------------------------------------ */

export function buildHook(group) {
  const mat = new THREE.MeshStandardMaterial({ color: 0x1f2328, roughness: 0.6, metalness: 0.5 });
  const shoe = new THREE.MeshStandardMaterial({ color: 0xd8dde2, roughness: 0.5, metalness: 0.6 });
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 1, 6), mat);
  const tip = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.14, 0.34), shoe);
  arm.visible = tip.visible = false;
  group.add(arm, tip);
  return { arm, tip };
}

/** Place the drawn hook: pivot and point in world space, or hide it. */
export function placeHook(hook, pivot, point, visible) {
  if (!hook) return;
  hook.arm.visible = hook.tip.visible = !!visible;
  if (!visible) return;
  stretch(hook.arm, pivot, point);
  hook.tip.position.copy(point);
  hook.tip.quaternion.copy(hook.arm.quaternion);
}

export { TUNE };
