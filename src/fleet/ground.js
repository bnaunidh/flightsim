import * as THREE from '../vendor/three.module.js';
import { makeModel, addBox, addCylinder, addSphere, addPlane, addInstanced,
  makeMaterial, paintTexture, registerPart, finishModel, seedRandom, tubeBetween } from './common.js';

// Metres; +Y up and -Z forward. Procedural ground-service fleet.
const TAU = Math.PI * 2;
const clamp = THREE.MathUtils.clamp;
const V = (a) => a?.isVector3 ? a.clone() : Array.isArray(a) ? new THREE.Vector3(...a) : new THREE.Vector3(a?.x || 0, a?.y || 0, a?.z || 0);
const approach = (value, target, rate, dt) => value + clamp(target - value, -rate * dt, rate * dt);
const group = (parent, name, pos = [0, 0, 0]) => { const g = new THREE.Group(); g.name = name; g.position.set(...pos); parent.add(g); return g; };
const matrix = (p, s = [1, 1, 1], q = new THREE.Quaternion()) => new THREE.Matrix4().compose(V(p), q, V(s));

function panelTexture(color = '#c3c2b6', label = 'AIRFIELD') {
  return paintTexture(`ground-panels:${color}:${label}`, 1024, 512, (c, w, h) => {
    c.fillStyle = color; c.fillRect(0, 0, w, h);
    const random = seedRandom(681);
    for (let i = 0; i < 7000; i++) { c.fillStyle = `rgba(${random() > .55 ? '230,225,203' : '33,37,33'},${random() * .055})`; c.fillRect(random() * w, random() * h, 1 + random() * 3, 1); }
    c.fillStyle = '#354348'; c.fillRect(0, 310, w, 57);
    c.fillStyle = '#aaa280'; c.fillRect(0, 302, w, 5);
    c.strokeStyle = 'rgba(25,30,27,.28)'; c.lineWidth = 2;
    for (const x of [8, 256, 512, 768, 1016]) { c.beginPath(); c.moveTo(x, 7); c.lineTo(x, h - 8); c.stroke(); }
    for (const y of [8, 150, 290, 502]) { c.beginPath(); c.moveTo(8, y); c.lineTo(w - 8, y); c.stroke(); }
    for (let x = 16; x < w; x += 23) for (const y of [15, 143, 283, 496]) { c.fillStyle = 'rgba(27,31,30,.45)'; c.fillRect(x, y, 2, 2); c.fillStyle = 'rgba(235,232,206,.35)'; c.fillRect(x, y + 2, 2, 1); }
    for (let i = 0; i < 90; i++) { c.fillStyle = 'rgba(59,52,39,.13)'; c.fillRect(random() * w, 385 + random() * 113, 1 + random() * 5, 4 + random() * 18); }
    c.font = 'bold 44px sans-serif'; c.fillStyle = '#263336'; c.textAlign = 'center'; c.fillText(label, 512, 242);
    c.font = '18px monospace'; c.fillText('GROUND OPERATIONS  •  07', 512, 277);
  });
}

function windowTexture() {
  return paintTexture('ground-glass-window-v1', 128, 128, (c, w, h) => {
    const g = c.createLinearGradient(0, 0, w, h); g.addColorStop(0, '#b1c6ca'); g.addColorStop(.42, '#63848d'); g.addColorStop(.45, '#a4bcc0'); g.addColorStop(.5, '#506c73'); g.addColorStop(1, '#29454d');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    c.strokeStyle = '#283536'; c.lineWidth = 5; c.strokeRect(1, 1, w - 2, h - 2);
  });
}

function materials(m, opts = {}, label = 'AIRFIELD') {
  const body = makeMaterial(m, { color: 0xffffff, map: panelTexture(opts.color || '#c3c2b6', label), roughness: .62, metalness: .25 });
  const steel = makeMaterial(m, { color: 0x737b7b, roughness: .42, metalness: .72 });
  const dark = makeMaterial(m, { color: 0x263032, roughness: .88 });
  const rubber = makeMaterial(m, { color: 0x252829, roughness: .91, map: paintTexture('ground-tire-v1', 128, 128, (c, w, h) => {
    c.fillStyle = '#575b59'; c.fillRect(0, 0, w, h); c.strokeStyle = '#161b1b'; c.lineWidth = 4;
    for (let y = 0; y < h; y += 12) { c.beginPath(); c.moveTo(0, y); c.lineTo(64, y + 7); c.lineTo(w, y); c.stroke(); }
    c.strokeStyle = '#757b79'; c.lineWidth = 10; c.beginPath(); c.arc(64, 64, 28, 0, TAU); c.stroke();
  }) });
  const glass = makeMaterial(m, { map: windowTexture(), color: 0xc0d4d5, transparent: true, opacity: .45, roughness: .09, metalness: .38, envMap: opts.environmentMap || null, envMapIntensity: 1.25, side: THREE.DoubleSide, depthWrite: false });
  const red = makeMaterial(m, { color: 0x782a25, emissive: 0xcc2111, emissiveIntensity: .05 });
  const amber = makeMaterial(m, { color: 0x8a6424, emissive: 0xffa629, emissiveIntensity: .05 });
  const white = makeMaterial(m, { color: 0xc4d4cb, emissive: 0xe1e4c5, emissiveIntensity: .15 });
  return { body, steel, dark, rubber, glass, red, amber, white };
}

