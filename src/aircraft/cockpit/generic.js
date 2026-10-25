/**
 * The generic cockpit: the one every aeroplane had before the cockpits were
 * split into families.
 *
 * It is a box room — panel shell, glareshield, side walls with a gap for the
 * window, roof, floor — with the canvas instrument panel (panel-canvas.js) a
 * metre ahead of the eye, and it is dressed per aeroplane class: a yoke or a
 * centre stick, propeller levers or thrust levers, round dials or a glass
 * PFD. It does not know what the aeroplane looks like from outside.
 *
 * It stays, unchanged, as the cockpit for every family whose own builder has
 * not been written yet (airliners, jets, the specials), and as the fallback
 * if a family builder ever throws.
 */

import * as THREE from '../../vendor/three.module.js';
import { clamp, lerp } from '../../core/noise.js';
import { InstrumentPanel } from './panel-canvas.js';
import {
  shellMaterials,
  warningLamps,
  cockpitEnv,
  rainMaterial,
  updateRain,
  makeYoke,
  makeStick,
  makeLever,
} from './common.js';

/**
 * Per-aeroplane cockpit dressing.
 *
 * The instruments themselves are shared — an altimeter is an altimeter — but
 * what you hold and what the cabin is made of is not. A fast jet has a stick
 * between your knees and one thrust lever per engine; a light single has a
 * yoke and three knobs; an airliner has a wide, dark flight deck.
 */
export const COCKPIT_STYLES = {
  // `panel` picks the instruments: round dials for the light aeroplanes,
  // screens for anything with a jet engine. A 1970s six-pack in a fly-by-wire
  // fighter was the last thing in here that still looked like a placeholder.
  trainer: { stick: 'yoke', levers: 'prop', shell: 0x8f949c, trim: '#241c15', panel: 'classic' },
  tourer: { stick: 'yoke', levers: 'prop', shell: 0x6d747e, trim: '#1b2029', panel: 'classic' },
  airliner: { stick: 'yoke', levers: 'jet2', shell: 0x4a5058, trim: '#15181d', panel: 'glass' },
  fighter: { stick: 'centre', levers: 'jet1', shell: 0x3c4148, trim: '#101318', panel: 'glass' },
  carrier: { stick: 'centre', levers: 'jet1', shell: 0x424851, trim: '#12161b', panel: 'glass' },
};

/**
 * Build the physical cockpit: panel shell, glareshield, yoke, throttle lever,
 * door frames, seats and the rain-streaked windshield overlay.
 */
