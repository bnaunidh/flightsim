/**
 * The apron: a working airport rather than a shed beside a runway.
 *
 * What was here before was a box for the terminal, a box for its roof, and a
 * truck made of four more boxes. This replaces all of it with things that have
 * a shape: a glazed terminal with a canopy and a departures hall you can see
 * into, three air bridges reaching out to the stands, aeroplanes parked at
 * those stands, and the ground vehicles that make an airfield look staffed —
 * a pushback tug, a fuel bowser, a baggage train and a catering lift.
 *
 * The parked aeroplanes are built by the same code as the one you fly, from
 * the same fleet, so a Meridian at the gate really is a Meridian.
 *
 * Everything is procedural and everything hangs off one group, so the world
 * teardown disposes it along with the rest.
 */

import * as THREE from '../vendor/three.module.js';
import { AIRPORT, addObstacleAt } from './terrain.js';
import { buildingTexture, roofTexture, panelTexture, asphaltTexture } from '../render/textures.js';
import { createAircraftModel } from '../aircraft/model-adapter.js';
import { LIVERIES, schemeFor } from '../aircraft/liveries.js';
import { getAircraft } from '../aircraft/types.js';

/*
 * Field elevation, read once at import — which was Kestrel's, on every map.
 * The terminal, the air bridges, the parked aeroplanes and the service
 * vehicles all built themselves at the wrong height everywhere else.
 */
let ELEV = AIRPORT.elev;

/** Called from main.js after applyMap(), before the world is rebuilt. */
export function refreshApronElevation() {
  ELEV = AIRPORT.elev;
  return ELEV;
}

/* ------------------------------------------------------------------ */
/* Small parts                                                         */
/* ------------------------------------------------------------------ */

function box(w, h, d, mat, x, y, z, ry = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.rotation.y = ry;
  m.castShadow = m.receiveShadow = true;
  return m;
}

/** A road wheel, lying on its side the way a wheel does. */
function roadWheel(r, width, mat) {
  const w = new THREE.Mesh(new THREE.CylinderGeometry(r, r, width, 12), mat);
  w.rotation.x = Math.PI / 2;
  w.castShadow = true;
  return w;
}

/**
 * Anything with wheels shares this: a chassis you position, and wheels placed
 * from a list of offsets. Saves every vehicle repeating the same eight lines.
 */
function wheeled(group, wheels, r, width, mat) {
  for (const [x, z] of wheels) {
    const w = roadWheel(r, width, mat);
    w.position.set(x, r, z);
    group.add(w);
  }
}