function wheels(m, parent, mat, { x = .91, front = -1.22, rear = 1.22, radius = .34, width = .24, y = radius, name = 'wheels', segments = 8 } = {}) {
  const geo = new THREE.CylinderGeometry(radius, radius, width, segments, 1);
  geo.rotateZ(Math.PI / 2);
  const placements = [[-x, y, front], [x, y, front], [-x, y, rear], [x, y, rear]];
  const mesh = addInstanced(m, parent, name, geo, mat, placements.map(p => matrix(p)));
  let spin = 0;
  function update(dt, speed = 0, steering = 0, compression = 0) {
    if (!mesh.visible) return;
    spin = (spin + speed * dt / radius) % TAU;
    placements.forEach((p, i) => {
      const s = Array.isArray(compression) ? compression[i] || 0 : compression;
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), i < 2 ? steering : 0);
      q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), spin));
      mesh.setMatrixAt(i, matrix([p[0], p[1] + clamp(s, -.1, .18), p[2]], [1, 1, 1], q));
    }); mesh.instanceMatrix.needsUpdate = true;
  }
  return { mesh, radius, update, reset() { spin = 0; update(0); } };
}

function licensePlate(m, parent, name, pos, rear = false) {
  const mat = makeMaterial(m, { map: paintTexture('runabout-license', 256, 64, (c, w, h) => { c.fillStyle = '#cdc9af'; c.fillRect(0, 0, w, h); c.strokeStyle = '#394447'; c.lineWidth = 4; c.strokeRect(3, 3, w - 6, h - 6); c.fillStyle = '#263135'; c.font = 'bold 42px monospace'; c.textAlign = 'center'; c.fillText('IFS 007', w / 2, 47); }), roughness: .6 });
  const mesh = addPlane(m, parent, name, .48, .12, pos, mat); if (!rear) mesh.rotation.y = Math.PI; return mesh;
}

