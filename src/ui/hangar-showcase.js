/**
 * The hangar showcase — one aeroplane at a time, on a turntable, under lights.
 *
 * "make it so you can select planes in a cool fashion, the planes are on a
 * podium spinning etc" — the owner. The hangar used to be a list of names, so
 * the only way to see an aeroplane before you bought it was to buy it.
 *
 * WHAT IT DRAWS
 * A small room: a lit concrete floor with its painted lines, a corrugated back
 * wall, three soft spotlights with their beams showing, and a round podium
 * whose top turns. On it, the aeroplane the game will actually fly — built by
 * the same createAircraftModel() the runway uses, in the livery you have
 * chosen — so the picture cannot drift from the thing you get.
 *
 * ONE RENDERER, AND ONLY WHILE IT IS OPEN
 * This draws with the game's own WebGLRenderer onto the game's own canvas,
 * INSTEAD of the world (main.js loop() asks menus.drawView() first). The
 * hangar covers the whole window, so the island behind it would be drawn for
 * nobody: on a Chromebook that is most of the frame. No second WebGL context,
 * no second copy of every texture, and when the hangar closes the world is
 * drawn again on the very next frame.
 *
 * SIZE
 * An A380 is twenty-four times the span of T-Pose Harrison. Drawn to scale,
 * one would be off the edges and the other a speck. So every aeroplane is
 * scaled to the podium, but not all the way: the display size grows with the
 * fifth root of the real one, so the jumbo still looms over the podium edge
 * and Harrison still looks small — just never lost. The camera frames the
 * largest that can occur, not the one on show, or the scaling would cancel.
 *
 * MEMORY
 * Models are kept in a small least-recently-used cache (the one on show, the
 * ones either side, which are built while you look so the next press is
 * instant) and disposed when they fall out of it — and all of them when the
 * hangar closes. tests/features/menus.browser.js browses every aeroplane
 * twice and checks the renderer's geometry and texture counts come back down.
 */

import * as THREE from '../vendor/three.module.js';
import { createAircraftModel } from '../aircraft/model-adapter.js';
import { getAircraft } from '../aircraft/types.js';
import { schemeFor } from '../aircraft/liveries.js';

const PODIUM_R = 8;
const PODIUM_H = 0.9;
/** The turning top's surface: what the wheels stand on. */
const TOP_Y = PODIUM_H + 0.14;
/** Display radius of a light aircraft, and the real one it stands for. */
const R0 = 7.1;
const R_REF = 6.8;
/** The largest drawn radius any aeroplane may reach. The camera frames this. */
const R_MAX = R0 * 1.2;
/** How far a model slides when you browse. */
const SLIDE = 30;
const CACHE_MAX = 5;
/** Turntable speed when nobody is touching it, radians a second. */
const AUTO_SPIN = 0.34;
/** Nose towards the camera's left — the three-quarter view a brochure uses. */
const START_ANGLE = 2.35;

/** Parked, gear down, engine off: what userData.update() should draw. */
const PARKED = {
  controls: { pitch: 0, roll: 0, yaw: 0, throttle: 0, brakes: 0 },
  rpm: 0,
  flaps: 0,
  gearPos: 1,
  gear: 1,
  gearDown: true,
  onGround: true,
  groundSpeed: 0,
  engineOn: false,
  agl: 0,
  crashed: false,
};
const DAYLIGHT = { isNight: false, cond: { cloud: 0.2 } };

const easeOutCubic = (t) => 1 - (1 - t) ** 3;
const easeInCubic = (t) => t * t * t;
const easeOutBack = (t) => {
  const c = 1.45;
  return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2;
};
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* --------------------------------------------------------------------- */
/* Painted surfaces. Canvas, like every other texture in the game.        */
/* --------------------------------------------------------------------- */

function canvasTexture(w, h, paint, { srgb = true, repeat = null } = {}) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  paint(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
  }
  t.anisotropy = 4;
  return t;
}

