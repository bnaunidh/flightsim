/**
 * Parts and behaviours every cockpit shares.
 *
 * The family builders (generic.js, light.js, and the airliner / jet / special
 * ones to come) build different rooms, but some things are the same in all of
 * them and must stay the same: the warning lamps and the flashing master
 * caution, rain on the glass, the controls moving with your hands, the panel
 * going dark when lightning (or a mayday) takes the instruments out, and the
 * panel lights coming up at dusk. They live here so no builder has to
 * re-derive them, and so a fix to one is a fix to all.
 */

import * as THREE from '../../vendor/three.module.js';
import { panelTexture, panelNormal, leatherTexture, dropletTexture } from '../../render/textures.js';
import { clamp, lerp } from '../../core/noise.js';
import { blinkLevel } from '../../render/flash-safety.js';

/**
 * The cockpit's own eye point. main.js places every cockpit group so that this
 * point lands on the pilot's eye in the aeroplane being flown (see setAircraft
 * there and features/airliners.js seatPanel), so every builder authors its
 * room around it.
 */
export const TRAINER_EYE = Object.freeze([-0.24, 0.46, 0.06]);

/** The panel shell / trim materials of the old cockpit, from a style. */
export function shellMaterials(style) {
  const shellMat = new THREE.MeshStandardMaterial({
    map: panelTexture(),
    normalMap: panelNormal(),
    normalScale: new THREE.Vector2(0.6, 0.6),
    roughness: 0.78,
    metalness: 0.06,
    color: style.shell,
  });
  const trimMat = new THREE.MeshStandardMaterial({
    map: leatherTexture(style.trim),
    roughness: 0.85,
  });
  return { shellMat, trimMat };
}

/* ------------------------------------------------------------------ *
 * Warning lamps
 *
 * The row of warning lights. They are dark until something is wrong, which
 * is the point: when the engine quits you should not have to read a menu to
 * find out, you should see red in front of you. MASTER CAUTION flashes
 * whenever any of the others is lit.
 * ------------------------------------------------------------------ */

export const WARNINGS = Object.freeze([
  { key: 'engine', label: 'ENGINE', colour: 0xff3b25 },
  { key: 'fuelLeak', label: 'FUEL', colour: 0xff3b25 },
  { key: 'elevator', label: 'PITCH', colour: 0xffa42b },
  { key: 'icing', label: 'ICE', colour: 0xffa42b },
  { key: 'gear', label: 'GEAR', colour: 0xffa42b },
  { key: 'brakes', label: 'BRAKES', colour: 0xffa42b },
  { key: 'roughEngine', label: 'ENG ROUGH', colour: 0xffa42b },
  { key: 'tyre', label: 'TYRE', colour: 0xffa42b },
]);