/** Player body motion belongs to the game; speed animates the wheels only. */
export function createAirfieldRunabout(opts = {}) {
  const m = makeModel('Airfield Runabout'); const a = materials(m, opts, 'AIRFIELD');
  const chassis = group(m, 'sprung-chassis');
  const body = addBox(m, chassis, 'lower-body', [1.50, .38, 3.5], [0, .72, 0], a.body);
  const hood = addBox(m, chassis, 'hood', [1.68, .25, 1.05], [0, 1.035, -1.22], a.body);
  const rear = addBox(m, chassis, 'rear-quarter', [1.68, .24, .59], [0, 1.03, 1.4], a.body);
  const roof = addBox(m, chassis, 'roof', [1.57, .08, 1.69], [0, 1.68, .05], a.body);
  // Actual open wheel wells: separate lower sill between each pair of tires;
  // upper sheet metal clears the tire and their recesses stay visibly dark.
  const sill = addInstanced(m, chassis, 'sills-and-arch-lips', new THREE.BoxGeometry(1, 1, 1), a.dark,
    [-1, 1].flatMap(s => [matrix([s * .85, .46, 0], [.06, .18, 1.68]), matrix([s * .865, .75, -1.22], [.025, .07, .86]), matrix([s * .865, .75, 1.22], [.025, .07, .86])]));
  const pillars = addInstanced(m, chassis, 'window-pillars', new THREE.BoxGeometry(1, 1, 1), a.dark,
    [-1, 1].flatMap(x => [-.72, .85].map(z => matrix([x * .755, 1.405, z], [.045, .52, .05]))));
  const windshield = addPlane(m, chassis, 'windshield', 1.46, .51, [0, 1.398, -.775], a.glass); windshield.rotation.y = Math.PI;
  const backGlass = addPlane(m, chassis, 'rear-glass', 1.46, .5, [0, 1.40, .897], a.glass);
  const doors = [-1, 1].map(s => {
    const door = group(chassis, `${s < 0 ? 'left' : 'right'}-door`, [s * .803, 1.12, -.73]);
    const pane = addPlane(m, door, 'side-window', 1.6, .5, [0, .28, .80], a.glass); pane.rotation.y = s * Math.PI / 2;
    const lower = addBox(m, door, 'door-skin', [.035, .28, 1.57], [0, -.1, .80], a.body);
    return door;
  });
  const seats = addInstanced(m, chassis, 'seats', new THREE.BoxGeometry(1, 1, 1), a.dark,
    [-.42, .42].flatMap(x => [matrix([x, .94, .16], [.52, .13, .6]), matrix([x, 1.20, .42], [.5, .52, .13])]));
  const dash = addBox(m, chassis, 'dashboard', [1.41, .12, .29], [0, 1.18, -.56], a.dark);
  const steeringGeo = m.userData.ownGeometry(new THREE.TorusGeometry(.135, .018, 3, 8));
  const steeringWheel = new THREE.Mesh(steeringGeo, a.dark); steeringWheel.name = 'steering-wheel'; steeringWheel.position.set(-.42, 1.23, -.35); steeringWheel.rotation.x = -.4; chassis.add(steeringWheel);
  const mirrors = addInstanced(m, chassis, 'door-mirrors', new THREE.BoxGeometry(.13, .11, .2), a.steel, [-1, 1].map(s => matrix([s * .93, 1.36, -.62])));
  const frontLights = addInstanced(m, chassis, 'headlights', new THREE.PlaneGeometry(.32, .17), a.white, [-1, 1].map(s => matrix([s * .57, .91, -1.756], [1, 1, 1], new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI))));
  const brakeLights = addInstanced(m, chassis, 'brake-lights', new THREE.PlaneGeometry(.27, .17), a.red, [-1, 1].map(s => matrix([s * .60, .91, 1.756])));
  const indicatorMaterials = [-1, 1].map(() => makeMaterial(m, { color: 0x977739, emissive: 0xffa31d, emissiveIntensity: .04 }));
  const indicators = [-1, 1].map((s, i) => addInstanced(m, chassis, `${s < 0 ? 'left' : 'right'}-indicators`, new THREE.PlaneGeometry(.12, .12), indicatorMaterials[i], [matrix([s * .76, .91, -1.761], [1, 1, 1], new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI)), matrix([s * .76, .91, 1.761])]));
  const beacon = group(chassis, 'rotating-roof-beacon', [0, 1.78, .08]);
  const beaconLens = addCylinder(m, beacon, 'amber-lens', .09, .11, .13, 6, [0, 0, 0], a.amber);
  const reflector = addPlane(m, beacon, 'rotating-reflector', .15, .08, [0, .005, .001], a.white); reflector.material = makeMaterial(m, { color: 0xdcc28c, emissive: 0xffbd43, emissiveIntensity: .8, side: THREE.DoubleSide });
  const frontPlate = licensePlate(m, chassis, 'front-number-plate', [0, .65, -1.762]); const rearPlate = licensePlate(m, chassis, 'rear-number-plate', [0, .65, 1.762], true);
  const wheelSet = wheels(m, m, a.rubber);
  registerPart(m, 'body', 'Chassis and floor', [body, sill, seats, dash, steeringWheel, frontPlate, rearPlate], { massKg: 480 });
  registerPart(m, 'hood', 'Hood and headlights', [hood, frontLights], { massKg: 32 });
  registerPart(m, 'rearPanel', 'Rear panel and brake lamps', [rear, brakeLights], { massKg: 25 });
  registerPart(m, 'roof', 'Roof and pillars', [roof, pillars, windshield, backGlass], { massKg: 47 });
  registerPart(m, 'leftDoor', 'Left door', [doors[0], indicators[0]], { massKg: 26 });
  registerPart(m, 'rightDoor', 'Right door', [doors[1], indicators[1]], { massKg: 26 });
  registerPart(m, 'wheels', 'Wheel and axle assembly', [wheelSet.mesh], { massKg: 90 });
  registerPart(m, 'mirrors', 'Mirrors', [mirrors], { massKg: 2 });
  registerPart(m, 'beacon', 'Roof beacon', [beacon], { massKg: 1.5 });
  let time = 0; const controls = { speed: 0, steering: 0, braking: false, headlights: true, beacon: true, doorOpen: 0, suspension: 0 };
  Object.assign(m.userData, { chassis, wheels: wheelSet.mesh, doors, steeringWheel, beacon, controls,
    rollCrash(options = {}) { return m.userData.beginCrash({ massKg: 900, centerOfMass: { x: 0, y: .78, z: 0 }, worldAngularVelocity: { x: .1, y: 0, z: 2.1 }, ...options }); } });
  return finishModel(m, { update(dt, state = {}) {
    Object.assign(controls, state); time += dt; if (m.userData.crashBody) return;
    const steer = clamp(controls.steering || 0, -1, 1);
    const compression = Array.isArray(controls.suspension) ? controls.suspension.reduce((x, y) => x + y, 0) / 4 : controls.suspension || 0;
    chassis.position.y = approach(chassis.position.y, -clamp(compression, -.08, .16), .5, dt);
    wheelSet.update(dt, controls.speed || 0, steer * .52, controls.suspension);
    steeringWheel.rotation.z = -steer * 1.9;
    doors.forEach((d, i) => { if (d.visible) d.rotation.y = approach(d.rotation.y, (i ? -1 : 1) * clamp(controls.doorOpen || 0, 0, 1) * 1.05, 1.3, dt); });
    a.red.emissiveIntensity = controls.braking ? 2.2 : .10; a.white.emissiveIntensity = controls.headlights ? 1.2 : .06;
    indicatorMaterials.forEach((mat, i) => { mat.emissiveIntensity = (controls.hazard || (i ? steer > .2 : steer < -.2)) && time % .85 < .43 ? 2 : .04; });
    if (beacon.visible) beacon.rotation.y += controls.beacon ? dt * 5.5 : 0;
    a.amber.emissiveIntensity = controls.beacon ? .6 : .02;
  }, reset() { time = 0; chassis.position.y = 0; wheelSet.reset(); doors.forEach(d => d.rotation.y = 0); } });
}

