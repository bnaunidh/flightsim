/**
 * T-Pose Harrison, drawn.
 *
 * "Add T-Pose Harrison (1 km faster than Air Massimo)" — the owner's list. A
 * man in a T-pose, flying. He stands bolt upright with his arms straight out
 * on a stubby rocket board, and the board's rocket throws Air Massimo's blue
 * flame. That is all the aeroplane there is: the arms are the wing (the
 * flight model's wing tips are his hands), the board is the undercarriage —
 * three fat wheels that fold up into it — and he leans into a turn the way a
 * snowboarder does, because the centre of gravity is down at his feet.
 *
 * Built in METRES and wrapped so the root carries `shape.scale`, exactly as
 * model.js's aeroplanes are: main.js hangs the cockpit on the root and counter-
 * scales it by shape.scale, and a root of scale 1 would have put the panel at
 * twice the size, twice as far away.
 *
 * The drawn wheels touch exactly where the physics lands (the `nose` and
 * `main` of the roster entry in ../extra/tpose.js); tests/features/aircrew.mjs
 * checks it the way fighters.mjs checks the jets.
 *
 * userData:
 *   update(dt, ac, weather)   the flame, the wheels, his head
 *   setRider(on)              hide Harrison (he jumped off; the board flies on)
 *   rider                     his group, for the camera and the tests
 */

import * as THREE from '../../vendor/three.module.js';
import { createUniformPerson } from '../../features/uniforms.js';

/** How big Harrison is drawn: 1.9 x the game's 1.72 m person = 3.3 m tall. */
export const HARRISON_SCALE = 1.9;
/** Where the board's deck is, metres below the centre of gravity. */
export const DECK_Y = -0.2;
/** The wheels' contact points, metres (must match the roster's shape). */
export const WHEELS = { nose: [0, -0.66, -1.1], main: [0.42, -0.66, 0.4], r: 0.15 };

function mat(color, extra = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.1, ...extra });
}