export function annunciator(text, colour, w = 0.108, h = 0.042) {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 48;
  const g = c.getContext('2d');
  g.fillStyle = '#0a0c10';
  g.fillRect(0, 0, 128, 48);
  g.fillStyle = '#ffffff';
  g.font = `bold ${text.length > 8 ? 17 : 21}px system-ui, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 64, 25);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshStandardMaterial({
    map: tex,
    emissiveMap: tex,
    emissive: new THREE.Color(colour),
    emissiveIntensity: 0,
    color: 0x141820,
    roughness: 0.6,
  });
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
}

/**
 * The unlit look of a set of annunciators as ONE mesh: each one's own legend
 * (its material's map canvas) copied into a cell of a shared canvas, each
 * one's quad baked where it sits (parent space). Null if they do not share a
 * parent or have no canvases (a test's stub).
 */
function unlitRow(meshes) {
  const parent = meshes[0] && meshes[0].parent;
  if (!parent || meshes.some((m) => m.parent !== parent)) return null;
  const cw = 128;
  const ch = 48;
  const c = document.createElement('canvas');
  c.width = cw * meshes.length;
  c.height = ch;
  const g = c.getContext('2d');
  if (!g || typeof g.drawImage !== 'function') return null;
  const pos = [];
  const uv = [];
  const idx = [];
  const v = new THREE.Vector3();
  meshes.forEach((m, i) => {
    const img = m.material.map && m.material.map.image;
    if (img) g.drawImage(img, i * cw, 0, cw, ch);
    m.updateMatrix();
    const geo = m.geometry;
    const p = geo.attributes.position;
    const t = geo.attributes.uv;
    const base = pos.length / 3;
    for (let k = 0; k < p.count; k++) {
      v.fromBufferAttribute(p, k).applyMatrix4(m.matrix);
      pos.push(v.x, v.y, v.z);
      uv.push((i + t.getX(k)) / meshes.length, t.getY(k));
    }
    for (let k = 0; k < geo.index.count; k++) idx.push(base + geo.index.getX(k));
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshStandardMaterial({ map: tex, color: 0x141820, roughness: 0.6 });
  mat.addEventListener('dispose', () => tex.dispose());
  return new THREE.Mesh(geo, mat);
}

/**
 * The lamp row and the master caution, placed by the builder.
 *
 * `place(mesh, i)` positions lamp i; `placeMaster(mesh)` the master caution.
 * Returns `{ lamps, master, update(t, ac, env) }` — `lamps` is the list
 * tests/playtest.js reads off `cockpit.userData.warnings`.
 */
export function warningLamps(group, { place, placeMaster, size = [0.108, 0.042], masterSize = [0.15, 0.05] }) {
  const lamps = [];
  WARNINGS.forEach((w, i) => {
    const m = annunciator(w.label, w.colour, size[0], size[1]);
    m.name = `lamp ${w.key}`;
    place(m, i);
    group.add(m);
    lamps.push({ ...w, mat: m.material, mesh: m });
  });
  const master = annunciator('MASTER CAUTION', 0xff2a1a, masterSize[0], masterSize[1]);
  master.name = 'master caution';
  placeMaster(master);
  group.add(master);
  /*
   * Dark, all nine are one mesh: the legends painted once side by side into
   * one texture, the quads merged where the lamps sit. A lamp's own mesh is
   * drawn only while it is lit, a hair in front. Nine draws a frame became
   * one, which is a good part of what the cockpit view costs.
   */
  const all = [...lamps.map((l) => l.mesh), master];
  const unlit = unlitRow(all);
  if (unlit) {
    unlit.name = 'warning lamps (unlit)';
    group.add(unlit);
    for (const m of all) {
      m.position.z += 0.0006;
      m.visible = false;
    }
  }
  return {
    lamps,
    master,
    /**
     * Steady for the thing that is wrong, and a flashing master caution so it
     * catches your eye even if you are looking outside. Dark during an
     * instrument blackout: the lamps are on the same bus as the panel.
     */
    update(t, ac, env) {
      const f = ac.failures || {};
      /*
       * Low fuel is a fraction of the tank, not a number of litres.
       *
       * The FUEL lamp lit below a flat twelve litres, which is seven and a half
       * per cent of the trainer's 160 litre tank and a rounding error in the
       * fighter's 5,200. So on every aeroplane but the Skylark the lamp sat dark
       * right up to the point where the tanks ran dry and the ENGINE lamp took
       * over — no warning at all, in the aeroplanes that burn fuel fastest.
       * fuelFraction() reads against the capacity of the type actually being
       * flown, and 0.075 is the old twelve litres expressed as what it always
       * meant.
       */
      const lowFuel = ac.fuel > 0 && typeof ac.fuelFraction === 'function' && ac.fuelFraction() < 0.075;
      const dead = !!(env && env.blackout);
      let anyLit = false;
      for (const l of lamps) {
        const on = !dead && (!!f[l.key] || (l.key === 'fuelLeak' && lowFuel));
        l.on = on;
        if (on) anyLit = true;
        l.mat.emissiveIntensity = on ? 2.4 : 0;
        if (unlit) l.mesh.visible = on;
      }
      // About once a second, and through Reduce flashing (on by default): a
      // soft swell instead of a hard on-off, well under three a second.
      master.material.emissiveIntensity = anyLit ? 3.0 * blinkLevel(t, 0.9, 0.56) : 0;
      if (unlit) master.visible = anyLit;
      return anyLit;
    },
  };
}

/* ------------------------------------------------------------------ *
 * What the cockpit needs to know about the world, per frame.
 * ------------------------------------------------------------------ */

/**
 * `sim` is optional (main.js passes it; a test or a thumbnail may not).
 *
 *   blackout   the instruments are dead (lightning, or the mayday script)
 *   autopilot  the autopilot is flying
 *   panelLight 0 in daylight .. 1 at night: how far the panel lights are up
 */
export function cockpitEnv(weather, sim, out = {}) {
  out.blackout = !!(sim && sim.instrumentBlackout > 0);
  out.autopilot = !!(sim && sim.autopilot && sim.autopilot.engaged);
  const time = weather && weather.time;
  const cloud = weather && weather.cond ? weather.cond.cloud || 0 : 0;
  out.panelLight = time === 'night' ? 1 : time === 'sunset' ? 0.7 : clamp((cloud - 0.6) * 0.8, 0, 0.3);
  return out;
}

/* ------------------------------------------------------------------ *
 * Rain on the glass
 * ------------------------------------------------------------------ */

/**
 * Droplets on a pane: the material slides the droplet texture down the glass
 * faster the faster you fly. Hidden outright when it is dry — a transparent
 * mesh at opacity 0 is still drawn, and a windscreen is a lot of pixels.
 */
export function rainMaterial({ depthTest = true } = {}) {
  // A clone, so each cockpit scrolls its own copy and disposing one never
  // pulls the texture out from under the next.
  const map = dropletTexture().clone();
  map.needsUpdate = true;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  return new THREE.MeshBasicMaterial({
    map,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    depthTest,
  });
}

export function updateRain(mat, meshes, t, ac, weather) {
  // Rain, and the wet of flying through cloud (weather.immersion, main.js) or a fog bank.
  const rain = weather && weather.cond ? Math.min(1, (weather.cond.rain || 0) + (weather.immersion || 0) * 0.35) : 0;
  const wet = rain > 0.01;
  for (const m of meshes) m.visible = wet;
  mat.opacity = rain * 0.55;
  if (wet) {
    mat.map.offset.y = (t * (0.05 + (ac.airspeed || 0) * 0.004)) % 1;
    mat.map.offset.x = Math.sin(t * 0.4) * 0.02;
  }
  return wet;
}

/* ------------------------------------------------------------------ *
 * Controls you hold
 * ------------------------------------------------------------------ */

/**
 * A control wheel: column, hub and horns. `style` 'horns' is the old
 * trainer yoke; 'ram' the light single's ram's-horn wheel with a centre plate.
 */
export function makeYoke({ hubMat, colour = 0x1c1f24, style = 'horns', columnMat } = {}) {
  const yoke = new THREE.Group();
  yoke.name = 'yoke';
  const column = new THREE.Mesh(
    new THREE.CylinderGeometry(0.035, 0.035, 0.42, 10),
    columnMat || new THREE.MeshStandardMaterial({ color: 0x2b2f35, roughness: 0.4, metalness: 0.6 })
  );
  column.rotation.x = Math.PI / 2;
  // Forwards, into the panel. It used to run backwards towards the pilot,
  // which put a fat grey cylinder end-on in the middle of the windscreen.
  column.position.z = -0.2;
  yoke.add(column);
  const mat = hubMat || new THREE.MeshStandardMaterial({ color: colour, roughness: 0.5, metalness: 0.3 });
  const hub = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.06), mat);
  yoke.add(hub);
  for (const side of [-1, 1]) {
    const horn = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.017, 8, 14, Math.PI * 1.1), mat);
    horn.rotation.y = Math.PI / 2;
    horn.rotation.z = side > 0 ? -Math.PI * 0.55 : Math.PI * 0.45;
    horn.position.x = side * 0.02;
    yoke.add(horn);
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.13, 8), mat);
    grip.rotation.z = Math.PI / 2;
    grip.position.set(side * 0.19, 0, 0);
    yoke.add(grip);
  }
  return yoke;
}

/** A fast jet's centre stick: shaft, grip, hat switch and trigger. */
export function makeStick() {
  const stick = new THREE.Group();
  stick.name = 'stick';
  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(0.021, 0.028, 0.34, 10),
    new THREE.MeshStandardMaterial({ color: 0x23272d, roughness: 0.42, metalness: 0.55 })
  );
  shaft.position.y = 0.17;
  stick.add(shaft);
  const grip = new THREE.Mesh(
    new THREE.CylinderGeometry(0.034, 0.034, 0.13, 10),
    new THREE.MeshStandardMaterial({ color: 0x15181c, roughness: 0.85 })
  );
  grip.position.y = 0.4;
  stick.add(grip);
  const swMat = new THREE.MeshStandardMaterial({ color: 0x8d939b, roughness: 0.4, metalness: 0.6 });
  const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.012, 8), swMat);
  hat.position.set(0, 0.47, -0.012);
  stick.add(hat);
  const trigger = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.045, 0.014), swMat);
  trigger.position.set(0, 0.38, -0.036);
  stick.add(trigger);
  return stick;
}

/**
 * A quadrant lever. Real quadrants use shape as well as colour so you can
 * find the right lever without looking: round throttle, flat-topped prop,
 * ribbed mixture.
 */
export function makeLever(colour, shape, stemMat) {
  const g = new THREE.Group();
  const stem = new THREE.Mesh(
    new THREE.CylinderGeometry(0.013, 0.013, 0.19, 8),
    stemMat || new THREE.MeshStandardMaterial({ color: 0x3a3f46, roughness: 0.35, metalness: 0.7 })
  );
  stem.position.y = 0.095;
  g.add(stem);
  const mat = new THREE.MeshStandardMaterial({ color: colour, roughness: 0.5 });
  const knobGeo =
    shape === 'flat'
      ? new THREE.CylinderGeometry(0.032, 0.032, 0.03, 12)
      : shape === 'ribbed'
        ? new THREE.CylinderGeometry(0.026, 0.03, 0.055, 10)
        : new THREE.SphereGeometry(0.033, 12, 8);
  const k = new THREE.Mesh(knobGeo, mat);
  k.position.y = 0.2;
  g.add(k);
  return g;
}

/** Ease `cur` towards `want` at `rate` per second; the controls have mass. */
export const ease = (cur, want, rate, dt) => lerp(cur, want, clamp(dt * rate, 0, 1));