function serviceBase(name, opts, label, size = [2.2, .8, 3.6]) {
  const m = makeModel(name); const a = materials(m, opts, label); const motion = group(m, 'ground-path-motion');
  const body = addBox(m, motion, 'chassis', size, [0, .76, 0], a.body);
  const cab = group(motion, 'cab', [0, 0, -.82]);
  const roof = addBox(m, cab, 'cab-roof', [1.77, .09, 1.22], [0, 1.96, 0], a.body);
  const panes = addInstanced(m, cab, 'cab-glazing', new THREE.PlaneGeometry(1, 1), a.glass, [matrix([0, 1.62, -.63], [1.72, .6, 1]), matrix([-.89, 1.62, 0], [1.22, .6, 1], new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2)), matrix([.89, 1.62, 0], [1.22, .6, 1], new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 2))]);
  const seat = addBox(m, cab, 'empty-driver-seat', [.55, .52, .45], [-.45, 1.43, .15], a.dark);
  const beacon = addCylinder(m, cab, 'beacon', .09, .12, .16, 6, [0, 2.08, 0], a.amber);
  const wheelSet = wheels(m, motion, a.rubber, { x: size[0] * .47, front: -size[2] * .33, rear: size[2] * .33, radius: .39 });
  registerPart(m, 'chassis', 'Main chassis', [body], { massKg: 1050 });
  registerPart(m, 'cab', 'Operator cab', [cab], { massKg: 95 });
  registerPart(m, 'wheels', 'Wheels and axles', [wheelSet.mesh], { massKg: 135 });
  return { m, a, motion, body, cab, wheelSet, beacon };
}

function pathSampler(path, closed = true) {
  let points = path?.map(V);
  if (!points || points.length < 2) points = Array.from({ length: 24 }, (_, i) => new THREE.Vector3(Math.sin(i / 24 * TAU) * 9, 0, Math.cos(i / 24 * TAU) * 9));
  const segments = [], last = closed ? points.length : points.length - 1; let length = 0;
  for (let i = 0; i < last; i++) { const start = points[i], end = points[(i + 1) % points.length]; const len = start.distanceTo(end); if (len > .001) { segments.push({ start, end, at: length, len }); length += len; } }
  if (!segments.length) throw new Error('Ground path must contain two distinct points.');
  return { length, sample(distance) {
    const d = closed ? ((distance % length) + length) % length : clamp(distance, 0, length - .000001);
    const s = segments.find(x => d < x.at + x.len) || segments[segments.length - 1];
    const p = s.start.clone().lerp(s.end, (d - s.at) / s.len); const tangent = s.end.clone().sub(s.start).normalize();
    return { position: p, yaw: Math.atan2(-tangent.x, -tangent.z) };
  } };
}

/** User-supplied towing target is moved only when explicitly provided. */
export function createPushbackTug(opts = {}) {
  const { m, a, motion, wheelSet } = serviceBase('Pushback tug', opts, 'PUSHBACK', [2.4, .71, 3.9]);
  const hook = group(motion, 'tow-hook', [0, .44, 2.8]);
  const bar = tubeBetween(m, hook, 'towbar', [0, 0, -1], [0, 0, .38], .065, a.steel, 6);
  const hitch = addCylinder(m, hook, 'hitch-pin', .1, .1, .2, 6, [0, 0, .36], a.steel);
  registerPart(m, 'towHook', 'Towbar and hitch pin', [hook], { massKg: 34 });
  const path = pathSampler(opts.path || [[0, 0, 0], [0, 0, -18], [6, 0, -27]], false);
  let distance = 0, time = 0;
  const controls = { moving: false, speed: 1.2 }; const hookPose = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() };
  Object.assign(m.userData, { motion, towHook: hook, towHitchPin: hitch, controls, pathLength: path.length, getTowHookPose() { hitch.updateWorldMatrix(true, false); hitch.getWorldPosition(hookPose.position); hitch.getWorldQuaternion(hookPose.quaternion); return hookPose; } });
  return finishModel(m, { update(dt, state = {}) {
    Object.assign(controls, state); time += dt; if (m.userData.crashBody) return;
    const speed = controls.moving && distance < path.length ? clamp(controls.speed || 0, 0, 3) : 0; distance = Math.min(path.length, distance + speed * dt);
    const pose = path.sample(distance); motion.position.copy(pose.position); motion.rotation.y = pose.yaw; wheelSet.update(dt, speed);
    a.amber.emissiveIntensity = time % 1 < .45 ? 1.2 : .08;
    const hp = m.userData.getTowHookPose();
    if (opts.towTarget && hook.visible) {
      // Anchor is supplied in the target's LOCAL coordinates (for example its nose-gear hitch).
      const target = opts.towTarget; const anchor = V(opts.targetTowPoint || [0, 0, -4]);
      const desiredQ = hp.quaternion.clone(); const scale = target.getWorldScale(new THREE.Vector3());
      const desiredP = hp.position.clone().sub(anchor.multiply(scale).applyQuaternion(desiredQ));
      const local = new THREE.Matrix4().compose(desiredP, desiredQ, scale);
      if (target.parent) { target.parent.updateWorldMatrix(true, false); local.premultiply(target.parent.matrixWorld.clone().invert()); }
      local.decompose(target.position, target.quaternion, target.scale); target.updateMatrix();
    }
    if (opts.onTowPose && hook.visible) opts.onTowPose(hp, speed);
  }, reset() { distance = 0; time = 0; motion.position.set(0, 0, 0); motion.rotation.set(0, 0, 0); wheelSet.reset(); } });
}

