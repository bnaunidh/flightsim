/**
 * Kestrel Island Airfield — runway 09/27, taxiway, apron, terminal, control
 * tower, hangars, windsock, runway/approach lighting and a working PAPI.
 *
 * The PAPI (those four lights beside the runway) is the friendliest landing aid
 * there is: two white and two red means you are on a perfect glide path, and the
 * tutorial teaches exactly that.
 */

import * as THREE from '../vendor/three.module.js';
import { AIRPORT, heightAt, addObstacleAt } from './terrain.js';
import {
  runwayTexture,
  asphaltTexture,
  asphaltNormal,
  buildingTexture,
  hangarTexture,
  roofTexture,
  panelTexture,
} from '../render/textures.js';

/*
 * Field elevation.
 *
 * This was `const ELEV = AIRPORT.elev` — read once, at import, when AIRPORT is
 * still Kestrel's. Every other map then built its airport at Kestrel's height:
 * ten metres out at the three real fields, and 286 m out at the air base,
 * where the runway paint, the tower and every mission's touchdown point sat
 * underground while the aeroplane stood on the ground above them.
 *
 * `let`, refreshed by refreshRunways(), which main.js calls after applyMap().
 */
let ELEV = AIRPORT.elev;

/**
 * Re-read the field from whichever map is now loaded.
 *
 * RUNWAY and RUNWAY2 are mutated in place rather than replaced, because the
 * missions and the ATC director hold references to them and to the Vector3s
 * inside them — handing out new objects would leave every one of those
 * pointing at the old field.
 */
export function refreshRunways() {
  ELEV = AIRPORT.elev;

  Object.assign(RUNWAY, AIRPORT.runway, { elev: ELEV, headingDeg: AIRPORT.headingDeg ?? 90 });
  const halfLen = AIRPORT.runway.length / 2;
  /*
   * The aiming point, 200 m in from the westerly threshold.
   *
   * That is where it has always been on Kestrel (threshold -550, touchdown
   * -350) and it is what the tutorial, the missions and the landing grade are
   * all written around — so it is kept as a fixed distance from the threshold
   * rather than a fraction of the runway, which would move it on every map
   * with a different length.
   */
  RUNWAY.touchdown.set(AIRPORT.runway.cx - halfLen + 200, ELEV, AIRPORT.runway.cz);
  RUNWAY.thresholdWest.set(AIRPORT.runway.cx - halfLen, ELEV, AIRPORT.runway.cz);
  RUNWAY.thresholdEast.set(AIRPORT.runway.cx + halfLen, ELEV, AIRPORT.runway.cz);

  const r2 = AIRPORT.runway2;
  if (r2) {
    Object.assign(RUNWAY2, r2, { elev: ELEV });
    RUNWAY2.thresholdNorth.set(r2.cx, ELEV, r2.cz - r2.length / 2);
    RUNWAY2.thresholdSouth.set(r2.cx, ELEV, r2.cz + r2.length / 2);
  }
  return ELEV;
}
/** The crosswind runway, 18/36. */
export const RUNWAY2 = {
  ...AIRPORT.runway2,
  elev: ELEV,
  // 18 is flown southbound (+Z), 36 northbound.
  thresholdNorth: new THREE.Vector3(AIRPORT.runway2.cx, ELEV, AIRPORT.runway2.cz - AIRPORT.runway2.length / 2),
  thresholdSouth: new THREE.Vector3(AIRPORT.runway2.cx, ELEV, AIRPORT.runway2.cz + AIRPORT.runway2.length / 2),
};

export const RUNWAY = {
  ...AIRPORT.runway,
  elev: ELEV,
  headingDeg: 90,
  // Aiming point for a runway 09 (westerly) approach.
  touchdown: new THREE.Vector3(-350, ELEV, 0),
  thresholdWest: new THREE.Vector3(-550, ELEV, 0),
  thresholdEast: new THREE.Vector3(550, ELEV, 0),
};