/** Polished concrete: a pool of light under the podium, slab seams, the yellow lines. */
function floorTexture() {
  return canvasTexture(1024, 1024, (g, w, h) => {
    const cx = w / 2;
    const cy = h / 2;
    const unit = w / 120; // the disc is 120 units across
    const pool = g.createRadialGradient(cx, cy, 0, cx, cy, w / 2);
    pool.addColorStop(0, '#5d6b7e');
    pool.addColorStop(0.16, '#46536a');
    pool.addColorStop(0.42, '#232c3b');
    pool.addColorStop(1, '#0c111b');
    g.fillStyle = pool;
    g.fillRect(0, 0, w, h);
    // Concrete speckle, seeded so it is the same every time.
    let s = 7;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 9000; i++) {
      const v = rnd();
      g.fillStyle = v > 0.5 ? 'rgba(255,255,255,0.025)' : 'rgba(0,0,0,0.05)';
      g.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 2, 1 + rnd() * 2);
    }
    // Slab seams every six units.
    g.strokeStyle = 'rgba(0,0,0,0.28)';
    g.lineWidth = 1.5;
    for (let x = cx % (6 * unit); x < w; x += 6 * unit) {
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, h);
      g.stroke();
      g.beginPath();
      g.moveTo(0, x);
      g.lineTo(w, x);
      g.stroke();
    }
    // The painted ring the podium stands in, dashed like a hangar's tow circle.
    g.strokeStyle = 'rgba(255,194,71,0.85)';
    g.lineWidth = 0.32 * unit;
    g.setLineDash([2.2 * unit, 1.4 * unit]);
    g.beginPath();
    g.arc(cx, cy, 11.2 * unit, 0, Math.PI * 2);
    g.stroke();
    g.setLineDash([]);
    // The lead-out line to the doors, towards the camera, and its edge marks.
    g.fillStyle = 'rgba(255,194,71,0.8)';
    g.fillRect(cx - 0.18 * unit, cy + 12.6 * unit, 0.36 * unit, 48 * unit);
    g.fillStyle = 'rgba(255,255,255,0.18)';
    for (const sx of [-1, 1]) g.fillRect(cx + sx * 17 * unit - 0.12 * unit, cy - 50 * unit, 0.24 * unit, 100 * unit);
  });
}

/** Corrugated hangar wall: panels, a girder band and a stencilled name. */
function wallTexture() {
  return canvasTexture(2048, 512, (g, w, h) => {
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#0a0f18');
    grad.addColorStop(0.55, '#18212f');
    grad.addColorStop(1, '#202b3b');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    // Corrugations.
    for (let x = 0; x < w; x += 8) {
      g.fillStyle = (x / 8) % 2 ? 'rgba(255,255,255,0.025)' : 'rgba(0,0,0,0.12)';
      g.fillRect(x, 0, 4, h);
    }
    // Door panels, every 160 px, with their seams.
    g.fillStyle = 'rgba(0,0,0,0.45)';
    for (let x = 0; x < w; x += 160) g.fillRect(x, h * 0.18, 5, h * 0.82);
    // A girder band near the top, with rivets.
    g.fillStyle = '#0d131d';
    g.fillRect(0, h * 0.12, w, h * 0.06);
    g.fillStyle = 'rgba(255,255,255,0.08)';
    for (let x = 6; x < w; x += 22) g.fillRect(x, h * 0.145, 3, 3);
    // Hazard stripe along the foot.
    for (let x = -h; x < w; x += 36) {
      g.fillStyle = 'rgba(255,194,71,0.32)';
      g.beginPath();
      g.moveTo(x, h);
      g.lineTo(x + 18, h);
      g.lineTo(x + 38, h - 20);
      g.lineTo(x + 20, h - 20);
      g.closePath();
      g.fill();
    }
    // The stencil.
    g.font = '700 74px ui-monospace, Menlo, Consolas, monospace';
    g.textAlign = 'center';
    g.fillStyle = 'rgba(214,226,242,0.13)';
    g.fillText('KESTREL ISLAND  ·  HANGAR 1', w * 0.5, h * 0.42);
  });
}

/** The turning top: machined rings and the game's star in the middle. */
function topTexture() {
  return canvasTexture(512, 512, (g, w) => {
    const c = w / 2;
    const grad = g.createRadialGradient(c, c, 0, c, c, c);
    grad.addColorStop(0, '#3a475b');
    grad.addColorStop(1, '#222b39');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, w);
    for (let r = 14; r < c; r += 9) {
      g.strokeStyle = r % 2 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.18)';
      g.lineWidth = 2;
      g.beginPath();
      g.arc(c, c, r, 0, Math.PI * 2);
      g.stroke();
    }
    // Twelve bolt heads round the rim, so the turning reads.
    g.fillStyle = 'rgba(210,225,245,0.35)';
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      g.beginPath();
      g.arc(c + Math.cos(a) * c * 0.9, c + Math.sin(a) * c * 0.9, 5, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = 'rgba(88,198,255,0.22)';
    g.beginPath();
    const S = 60;
    g.moveTo(c, c - S);
    g.lineTo(c + S * 0.14, c - S * 0.14);
    g.lineTo(c + S, c);
    g.lineTo(c + S * 0.14, c + S * 0.14);
    g.lineTo(c, c + S);
    g.lineTo(c - S * 0.14, c + S * 0.14);
    g.lineTo(c - S, c);
    g.lineTo(c - S * 0.14, c - S * 0.14);
    g.closePath();
    g.fill();
  });
}