export function createBaggageTrain(opts = {}) {
  const { m, a, motion, wheelSet } = serviceBase('Baggage train', opts, 'BAGGAGE', [1.7, .6, 2.65]);
  const count = clamp(Math.round(opts.trailers ?? 3), 1, 5), trailers = [], trailerWheels = [];
  for (let i = 0; i < count; i++) {
    const cart = group(m, `trailer-${i + 1}`); trailers.push(cart);
    addBox(m, cart, 'cart-bed', [1.74, .24, 2.32], [0, .68, 0], a.steel);
    addBox(m, cart, 'canvas-baggage-cover', [1.70, 1.0, 2.2], [0, 1.25, 0], a.body);
    const link = tubeBetween(m, cart, 'drawbar', [0, .52, -1.1], [0, .52, -1.9], .045, a.steel, 5);
    const w = wheels(m, cart, a.rubber, { x: .89, front: -.78, rear: .78, radius: .27, width: .17, segments: 6 }); trailerWheels.push(w);
    registerPart(m, `trailer${i + 1}`, `Baggage trailer ${i + 1}`, [cart], { massKg: 210 });
  }
  const path = pathSampler(opts.path, true); let distance = 0, time = 0; const controls = { moving: true, speed: 1.8 };
  Object.assign(m.userData, { motion, trailers, controls, pathLength: path.length });
  function place() {
    [motion, ...trailers].forEach((vehicle, i) => { if (!vehicle.visible) return; const p = path.sample(distance - i * 3.15); vehicle.position.copy(p.position); vehicle.rotation.y = p.yaw; });
  }
  place();
  return finishModel(m, { update(dt, state = {}) {
    Object.assign(controls, state); time += dt; if (m.userData.crashBody) return;
    const speed = controls.moving ? clamp(controls.speed || 0, -3, 3) : 0; distance += speed * dt; place();
    wheelSet.update(dt, speed); trailerWheels.forEach(w => w.update(dt, speed)); a.amber.emissiveIntensity = time % 1 < .4 ? 1 : .05;
  }, reset() { distance = 0; place(); wheelSet.reset(); trailerWheels.forEach(w => w.reset()); } });
}

export function createCateringLift(opts = {}) {
  const { m, a, motion, cab, wheelSet } = serviceBase('Catering lift truck', opts, 'CATERING', [2.35, .65, 5.2]);
  cab.position.z = -1.92;
  const platform = group(motion, 'lifting-platform', [0, 1.45, .55]);
  addBox(m, platform, 'insulated-catering-box', [2.28, 1.55, 3.45], [0, .89, 0], a.body);
  addBox(m, platform, 'platform-floor', [2.42, .14, 3.68], [0, 0, 0], a.steel);
  const servingDoor = group(platform, 'serving-door', [0, .25, -1.738]);
  const doorLeaf = addPlane(m, servingDoor, 'serving-door-leaf', 1.72, 1.2, [0, .59, 0], a.body); doorLeaf.rotation.y = Math.PI;
  const scissors = addInstanced(m, motion, 'paired-scissor-arms', new THREE.BoxGeometry(1, 1, 1), a.steel, Array.from({ length: 4 }, () => matrix([0, 1, 0])));
  registerPart(m, 'liftBox', 'Catering box and platform', [platform], { massKg: 580 });
  registerPart(m, 'scissors', 'Four linked lift arms', [scissors], { massKg: 170 });
  const armLength = 3.08, baseY = 1.05, midZ = .55; let height = 1.45;
  const controls = { lift: 0, doorOpen: 0, speed: 0 };
  function sync() {
    platform.position.y = height;
    const rise = height - baseY, horizontal = Math.sqrt(Math.max(.01, armLength * armLength - rise * rise));
    let i = 0;
    for (const x of [-.95, .95]) for (const direction of [-1, 1]) {
      const start = new THREE.Vector3(x, baseY, midZ - direction * horizontal / 2), end = new THREE.Vector3(x, height, midZ + direction * horizontal / 2);
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), end.clone().sub(start).normalize());
      scissors.setMatrixAt(i++, matrix(start.add(end).multiplyScalar(.5), [.09, armLength, .1], q));
    } scissors.instanceMatrix.needsUpdate = true;
  }
  sync(); Object.assign(m.userData, { platform, scissors, servingDoor, controls, liftRange: [1.45, 3.8] });
  return finishModel(m, { update(dt, state = {}) {
    Object.assign(controls, state); if (m.userData.crashBody) return;
    if (platform.visible && scissors.visible) { height = approach(height, 1.45 + 2.35 * clamp(controls.lift || 0, 0, 1), .45, dt); sync(); }
    servingDoor.position.y = .25 + 1.18 * clamp(controls.doorOpen || 0, 0, 1); wheelSet.update(dt, controls.speed || 0);
  }, reset() { height = 1.45; servingDoor.position.y = .25; sync(); wheelSet.reset(); } });
}

