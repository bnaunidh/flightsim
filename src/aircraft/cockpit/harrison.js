/**
 * T-Pose Harrison's view: his own head, and the readout he flies by.
 *
 * He has no aeroplane round him — "his head is the nose of the plane"
 * (extra/tpose.js) — so there is no room to build, and until this file his
 * family ('none') fell to the generic box, which eject.js then hid every
 * frame: the cockpit view was nothing at all, the runway at wheel height
 * and no instruments (the GM's audit of 2026-10-27, "tpose: NO cockpit").
 *
 * What a man flying head-first at 940 km/h gets instead: the jet HUD's
 * symbology (displays.js paintHUD — speed, height, heading, the pitch
 * ladder, the velocity vector) floating a little ahead of his eyes as if on
 * a visor, and his own two arms out at the edge of the picture — he is in a
 * T-pose, so from his eyes his arms run out left and right at shoulder
 * height, hands at the tips — which is what tells you whose eyes these are.
 * Nothing else: no panel, no frame, no glass, no seat.
 *
 * Cheap on Low: one HUD canvas at 12 Hz, two arms of two boxes each.
 * The cockpit camera, free-look and the hat are the rig's as for any type.
 */

import * as THREE from '../../vendor/three.module.js';
import { TRAINER_EYE, cockpitEnv } from './common.js';
import { Display, DisplayBus, readFlight, paintHUD } from './displays.js';
import { roundedBox, part } from './kit.js';

/** Where the HUD's eye is in the realistic cockpit view (flight/camera.js REALISTIC_OFFSET). */
const REALISTIC = new THREE.Vector3(0, -0.02, 0.16);

export function buildHarrisonView(ctx) {
  const { type } = ctx;
  const group = new THREE.Group();
  group.name = 'cockpit';
  const E = new THREE.Vector3(...TRAINER_EYE);

  /* ---- The visor: the HUD a forearm's length ahead of the eyes ---- */
  const dist = 0.6;
  const wc = 0.34;
  const hc = 0.26;
  const zH = E.z - dist;
  const top = E.y + hc * 0.45;
  const base = top - hc;
  const geom = { boreY: (top - E.y) / hc, ppd: 1 };
  const hud = new Display({
    name: 'visor HUD',
    w: 512,
    h: Math.round((512 * hc) / wc),
    widthM: wc,
    heightM: hc,
    hud: true,
    hz: 12,
    colour: new THREE.Color(0x9dffb4).multiplyScalar(0.9),
    paint: (g, w, h, d) => {
      const real = !!d.realistic;
      const D = dist + (real ? REALISTIC.z : 0);
      const eyeY = E.y + (real ? REALISTIC.y : 0);
      geom.ppd = (w / wc) * D * Math.tan(Math.PI / 180);
      geom.boreY = (top - eyeY) / hc;
      paintHUD(g, w, h, d, { pxPerDeg: () => geom.ppd, boreY: geom.boreY });
    },
  });
  hud.mesh.position.set(E.x, (top + base) / 2, zH);
  hud.mesh.renderOrder = 40;
  // A visor draws over everything; there is nothing of his to hide it.
  hud.material.depthTest = false;
  hud.userData = geom;
  group.add(hud.mesh);
  const bus = new DisplayBus({ hz: 12, maxPerFrame: 1 });
  bus.add(hud);

  /* ---- His arms, out to each side at shoulder height ---- */
  // The eyes sit about 0.14 m ahead of and 0.1 m above the shoulder line
  // (models/tpose-harrison.js EYE_M); each arm runs 0.9 m out from a
  // shoulder 0.2 m off the centreline, sleeve then hand.
  const sleeve = new THREE.MeshStandardMaterial({ color: 0x3a6fb5, roughness: 0.85 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xd9a788, roughness: 0.7 });
  const yArm = E.y - 0.12;
  const zArm = E.z + 0.16;
  for (const s of [-1, 1]) {
    const upper = part(group, roundedBox(0.42, 0.11, 0.12, 0.04), sleeve, E.x + s * 0.41, yArm, zArm, 'upper arm');
    upper.rotation.z = s * 0.03;
    part(group, roundedBox(0.4, 0.09, 0.1, 0.035), sleeve, E.x + s * 0.82, yArm + 0.01, zArm, 'forearm');
    part(group, roundedBox(0.16, 0.035, 0.09, 0.015), skin, E.x + s * 1.1, yArm + 0.015, zArm - 0.01, 'hand');
  }

  /* ---- Live ---- */
  const env = {};
  let lastAc = null;
  let lastSim = null;
  let painted = false;
  const read = (out) => {
    readFlight(lastAc, lastSim, out, 1);
    out.realistic = !!(lastSim && lastSim.settings && lastSim.settings.realisticCockpit);
  };
  group.userData.update = (dt, ac, weather, sim) => {
    lastAc = ac;
    lastSim = sim || null;
    cockpitEnv(weather, sim, env);
    if (!painted) {
      painted = true;
      bus.paintAll(read, env);
    } else bus.update(dt, read, env);
    hud.material.opacity = env.blackout ? 0 : 1;
  };
  group.userData.displays = [hud];
  group.userData.bus = bus;
  group.userData.hud = hud;
  group.userData.family = 'none';
  group.userData.builder = `harrison:${(type && type.id) || 'tpose'}`;
  group.userData.eye = E.clone();
  group.userData.viewPitchDeg = 0;
  return group;
}