function pavementMaterial(repeatX, repeatY) {
  const map = asphaltTexture().clone();
  map.needsUpdate = true;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(repeatX, repeatY);
  const nrm = asphaltNormal().clone();
  nrm.needsUpdate = true;
  nrm.wrapS = nrm.wrapT = THREE.RepeatWrapping;
  nrm.repeat.set(repeatX, repeatY);
  return new THREE.MeshStandardMaterial({
    map,
    normalMap: nrm,
    normalScale: new THREE.Vector2(0.7, 0.7),
    roughness: 0.92,
    metalness: 0.02,
  });
}

function slab(w, d, x, z, y, mat, rotY = 0) {
  const geo = new THREE.PlaneGeometry(w, d);
  geo.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.y = rotY;
  m.receiveShadow = true;
  return m;
}

export class Airport {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.name = 'airport';
    this.t = 0;
    this.lightsOn = false;

    this.buildPavement();
    this.buildBuildings();
    this.buildWindsock();
    this.buildLighting();
    this.buildClutter();

    scene.add(this.group);
  }

  buildPavement() {
    // Runway. The texture's long axis is rotated onto the world X axis so the
    // painted numbers, threshold bars and centreline land where they belong.
    const rwTex = runwayTexture();
    const rwMat = new THREE.MeshStandardMaterial({
      map: rwTex,
      normalMap: asphaltNormal(),
      normalScale: new THREE.Vector2(0.45, 0.45),
      roughness: 0.9,
      metalness: 0.02,
    });
    this.runwayMat = rwMat;
    const rgeo = new THREE.PlaneGeometry(RUNWAY.halfWidth * 2, RUNWAY.length);
    rgeo.rotateX(-Math.PI / 2);
    const runway = new THREE.Mesh(rgeo, rwMat);
    runway.rotation.y = Math.PI / 2;
    runway.position.set(RUNWAY.cx, ELEV + 0.06, RUNWAY.cz);
    runway.receiveShadow = true;
    this.group.add(runway);

    // Slightly raised shoulder so the runway does not look pasted on.
    const shoulderMat = pavementMaterial(40, 6);
    this.group.add(slab(RUNWAY.length + 40, 62, 0, 0, ELEV + 0.02, shoulderMat));

    // --- The crosswind runway, 18/36 ---
    /*
     * Same texture. The plane comes out of PlaneGeometry lying length-along-Z,
     * which is heading 180 — 18/36's own heading, and the reason this looked
     * right for as long as every second runway was north-south.
     *
     * It was never turned, though. The main runway above gets a rotation.y and
     * this one got none at all, so at Los Angeles, where the second runway is
     * parallel to the first rather than across it, the painted centreline, the
     * numbers and the threshold bars were all laid at right angles to the
     * tarmac they belong to. Turn it by its own heading, the same way round as
     * the main runway does.
     */
    const r2 = RUNWAY2;
    const r2geo = new THREE.PlaneGeometry(r2.halfWidth * 2, r2.length);
    r2geo.rotateX(-Math.PI / 2);
    const r2rot = THREE.MathUtils.degToRad(180 - (r2.headingDeg ?? 180));
    const runway2 = new THREE.Mesh(r2geo, rwMat);
    runway2.rotation.y = r2rot;
    runway2.position.set(r2.cx, ELEV + 0.055, r2.cz);
    runway2.receiveShadow = true;
    this.group.add(runway2);
    // The shoulder has to follow it round, or it lies across the runway.
    this.group.add(slab(56, r2.length + 40, r2.cx, r2.cz, ELEV + 0.02, shoulderMat, r2rot));

    const taxiMat = pavementMaterial(40, 3);
    this.group.add(slab(880, 24, 0, -95, ELEV + 0.05, taxiMat));
    this.group.add(slab(24, 95, -430, -47, ELEV + 0.05, taxiMat));
    this.group.add(slab(24, 95, 0, -47, ELEV + 0.05, taxiMat));

    const apronMat = pavementMaterial(18, 6);
    // Depth reaches the taxiway edge — see isPaved() in terrain.js.
    this.group.add(slab(360, 84, -80, -148, ELEV + 0.05, apronMat));

    // Yellow taxi centreline paint.
    const paint = new THREE.MeshBasicMaterial({ color: 0xd9c02a, transparent: true, opacity: 0.85 });
    const stripe = (w, d, x, z) => {
      const g = new THREE.PlaneGeometry(w, d);
      g.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(g, paint);
      m.position.set(x, ELEV + 0.07, z);
      this.group.add(m);
    };
    // A link from the parallel taxiway up to the 36 threshold, so the second
    // runway can actually be taxied to rather than admired from a distance.
    this.group.add(slab(24, 120, r2.cx, -160, ELEV + 0.05, taxiMat));
    stripe(0.7, 120, r2.cx, -160);
    stripe(860, 0.7, 0, -95);
    stripe(0.7, 95, -430, -47);
    stripe(0.7, 95, 0, -47);
    for (let i = 0; i < 4; i++) stripe(0.7, 60, -220 + i * 90, -140);
  }

  buildBuildings() {
    const terminalTex = buildingTexture(0);
    terminalTex.repeat.set(3, 1);
    const terminalMat = new THREE.MeshStandardMaterial({
      map: terminalTex,
      roughness: 0.8,
      metalness: 0.05,
    });
    const roofMat = new THREE.MeshStandardMaterial({
      map: roofTexture(),
      roughness: 0.9,
    });

    // The terminal is built in apron.js, with glass, a canopy and air bridges.

    // Control tower: shaft + glazed cab + railing.
    const shaftMat = new THREE.MeshStandardMaterial({
      map: buildingTexture(2),
      roughness: 0.85,
    });
    // The shaft, with a stair tower up the back of it and ribs down its
    // length so it is not a bare pipe.
    const TX = 40;
    const TZ = -206;
    // Raised from 26 m. Beside a 22 m airliner the old tower barely cleared
    // the tail, and a control tower that an aeroplane can look level at does
    // not read as a control tower.
    /*
     * Tower height.
     *
     * 42 m put the cab barely above the terminal roof, which is the wrong way
     * round — a control tower has to see over everything on the field, and
     * from the air it read as just another building. Real regional towers run
     * 50-70 m; 64 puts the cab well clear of the 28 m terminal and makes it
     * the landmark you actually navigate by.
     */
    const TOWER_H = 64;
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(4.6, 6.4, TOWER_H, 20), shaftMat);
    shaft.position.set(TX, ELEV + TOWER_H / 2, TZ);
    shaft.castShadow = shaft.receiveShadow = true;
    this.group.add(shaft);
    const stairs = new THREE.Mesh(new THREE.BoxGeometry(3.6, TOWER_H, 3.6), shaftMat);
    stairs.position.set(TX, ELEV + TOWER_H / 2, TZ - 6.2);
    stairs.castShadow = stairs.receiveShadow = true;
    this.group.add(stairs);
    const concreteMat = new THREE.MeshStandardMaterial({ color: 0xc3c7cb, roughness: 0.85 });
    for (let i = 0; i < 5; i++) {
      const band = new THREE.Mesh(new THREE.CylinderGeometry(4.5 + i * 0.06, 4.6 + i * 0.06, 0.5, 20), concreteMat);
      band.position.set(TX, ELEV + TOWER_H - 2 - i * 7, TZ);
      this.group.add(band);
    }
    // Flared base, so it looks like it is holding something up.
    const base = new THREE.Mesh(new THREE.CylinderGeometry(6.4, 9.4, 4, 20), concreteMat);
    base.position.set(TX, ELEV + 2, TZ);
    base.receiveShadow = true;
    this.group.add(base);
    // Solid, all the way up to the cab.
    addObstacleAt(TX, TZ, 16, 16, ELEV, TOWER_H + 11, 'You flew into the control tower');

    // The gallery the cab sits on, with a railing round it.
    const steelMat = new THREE.MeshStandardMaterial({ color: 0xa8b0b8, roughness: 0.4, metalness: 0.7 });
    const gallery = new THREE.Mesh(new THREE.CylinderGeometry(11.4, 11.4, 0.5, 20), concreteMat);
    gallery.position.set(TX, ELEV + TOWER_H - 0.6, TZ);
    gallery.castShadow = true;
    this.group.add(gallery);
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * Math.PI * 2;
      const postG = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 1.1, 6), steelMat);
      postG.position.set(TX + Math.cos(a) * 11.1, ELEV + TOWER_H + 0.2, TZ + Math.sin(a) * 11.1);
      this.group.add(postG);
    }
    const rail = new THREE.Mesh(new THREE.TorusGeometry(11.1, 0.06, 6, 32), steelMat);
    rail.rotation.x = Math.PI / 2;
    rail.position.set(TX, ELEV + TOWER_H + 0.7, TZ);
    this.group.add(rail);

    // Cab. Real tower glass slopes outwards at the bottom so the controllers
    // can look straight down at the apron without reflections in the way —
    // which is why the cab is wider at the top than the bottom.
    const cabMat = new THREE.MeshPhysicalMaterial({
      color: 0x9fd8ef,
      roughness: 0.05,
      metalness: 0.25,
      transparent: true,
      opacity: 0.5,
      side: THREE.DoubleSide,
    });
    const cab = new THREE.Mesh(new THREE.CylinderGeometry(9.4, 7.6, 7, 16, 1, true), cabMat);
    cab.position.set(TX, ELEV + TOWER_H + 3.4, TZ);
    cab.castShadow = true;
    this.group.add(cab);
    // Mullions between the panes.
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const mull = new THREE.Mesh(new THREE.BoxGeometry(0.16, 7.2, 0.3), steelMat);
      const r = 8.5;
      mull.position.set(TX + Math.cos(a) * r, ELEV + TOWER_H + 3.4, TZ + Math.sin(a) * r);
      mull.rotation.y = -a;
      mull.rotation.x = 0.12; // follow the slope of the glass
      this.group.add(mull);
    }
    // The lit room inside, so there is obviously somebody up there at night.
    const roomMat = new THREE.MeshBasicMaterial({ color: 0x9fd0a8, transparent: true, opacity: 0.12 });
    const room = new THREE.Mesh(new THREE.CylinderGeometry(7.4, 6.6, 6.4, 16), roomMat);
    room.position.set(TX, ELEV + TOWER_H + 3.2, TZ);
    this.group.add(room);
    this.towerRoom = room.material;
    // Consoles round the inside edge.
    const deskMat = new THREE.MeshStandardMaterial({ color: 0x2b3138, roughness: 0.7 });
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const desk = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.0, 1.4), deskMat);
      desk.position.set(TX + Math.cos(a) * 6.2, ELEV + TOWER_H + 0.6, TZ + Math.sin(a) * 6.2);
      desk.rotation.y = -a;
      this.group.add(desk);
    }

    // Roof: a shallow cone with an overhanging brow that shades the glass.
    const cabRoof = new THREE.Mesh(new THREE.ConeGeometry(10.6, 2.2, 16), roofMat);
    cabRoof.position.set(TX, ELEV + TOWER_H + 8, TZ);
    cabRoof.castShadow = true;
    this.group.add(cabRoof);
    const brow = new THREE.Mesh(new THREE.CylinderGeometry(10.8, 10.8, 0.4, 16), concreteMat);
    brow.position.set(TX, ELEV + TOWER_H + 7, TZ);
    this.group.add(brow);

    // Mast, aerials and the radar dish on top.
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 6, 8), steelMat);
    mast.position.set(TX, ELEV + TOWER_H + 12, TZ);
    this.group.add(mast);
    for (const [ax, az, len] of [[1.6, 0, 2.2], [-1.6, 0, 2.0], [0, 1.6, 1.8]]) {
      const aerial = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, len, 6), steelMat);
      aerial.position.set(TX + ax, ELEV + TOWER_H + 10.5, TZ + az);
      this.group.add(aerial);
    }
    const dish = new THREE.Mesh(
      new THREE.SphereGeometry(1.5, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.45),
      new THREE.MeshStandardMaterial({ color: 0xdfe3e7, roughness: 0.45, metalness: 0.3, side: THREE.DoubleSide })
    );
    dish.position.set(TX, ELEV + TOWER_H + 9.6, TZ);
    dish.rotation.x = Math.PI * 0.72;
    this.group.add(dish);
    this.towerDish = dish;

    const beacon = new THREE.Mesh(
      new THREE.SphereGeometry(0.9, 10, 8),
      new THREE.MeshBasicMaterial({ color: 0x35ff6a })
    );
    beacon.position.set(TX, ELEV + TOWER_H + 15.2, TZ);
    this.group.add(beacon);
    this.beacon = beacon;

    // Hangars: corrugated arch sheds with open fronts.
    const hangarMat = new THREE.MeshStandardMaterial({
      map: hangarTexture(),
      roughness: 0.68,
      metalness: 0.35,
      side: THREE.DoubleSide,
    });
    const hangarTexRepeat = hangarMat.map.clone();
    hangarTexRepeat.needsUpdate = true;
    hangarTexRepeat.wrapS = hangarTexRepeat.wrapT = THREE.RepeatWrapping;
    hangarTexRepeat.repeat.set(4, 2);
    hangarMat.map = hangarTexRepeat;

    for (let i = 0; i < 2; i++) {
      const x = -250 + i * 150;
      // Bigger: an 18 m arch is only three times the height of the airliner
      // that is supposed to fit inside it. And solid — you cannot fly through
      // a hangar any more.
      const HANGAR_R = 26;
      const HANGAR_L = 62;
      addObstacleAt(x, -250, HANGAR_R * 2, HANGAR_L, ELEV, HANGAR_R, 'You flew into a hangar');
      const arch = new THREE.Mesh(
        new THREE.CylinderGeometry(HANGAR_R, HANGAR_R, HANGAR_L, 20, 1, true, 0, Math.PI),
        hangarMat
      );
      arch.rotation.z = Math.PI / 2;
      arch.rotation.y = Math.PI / 2;
      arch.position.set(x, ELEV + 0.2, -250);
      arch.castShadow = arch.receiveShadow = true;
      this.group.add(arch);
      // Back wall.
      const back = new THREE.Mesh(new THREE.CircleGeometry(HANGAR_R, 20, 0, Math.PI), hangarMat);
      back.position.set(x, ELEV + 0.2, -250 - HANGAR_L / 2);
      back.castShadow = true;
      this.group.add(back);
      // Dark interior so the opening does not look like a hole in the sky.
      const inner = new THREE.Mesh(
        new THREE.CircleGeometry(HANGAR_R - 0.4, 20, 0, Math.PI),
        new THREE.MeshBasicMaterial({ color: 0x14171c })
      );
      inner.position.set(x, ELEV + 0.2, -250 - HANGAR_L / 2 + 0.5);
      this.group.add(inner);
    }

    // Fuel farm.
    const tankMat = new THREE.MeshStandardMaterial({ color: 0xd8dbe0, roughness: 0.45, metalness: 0.6 });
    for (let i = 0; i < 2; i++) {
      const tank = new THREE.Mesh(new THREE.CylinderGeometry(5, 5, 12, 18), tankMat);
      tank.rotation.z = Math.PI / 2;
      tank.position.set(120 + i * 16, ELEV + 5, -250);
      tank.castShadow = tank.receiveShadow = true;
      this.group.add(tank);
    }
  }

  buildWindsock() {
    const g = new THREE.Group();
    const poleMat = new THREE.MeshStandardMaterial({ color: 0xbfc4c9, roughness: 0.5, metalness: 0.6 });
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.28, 9, 10), poleMat);
    pole.position.y = 4.5;
    pole.castShadow = true;
    g.add(pole);

    // Striped sock, built from alternating cone frustums.
    this.sockPivot = new THREE.Group();
    this.sockPivot.position.y = 9;
    g.add(this.sockPivot);
    const colors = [0xf05a28, 0xf2f2f2, 0xf05a28, 0xf2f2f2, 0xf05a28];
    let z = 0;
    for (let i = 0; i < colors.length; i++) {
      const r0 = 1.05 - i * 0.13;
      const r1 = 1.05 - (i + 1) * 0.13;
      const seg = new THREE.Mesh(
        new THREE.CylinderGeometry(r1, r0, 1.3, 12, 1, true),
        new THREE.MeshStandardMaterial({
          color: colors[i],
          roughness: 0.75,
          side: THREE.DoubleSide,
        })
      );
      seg.rotation.x = Math.PI / 2;
      seg.position.z = z + 0.65;
      z += 1.3;
      this.sockPivot.add(seg);
    }

    g.position.set(-500, heightAt(-500, -60), -60);
    this.group.add(g);
    this.windsock = g;
  }

  buildLighting() {
    // Runway edge lights + threshold lights, drawn as small emissive spheres
    // with an additive glow sprite each. Instanced, so it stays cheap.
    const positions = [];
    const colors = [];
    const step = 60;
    for (let x = -RUNWAY.length / 2; x <= RUNWAY.length / 2 + 1; x += step) {
      for (const z of [-RUNWAY.halfWidth - 1.5, RUNWAY.halfWidth + 1.5]) {
        // Last 600 m of runway 09 shows amber, like the real thing.
        const amber = x > RUNWAY.length / 2 - 300;
        positions.push([x, ELEV + 0.45, z]);
        colors.push(amber ? new THREE.Color(0xffb347) : new THREE.Color(0xfff4de));
      }
    }
    // Thresholds: green on the approach end, red on the far end.
    for (let i = -2; i <= 2; i++) {
      positions.push([-RUNWAY.length / 2 - 2, ELEV + 0.45, i * 7]);
      colors.push(new THREE.Color(0x2bff6a));
      positions.push([RUNWAY.length / 2 + 2, ELEV + 0.45, i * 7]);
      colors.push(new THREE.Color(0xff3b30));
    }
    // Approach lead-in lights out over the water for runway 09.
    for (let i = 1; i <= 8; i++) {
      positions.push([-RUNWAY.length / 2 - i * 60, ELEV + 0.6, 0]);
      colors.push(new THREE.Color(0xffffff));
    }

    const geo = new THREE.SphereGeometry(0.42, 6, 5);
    const mat = new THREE.MeshBasicMaterial({ vertexColors: false, color: 0xffffff });
    const inst = new THREE.InstancedMesh(geo, mat, positions.length);
    const dummy = new THREE.Object3D();
    inst.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(positions.length * 3), 3);
    positions.forEach((p, i) => {
      dummy.position.set(p[0], p[1], p[2]);
      dummy.updateMatrix();
      inst.setMatrixAt(i, dummy.matrix);
      inst.setColorAt(i, colors[i]);
    });
    inst.instanceMatrix.needsUpdate = true;
    inst.instanceColor.needsUpdate = true;
    inst.visible = false;
    this.group.add(inst);
    this.runwayLights = inst;

    // Glow halos (additive) so lights read from far away at night.
    const glowTex = makeGlowTexture();
    const glowMat = new THREE.SpriteMaterial({
      map: glowTex,
      color: 0xfff0cf,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
      opacity: 0.85,
    });
    this.glowGroup = new THREE.Group();
    positions.forEach((p, i) => {
      const s = new THREE.Sprite(glowMat.clone());
      s.material.color.copy(colors[i]);
      s.position.set(p[0], p[1], p[2]);
      s.scale.setScalar(7);
      this.glowGroup.add(s);
    });
    this.glowGroup.visible = false;
    this.group.add(this.glowGroup);

    /*
     * PAPI: four lights abreast the aiming point, out on the grass to the left
     * of runway 09.
     *
     * Both coordinates used to be written out as numbers — x -350 and z -32 —
     * and both of those are Kestrel's: its touchdown point 200 m in from the
     * threshold, and its 17 m half-width plus 15 m of grass. Ironhead's runway
     * is 3,200 m long and 68 m wide, so on that map -350 is more than a
     * kilometre past the threshold and -32 is still inside the edge: four
     * light boxes standing in the middle of the landing surface, well down the
     * roll-out from where its real aiming point is. updatePapi() measures the
     * glide angle to RUNWAY.touchdown, so the lights have to be measured off
     * the same runway rather than off Kestrel's.
     */
    this.papi = [];
    const papiX = RUNWAY.touchdown.x;
    const papiZ = RUNWAY.cz - RUNWAY.halfWidth - 15;
    const papiGroup = new THREE.Group();
    for (let i = 0; i < 4; i++) {
      const box = new THREE.Mesh(
        new THREE.BoxGeometry(2.4, 1.5, 1.6),
        new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.6 })
      );
      box.position.set(papiX, ELEV + 0.75, papiZ - i * 6);
      box.castShadow = true;
      papiGroup.add(box);
      const lens = new THREE.Mesh(
        new THREE.CircleGeometry(0.62, 12),
        new THREE.MeshBasicMaterial({ color: 0xffffff })
      );
      lens.position.set(papiX - 1.3, ELEV + 0.85, papiZ - i * 6);
      lens.rotation.y = -Math.PI / 2;
      papiGroup.add(lens);
      const glow = new THREE.Sprite(glowMat.clone());
      glow.position.copy(lens.position);
      glow.scale.setScalar(6);
      papiGroup.add(glow);
      this.papi.push({ lens, glow });
    }
    this.group.add(papiGroup);
  }

  buildClutter() {
    // Baggage carts, cones and a fuel truck — small props that make the apron
    // feel used rather than empty.
    const coneMat = new THREE.MeshStandardMaterial({ color: 0xf0561d, roughness: 0.8 });
    for (let i = 0; i < 14; i++) {
      const c = new THREE.Mesh(new THREE.ConeGeometry(0.45, 1.1, 8), coneMat);
      c.position.set(-240 + i * 26, ELEV + 0.55, -118);
      c.castShadow = true;
      this.group.add(c);
    }
    // The service vehicles used to be here as a box on four cylinders. They
    // are in apron.js now, built as things with a shape.
  }

  /** Toggle the airfield lighting (night / low visibility). */
  setLightsOn(on) {
    if (this.lightsOn === on) return;
    this.lightsOn = on;
    this.runwayLights.visible = on;
    this.glowGroup.visible = on;
    // Somebody is on duty up there whatever the hour, and at night you can
    // see them.
    if (this.towerRoom) this.towerRoom.opacity = on ? 0.4 : 0.12;
  }

  /**
   * Update the PAPI from the aircraft position: it compares the actual glide
   * angle to the ideal 3° and lights red/white accordingly.
   * Returns a short human hint for the HUD.
   */
  updatePapi(aircraftPos) {
    const td = RUNWAY.touchdown;
    const dx = td.x - aircraftPos.x;
    const dz = td.z - aircraftPos.z;
    const dist = Math.hypot(dx, dz);
    const alt = aircraftPos.y - ELEV;
    // Only meaningful on a westerly approach within ~12 km.
    const approaching = aircraftPos.x < td.x && dist < 12000 && dist > 120 && alt > 3;
    let whites = 0;
    if (approaching) {
      const angle = (Math.atan2(alt, dist) * 180) / Math.PI;
      // 4 bars: each covers ~0.33° around the 3° path.
      const thresholds = [2.5, 2.83, 3.17, 3.5];
      whites = thresholds.filter((t) => angle > t).length;
    }
    this.papi.forEach((p, i) => {
      const white = i < whites;
      const col = white ? 0xffffff : 0xff2d20;
      p.lens.material.color.setHex(col);
      p.glow.material.color.setHex(col);
      p.glow.material.opacity = this.lightsOn ? 0.9 : 0.5;
    });
    if (!approaching) return null;
    if (whites === 4) return { state: 'high', text: 'Too high — ease off and descend' };
    if (whites === 0) return { state: 'low', text: 'Too low — add power!' };
    if (whites === 2) return { state: 'good', text: 'On the perfect glide path' };
    return { state: whites > 2 ? 'slightlyHigh' : 'slightlyLow', text: whites > 2 ? 'A little high' : 'A little low' };
  }

  update(dt, weather) {
    if (this.towerDish) this.towerDish.rotation.z += dt * 0.9;

    this.t += dt;
    // Windsock points downwind and lifts as the wind increases.
    const fromRad = THREE.MathUtils.degToRad(weather.windDirDeg);
    // Sock tail points the way the wind is going.
    this.sockPivot.rotation.y = -fromRad + Math.PI;
    const lift = Math.min(1, weather.windSpeedKts / 15);
    this.sockPivot.rotation.x = (1 - lift) * 1.15 + Math.sin(this.t * 3.2) * 0.05 * lift;
    // Rotating green beacon.
    this.beacon.visible = this.lightsOn && Math.sin(this.t * 3) > 0;
    this.setLightsOn(weather.isNight || weather.cond.cloud > 0.8);
  }
}

function makeGlowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