export function createAirbridge(opts = {}) {
  const m = makeModel('Telescoping airbridge'), a = materials(m, opts, 'GATE 02');
  const pivot = group(m, 'terminal-pivot');
  const tunnelPitch = group(pivot, 'tunnel-pitch-hinge', [0, 3.6, 0]);
  const rotunda = addCylinder(m, m, 'terminal-rotunda', 1.4, 1.4, 2.3, 10, [0, 3.6, 0], a.body);
  const outer = addBox(m, tunnelPitch, 'outer-tunnel', [2.4, 2.25, 5.2], [0, 0, -2.6], a.body);
  const inner = addBox(m, tunnelPitch, 'inner-tunnel', [2.23, 2.07, 5.15], [0, 0, -5.5], a.body);
  const head = group(pivot, 'aircraft-end-cab', [0, 3.6, -8]);
  addBox(m, head, 'dock-cab', [2.5, 2.2, 1.55], [0, 0, 0], a.body);
  const gasket = addBox(m, head, 'rubber-docking-gasket', [2.55, 2.24, .19], [0, 0, -.86], a.dark);
  const window = addPlane(m, head, 'operator-window', .94, 1.03, [-1.255, .14, 0], a.glass); window.rotation.y = -Math.PI / 2;
  const column = addCylinder(m, pivot, 'telescoping-lift-column', .24, .24, 1, 8, [0, 1.5, -7.4], a.steel);
  const bogie = group(pivot, 'steering-bogie', [0, 0, -7.4]);
  addBox(m, bogie, 'bogie-crossbar', [2.8, .22, .48], [0, .4, 0], a.steel);
  const wheelSet = wheels(m, bogie, a.rubber, { x: 1.18, front: -.38, rear: .38, radius: .32, width: .21, segments: 6 });
  registerPart(m, 'rotunda', 'Terminal rotunda', [rotunda], { massKg: 1200 });
  registerPart(m, 'outerTunnel', 'Outer tunnel', [outer], { massKg: 1900 });
  registerPart(m, 'innerTunnel', 'Telescoping inner tunnel', [inner], { massKg: 1400 });
  registerPart(m, 'dockingCab', 'Aircraft docking cab', [head], { massKg: 580 });
  registerPart(m, 'liftColumn', 'Lifting column', [column], { massKg: 340 });
  registerPart(m, 'bogie', 'Powered bogie', [bogie], { massKg: 440 });
  const controls = { extension: .45, height: 3.6, rotation: 0 }; let extension = .45, height = 3.6, yaw = 0;
  const previousBogiePosition = new THREE.Vector3();
  Object.assign(m.userData, { pivot, tunnelPitch, outerTunnel: outer, innerTunnel: inner, dockingCab: head, bogie, controls, dockingRange: { distance: [6.255, 9.755], doorSillHeight: [1.7, 4.1] },
    dockTo(worldDoorPosition) {
      m.updateWorldMatrix(true, false); const p = V(worldDoorPosition).applyMatrix4(m.matrixWorld.clone().invert());
      const distance = Math.hypot(p.x, p.z); controls.extension = clamp((distance - 6.255) / 3.5, 0, 1); controls.rotation = Math.atan2(-p.x, -p.z); controls.height = clamp(p.y + 1.1, 2.8, 5.2);
      return { withinReach: distance >= 6.255 && distance <= 9.755 && p.y >= 1.7 && p.y <= 4.1, requestedDistance: distance };
    } });
  function sync(dt) {
    const distance = 5.3 + extension * 3.5; pivot.rotation.y = yaw;
    const pitch = Math.atan2(height - 3.6, distance);
    const slopedDistance = Math.hypot(distance, height - 3.6);
    tunnelPitch.rotation.x = pitch;
    inner.position.set(0, 0, -(slopedDistance - 2.4)); head.position.set(0, height, -distance);
    column.position.set(0, (height - 1.15 + .55) / 2, -(distance - .6)); column.scale.y = height - 1.15 - .55;
    bogie.position.z = -(distance - .6);
    const nextBogiePosition = new THREE.Vector3(-Math.sin(yaw) * (distance - .6), 0, -Math.cos(yaw) * (distance - .6));
    const travel = nextBogiePosition.clone().sub(previousBogiePosition);
    if (dt > 0 && travel.lengthSq() > 1e-12) bogie.rotation.y = Math.atan2(-travel.x, -travel.z) - yaw;
    wheelSet.update(dt, dt > 0 ? travel.length() / dt : 0); previousBogiePosition.copy(nextBogiePosition);
  }
  sync(0);
  return finishModel(m, { update(dt, state = {}) {
    Object.assign(controls, state); if (m.userData.crashBody) return;
    extension = approach(extension, clamp(controls.extension, 0, 1), .11, dt); height = approach(height, clamp(controls.height, 2.8, 5.2), .18, dt);
    const delta = Math.atan2(Math.sin(controls.rotation - yaw), Math.cos(controls.rotation - yaw)); yaw += clamp(delta, -.13 * dt, .13 * dt); sync(dt);
  }, reset() { extension = .45; height = 3.6; yaw = 0; sync(0); } });
}