export function buildTPoseHarrison(type) {
  const S = (type && type.shape) || { scale: 0.5 };
  const root = new THREE.Group();
  root.name = 'aircraft:tpose';
  root.scale.setScalar(S.scale || 1);
  const m = new THREE.Group(); // everything below is in metres
  m.scale.setScalar(1 / (S.scale || 1));
  root.add(m);

  const mats = {
    deck: mat(0x7a3bd1, { roughness: 0.4 }),
    stripe: mat(0xffd23f, { roughness: 0.45 }),
    grip: mat(0x23242a, { roughness: 0.95, metalness: 0 }),
    metal: mat(0xc9d0d8, { roughness: 0.3, metalness: 0.7 }),
    fin: mat(0xe0302b, { roughness: 0.45 }),
    nozzle: mat(0x2a2d33, { roughness: 0.35, metalness: 0.6 }),
    tyre: mat(0x141518, { roughness: 0.9, metalness: 0 }),
    hub: mat(0xffd23f, { roughness: 0.4 }),
  };
  const add = (geo, material, x, y, z, name) => {
    const o = new THREE.Mesh(geo, material);
    o.position.set(x, y, z);
    o.castShadow = true;
    if (name) o.name = name;
    m.add(o);
    return o;
  };

  /* ---- the board: a rounded deck with a yellow flash and grip tape ---- */
  const deckShape = new THREE.Shape();
  const hw = 0.36;
  const front = -1.34;
  const back = 0.95;
  deckShape.moveTo(-hw, back - 0.1);
  deckShape.lineTo(-hw, front + 0.35);
  deckShape.quadraticCurveTo(-hw, front, 0, front);
  deckShape.quadraticCurveTo(hw, front, hw, front + 0.35);
  deckShape.lineTo(hw, back - 0.1);
  deckShape.quadraticCurveTo(hw, back, 0, back);
  deckShape.quadraticCurveTo(-hw, back, -hw, back - 0.1);
  const deckGeo = new THREE.ExtrudeGeometry(deckShape, { depth: 0.12, bevelEnabled: true, bevelThickness: 0.025, bevelSize: 0.025, bevelSegments: 2, curveSegments: 8 });
  // Shape is in x/y; lie it flat so its y becomes the board's z.
  deckGeo.rotateX(Math.PI / 2);
  deckGeo.translate(0, DECK_Y, 0);
  add(deckGeo, mats.deck, 0, 0, 0, 'board');
  const grip = add(new THREE.BoxGeometry(hw * 1.7, 0.012, 1.5), mats.grip, 0, DECK_Y + 0.03, -0.12);
  grip.castShadow = false;
  for (const z of [-1.05, 0.72]) add(new THREE.BoxGeometry(hw * 1.9, 0.02, 0.07), mats.stripe, 0, DECK_Y + 0.02, z);

  /* ---- the rocket on the back, with Air Massimo's blue flame ---- */
  const body = new THREE.CylinderGeometry(0.19, 0.19, 0.95, 16);
  body.rotateX(Math.PI / 2);
  add(body, mats.metal, 0, DECK_Y + 0.22, 1.2, 'rocket');
  const noseCone = new THREE.ConeGeometry(0.17, 0.3, 16);
  noseCone.rotateX(-Math.PI / 2);
  add(noseCone, mats.fin, 0, DECK_Y + 0.22, 0.58);
  const bell = new THREE.CylinderGeometry(0.2, 0.26, 0.22, 16, 1, true);
  bell.rotateX(Math.PI / 2);
  add(bell, mats.nozzle, 0, DECK_Y + 0.22, 1.78, 'nozzle');
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 + Math.PI / 2;
    const fin = add(new THREE.BoxGeometry(0.02, 0.26, 0.34), mats.fin, Math.cos(a) * 0.24, DECK_Y + 0.22 + Math.sin(a) * 0.24, 1.45);
    fin.rotation.z = a - Math.PI / 2;
  }
  // A strut down to the deck.
  add(new THREE.BoxGeometry(0.08, 0.14, 0.5), mats.nozzle, 0, DECK_Y + 0.07, 1.05);

  const flameMat = new THREE.MeshBasicMaterial({
    color: 0x7fc8ff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  flameMat.name = 'afterburner';
  // Wide at the nozzle, a point one metre behind it (+Z, out of the back).
  const flameGeo = new THREE.ConeGeometry(0.2, 1, 14, 1, true);
  flameGeo.translate(0, 0.5, 0);
  flameGeo.rotateX(Math.PI / 2);
  const flame = add(flameGeo, flameMat, 0, DECK_Y + 0.22, 1.86, 'flame');
  flame.castShadow = false;
  const coreMat = flameMat.clone();
  coreMat.color.setHex(0xffffff);
  coreMat.opacity = 0.9;
  const core = add(flameGeo.clone().scale(0.5, 0.5, 0.55), coreMat, 0, DECK_Y + 0.22, 1.86, 'flameCore');
  core.castShadow = false;

  /* ---- three fat wheels on yellow hangers; they fold into the board ---- */
  const wheelGeo = new THREE.CylinderGeometry(WHEELS.r, WHEELS.r, 0.16, 18);
  wheelGeo.rotateZ(Math.PI / 2);
  const hubGeo = new THREE.CylinderGeometry(WHEELS.r * 0.45, WHEELS.r * 0.45, 0.17, 10);
  hubGeo.rotateZ(Math.PI / 2);
  const legs = [];
  const wheelAt = (x, z, name) => {
    const leg = new THREE.Group();
    leg.position.set(x, DECK_Y - 0.03, z);
    m.add(leg);
    const axleY = WHEELS.nose[1] + WHEELS.r - (DECK_Y - 0.03);
    const hanger = new THREE.Mesh(new THREE.BoxGeometry(0.06, Math.abs(axleY), 0.08), mats.hub);
    hanger.position.y = axleY / 2;
    leg.add(hanger);
    const w = new THREE.Mesh(wheelGeo, mats.tyre);
    w.name = name;
    w.position.y = axleY;
    w.castShadow = true;
    leg.add(w);
    const hub = new THREE.Mesh(hubGeo, mats.hub);
    hub.position.y = axleY;
    leg.add(hub);
    legs.push({ leg, wheel: w, hub });
  };
  wheelAt(WHEELS.nose[0], WHEELS.nose[2], 'wheel:nose');
  wheelAt(-WHEELS.main[0], WHEELS.main[2], 'wheel:left');
  wheelAt(WHEELS.main[0], WHEELS.main[2], 'wheel:right');

  /* ---- Harrison himself ---- */
  const rider = new THREE.Group();
  rider.name = 'harrison';
  const person = createUniformPerson('harrison', { seed: 5 });
  person.scale.setScalar(HARRISON_SCALE);
  rider.position.set(0, DECK_Y + 0.02, -0.1);
  rider.add(person);
  m.add(rider);
  const rig = person.userData.rig;
  // A rider's stance: feet a little apart, knees soft.
  for (const L of rig.legs) {
    L.leg.rotation.set(0, 0, L.side * 0.07);
    L.knee.rotation.set(-0.12, 0, 0);
  }
  rig.body.rotation.x = 0.05;

  let spin = 0;
  let t = 0;
  root.userData.rider = rider;
  root.userData.person = person;
  root.userData.setRider = (on) => {
    rider.visible = !!on;
  };
  root.userData.update = (dt, ac = {}, weather = {}) => {
    void weather;
    t += dt || 0;
    const on = ac.engineOn !== false && (ac.rpm ?? 0) > 0.02;
    const thr = ac.controls ? ac.controls.throttle || 0 : 0;
    const k = on ? 0.35 + Math.min(1, (ac.rpm ?? thr)) * 1.6 : 0;
    const flick = 1 + Math.sin(t * 47) * 0.07 + Math.sin(t * 31) * 0.05;
    flame.visible = core.visible = k > 0.05;
    flame.scale.set(1, 1, k * flick);
    core.scale.set(1, 1, k * flick);
    // The wheels roll with the ground speed and fold away with the gear.
    spin += ((ac.groundSpeed || 0) / WHEELS.r) * (dt || 0) * (ac.onGround ? 1 : 0);
    const g = ac.gearPos ?? 1;
    for (const L of legs) {
      L.wheel.rotation.x = -spin;
      L.hub.rotation.x = -spin;
      L.leg.scale.set(1, Math.max(0.02, g), 1);
      L.leg.visible = g > 0.03;
    }
    // He looks where he is turning, and bobs a little when standing still.
    const roll = ac.controls ? ac.controls.roll || 0 : 0;
    rig.head.rotation.y += (-roll * 0.45 - rig.head.rotation.y) * Math.min(1, (dt || 0) * 5);
    rig.chest.position.y = 0.06 + (ac.onGround ? Math.sin(t * 2.2) * 0.006 : 0);
  };
  root.userData.dispose = () => {
    root.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
    });
    for (const k in mats) mats[k].dispose();
    flameMat.dispose();
    coreMat.dispose();
  };
  return root;
}