export class Apron {
  constructor(scene, quality = 'high') {
    this.group = new THREE.Group();
    this.group.name = 'apron';
    this.t = 0;
    this.bridges = [];
    this.beacons = [];
    this.windows = [];

    this.mats = {
      concrete: new THREE.MeshStandardMaterial({ color: 0xb9bcc0, roughness: 0.9, metalness: 0.02 }),
      white: new THREE.MeshStandardMaterial({ color: 0xe8ecef, roughness: 0.6, metalness: 0.1 }),
      grey: new THREE.MeshStandardMaterial({ color: 0x8d949c, roughness: 0.55, metalness: 0.35 }),
      dark: new THREE.MeshStandardMaterial({ color: 0x2a3038, roughness: 0.7, metalness: 0.2 }),
      rubber: new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.95 }),
      glass: new THREE.MeshPhysicalMaterial({
        color: 0x9fc4dc,
        roughness: 0.08,
        metalness: 0.1,
        transparent: true,
        opacity: 0.42,
        side: THREE.DoubleSide,
      }),
      steel: new THREE.MeshStandardMaterial({ color: 0xa8b0b8, roughness: 0.4, metalness: 0.7 }),
      yellow: new THREE.MeshStandardMaterial({ color: 0xf2c53d, roughness: 0.6, metalness: 0.25 }),
      red: new THREE.MeshStandardMaterial({ color: 0xc23a2b, roughness: 0.6, metalness: 0.2 }),
      green: new THREE.MeshStandardMaterial({ color: 0x2f8f5b, roughness: 0.6, metalness: 0.2 }),
      roof: new THREE.MeshStandardMaterial({ map: roofTexture(), roughness: 0.9 }),
      panel: new THREE.MeshStandardMaterial({ map: panelTexture(), roughness: 0.6 }),
    };

    this.buildTerminal();
    this.buildStands();
    this.buildGroundVehicles();
    if (quality !== 'low') this.buildParkedAircraft();

    scene.add(this.group);
  }

  /* --------------------------------------------------------- terminal -- */

  /**
   * The terminal. Three storeys of glass facing the apron with a solid
   * service block behind, a cantilevered canopy over the kerb, and a
   * departures hall that lights up after dark.
   */
  buildTerminal() {
    const M = this.mats;
    const cx = -60;
    const cz = -212;
    // Enlarged. At 14 m the concourse was barely twice the height of the
    // airliner parked at it and shorter than the aeroplane was long, which is
    // what makes an aeroplane look like it is the size of a building.
    const W = 150;
    const D = 38;
    const H = 24;

    const wallTex = buildingTexture(0);
    wallTex.repeat.set(4, 1);
    const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.82, metalness: 0.05 });

    // Service block at the back: solid, taller, where the machinery lives.
    this.group.add(box(W * 0.86, H + 5, D * 0.5, wallMat, cx, ELEV + (H + 5) / 2, cz - D * 0.42));
    // Plant on its roof, so the skyline is not a flat line.
    for (let i = 0; i < 4; i++) {
      this.group.add(box(6, 2.4, 5, M.grey, cx - 28 + i * 18, ELEV + H + 6.4, cz - D * 0.42));
    }

    // The concourse itself.
    this.group.add(box(W, H, D, wallMat, cx, ELEV + H / 2, cz));

    // Glazed frontage facing the aeroplanes: mullions with glass between.
    const glazeZ = cz + D / 2 + 0.1;
    const bays = 24;
    for (let i = 0; i < bays; i++) {
      const x = cx - W / 2 + (i + 0.5) * (W / bays);
      const pane = new THREE.Mesh(new THREE.PlaneGeometry(W / bays - 0.5, H - 4.2), M.glass);
      pane.position.set(x, ELEV + H / 2 + 0.6, glazeZ);
      this.group.add(pane);
      // The lit hall behind the glass — one panel, brightened at night.
      const lit = new THREE.Mesh(
        new THREE.PlaneGeometry(W / bays - 0.5, H - 4.2),
        new THREE.MeshBasicMaterial({ color: 0xffe6b4, transparent: true, opacity: 0 })
      );
      lit.position.set(x, ELEV + H / 2 + 0.6, glazeZ - 0.25);
      this.group.add(lit);
      this.windows.push(lit.material);
      // Mullion.
      this.group.add(box(0.28, H - 3.6, 0.4, M.steel, x - W / bays / 2, ELEV + H / 2 + 0.6, glazeZ));
    }
    // Spandrel below the glass and a fascia above it.
    this.group.add(box(W, 2.6, 0.7, M.white, cx, ELEV + 1.3, glazeZ));
    this.group.add(box(W + 1.2, 2.0, 1.2, M.white, cx, ELEV + H - 0.6, glazeZ));

    // Solid: the concourse, the service block behind it, and the canopy.
    addObstacleAt(cx, cz, W, D, ELEV, H + 4, 'You flew into the terminal');
    addObstacleAt(cx, cz - D * 0.42, W * 0.86, D * 0.5, ELEV, H + 9, 'You flew into the terminal');

    /*
     * Roof: a shallow barrel, and this time actually shallow.
     *
     * It was a drum of radius 0.62 x depth — 23.6 m — sitting with its centre
     * at roof height, so its crown stood twenty-one metres above a
     * twenty-four metre building and its ends, which were capped, drew a pie
     * slice from that centre out to the full radius. That is the dark slab
     * hanging off the end of the terminal at an angle: not a bug in the arc,
     * a cylinder cap seen from outside.
     *
     * Built from the two numbers that actually describe a barrel vault
     * instead: how far apart the eaves are, and how far it rises between
     * them. The radius follows from those, the springing points land on the
     * long walls, and the crown sits a few metres above the parapet — which
     * is what a terminal roof looks like. Open-ended, because the caps were
     * the whole problem.
     */
    const rise = 3.6;
    const halfD = D / 2;
    const R = (halfD * halfD + rise * rise) / (2 * rise);
    const halfArc = Math.asin(Math.min(1, halfD / R));
    const roof = new THREE.Mesh(
      new THREE.CylinderGeometry(R, R, W + 1.2, 32, 1, true, Math.PI / 2 - halfArc, halfArc * 2),
      M.roof
    );
    roof.rotation.z = Math.PI / 2;
    // Centre placed so the eaves sit on the walls and the crown `rise` above.
    roof.position.set(cx, ELEV + H - R + rise, cz);
    roof.castShadow = roof.receiveShadow = true;
    this.group.add(roof);

    // Kerbside canopy on the landside, held up by columns.
    const canopy = box(W * 0.72, 0.6, 9, M.white, cx, ELEV + 6.4, cz - D / 2 - 5);
    this.group.add(canopy);
    for (let i = 0; i < 6; i++) {
      const x = cx - W * 0.3 + i * (W * 0.6) / 5;
      this.group.add(box(0.6, 6.2, 0.6, M.steel, x, ELEV + 3.1, cz - D / 2 - 8.4));
    }

    // Name board on the fascia.
    const board = box(26, 2.2, 0.3, M.dark, cx, ELEV + H + 1.6, glazeZ + 0.3);
    this.group.add(board);
    const letters = new THREE.Mesh(
      new THREE.PlaneGeometry(24, 1.5),
      new THREE.MeshBasicMaterial({ color: 0x7cc7ff, transparent: true, opacity: 0.9 })
    );
    letters.position.set(cx, ELEV + H + 1.6, glazeZ + 0.47);
    this.group.add(letters);
    this.beacons.push({ mat: letters.material, base: 0.55, night: 0.95 });
  }

  /* ----------------------------------------------------------- stands -- */

  /**
   * Three stands with air bridges. The bridge is a tunnel on a lifting column
   * with a rotunda at the terminal end and a cab at the aeroplane end — which
   * is what makes it read as a jetway rather than a plank.
   */
  buildStands() {
    const M = this.mats;
    this.stands = [
      { x: -140, z: -178, ac: 'meridian' },
      { x: -60, z: -178, ac: 'courier' },
      { x: 10, z: -178, ac: null },
    ];

    for (let i = 0; i < this.stands.length; i++) {
      const st = this.stands[i];
      const g = new THREE.Group();

      // Rotunda at the terminal wall.
      const rot = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.6, 5.6, 14), M.grey);
      rot.position.set(st.x, ELEV + 4.4, -199);
      rot.castShadow = true;
      g.add(rot);

      // Tunnel: two telescoping sections, so it looks like it can move.
      const tunnelA = box(3.4, 3.2, 13, M.white, st.x, ELEV + 5.2, -192);
      const tunnelB = box(3.0, 2.9, 11, M.grey, st.x, ELEV + 5.2, -181.5);
      g.add(tunnelA, tunnelB);
      // Window strip down the side of the tunnel.
      for (const side of [-1, 1]) {
        const strip = new THREE.Mesh(new THREE.PlaneGeometry(22, 0.9), M.glass);
        strip.position.set(st.x + side * 1.72, ELEV + 5.9, -186.5);
        strip.rotation.y = side * Math.PI * 0.5;
        g.add(strip);
      }

      // Lifting column and wheels under the moving end.
      g.add(box(1.1, 4.4, 1.1, M.steel, st.x, ELEV + 2.2, -177));
      const bogie = new THREE.Group();
      bogie.position.set(st.x, ELEV, -177);
      wheeled(bogie, [[-1.5, 0], [1.5, 0]], 0.62, 0.5, M.rubber);
      g.add(bogie);

      // Cab at the aeroplane end, angled to meet a door.
      const cab = box(3.6, 3.4, 3.2, M.white, st.x, ELEV + 5.0, -175.4);
      g.add(cab);
      const bellows = box(3.9, 3.6, 0.8, M.dark, st.x, ELEV + 5.0, -173.8);
      g.add(bellows);

      // Stand number, painted on the concrete.
      const num = new THREE.Mesh(
        new THREE.PlaneGeometry(6, 6),
        new THREE.MeshBasicMaterial({ color: 0xf2e14a, transparent: true, opacity: 0.55 })
      );
      num.rotation.x = -Math.PI / 2;
      num.position.set(st.x, ELEV + 0.07, -160);
      g.add(num);

      // Lead-in line: the yellow line a pilot follows onto the stand.
      const line = new THREE.Mesh(
        new THREE.PlaneGeometry(0.5, 36),
        new THREE.MeshBasicMaterial({ color: 0xf2c53d, transparent: true, opacity: 0.85 })
      );
      line.rotation.x = -Math.PI / 2;
      line.position.set(st.x, ELEV + 0.07, -152);
      g.add(line);
      // The stop bar across it.
      const stop = new THREE.Mesh(
        new THREE.PlaneGeometry(7, 0.6),
        new THREE.MeshBasicMaterial({ color: 0xe24d3a, transparent: true, opacity: 0.9 })
      );
      stop.rotation.x = -Math.PI / 2;
      stop.position.set(st.x, ELEV + 0.07, -168);
      g.add(stop);

      this.group.add(g);
      this.bridges.push(g);
    }
  }

  /* -------------------------------------------------- parked aircraft -- */

  /** Aeroplanes on the stands, from the same fleet you fly. */
  buildParkedAircraft() {
    this.stands.forEach((st, standIndex) => {
      if (!st.ac) return;
      const type = getAircraft(st.ac);
      /*
       * Park them in different airlines' colours.
       *
       * An apron where every aeroplane wears the same paint looks like a
       * factory, not an airport. The scheme is picked from the stand index so
       * it is stable across rebuilds rather than shuffling every time the
       * world is built.
       */
      const painted = LIVERIES.filter((l) => !l.house);
      const scheme = painted.length ? painted[standIndex % painted.length] : null;
      const model = createAircraftModel({ type, livery: scheme || schemeFor(type, 'house') });
      // Nose in to the stand, which is why the air bridge reaches where it does.
      model.position.set(st.x, ELEV + 1.5 * type.shape.scale, st.z + 6);
      model.rotation.y = Math.PI; // facing the terminal
      // Parked: everything still, lights out, wheels on the ground.
      model.userData.update(
        0.016,
        {
          controls: { pitch: 0, roll: 0, yaw: 0, throttle: 0, brakes: 1 },
          rpm: 0,
          flaps: 0,
          gearPos: 1,
          gearDown: true,
          onGround: true,
          groundSpeed: 0,
          agl: 0,
          engineOn: false,
        },
        { isNight: false, cond: { cloud: 0 } }
      );
      this.group.add(model);
    });
  }

  /* --------------------------------------------------- ground vehicles -- */

  buildGroundVehicles() {
    const M = this.mats;

    /* ---- Pushback tug: low, flat, with a wedge nose ---- */
    const tug = new THREE.Group();
    tug.position.set(-140, ELEV, -158);
    const tugBody = box(5.2, 1.1, 2.6, M.yellow, 0, 1.0, 0);
    tug.add(tugBody);
    // Sloped front so it can get under a nose leg.
    const wedge = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 2.5, 3), M.yellow);
    wedge.rotation.z = Math.PI / 2;
    wedge.rotation.x = Math.PI / 2;
    wedge.position.set(-3.1, 0.85, 0);
    tug.add(wedge);
    const tugCab = box(1.8, 1.5, 2.2, M.panel, 1.4, 2.3, 0);
    tug.add(tugCab);
    tug.add(box(2.0, 0.12, 2.4, M.dark, 1.4, 3.1, 0)); // cab roof
    wheeled(tug, [[-1.8, -1.2], [-1.8, 1.2], [1.8, -1.2], [1.8, 1.2]], 0.52, 0.42, M.rubber);
    this.group.add(tug);
    this.tug = tug;

    /* ---- Fuel bowser: a proper cylindrical tank ---- */
    const bowser = new THREE.Group();
    bowser.position.set(-104, ELEV, -156);
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 7.5, 18), M.white);
    tank.rotation.z = Math.PI / 2;
    tank.position.set(0.6, 2.1, 0);
    tank.castShadow = true;
    bowser.add(tank);
    // Domed ends.
    for (const ex of [-3.15, 4.35]) {
      const cap = new THREE.Mesh(new THREE.SphereGeometry(1.5, 14, 10), M.white);
      cap.scale.set(0.4, 1, 1);
      cap.position.set(ex, 2.1, 0);
      bowser.add(cap);
    }
    bowser.add(box(2.6, 2.0, 2.4, M.panel, -4.2, 1.9, 0)); // cab
    bowser.add(box(1.2, 1.4, 0.9, M.red, 3.2, 1.5, 1.5)); // hose cabinet
    // Hose, coiled on a reel.
    const reel = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.18, 8, 18), M.dark);
    reel.position.set(3.2, 1.6, 1.95);
    bowser.add(reel);
    wheeled(bowser, [[-3.4, -1.3], [-3.4, 1.3], [1.6, -1.3], [1.6, 1.3], [3.4, -1.3], [3.4, 1.3]], 0.66, 0.5, M.rubber);
    this.group.add(bowser);

    /* ---- Baggage train: a tractor and three carts ---- */
    const train = new THREE.Group();
    train.position.set(-60, ELEV, -152);
    const tractor = new THREE.Group();
    tractor.add(box(2.8, 1.0, 1.8, M.green, 0, 0.9, 0));
    tractor.add(box(1.4, 1.3, 1.6, M.panel, 0.3, 2.0, 0));
    wheeled(tractor, [[-0.9, -0.85], [-0.9, 0.85], [0.9, -0.85], [0.9, 0.85]], 0.42, 0.34, M.rubber);
    train.add(tractor);
    for (let i = 0; i < 3; i++) {
      const cart = new THREE.Group();
      cart.position.x = -3.4 - i * 3.2;
      cart.add(box(2.6, 0.5, 1.8, M.grey, 0, 0.95, 0)); // bed
      // Canvas top on a frame, which is what a baggage cart actually looks like.
      cart.add(box(2.6, 1.3, 1.85, M.white, 0, 1.85, 0));
      for (const cx2 of [-1.25, 1.25]) cart.add(box(0.1, 1.3, 0.1, M.steel, cx2, 1.85, 0));
      wheeled(cart, [[-0.9, -0.8], [-0.9, 0.8], [0.9, -0.8], [0.9, 0.8]], 0.34, 0.3, M.rubber);
      // Drawbar to the one in front.
      cart.add(box(0.9, 0.12, 0.12, M.dark, 1.75, 0.6, 0));
      train.add(cart);
    }
    this.group.add(train);
    this.train = train;

    /* ---- Catering lift: box body raised on a scissor ---- */
    const cater = new THREE.Group();
    cater.position.set(10, ELEV, -158);
    cater.add(box(2.6, 2.0, 2.4, M.panel, -3.4, 1.9, 0)); // cab
    const bodyLift = new THREE.Group();
    bodyLift.position.y = 3.2;
    bodyLift.add(box(6.0, 2.8, 2.6, M.white, 0.8, 1.4, 0));
    bodyLift.add(box(0.2, 2.4, 2.3, M.dark, 3.85, 1.4, 0)); // door at the front
    cater.add(bodyLift);
    // Scissor legs — two crossed struts, so it reads as a lift.
    for (const side of [-1, 1]) {
      for (const lean of [-1, 1]) {
        const strut = box(3.6, 0.16, 0.16, M.steel, 0.8, 1.7, side * 1.1);
        strut.rotation.z = lean * 0.6;
        cater.add(strut);
      }
    }
    wheeled(cater, [[-2.6, -1.2], [-2.6, 1.2], [2.4, -1.2], [2.4, 1.2]], 0.6, 0.46, M.rubber);
    this.group.add(cater);

    /* ---- Ground power unit and a set of steps, to fill the stand ---- */
    const gpu = new THREE.Group();
    gpu.position.set(-152, ELEV, -166);
    gpu.add(box(2.2, 1.4, 1.4, M.yellow, 0, 1.0, 0));
    wheeled(gpu, [[-0.7, -0.6], [-0.7, 0.6], [0.7, -0.6], [0.7, 0.6]], 0.3, 0.26, M.rubber);
    this.group.add(gpu);

    const steps = new THREE.Group();
    steps.position.set(28, ELEV, -170);
    steps.rotation.y = 0.4;
    for (let i = 0; i < 9; i++) {
      steps.add(box(1.8, 0.14, 0.34, M.steel, 0, 0.5 + i * 0.34, -i * 0.36));
    }
    steps.add(box(2.0, 0.12, 1.6, M.steel, 0, 3.6, -3.2)); // platform
    for (const side of [-1, 1]) {
      steps.add(box(0.08, 1.0, 3.6, M.steel, side * 0.95, 3.0, -1.7));
    }
    wheeled(steps, [[-0.7, 0.2], [0.7, 0.2]], 0.34, 0.3, M.rubber);
    this.group.add(steps);
  }

  /* ----------------------------------------------------------- update -- */

  update(dt, weather) {
    this.t += dt;
    const night = weather && (weather.isNight || weather.cond.cloud > 0.8);
    // The hall lights up when it gets dark. Staggering the panels by a hair
    // stops it reading as one glowing rectangle.
    for (let i = 0; i < this.windows.length; i++) {
      const flicker = 0.86 + Math.sin(this.t * 0.3 + i) * 0.14;
      this.windows[i].opacity = night ? 0.72 * flicker : 0.06;
    }
    for (const b of this.beacons) b.mat.opacity = night ? b.night : b.base;
  }
}