/** A soft dark oval: the shadow the aeroplane would throw on the turntable. */
function blobTexture() {
  return canvasTexture(128, 128, (g, w) => {
    const grad = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    grad.addColorStop(0, 'rgba(0,0,0,0.62)');
    grad.addColorStop(0.55, 'rgba(0,0,0,0.3)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, w);
  });
}

/** A beam that fades from the lamp to nothing. */
function beamTexture() {
  return canvasTexture(4, 128, (g, w, h) => {
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, 'rgba(255,255,255,0.9)');
    grad.addColorStop(0.65, 'rgba(255,255,255,0.25)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
  }, { srgb: false });
}

/**
 * The locked look: pure black, no rim, no shading — just the shape, with a
 * big "?" over it from the UI (the owner, 2026-10-04: "a pure black thing
 * with a question mark on it… don't make it a cube"). Unlit, so it stays a
 * flat silhouette whatever the hangar lights are doing.
 */
function silhouetteMaterial() {
  return new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.DoubleSide, toneMapped: false });
}

/* --------------------------------------------------------------------- */

export class HangarShowcase {
  /**
   * @param {object} o
   * @param {HTMLElement} o.stage    the box the podium is framed in
   * @param {() => boolean} o.isActive  whether the hangar is on screen
   * @param {(dir:number) => void} o.onFlick  a swipe asked for the next (+1) or previous (-1)
   * @param {() => void} [o.onSettled]  a new aeroplane finished arriving (for prefetching)
   */
  constructor({ stage, isActive, onFlick, onSettled }) {
    this.stage = stage;
    this.isActive = isActive;
    this.onFlick = onFlick;
    this.onSettled = onSettled;
    this.ready = false;
    this.broken = null;
    this.cache = new Map();
    this.current = null;
    this.leaving = [];
    this.angle = START_ANGLE;
    this.spinVel = AUTO_SPIN;
    this.drag = null;
    this.flash = 0;
    this.accent = new THREE.Color(0x58c6ff);
    this.queue = [];
    this.wasActive = false;
    this.counters = { built: 0, disposed: 0, buildMs: [], frameMs: [], frames: 0, skipped: 0 };
    this._bindInput();
  }

  /* ---------------- the room ---------------- */