export function buildGenericCockpit({ highContrast = false, type = null } = {}) {
  const style =
    COCKPIT_STYLES[String((type && type.class) || 'Trainer').toLowerCase()] || COCKPIT_STYLES.trainer;
  const group = new THREE.Group();
  group.name = 'cockpit';
  // Lifted with the eye point (see EYE in flight/camera.js) so the panel keeps
  // its framing: top of the panel roughly 20 degrees below the horizon, which is
  // what you see from the left seat of a real high-wing trainer.
  group.position.y = 0.29;

  const panel = new InstrumentPanel(highContrast, style.panel || 'classic');
  const { shellMat, trimMat } = shellMaterials(style);

  /**
   * The panel face is bent towards the pilot at the edges.
   *
   * A real panel is not a flat board — it wraps, so the outboard instruments
   * face you instead of facing sideways past your shoulder. On a flat plane
   * the fuel gauge and the radio stack were both being read at a glancing
   * angle, which is exactly why the panel looked like a poster.
   */
  const curvedPanel = (w, h, curve, segs = 28) => {
    const g = new THREE.PlaneGeometry(w, h, segs, 2);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const t = p.getX(i) / (w / 2);
      p.setZ(i, t * t * curve);
    }
    p.needsUpdate = true;
    g.computeVertexNormals();
    return g;
  };

  // Instrument panel face.
  const faceMat = new THREE.MeshStandardMaterial({
    map: panel.texture,
    roughness: 0.34,
    metalness: 0.08,
    emissive: 0xffffff,
    emissiveMap: panel.texture,
    emissiveIntensity: 0.22,
  });
  const face = new THREE.Mesh(curvedPanel(1.46, 0.73, 0.075), faceMat);
  face.position.set(0, -0.26, -0.94);
  face.rotation.x = 0.2;
  group.add(face);
  group.userData.panelFace = face;

  // Panel shell / coaming around it.
  const shell = new THREE.Mesh(new THREE.BoxGeometry(1.62, 0.9, 0.3), shellMat);
  shell.position.set(0, -0.40, -1.10);
  group.add(shell);

  /**
   * The glareshield: a padded hood that overhangs the panel.
   *
   * It was a flat 10 cm strip, which cast nothing and hid nothing. A real one
   * juts out over the instruments — it is what stops the sun landing on the
   * dials, and in here it is what gives the top of the panel an edge to sit
   * under. Built as a lip plus an underside so it reads as thick.
   */
  const hood = new THREE.Mesh(new THREE.BoxGeometry(1.64, 0.09, 0.30), trimMat);
  hood.position.set(0, 0.035, -0.95);
  hood.rotation.x = -0.20;
  group.add(hood);
  // The rolled front edge, a slightly proud cylinder along the lip.
  const lip = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.64, 12), trimMat);
  lip.rotation.z = Math.PI / 2;
  lip.position.set(0, 0.012, -0.815);
  group.add(lip);
  // Underside, darker, so there is a shadow line above the instruments.
  const hoodUnder = new THREE.Mesh(
    new THREE.BoxGeometry(1.6, 0.02, 0.26),
    new THREE.MeshStandardMaterial({ color: 0x0b0d11, roughness: 0.95 })
  );
  hoodUnder.position.set(0, -0.018, -0.94);
  hoodUnder.rotation.x = -0.20;
  group.add(hoodUnder);

  /**
   * Centre pedestal and side consoles.
   *
   * Everything below the panel used to be one flat kick plate, so the throttle
   * quadrant and the trim wheel floated in front of nothing. These give them
   * something to be mounted on, and they close the cabin down towards the
   * floor the way a real one narrows around your knees.
   */
  const pedestal = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.5, 0.34), shellMat);
  pedestal.position.set(0.14, -0.62, -0.66);
  pedestal.rotation.x = -0.16;
  group.add(pedestal);
  for (const side of [-1, 1]) {
    const console_ = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.34, 0.9), trimMat);
    console_.position.set(side * 0.66, -0.72, -0.42);
    group.add(console_);
  }

  // Windscreen posts and roof.
  for (const side of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.9, 0.08), shellMat);
    post.position.set(side * 0.72, 0.35, -0.78);
    post.rotation.x = -0.28;
    post.rotation.z = side * 0.12;
    group.add(post);
    // The cabin sides.
    //
    // These used to be a single 0.62 m panel in a cabin 1.57 m tall and 2.1 m
    // deep, so there was open sky above them, below them, in front of them and
    // behind them — from the pilot's seat the cockpit had holes all round it.
    // Now the side is closed from floor to roof and front to back, with one
    // deliberate gap left where the side window belongs.
    const SIDE_X = side * 0.78;
    const WIN_LOW = -0.12; // window sill
    const WIN_HIGH = 0.32; // window head
    const FLOOR_Y = -0.95;
    const ROOF_Y = 0.62;
    const FRONT_Z = -1.12;
    const BACK_Z = 1.02;
    const wall = (h, y, d, z, mat = shellMat) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.06, h, d), mat);
      m.position.set(SIDE_X, y, z);
      group.add(m);
      return m;
    };
    // Below the window, all the way along.
    wall(WIN_LOW - FLOOR_Y, (WIN_LOW + FLOOR_Y) / 2, BACK_Z - FRONT_Z, (BACK_Z + FRONT_Z) / 2);
    // Above the window, up to the roof.
    wall(ROOF_Y - WIN_HIGH, (ROOF_Y + WIN_HIGH) / 2, BACK_Z - FRONT_Z, (BACK_Z + FRONT_Z) / 2, trimMat);
    // Behind the window, closing the corner to the bulkhead.
    wall(WIN_HIGH - WIN_LOW, (WIN_HIGH + WIN_LOW) / 2, BACK_Z - 0.42, BACK_Z - (BACK_Z - 0.42) / 2);
    // A slim post between the windscreen and the side window.
    wall(WIN_HIGH - WIN_LOW, (WIN_HIGH + WIN_LOW) / 2, 0.16, FRONT_Z + 0.08, trimMat);
  }
  // Roof and floor are widened to meet the side walls — they were narrower
  // than the cabin, which left a seam of daylight down each top corner.
  const roofPanel = new THREE.Mesh(new THREE.BoxGeometry(1.68, 0.06, 2.2), trimMat);
  roofPanel.position.set(0, 0.62, -0.05);
  group.add(roofPanel);
  const bulkhead = new THREE.Mesh(new THREE.BoxGeometry(1.68, 1.62, 0.06), trimMat);
  bulkhead.position.set(0, -0.16, 1.02);
  group.add(bulkhead);

  // Floor and rudder pedals.
  const floor = new THREE.Mesh(new THREE.BoxGeometry(1.68, 0.06, 2.2), trimMat);
  floor.position.set(0, -0.95, -0.05);
  group.add(floor);
  // Close the shin gap between the bottom of the instrument panel and the
  // floor, which was open straight through to the outside world.
  const kick = new THREE.Mesh(new THREE.BoxGeometry(1.68, 0.62, 0.06), shellMat);
  kick.position.set(0, -0.66, -1.1);
  group.add(kick);
  const pedals = [];
  for (const side of [-1, 1]) {
    const p = new THREE.Mesh(
      new THREE.BoxGeometry(0.14, 0.2, 0.05),
      new THREE.MeshStandardMaterial({ color: 0x2a2e34, roughness: 0.7, metalness: 0.3 })
    );
    p.position.set(side * 0.2, -0.78, -0.86);
    p.rotation.x = -0.5;
    group.add(p);
    pedals.push({ mesh: p, side });
  }

  // Yoke: column, hub and horns. Moves with the controls.
  const yoke = makeYoke();
  // Yoke height matters more than it sounds. Sat down at -0.36 it was 53
  // degrees below the pilot's eye line — completely outside the view, so the
  // aeroplane appeared to have no controls at all. Up here it sits in the lower
  // third of the windscreen where a real one does, and you can watch it move.
  yoke.position.set(-0.24, -0.09, -0.5);
  yoke.scale.setScalar(0.85);
  if (style.stick === 'yoke') {
    group.add(yoke);
  } else {
    // A fast jet has a stick between your knees, not a control wheel.
    const stick = makeStick();
    stick.position.set(-0.05, -0.46, -0.42);
    group.add(stick);
    group.userData.stick = stick;
  }

  /* ---------------- Throttle quadrant ---------------- */
  // Three levers, the way a real light single is laid out: black throttle,
  // blue propeller, red mixture, left to right, on the panel's lower centre.
  const quadrant = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.13, 0.18), shellMat);
  quadrant.position.set(0.14, -0.34, -0.8);
  group.add(quadrant);

  // Propeller aeroplanes get throttle / propeller / mixture. Jets get thrust
  // levers — one per engine and nothing else, because that is all there is.
  const throttleLever = makeLever(style.levers === 'prop' ? 0x14171b : 0x22262c, 'round');
  const propLever = makeLever(0x1f4f9c, 'flat');
  const mixture = makeLever(0x8a1f1a, 'ribbed');
  if (style.levers === 'prop') {
    throttleLever.position.set(0.03, -0.4, -0.78);
    propLever.position.set(0.14, -0.4, -0.78);
    mixture.position.set(0.25, -0.4, -0.78);
    group.add(throttleLever, propLever, mixture);
  } else {
    throttleLever.position.set(style.levers === 'jet2' ? 0.09 : 0.14, -0.4, -0.78);
    throttleLever.scale.set(1, 1.3, 1);
    group.add(throttleLever);
    if (style.levers === 'jet2') {
      const second = makeLever(0x22262c, 'round');
      second.position.set(0.2, -0.4, -0.78);
      second.scale.set(1, 1.3, 1);
      group.add(second);
      group.userData.throttle2 = second;
    }
  }

  /* ---------------- Flap lever ---------------- */
  // Sits right of the quadrant and steps through the same detents as the wing.
  const flapBase = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.12, 0.12), shellMat);
  flapBase.position.set(0.4, -0.38, -0.76);
  group.add(flapBase);
  const flapLever = makeLever(0xd9dde3, 'flat');
  flapLever.scale.setScalar(0.85);
  flapLever.position.set(0.4, -0.4, -0.74);
  group.add(flapLever);

  /* ---------------- Trim wheel ---------------- */
  const trimWheel = new THREE.Mesh(
    new THREE.CylinderGeometry(0.075, 0.075, 0.028, 20),
    new THREE.MeshStandardMaterial({ color: 0x24272c, roughness: 0.6, metalness: 0.2 })
  );
  trimWheel.rotation.z = Math.PI / 2;
  trimWheel.position.set(0.14, -0.5, -0.66);
  group.add(trimWheel);

  // Rain on the windscreen (only visible when it is actually raining).
  const dropMat = rainMaterial({ depthTest: false });
  const droplets = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 1.1), dropMat);
  droplets.position.set(0, 0.02, -0.62);
  droplets.renderOrder = 20;
  group.add(droplets);

  // Along the glareshield, tilted back towards the pilot.
  const warn = warningLamps(group, {
    place: (m, i) => {
      m.position.set(-0.34 + i * 0.116, 0.10, -0.96);
      m.rotation.x = -0.42;
    },
    placeMaster: (m) => {
      m.position.set(0.34, 0.165, -0.93);
      m.rotation.x = -0.42;
    },
  });

  let t = 0;
  const env = {};
  group.userData.update = (dt, ac, weather, sim) => {
    t += dt;
    cockpitEnv(weather, sim, env);
    warn.update(t, ac, env);
    // A dead panel is not repainted; it holds what it showed, dimmed.
    if (!env.blackout) panel.update(dt, ac, weather);
    faceMat.emissiveIntensity = env.blackout ? 0.02 : 0.22;
    const c = ac.controls;
    // Yoke: rotate for aileron, push/pull for elevator.
    yoke.rotation.z = lerp(yoke.rotation.z, -c.roll * 0.8, clamp(dt * 10, 0, 1));
    yoke.position.z = lerp(yoke.position.z, -0.52 - c.pitch * 0.07, clamp(dt * 10, 0, 1));
    // Levers rake forward as they are pushed in, exactly like the real thing.
    throttleLever.rotation.x = lerp(throttleLever.rotation.x, 0.5 - c.throttle * 0.9, clamp(dt * 8, 0, 1));
    // Propeller lever tracks rpm; mixture leans off as you climb, which is what
    // a pilot would actually be doing with it.
    propLever.rotation.x = lerp(propLever.rotation.x, 0.5 - clamp(ac.rpm, 0, 1) * 0.85, clamp(dt * 5, 0, 1));
    const lean = clamp((ac.pos.y - 300) / 2400, 0, 0.55);
    mixture.rotation.x = lerp(mixture.rotation.x, -0.4 + lean, clamp(dt * 2, 0, 1));
    // Flap lever steps down through the detents with the flaps themselves.
    flapLever.rotation.x = lerp(flapLever.rotation.x, -0.45 + ac.flaps * 1.1, clamp(dt * 6, 0, 1));
    // Trim wheel winds as the trim runs.
    trimWheel.rotation.y = (ac.trim || 0) * 6;
    for (const p of pedals) {
      p.mesh.position.z = -0.86 + c.yaw * p.side * 0.05;
    }
    // Rain streaks slide across the glass, faster when you fly faster.
    updateRain(dropMat, [droplets], t, ac, weather);
  };
  group.userData.panel = panel;
  group.userData.warnings = warn.lamps;
  group.userData.family = 'generic';
  group.userData.builder = 'generic';

  return group;
}
