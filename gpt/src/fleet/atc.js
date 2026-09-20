/** Kestrel tower: preserves the existing 64 m landmark and adds a Y-axis radar. */
import * as THREE from '../vendor/three.module.js';
import { makeModel, addBox, addCylinder, addPlane, addInstanced, makeMaterial,
  paintTexture, registerPart, finishModel, seedRandom } from './common.js';

export function createControlTower({ height = 64, environment = null, airport = 'KESTREL' } = {}) {
  const h = Math.max(30, Math.min(100, Number(height) || 64));
  const g = makeModel('controlTower');
  const concreteMap = paintTexture('tower-concrete', 256, 512, (c, w, hh) => {
    const rnd = seedRandom(2016); c.fillStyle = '#b3b4b0'; c.fillRect(0, 0, w, hh);
    for (let i = 0; i < 2200; i++) { c.fillStyle = `rgba(55,59,54,${rnd() * .11})`; c.fillRect(rnd() * w, rnd() * hh, 1 + rnd() * 3, 1 + rnd() * 9); }
    c.fillStyle = '#777e7c'; for (let y = 42; y < hh; y += 85) { c.fillRect(0, y, w, 1); c.fillRect(20, y - 32, 11, 22); }
  });
  const glassMap = paintTexture('tower-glazing', 256, 256, (c, w, hh) => {
    const grad = c.createLinearGradient(0, 0, 40, hh);
    grad.addColorStop(0, '#82999e'); grad.addColorStop(.45, '#526e75'); grad.addColorStop(.49, '#a3b4b5'); grad.addColorStop(.55, '#3b4e4e'); grad.addColorStop(1, '#273d41');
    c.fillStyle = grad; c.fillRect(0, 0, w, hh);
    c.fillStyle = 'rgba(211,227,223,.12)'; for (let x = 0; x < w; x += 32) c.fillRect(x, 0, 8, hh);
    c.fillStyle = '#394246'; c.fillRect(0, 0, w, 9); c.fillRect(0, hh - 9, w, 9);
  });
  const shaftMat = makeMaterial(g, { map: concreteMap, roughness: .9 });
  const concrete = makeMaterial(g, { color: 0xb8bcb9, roughness: .84 });
  const steel = makeMaterial(g, { color: 0x7d878b, roughness: .45, metalness: .7, envMap: environment });
  const glass = makeMaterial(g, { map: glassMap, roughness: .09, metalness: .45, envMap: environment, envMapIntensity: 1.4 });
  const roofMat = makeMaterial(g, { color: 0x575f61, roughness: .68, metalness: .45 });
  const shaft = addCylinder(g, g, 'Tapered concrete shaft', 4.6, 6.4, h, 8, [0, h / 2, 0], shaftMat);
  const stairs = addBox(g, g, 'Stairwell', [3.6, h, 3.6], [0, h / 2, -6.2], shaftMat);
  const base = addCylinder(g, g, 'Foundation', 6.4, 9.4, 4, 8, [0, 2, 0], concrete);
  const gallery = new THREE.Group(); gallery.name = 'Gallery and guardrails'; g.add(gallery);
  addCylinder(g, gallery, 'Gallery slab', 11.4, 11.4, .5, 8, [0, h - .6, 0], concrete);
  const railMatrices = [], v = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4;
    v.set(Math.sin(a) * 11.1, h + .1, Math.cos(a) * 11.1); q.identity(); s.set(.1, 1.1, .1);
    railMatrices.push(new THREE.Matrix4().compose(v, q, s));
    const b = a + Math.PI / 8;
    v.set(Math.sin(b) * 10.255, h + .65, Math.cos(b) * 10.255); q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), b); s.set(8.50, .1, .1);
    railMatrices.push(new THREE.Matrix4().compose(v, q, s));
  }
  addInstanced(g, gallery, 'Steel guardrails', new THREE.BoxGeometry(1, 1, 1), steel, railMatrices);
  const cab = new THREE.Group(); cab.name = 'Control cab'; g.add(cab);
  addCylinder(g, cab, 'Sloping reflective glazing', 9.4, 7.6, 7, 8, [0, h + 3.4, 0], glass, true);
  const frames = [];
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4; v.set(Math.sin(a) * 8.5, h + 3.4, Math.cos(a) * 8.5);
    q.setFromEuler(new THREE.Euler(.252, a, 0, 'YXZ')); s.set(.17, 7.23, .25);
    frames.push(new THREE.Matrix4().compose(v, q, s));
  }
  addInstanced(g, cab, 'Cab window mullions', new THREE.BoxGeometry(1, 1, 1), steel, frames);
  const roof = new THREE.Group(); roof.name = 'Cab roof'; g.add(roof);
  addCylinder(g, roof, 'Shaded roof brow', 10.8, 10.8, .4, 8, [0, h + 7, 0], concrete);
  addCylinder(g, roof, 'Shallow roof', 0, 10.6, 2.2, 8, [0, h + 8, 0], roofMat);
  const radar = new THREE.Group(); radar.name = 'Azimuth radar assembly'; radar.position.set(0, h + 10.3, 0); g.add(radar);
  addCylinder(g, radar, 'Radar pedestal', .26, .4, 2.2, 6, [0, 0, 0], steel);
  addBox(g, radar, 'Radar array', [5, 1.05, .24], [0, 1.4, 0], concrete);
  addBox(g, radar, 'Radar feed', [.1, .1, .9], [0, 1.4, -.5], steel);
  const mast = addCylinder(g, g, 'Radio aerial', .06, .1, 5.4, 6, [3.2, h + 10.5, 0], steel);
  const lampMat = makeMaterial(g, { color: 0xa52c24, emissive: 0xff3322, emissiveIntensity: .2, roughness: .3 });
  const beacon = addBox(g, g, 'Red obstruction lamp', [.38, .35, .38], [3.2, h + 13.35, 0], lampMat);
  const signMap = paintTexture(`tower-sign-${airport}`, 512, 128, (c, w, hh) => {
    c.fillStyle = '#35464b'; c.fillRect(0, 0, w, hh); c.fillStyle = '#e5e4d7'; c.font = 'bold 48px sans-serif'; c.textAlign = 'center'; c.fillText(String(airport).slice(0, 14), w / 2, 61); c.font = '24px sans-serif'; c.fillText('AIR TRAFFIC CONTROL', w / 2, 99);
  });
  const sign = addPlane(g, g, 'Airport sign', 5.5, 1.375, [0, 6.5, -6.1], makeMaterial(g, { map: signMap, roughness: .8 })); sign.rotation.y = Math.PI;
  registerPart(g, 'foundation', 'Foundation', [base], { massKg: 24000 });
  registerPart(g, 'shaft', 'Tower shaft and stairwell', [shaft, stairs, sign], { massKg: 220000, dependsOn: 'foundation' });
  registerPart(g, 'gallery', 'Gallery and guardrails', [gallery], { massKg: 6000, dependsOn: 'shaft' });
  registerPart(g, 'cab', 'Glazed control cab', [cab], { massKg: 3400, dependsOn: 'shaft' });
  registerPart(g, 'roof', 'Control cab roof', [roof], { massKg: 2100, dependsOn: 'cab' });
  registerPart(g, 'radar', 'Rotating radar array', [radar], { massKg: 160, dependsOn: 'roof' });
  registerPart(g, 'aerial', 'Radio aerial and beacon', [mast, beacon], { massKg: 25, dependsOn: 'roof' });
  let time = 0;
  Object.assign(g.userData, { radar, beacon, controlCab: cab });
  return finishModel(g, { update(dt, state = {}) {
    time += dt;
    if (radar.visible) radar.rotation.y = (radar.rotation.y + dt * (state.radarSpeed ?? .9)) % (Math.PI * 2);
    lampMat.emissiveIntensity = state.night ? (time % 2 < .22 ? 3 : .08) : .08;
  }, reset() { time = 0; radar.rotation.y = 0; lampMat.emissiveIntensity = .08; } });
}

export const previewModels = [{ id: 'control-tower', label: 'Kestrel ATC tower', create: () => createControlTower(), updateState: { night: true }, damagePart: 'radar' }];