  init(renderer) {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x070b13);
    scene.fog = new THREE.Fog(0x070b13, 48, 120);
    this.scene = scene;
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.5, 400);
    this.owned = []; // everything the room made, for dispose()

    const keep = (o) => {
      this.owned.push(o);
      return o;
    };

    // Floor.
    const floorMap = keep(floorTexture());
    const floor = new THREE.Mesh(
      keep(new THREE.CircleGeometry(60, 72)),
      keep(new THREE.MeshStandardMaterial({ map: floorMap, roughness: 0.5, metalness: 0.08 }))
    );
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);

    // Back wall: two-thirds of a drum behind the podium.
    const wallMap = keep(wallTexture());
    wallMap.wrapS = THREE.RepeatWrapping;
    wallMap.repeat.set(-1, 1); // read from inside the drum, the right way round
    const wall = new THREE.Mesh(
      keep(new THREE.CylinderGeometry(52, 52, 34, 64, 1, true, Math.PI * 0.62, Math.PI * 0.76)),
      keep(new THREE.MeshStandardMaterial({ map: wallMap, roughness: 0.8, metalness: 0.2, side: THREE.BackSide }))
    );
    wall.position.y = 17;
    scene.add(wall);

    // The podium: a dark machined drum, a lit ring round its lip, a turning top.
    const drumMat = keep(new THREE.MeshStandardMaterial({ color: 0x1a2230, roughness: 0.32, metalness: 0.75 }));
    const drum = new THREE.Mesh(keep(new THREE.CylinderGeometry(PODIUM_R, PODIUM_R + 0.55, PODIUM_H, 72)), drumMat);
    drum.position.y = PODIUM_H / 2;
    scene.add(drum);
    this.ringMat = keep(new THREE.MeshBasicMaterial({ color: 0x58c6ff, toneMapped: false }));
    const ring = new THREE.Mesh(keep(new THREE.TorusGeometry(PODIUM_R + 0.02, 0.075, 8, 120)), this.ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = PODIUM_H;
    scene.add(ring);
    const footRing = new THREE.Mesh(keep(new THREE.TorusGeometry(PODIUM_R + 0.58, 0.05, 6, 120)), this.ringMat);
    footRing.rotation.x = Math.PI / 2;
    footRing.position.y = 0.05;
    scene.add(footRing);
    const topMap = keep(topTexture());
    this.turntable = new THREE.Mesh(
      keep(new THREE.CylinderGeometry(PODIUM_R - 0.25, PODIUM_R - 0.25, 0.16, 72)),
      [
        keep(new THREE.MeshStandardMaterial({ color: 0x232c3a, roughness: 0.4, metalness: 0.7 })),
        keep(new THREE.MeshStandardMaterial({ map: topMap, roughness: 0.38, metalness: 0.55 })),
        keep(new THREE.MeshStandardMaterial({ color: 0x232c3a })),
      ]
    );
    this.turntable.position.y = PODIUM_H + 0.06;
    scene.add(this.turntable);

    // Lamps overhead, and the beams coming down from them.
    const beamMap = keep(beamTexture());
    const beamMat = keep(new THREE.MeshBasicMaterial({
      color: 0xa9c8ff,
      alphaMap: beamMap,
      transparent: true,
      opacity: 0.075,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
    }));
    const lampMat = keep(new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, fog: false }));
    const lampGeo = keep(new THREE.CylinderGeometry(0.9, 1.2, 0.5, 20));
    const beamGeo = keep(new THREE.CylinderGeometry(0.9, 9, 26, 32, 1, true));
    const LAMPS = [
      [0, 27, -1, 1],
      [-14, 25, -9, 0.7],
      [14, 25, -9, 0.7],
    ];
    for (const [x, y, z, k] of LAMPS) {
      const lamp = new THREE.Mesh(lampGeo, lampMat);
      lamp.position.set(x, y, z);
      scene.add(lamp);
      const beam = new THREE.Mesh(beamGeo, beamMat);
      // Hung from the lamp, pointing at the podium.
      const dir = new THREE.Vector3(-x * 0.25, -y + TOP_Y, -z * 0.25).normalize();
      beam.position.set(x, y, z).addScaledVector(dir, 13);
      beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir);
      beam.scale.setScalar(k);
      beam.scale.y = 1;
      scene.add(beam);
    }

    // Light. Decay 0 so the numbers mean the same at any size of room.
    scene.add(new THREE.HemisphereLight(0xd8e6ff, 0x262e3b, 1.6));
    const key = new THREE.SpotLight(0xfff3e2, 9, 0, 0.5, 0.6, 0);
    key.position.set(6, 27, 10);
    key.target.position.set(0, TOP_Y, 0);
    scene.add(key, key.target);
    const rim = new THREE.SpotLight(0x8fb8ff, 7, 0, 0.55, 0.7, 0);
    rim.position.set(-14, 20, -22);
    rim.target.position.set(0, TOP_Y + 2, 0);
    scene.add(rim, rim.target);
    const fill = new THREE.DirectionalLight(0xffffff, 1.1);
    fill.position.set(-10, 8, 20);
    scene.add(fill);

    // Reflections: a tiny studio of bright strips, baked once. Its render
    // target is kept and disposed with the room — PMREM allocates a new one
    // on every call, which is how the sea once turned to white blocks.
    try {
      const env = new THREE.Scene();
      env.add(new THREE.Mesh(new THREE.BoxGeometry(40, 20, 40), new THREE.MeshBasicMaterial({ color: 0x1b2433, side: THREE.BackSide })));
      const strip = new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 5, 5.4) });
      for (let i = -1; i <= 1; i++) {
        const s = new THREE.Mesh(new THREE.BoxGeometry(30, 0.4, 2.2), strip);
        s.position.set(0, 9.5, i * 9);
        env.add(s);
      }
      const side = new THREE.Mesh(new THREE.BoxGeometry(0.4, 6, 26), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.8, 2.2) }));
      side.position.set(-19.5, 3, 0);
      env.add(side);
      const pm = new THREE.PMREMGenerator(renderer);
      this.envRT = pm.fromScene(env, 0.04);
      pm.dispose();
      env.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose();
      });
      scene.environment = this.envRT.texture;
      scene.environmentIntensity = 0.85;
    } catch (e) {
      /* no reflections is a dimmer picture, not a broken one */
    }

    // Everything an aeroplane hangs from: a group that does not turn, so a
    // slide goes left and right whatever angle the turntable has reached.
    this.root = new THREE.Group();
    scene.add(this.root);

    this.silMat = keep(silhouetteMaterial());
    this.blobMap = keep(blobTexture());
    this.ready = true;
  }

  /* ---------------- aeroplanes ---------------- */

  key(id, livery) {
    return `${id}|${livery || 'house'}`;
  }

  /** Build (or fetch) one aeroplane, measured, scaled and seated. */
  entry(id, livery) {
    const k = this.key(id, livery);
    const hit = this.cache.get(k);
    if (hit) {
      hit.used = performance.now();
      return hit;
    }
    const type = getAircraft(id);
    const t0 = performance.now();
    const model = createAircraftModel({ type, livery: schemeFor(type, livery) });
    try {
      if (model.userData.update) model.userData.update(0, PARKED, DAYLIGHT);
    } catch (e) {
      /* a model that cannot settle still stands */
    }
    // Its own lamps go dark: a light more or less in the scene recompiles
    // every material in it, which is a stutter on every press of the arrow.
    const sprites = [];
    model.traverse((o) => {
      if (o.isSprite) {
        sprites.push(o);
        o.visible = false;
      }
      if (o.isLight) o.visible = false;
    });
    model.updateMatrixWorld(true);

    // Measure the drawn shape, vertex by vertex: a bounding box over-reads an
    // aeroplane's footprint by up to forty per cent (it is a cross, not a slab).
    const box = new THREE.Box3();
    const v = new THREE.Vector3();
    const meshes = [];
    const shown = (o) => {
      for (let p = o; p && p !== model; p = p.parent) if (!p.visible) return false;
      return true;
    };
    model.traverse((o) => {
      if (!o.isMesh || !shown(o) || !o.geometry || !o.geometry.attributes.position) return;
      meshes.push(o);
      const pos = o.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) box.expandByPoint(v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld));
    });
    if (box.isEmpty()) box.setFromCenterAndSize(new THREE.Vector3(), new THREE.Vector3(10, 3, 10));
    const cx = (box.min.x + box.max.x) / 2;
    const cz = (box.min.z + box.max.z) / 2;
    let r2 = 0;
    for (const o of meshes) {
      const pos = o.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
        const d = (v.x - cx) ** 2 + (v.z - cz) ** 2;
        if (d > r2) r2 = d;
      }
    }
    const rXZ = Math.sqrt(r2) || 5;
    const height = box.max.y - box.min.y;
    // A standing man is tall for his span; count height too, or he towers.
    const real = Math.max(rXZ, height * 0.9);
    const shown2 = R0 * clamp((real / R_REF) ** 0.18, 0.74, 1.2);
    const scale = shown2 / real;

    const fit = new THREE.Group();
    fit.scale.setScalar(scale);
    // Moved BY the offset, not to it: a factory may have placed its root.
    model.position.x -= cx;
    model.position.y -= box.min.y;
    model.position.z -= cz;
    fit.add(model);
    const spin = new THREE.Group();
    spin.position.y = TOP_Y;
    spin.add(fit);
    // The shadow it throws on the turntable: an oval of its own plan.
    const blob = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: this.blobMap, transparent: true, depthWrite: false, toneMapped: false })
    );
    blob.rotation.x = -Math.PI / 2;
    blob.position.y = 0.02;
    blob.scale.set((box.max.x - box.min.x) * scale * 0.9, (box.max.z - box.min.z) * scale * 0.9, 1);
    blob.renderOrder = -1;
    spin.add(blob);
    const holder = new THREE.Group();
    holder.add(spin);

    const e = {
      key: k,
      id,
      livery: livery || 'house',
      model,
      holder,
      spin,
      blob,
      sprites,
      scale,
      drawnR: rXZ * scale,
      drawnH: height * scale,
      silhouette: false,
      mats: new Map(),
      anim: null,
      used: performance.now(),
    };
    this.cache.set(k, e);
    this.counters.built++;
    this.counters.buildMs.push(+(performance.now() - t0).toFixed(1));
    if (this.counters.buildMs.length > 64) this.counters.buildMs.shift();
    this.trim();
    return e;
  }

  /** The locked look on or off, without touching a material anyone else owns. */
  setLocked(e, on) {
    if (!e || e.silhouette === !!on) return;
    e.silhouette = !!on;
    e.model.traverse((o) => {
      if (!o.isMesh) return;
      if (on) {
        e.mats.set(o, o.material);
        o.material = Array.isArray(o.material) ? o.material.map(() => this.silMat) : this.silMat;
      } else if (e.mats.has(o)) {
        o.material = e.mats.get(o);
      }
    });
    if (!on) e.mats.clear();
    e.blob.visible = true;
  }

  dispose(e) {
    if (!e) return;
    this.setLocked(e, false);
    e.holder.removeFromParent();
    const m = e.model;
    try {
      if (m.userData.blenderModel) {
        // The Blender helicopter shares its geometry and most of its paint
        // with every other copy of itself; disposing them would only make the
        // next copy upload them again.
      } else if (typeof m.userData.dispose === 'function') {
        m.userData.dispose();
      } else {
        const seen = new Set();
        m.traverse((o) => {
          if (o.geometry && !seen.has(o.geometry)) {
            seen.add(o.geometry);
            o.geometry.dispose();
          }
          for (const mat of [].concat(o.material || [])) {
            if (seen.has(mat)) continue;
            seen.add(mat);
            mat.dispose();
          }
        });
      }
    } catch (err) {
      console.warn('[hangar] could not dispose', e.id, err);
    }
    e.blob.geometry.dispose();
    e.blob.material.dispose();
    this.cache.delete(e.key);
    this.counters.disposed++;
  }

  /** Keep the cache to CACHE_MAX, oldest first, never the ones on screen. */
  trim() {
    if (this.cache.size <= CACHE_MAX) return;
    const busy = new Set([this.current, ...this.leaving]);
    const old = [...this.cache.values()].filter((e) => !busy.has(e)).sort((a, b) => a.used - b.used);
    while (this.cache.size > CACHE_MAX && old.length) this.dispose(old.shift());
  }

  /** Everything off the podium and out of memory — the hangar has closed. */
  release() {
    for (const e of [...this.cache.values()]) this.dispose(e);
    this.current = null;
    this.leaving = [];
    this.queue = [];
  }

  /**
   * Put an aeroplane on the podium.
   *
   * @param {string} id
   * @param {object} o
   * @param {string} o.livery
   * @param {boolean} o.locked   draw it as a silhouette
   * @param {number} o.dir      +1 slides in from the right, -1 from the left,
   *                             0 rises up through the turntable
   * @param {string} o.accent   the category's colour, for the lit ring
   */
  show(id, { livery = 'house', locked = false, dir = 0, accent = null } = {}) {
    if (accent) this.accent.set(accent);
    if (!this.ready) {
      // Nothing to draw with yet; remember what was asked for.
      this.pending = { id, livery, locked, dir };
      return;
    }
    const e = this.entry(id, livery);
    if (e === this.current) {
      if (e.silhouette !== !!locked) {
        this.setLocked(e, locked);
        if (!locked) this.hop(e);
      }
      return;
    }
    const prev = this.current;
    if (prev) {
      prev.anim = { kind: 'out', t: 0, dir: dir || 0 };
      if (!this.leaving.includes(prev)) this.leaving.push(prev);
    }
    // It may still be leaving from a moment ago: bring it back from wherever it is.
    this.leaving = this.leaving.filter((x) => x !== e);
    this.setLocked(e, locked);
    e.anim = { kind: 'in', t: 0, dir: dir || 0 };
    this.root.add(e.holder);
    this.current = e;
    this.flash = 1;
    this.settledFired = false;
    this.place(e);
  }

  /** The little jump an aeroplane does when it becomes yours. */
  hop(e) {
    if (!e) return;
    e.anim = { kind: 'hop', t: 0, dir: 0 };
    this.flash = 1.4;
  }

  /** Swap the paint on the one on show, in place. */
  repaint(livery, locked) {
    if (!this.ready || !this.current) return;
    const id = this.current.id;
    const old = this.current;
    for (const e of [...this.cache.values()]) if (e !== old && e.livery !== livery) this.dispose(e);
    const e = this.entry(id, livery);
    if (e === old) return;
    this.setLocked(e, locked);
    this.root.add(e.holder);
    this.current = e;
    this.dispose(old);
    this.hop(e);
    this.place(e);
  }

  /** Build these quietly, one a frame, after the arrival has finished. */
  prefetch(ids, livery) {
    this.queue = ids.filter(Boolean).map((id) => ({ id, livery }));
  }

  /* ---------------- input ---------------- */

  _bindInput() {
    const el = this.stage;
    if (!el) return;
    el.addEventListener('pointerdown', (ev) => {
      if (ev.button !== undefined && ev.button !== 0) return;
      if (ev.target.closest('button, a, input, select')) return;
      this.drag = { id: ev.pointerId, x0: ev.clientX, y0: ev.clientY, x: ev.clientX, t0: performance.now(), t: performance.now(), v: 0 };
      try {
        el.setPointerCapture(ev.pointerId);
      } catch (e) {
        /* a synthetic pointer cannot be captured, and does not need to be */
      }
      el.classList.add('is-dragging');
    });
    el.addEventListener('pointermove', (ev) => {
      const d = this.drag;
      if (!d || d.id !== ev.pointerId) return;
      const now = performance.now();
      const dx = ev.clientX - d.x;
      const dt = Math.max(1, now - d.t) / 1000;
      // A full turn for about the width of a phone.
      const rad = dx * 0.012;
      this.angle += rad;
      d.v = d.v * 0.4 + (rad / dt) * 0.6;
      d.x = ev.clientX;
      d.t = now;
    });
    const end = (ev) => {
      const d = this.drag;
      if (!d || d.id !== ev.pointerId) return;
      this.drag = null;
      el.classList.remove('is-dragging');
      const dx = ev.clientX - d.x0;
      const dy = ev.clientY - d.y0;
      const ms = performance.now() - d.t0;
      // A quick flick is "next one, please"; a slow drag was spinning it.
      if (ev.type === 'pointerup' && ms < 320 && Math.abs(dx) > 56 && Math.abs(dx) > Math.abs(dy) * 1.6) {
        // Give back most of the spin the flick put on.
        this.angle -= dx * 0.012 * 0.8;
        this.spinVel = AUTO_SPIN;
        if (this.onFlick) this.onFlick(dx < 0 ? 1 : -1);
        return;
      }
      this.spinVel = clamp(d.v, -9, 9);
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  /* ---------------- each frame ---------------- */

  place(e) {
    const a = e.anim;
    if (!a) {
      e.holder.position.set(0, 0, 0);
      e.holder.scale.setScalar(1);
      return;
    }
    const DUR = a.kind === 'in' ? 0.62 : a.kind === 'out' ? 0.42 : 0.7;
    const p = clamp(a.t / DUR, 0, 1);
    if (a.kind === 'in') {
      if (a.dir) {
        e.holder.position.set(a.dir * SLIDE * (1 - easeOutCubic(p)), 0, 0);
      } else {
        // Up through the turntable like a lift: the floor and the drum hide
        // whatever is still below them.
        e.holder.position.set(0, -(e.drawnH + TOP_Y + 0.5) * (1 - easeOutBack(p)), 0);
      }
    } else if (a.kind === 'out') {
      if (a.dir) e.holder.position.set(-a.dir * SLIDE * easeInCubic(p), 0, 0);
      else e.holder.position.set(0, -(e.drawnH + TOP_Y + 0.5) * easeInCubic(p), 0);
    } else if (a.kind === 'hop') {
      e.holder.position.set(0, Math.sin(p * Math.PI) * 1.6 * (1 - p * 0.3), 0);
    }
    if (p >= 1) {
      e.anim = null;
      if (a.kind === 'out') {
        e.holder.removeFromParent();
        this.leaving = this.leaving.filter((x) => x !== e);
        e.holder.position.set(0, 0, 0);
      } else {
        e.holder.position.set(0, 0, 0);
      }
    }
  }

  tick(dt) {
    dt = Math.min(dt, 1 / 20);
    // The turntable: your finger, then its momentum, then its own slow turn.
    if (!this.drag) {
      this.spinVel += (AUTO_SPIN - this.spinVel) * Math.min(1, dt * 1.6);
      this.angle += this.spinVel * dt;
    }
    this.turntable.rotation.y = this.angle;
    for (const e of [this.current, ...this.leaving]) {
      if (!e) continue;
      e.spin.rotation.y = this.angle;
      if (e.anim) {
        e.anim.t += dt;
        this.place(e);
      }
    }
    // The current one's own animation (propellers, the rotor, Harrison).
    const cur = this.current;
    if (cur && cur.model.userData.update && !cur.updateBroken) {
      try {
        cur.model.userData.update(dt, PARKED, DAYLIGHT);
        for (const s of cur.sprites) s.visible = false;
      } catch (err) {
        cur.updateBroken = true;
      }
    }
    // The ring: the category's colour, flaring as something arrives.
    this.flash = Math.max(0, this.flash - dt * 1.8);
    this.ringMat.color.copy(this.accent).multiplyScalar(1 + this.flash * 1.6);
    // Once it has landed, build the neighbours — one a frame, so no single
    // frame pays for two.
    if (cur && !cur.anim && !this.leaving.length) {
      if (!this.settledFired) {
        this.settledFired = true;
        if (this.onSettled) this.onSettled(cur.id);
      } else if (this.queue.length) {
        const q = this.queue.shift();
        if (!this.cache.has(this.key(q.id, q.livery))) {
          const e = this.entry(q.id, q.livery);
          this.compileQuietly(e);
        }
      }
    }
  }

  /** Compile a prefetched model's shaders now, so showing it does not stall. */
  compileQuietly(e) {
    if (!this._renderer || !e) return;
    try {
      if (typeof this._renderer.compile === 'function') this._renderer.compile(e.holder, this.camera, this.scene);
    } catch (err) {
      /* it will compile when it is first drawn instead */
    }
  }

  /** Aim the camera so the podium sits in the middle of the stage box. */
  frame(W, H, rect) {
    const cam = this.camera;
    const tanV = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
    const sw = Math.max(40, rect.width);
    const sh = Math.max(40, rect.height);
    // Wide enough for the widest aeroplane at any angle of the turntable, and
    // tall enough for the podium and the tallest thing on it.
    const halfW = R_MAX * 1.02;
    const halfH = 6.4;
    const dW = (halfW * H) / (tanV * sw * 0.96);
    const dH = (halfH * H) / (tanV * sh * 0.94);
    const d = Math.max(dW, dH, 18);
    const elev = THREE.MathUtils.degToRad(15);
    const look = new THREE.Vector3(0, TOP_Y + 2.2, 0);
    cam.position.set(0, look.y + Math.sin(elev) * d, Math.cos(elev) * d);
    cam.lookAt(look);
    cam.far = d + 140;
    // The haze starts behind the podium, however far back the camera is.
    this.scene.fog.near = d + 14;
    this.scene.fog.far = d + 95;
    cam.aspect = W / H;
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    cam.setViewOffset(W, H, W / 2 - cx, H / 2 - cy, W, H);
    cam.updateProjectionMatrix();
  }

  /**
   * Draw a frame, if the hangar is open. Returns true when it drew (or when
   * it is open but scrolled out of sight), which tells the game loop not to
   * draw the island behind it.
   */
  render(renderer, dt) {
    if (this.broken) return false;
    const active = !!(this.isActive && this.isActive());
    if (!active) {
      if (this.wasActive) {
        this.wasActive = false;
        this.release();
      }
      return false;
    }
    this.wasActive = true;
    try {
      const t0 = performance.now();
      this._renderer = renderer;
      if (!this.ready) {
        this.init(renderer);
        if (this.pending) {
          const p = this.pending;
          this.pending = null;
          this.show(p.id, p);
        }
      }
      const canvas = renderer.domElement;
      const W = canvas.clientWidth || window.innerWidth;
      const H = canvas.clientHeight || window.innerHeight;
      const rect = this.stage.getBoundingClientRect();
      if (rect.bottom < 8 || rect.top > H - 8 || rect.width < 8 || rect.height < 8) {
        // Scrolled away: the last frame stays on the canvas, and costs nothing.
        this.counters.skipped++;
        return true;
      }
      this.tick(dt || 1 / 60);
      this.frame(W, H, rect);
      const exposure = renderer.toneMappingExposure;
      renderer.toneMappingExposure = 1;
      renderer.render(this.scene, this.camera);
      renderer.toneMappingExposure = exposure;
      const ms = performance.now() - t0;
      this.counters.frames++;
      this.counters.frameMs.push(ms);
      if (this.counters.frameMs.length > 240) this.counters.frameMs.shift();
      return true;
    } catch (err) {
      console.error('[hangar] the showcase could not draw; showing the plan view instead.', err);
      this.broken = err;
      try {
        this.release();
      } catch (e) {
        /* already broken */
      }
      if (this.onBroken) this.onBroken(err);
      return false;
    }
  }

  /** For the tests and the console. */
  stats() {
    const f = this.counters.frameMs;
    const avg = f.length ? f.reduce((a, b) => a + b, 0) / f.length : 0;
    const sorted = [...f].sort((a, b) => a - b);
    return {
      ready: this.ready,
      broken: this.broken ? String(this.broken) : null,
      current: this.current ? this.current.id : null,
      locked: this.current ? this.current.silhouette : null,
      cached: [...this.cache.keys()],
      built: this.counters.built,
      disposed: this.counters.disposed,
      frames: this.counters.frames,
      skipped: this.counters.skipped,
      drawMsAvg: +avg.toFixed(2),
      drawMsP95: sorted.length ? +sorted[Math.floor(sorted.length * 0.95)].toFixed(2) : 0,
      buildMs: [...this.counters.buildMs],
      drawnR: this.current ? +this.current.drawnR.toFixed(2) : null,
      drawnH: this.current ? +this.current.drawnH.toFixed(2) : null,
    };
  }
}