/** Independent terminal sliding-door module; can mount in any building. */
export function createTerminalDoors(opts = {}) {
  const m = makeModel('Terminal automatic doors'), a = materials(m, opts, 'ARRIVALS');
  const frame = addInstanced(m, m, 'door-frame', new THREE.BoxGeometry(1, 1, 1), a.steel, [matrix([-1.55, 1.3, 0], [.12, 2.6, .22]), matrix([1.55, 1.3, 0], [.12, 2.6, .22]), matrix([0, 2.58, 0], [3.22, .15, .22])]);
  const leaves = [-1, 1].map(s => { const g = group(m, `${s < 0 ? 'left' : 'right'}-leaf`, [s * .75, 1.28, 0]); addPlane(m, g, 'safety-glass', 1.45, 2.46, [0, 0, 0], a.glass); addBox(m, g, 'door-stile', [.055, 2.46, .055], [s * .70, 0, 0], a.steel); return g; });
  registerPart(m, 'frame', 'Door frame and motor track', [frame], { massKg: 60 });
  registerPart(m, 'leftDoor', 'Left sliding door', [leaves[0]], { massKg: 29 }); registerPart(m, 'rightDoor', 'Right sliding door', [leaves[1]], { massKg: 29 });
  let open = 0; const controls = { open: 0 }; Object.assign(m.userData, { leaves, controls });
  return finishModel(m, { update(dt, state = {}) { Object.assign(controls, state); if (m.userData.crashBody) return; open = approach(open, clamp(controls.open, 0, 1), .8, dt); leaves.forEach((leaf, i) => { if (leaf.visible) leaf.position.x = (i ? 1 : -1) * (.75 + 1.42 * open); }); }, reset() { open = 0; leaves.forEach((leaf, i) => leaf.position.x = (i ? 1 : -1) * .75); } });
}

export function createParkedAircraft(opts = {}) {
  const m = makeModel('Parked regional aircraft'), a = materials(m, { ...opts, color: opts.color || '#d0cec1' }, 'ISLAND AIR');
  const fuselage = addSphere(m, m, 'fuselage', 1, 12, 7, [0, 1.75, 0], a.body); fuselage.scale.set(.8, .85, 4.65);
  const windowsMat = makeMaterial(m, { map: paintTexture('parked-airliner-windows', 512, 64, (c, w, h) => { c.clearRect(0, 0, w, h); for (let x = 14; x < w - 15; x += 39) { c.fillStyle = '#8aafb8'; c.fillRect(x, 8, 21, 41); c.fillStyle = '#263d45'; c.fillRect(x + 2, 11, 17, 34); c.fillStyle = '#96b1b5'; c.fillRect(x + 4, 13, 12, 4); } }), transparent: true, roughness: .18, metalness: .45, side: THREE.DoubleSide, envMap: opts.environmentMap || null });
  const windowGeometry = new THREE.PlaneGeometry(5.9, .36, 12, 1);
  const windowPositions = windowGeometry.attributes.position;
  for (let i = 0; i < windowPositions.count; i++) {
    const z = windowPositions.getX(i), y = windowPositions.getY(i) + .23;
    windowPositions.setZ(i, .8 * Math.sqrt(Math.max(.01, 1 - (z / 4.65) ** 2 - (y / .85) ** 2)) - .797 + .015);
  }
  windowGeometry.computeVertexNormals();
  const windows = addInstanced(m, m, 'cabin-window-rows', windowGeometry, windowsMat, [-1, 1].map(s => matrix([s * .797, 1.98, -.05], [1, 1, 1], new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), s * Math.PI / 2))));
  const cockpit = addInstanced(m, m, 'cockpit-glazing', new THREE.PlaneGeometry(.73, .33), a.glass, [-1, 1].map(s => matrix([s * .46, 2.13, -3.58], [1, 1, 1], new THREE.Quaternion().setFromEuler(new THREE.Euler(0, s * .9, -.12)))));
  const wing = addBox(m, m, 'wing', [10.7, .13, 1.5], [0, 1.48, .24], a.body);
  // Shape the primitive's vertices for taper and sweep; no imported mesh.
  const wp = wing.geometry.attributes.position;
  for (let i = 0; i < wp.count; i++) { const x = wp.getX(i); wp.setZ(i, wp.getZ(i) * (1 - .56 * Math.abs(x) / 5.35) + Math.abs(x) * .22); } wp.needsUpdate = true; wing.geometry.computeVertexNormals();
  const flaps = [-1, 1].map(s => { const f = group(m, `${s < 0 ? 'left' : 'right'}-flap`, [s * 2.5, 1.47, 1.3]); addBox(m, f, 'drooping-flap', [2.7, .06, .42], [0, 0, .20], a.body); f.rotation.x = .12; return f; });
  const tailplane = addBox(m, m, 'tailplane', [3.5, .09, .7], [0, 2.15, 3.56], a.body);
  const fin = addBox(m, m, 'tail-fin', [.13, 1.8, 1.25], [0, 2.74, 3.63], a.body);
  const elevators = [-1, 1].map(s => { const e = group(m, `${s < 0 ? 'left' : 'right'}-elevator`, [s * .96, 2.15, 3.93]); addBox(m, e, 'elevator-surface', [1.3, .045, .23], [0, 0, .1], a.body); e.rotation.x = .1; return e; });
  const engines = addInstanced(m, m, 'engine-nacelles', new THREE.CylinderGeometry(.35, .38, 1.5, 8), a.body, [-1, 1].map(s => matrix([s * 1.91, 1.17, -.48], [1, 1, 1], new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2))));
  const intakes = addInstanced(m, m, 'dark-engine-intakes', new THREE.CircleGeometry(.29, 8), a.dark, [-1, 1].map(s => matrix([s * 1.91, 1.17, -1.235], [1, 1, 1], new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI))));
  const gear = addInstanced(m, m, 'landing-gear', new THREE.CylinderGeometry(.24, .24, .20, 6), a.rubber, [[-.71, .24, .72], [.71, .24, .72], [0, .24, -2.75]].map(p => matrix(p, [1, 1, 1], new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2))));
  const struts = addInstanced(m, m, 'landing-struts', new THREE.CylinderGeometry(.06, .06, 1, 5), a.steel, [[-.71, .86, .72], [.71, .86, .72], [0, .67, -2.75]].map(p => matrix(p, [1, p[1] * 1.1, 1])));
  const cabinDoor = group(m, 'cabin-door-hinge', [-.695, 1.84, -2.65]);
  addBox(m, cabinDoor, 'cabin-door', [.04, 1.1, .61], [0, 0, .3], a.body);
  const beacon = addSphere(m, m, 'anti-collision-beacon', .08, 5, 3, [0, 2.61, .2], a.red);
  const strobe = addInstanced(m, m, 'wingtip-strobes', new THREE.PlaneGeometry(.12, .12), a.white, [-1, 1].map(s => matrix([s * 5.37, 1.48, 1.42])));
  const apuMaterial = makeMaterial(m, { color: 0xb0c3bd, transparent: true, opacity: .045, side: THREE.DoubleSide, depthWrite: false });
  const apu = addPlane(m, m, 'APU-shimmer', .44, 1.2, [0, 1.89, 5.10], apuMaterial); apu.rotation.x = Math.PI / 2;
  registerPart(m, 'fuselage', 'Fuselage and cabin windows', [fuselage, windows, cockpit], { massKg: 2800 });
  registerPart(m, 'wing', 'Main wing', [wing], { massKg: 900 });
  registerPart(m, 'leftFlap', 'Left flap', [flaps[0]], { massKg: 33 }); registerPart(m, 'rightFlap', 'Right flap', [flaps[1]], { massKg: 33 });
  registerPart(m, 'tailplane', 'Horizontal tail', [tailplane], { massKg: 130 }); registerPart(m, 'tailFin', 'Vertical tail', [fin], { massKg: 115 });
  registerPart(m, 'elevators', 'Elevators', elevators, { massKg: 29 }); registerPart(m, 'engines', 'Engine nacelles', [engines, intakes], { massKg: 820 });
  registerPart(m, 'landingGear', 'Landing gear', [gear, struts], { massKg: 290 }); registerPart(m, 'cabinDoor', 'Cabin entrance door', [cabinDoor], { massKg: 38 }); registerPart(m, 'lights', 'Beacons and strobes', [beacon, strobe], { massKg: 3 });
  let time = 0; const controls = { doorOpen: 0, apu: true, lights: true, controlDroop: .15 };
  Object.assign(m.userData, { cabinDoor, flaps, elevators, apuShimmer: apu, controls, doorWorldPosition(target = new THREE.Vector3()) { m.updateWorldMatrix(true, true); return target.set(-.72, 1.28, -2.4).applyMatrix4(m.matrixWorld); } });
  return finishModel(m, { update(dt, state = {}) {
    Object.assign(controls, state); time += dt;
    a.red.emissiveIntensity = controls.lights && time % 1.3 < .12 ? 3 : .05;
    a.white.emissiveIntensity = controls.lights && (time % 1.1 < .05 || (time % 1.1 > .12 && time % 1.1 < .17)) ? 4 : .1;
    apu.visible = !!controls.apu && !m.userData.crashBody; apu.scale.x = 1 + Math.sin(time * 3) * .15; apuMaterial.opacity = .035 + Math.sin(time * 4.4) * .012;
    if (m.userData.crashBody) return;
    cabinDoor.rotation.y = approach(cabinDoor.rotation.y, -clamp(controls.doorOpen || 0, 0, 1) * 1.3, .75, dt);
    [...flaps, ...elevators].forEach(f => { if (f.visible) f.rotation.x = approach(f.rotation.x, clamp(controls.controlDroop, 0, .35), .25, dt); });
  }, reset() { time = 0; cabinDoor.rotation.y = 0; [...flaps, ...elevators].forEach(f => f.rotation.x = .12); } });
}

export const previewModels = [
  { id: 'runabout', label: 'Airfield Runabout', create: () => createAirfieldRunabout(), updateState: { speed: 4, steering: .3, suspension: .07 }, damagePart: 'hood' },
  { id: 'airbridge', label: 'Telescoping airbridge', create: () => createAirbridge(), updateState: { extension: .8, height: 4.1, rotation: .24 }, damagePart: 'dockingCab' },
  { id: 'tug', label: 'Pushback tug', create: () => createPushbackTug(), updateState: { moving: false }, damagePart: 'towHook' },
  { id: 'baggage-train', label: 'Baggage train', create: () => createBaggageTrain({ path: [[0, 0, -8], [0, 0, 10], [9, 0, 10], [9, 0, -8]] }), updateState: { moving: true }, damagePart: 'trailer2' },
  { id: 'catering-lift', label: 'Catering lift', create: () => createCateringLift(), updateState: { lift: .8, doorOpen: .8 }, damagePart: 'liftBox' },
  { id: 'parked-aircraft', label: 'Parked regional aircraft', create: () => createParkedAircraft(), updateState: { doorOpen: .6 }, damagePart: 'tailFin' },
  { id: 'terminal-doors', label: 'Automatic terminal doors', create: () => createTerminalDoors(), updateState: { open: .4 }, damagePart: 'leftDoor' },
];
