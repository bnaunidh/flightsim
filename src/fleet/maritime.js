/** Procedural vessels. Metres, +Y up, -Z forward, +X starboard. No downloaded assets. */
import * as THREE from '../vendor/three.module.js';
import {
  makeModel, addBox, addCylinder, addPlane, addInstanced, makeMaterial,
  paintTexture, registerPart, finishModel, seedRandom, tubeBetween,
} from './common.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp = THREE.MathUtils.clamp;
const DEG = Math.PI / 180;
const identity = new THREE.Quaternion();
function matrix(position, scale = [1, 1, 1], rotation = null) {
  return new THREE.Matrix4().compose(V(...position), rotation || identity, V(...scale));
}
function group(parent, name, position = [0, 0, 0]) {
  const g = new THREE.Group(); g.name = name; g.position.set(...position); parent.add(g); return g;
}
function ownMesh(model, parent, name, geometry, material) {
  model.userData.ownGeometry(geometry);
  const m = new THREE.Mesh(geometry, material); m.name = name;
  m.castShadow = m.receiveShadow = true; parent.add(m); return m;
}
function paint(key, base, type = 'paint') {
  return paintTexture('maritime:' + key, 512, 512, (c, w, h) => {
    c.fillStyle = base; c.fillRect(0, 0, w, h);
    const rnd = seedRandom(5471);
    for (let i = 0; i < 1900; i++) {
      c.fillStyle = i % 2 ? 'rgba(240,240,222,.025)' : 'rgba(18,23,25,.035)';
      c.fillRect(rnd() * w, rnd() * h, type === 'deck' ? 1 : 14, type === 'deck' ? 6 : 1);
    }
    c.lineWidth = 1;
    for (let y = 64; y < h; y += 96) {
      c.strokeStyle = 'rgba(20,26,28,.32)'; c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke();
      c.fillStyle = 'rgba(233,225,202,.18)';
      for (let x = 12; x < w; x += 32) c.fillRect(x, y + 3, 2, 2);
    }
    if (type === 'hull') {
      c.fillStyle = '#bfbdae'; c.fillRect(0, h * .23, w, h * .047);
      c.fillStyle = '#333d42'; c.fillRect(0, h * .72, w, h * .1);
      for (let i = 0; i < 34; i++) {
        c.fillStyle = 'rgba(46,37,26,.13)'; c.fillRect(rnd() * w, h * .64, 2 + rnd() * 6, rnd() * 95);
      }
    }
  });
}
function skyEnvironment() {
  const map = paintTexture('maritime:reflection-sky', 256, 128, (c, w, h) => {
    const g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#799aad'); g.addColorStop(.44, '#b3c4c8');
    g.addColorStop(.52, '#d0d2c7'); g.addColorStop(.56, '#354751'); g.addColorStop(1, '#1c2930');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    c.fillStyle = '#d9dfde'; c.fillRect(16, 37, 48, 7); c.fillRect(90, 25, 35, 9);
    c.fillStyle = '#657785'; c.fillRect(185, 48, 38, 7);
  });
  map.mapping = THREE.EquirectangularReflectionMapping;
  return map;
}
function materials(model, opts = {}) {
  const envMap = opts.envMap || skyEnvironment();
  return {
    hull: makeMaterial(model, { map: paint('hull-' + (opts.color || '#365165'), opts.color || '#365165', 'hull'), roughness: .62, metalness: .25 }),
    metal: makeMaterial(model, { map: paint('steel', '#727b7f'), roughness: .48, metalness: .7, envMap, envMapIntensity: .28 }),
    cabin: makeMaterial(model, { map: paint('cabin', '#c0c1b5'), roughness: .72, metalness: .12 }),
    deck: makeMaterial(model, { map: paint('nonskid', '#697073', 'deck'), roughness: .92, metalness: .12 }),
    dark: makeMaterial(model, { color: 0x222c32, roughness: .78, metalness: .15 }),
    glass: makeMaterial(model, { color: 0x718f9b, roughness: .1, metalness: .7, envMap, envMapIntensity: .9 }),
  };
}

/** Deform a segmented box: the chines keep their hard edges and the transom stays flat. */
function hullMesh(model, parent, name, length, beam, depth, material, deck = false) {
  const geo = new THREE.BoxGeometry(beam, deck ? .07 : depth, length, 1, deck ? 1 : 2, 4);
  const a = geo.attributes.position;
  for (let i = 0; i < a.count; i++) {
    const z = a.getZ(i), station = (z / length) + .5;
    const width = station < .25 ? station * 3.65 + .022 : station < .5 ? .934 + (station - .25) * .264 : 1 - (station - .5) * .17;
    const y = a.getY(i), vertical = deck ? 1 : y / depth + .5;
    const chine = deck ? 1 : vertical < .5 ? .56 + vertical * .75 : .935 + (vertical - .5) * .13;
    a.setXYZ(i, a.getX(i) * width * chine, y + .2 * Math.pow(1 - station, 3), z);
  }
  geo.computeVertexNormals(); geo.computeBoundingBox(); geo.computeBoundingSphere();
  return ownMesh(model, parent, name, geo, material);
}

function fittingBatch(model, parent, name, transforms, material) {
  return addInstanced(model, parent, name, new THREE.BoxGeometry(1, 1, 1), material, transforms);
}
function navLights(model, parent, beam, stern, y) {
  const g = group(parent, 'navigationLights');
  const colors = [0xbe2825, 0x2fa75a, 0xe5e6da];
  const transforms = [matrix([-beam * .43, y, -.6], [.13, .11, .1]), matrix([beam * .43, y, -.6], [.13, .11, .1]), matrix([0, y, stern], [.13, .11, .1])];
  const mat = makeMaterial(model, { color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 1.1, roughness: .45 });
  // Three's instanceColor normally tints diffuse only; navigation lamps need coloured emission too.
  mat.onBeforeCompile = shader => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n#ifdef USE_COLOR\ntotalEmissiveRadiance *= vColor;\n#endif');
  };
  mat.customProgramCacheKey = () => 'maritime-nav-emission-v1';
  const mesh = fittingBatch(model, g, 'red-port_green-starboard_white-stern', transforms, mat);
  colors.forEach((c, i) => mesh.setColorAt(i, new THREE.Color(c))); mesh.instanceColor.needsUpdate = true;
  return { g, mat };
}

function createWaterEffects(model, length, beam) {
  // Particles store world poses and counter-transform their instancing matrix when the boat moves.
  const effects = group(model, 'worldWaterEffects');
  const foamTexture = paintTexture('maritime:foam', 64, 64, (c, w, h) => {
    c.clearRect(0, 0, w, h);
    const grad = c.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, 30);
    grad.addColorStop(0, 'rgba(230,239,234,.55)'); grad.addColorStop(.65, 'rgba(230,239,234,.34)'); grad.addColorStop(1, 'rgba(230,239,234,0)');
    c.fillStyle = grad; c.fillRect(0, 0, w, h);
    const rnd = seedRandom(740);
    for (let i = 0; i < 100; i++) { c.fillStyle = 'rgba(250,252,245,.4)'; c.fillRect(rnd() * w, rnd() * h, 2, 1); }
  });
  const mat = makeMaterial(model, { map: foamTexture, color: 0xe0eee7, transparent: true, opacity: .7, depthWrite: false, side: THREE.DoubleSide, roughness: 1 });
  const geo = new THREE.PlaneGeometry(1, 1); geo.rotateX(-Math.PI / 2);
  const opacities = new THREE.InstancedBufferAttribute(new Float32Array(52), 1);
  geo.setAttribute('particleOpacity', opacities);
  mat.onBeforeCompile = shader => {
    shader.vertexShader = 'attribute float particleOpacity; varying float vParticleOpacity;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvParticleOpacity = particleOpacity;');
    shader.fragmentShader = 'varying float vParticleOpacity;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.a *= vParticleOpacity;');
  };
  mat.customProgramCacheKey = () => 'maritime-particle-opacity-v1';
  const batch = addInstanced(model, effects, 'persistentWakeSprayBubbles', geo, mat, Array.from({ length: 52 }, () => matrix([0, 0, 0], [0, 0, 0])));
  batch.frustumCulled = false; batch.count = 0;
  const bowMat = makeMaterial(model, { map: foamTexture, color: 0xe1eee5, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
  const bow = addInstanced(model, model, 'bowWave', geo.clone(), bowMat, [matrix([-beam * .28, .04, -length * .34], [beam * .42, 1, 1.1]), matrix([beam * .28, .04, -length * .34], [beam * .42, 1, 1.1])]);
  const slickMat = makeMaterial(model, { color: 0x344c53, transparent: true, opacity: .12, roughness: .22, metalness: .35, side: THREE.DoubleSide, depthWrite: false });
  const slick = addPlane(model, effects, 'floodSlick', 1, 1, [0, 0, 0], slickMat); slick.rotation.x = -Math.PI / 2; slick.visible = false;
  const particles = [], rnd = seedRandom(8412), inv = new THREE.Matrix4(), world = new THREE.Matrix4();
  let accumulator = 0, sinkAccumulator = 0, slickOrigin = null, slickAge = 0;
  function emit(local, size, lifetime, type, velocity = V()) {
    if (particles.length >= 52) particles.shift();
    const p = V(...local).applyMatrix4(model.matrixWorld);
    particles.push({ position: p, size, life: lifetime, maxLife: lifetime, type, velocity });
  }
  function update(dt, state, sinking) {
    model.updateWorldMatrix(true, false); inv.copy(model.matrixWorld).invert();
    const sea = Number.isFinite(state.waterLevel) ? state.waterLevel : 0;
    const speed = Math.abs(state.speedMps ?? state.speed ?? 0), turn = clamp(state.steer ?? state.turn ?? 0, -1, 1);
    const plane = clamp((speed - 3) / 10, 0, 1);
    bow.visible = !sinking && speed > .4; bowMat.opacity = clamp(speed / 16, 0, .7);
    for (let i = 0; i < 2; i++) bow.setMatrixAt(i, matrix([(i ? 1 : -1) * beam * (.26 + plane * .1), .05 + plane * .15, -length * (.34 - plane * .05)], [beam * (.3 + plane * .3), 1, 1 + plane * 1.25]));
    bow.instanceMatrix.needsUpdate = true;
    accumulator += dt;
    if (!sinking && speed > .6) while (accumulator >= .12) {
      accumulator -= .12;
      emit([(rnd() - .5) * beam * .6, 0, length * .52], 1 + speed * .045, 5.8, 'wake');
      if (Math.abs(turn) > .12 && speed > 3) {
        const side = Math.sign(turn), q = model.getWorldQuaternion(new THREE.Quaternion());
        emit([side * beam * .48, .15, -length * .16], .3, 1.1, 'spray', V(side * (1 + speed * .14), 1.6, 1.2).applyQuaternion(q));
      }
    } else accumulator = 0;
    if (sinking) {
      if (!slickOrigin) { slickOrigin = model.getWorldPosition(V()); slickOrigin.y = sea + .014; }
      slickAge = Math.min(30, slickAge + dt); sinkAccumulator += dt;
      while (sinkAccumulator > .16) { sinkAccumulator -= .16; emit([(rnd() - .5) * beam * .6, .15, (rnd() - .5) * length * .5], .12, 3, 'bubble', V(0, .7, 0)); }
      slick.visible = true;
      const sw = new THREE.Matrix4().compose(slickOrigin, new THREE.Quaternion().setFromAxisAngle(V(1, 0, 0), -Math.PI / 2), V(beam + slickAge * .32, length * .8 + slickAge * .45, 1));
      slick.matrixAutoUpdate = false; slick.matrix.copy(inv).multiply(sw); slick.matrixWorldNeedsUpdate = true;
    }
    let n = 0;
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i]; p.life -= dt;
      if (p.life <= 0) { particles.splice(i, 1); continue; }
      if (p.type === 'wake') p.position.y = sea + .019;
      else {
        if (p.type === 'spray') p.velocity.y -= 9.81 * dt;
        p.position.addScaledVector(p.velocity, dt);
        if (p.type === 'spray' && p.position.y <= sea) { p.type = 'wake'; p.position.y = sea + .019; p.velocity.set(0, 0, 0); p.life = Math.min(p.life, .5); }
        if (p.position.y > sea && p.type === 'bubble') p.position.y = sea + .022;
      }
      const fade = Math.min(1, p.life / .8), age = 1 - p.life / p.maxLife;
      const size = p.size * (1 + age * (p.type === 'wake' ? 3 : 1)) * Math.sqrt(fade);
      world.compose(p.position, identity, V(size, 1, size * (p.type === 'wake' ? 1.45 : 1)));
      opacities.setX(n, fade * (1 - age * .65));
      batch.setMatrixAt(n++, inv.clone().multiply(world));
    }
    batch.count = n; batch.instanceMatrix.needsUpdate = true; opacities.needsUpdate = true;
  }
  function reset() { particles.length = 0; batch.count = 0; accumulator = sinkAccumulator = slickAge = 0; slickOrigin = null; slick.visible = false; bowMat.opacity = 0; }
  return { update, reset, bow, batch };
}

function waterCrash(model, { length, beam, massKg }, nav, effects) {
  let body = null, saved = null;
  const localCom = V(0, .1, .15), original = new THREE.Matrix4(), inv = new THREE.Matrix4();
  function capsize(opts = {}) {
    if (body) return body;
    if (model.userData.crashBody) throw new Error('Water capsize and land beginCrash must not own the same boat. Reset first.');
    model.updateWorldMatrix(true, false);
    const p = V(), q = new THREE.Quaternion(), s = V(); model.matrixWorld.decompose(p, q, s);
    if (Math.max(Math.abs(s.x - 1), Math.abs(s.y - 1), Math.abs(s.z - 1)) > 1e-4) throw new Error('Boat buoyancy requires unit world scale.');
    saved = { matrix: model.matrix.clone(), matrixAutoUpdate: model.matrixAutoUpdate };
    const readV = (v, fallback) => v ? V(v.x || 0, v.y || 0, v.z || 0) : fallback;
    const m = Number.isFinite(opts.massKg) ? Math.max(20, opts.massKg) : massKg;
    body = {
      position: p.add(localCom.clone().applyQuaternion(q)), quaternion: q,
      velocity: readV(opts.worldVelocity, V()), angularVelocity: readV(opts.worldAngularVelocity, V(0, 0, 4.5)),
      massKg: m, inertia: V(m * (length * length + 1) / 12, m * (length * length + beam * beam) / 12, m * (beam * beam + 1) / 12),
      age: 0, flooding: 0, waterLevel: Number.isFinite(opts.waterLevel) ? opts.waterLevel : 0,
      floodRate: Number.isFinite(opts.floodRate) ? clamp(opts.floodRate, 0, .5) : .048,
    };
    model.userData.waterBody = body;
    return body;
  }
  function step(dt) {
    if (!body) return false;
    let remaining = Math.min(dt, .15);
    const torque = V(), force = V(), r = V(), worldPoint = V(), up = V(0, 1, 0);
    while (remaining > 1e-8) {
      const h = Math.min(remaining, 1 / 120); remaining -= h;
      body.age += h;
      const upright = up.clone().applyQuaternion(body.quaternion).y;
      // Flooding reduces available displacement; it never directly sets a roll or sink pose.
      if (upright < .72 || body.flooding > .015) body.flooding = Math.min(1, body.flooding + h * body.floodRate);
      force.set(0, -body.massKg * 9.81, 0); torque.set(0, 0, 0);
      let wet = 0;
      for (const x of [-beam * .34, beam * .34]) for (const z of [-length * .31, 0, length * .31]) {
        r.set(x, -.43, z).sub(localCom).applyQuaternion(body.quaternion);
        worldPoint.copy(body.position).add(r);
        const submerged = clamp((body.waterLevel - worldPoint.y) / .65, 0, 1);
        wet += submerged / 6;
        const lift = body.massKg * 9.81 / 6 * 1.8 * submerged * (1 - body.flooding * .985);
        const sampleV = body.velocity.y + body.angularVelocity.clone().cross(r).y;
        const fy = Math.max(0, lift - sampleV * body.massKg * .065 * submerged);
        force.y += fy; torque.add(r.clone().cross(V(0, fy, 0)));
      }
      // Flooded water shifts its weight to the low side; this is a coarse free-surface approximation.
      const low = V(0, -1, 0).applyQuaternion(body.quaternion.clone().invert()); low.y = 0;
      if (low.lengthSq() > .001) {
        low.normalize().multiplyScalar(beam * .24 * body.flooding).applyQuaternion(body.quaternion);
        torque.add(low.cross(V(0, -body.massKg * 9.81 * .45, 0)));
      }
      // Broadside quadratic water drag prevents a flooded hull from falling like a stone in air.
      const dragY = .5 * 1000 * length * beam * .45 * wet * body.velocity.y * Math.abs(body.velocity.y);
      force.y -= clamp(dragY, -body.massKg * 45, body.massKg * 45);
      force.x -= body.massKg * .12 * body.velocity.x * Math.abs(body.velocity.x) * wet;
      force.z -= body.massKg * .07 * body.velocity.z * Math.abs(body.velocity.z) * wet;
      const iq = body.quaternion.clone().invert();
      const acceleration = torque.applyQuaternion(iq).divide(body.inertia).applyQuaternion(body.quaternion);
      body.velocity.addScaledVector(force, h / body.massKg).multiplyScalar(Math.exp(-.38 * h));
      body.angularVelocity.addScaledVector(acceleration, h).multiplyScalar(Math.exp(-.65 * h));
      body.position.addScaledVector(body.velocity, h);
      const a = body.angularVelocity.length();
      if (a > 1e-8) body.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(body.angularVelocity.clone().divideScalar(a), a * h)).normalize();
    }
    const p = body.position.clone().sub(localCom.clone().applyQuaternion(body.quaternion));
    original.compose(p, body.quaternion, V(1, 1, 1));
    if (model.parent) { model.parent.updateWorldMatrix(true, false); inv.copy(model.parent.matrixWorld).invert(); original.premultiply(inv); }
    model.matrixAutoUpdate = false; model.matrix.copy(original); model.matrix.decompose(model.position, model.quaternion, model.scale); model.matrixWorldNeedsUpdate = true;
    nav.mat.emissiveIntensity = Math.max(0, 1 - body.flooding * 2);
    return true;
  }
  function reset() {
    if (saved) { model.matrix.copy(saved.matrix); model.matrix.decompose(model.position, model.quaternion, model.scale); model.matrixAutoUpdate = saved.matrixAutoUpdate; model.matrixWorldNeedsUpdate = true; }
    body = saved = null; model.userData.waterBody = null; nav.mat.emissiveIntensity = 1.1; effects.reset();
  }
  model.userData.capsize = capsize; model.userData.waterBody = null;
  return { step, reset, get body() { return body; } };
}

function finishBoat(model, dims, nav, opts, moving = {}) {
  const effects = createWaterEffects(model, dims.length, dims.beam);
  const water = waterCrash(model, dims, nav, effects);
  model.userData.dimensions = dims; model.userData.bowWave = effects.bow;
  model.userData.wake = effects.batch; Object.assign(model.userData, moving);
  return finishModel(model, {
    update(dt, state = {}) {
      water.step(dt);
      if (moving.outboard && !model.userData.strikePoints.outboard?.detached) moving.outboard.rotation.y = clamp(state.steer ?? 0, -1, 1) * .42;
      if (moving.radar) moving.radar.rotation.y += dt * .7;
      effects.update(dt, water.body ? { ...state, waterLevel: water.body.waterLevel } : state, !!water.body);
      if (!water.body) nav.mat.emissiveIntensity = state.lights === false ? 0 : 1.1;
    },
    reset: water.reset,
  });
}

/** Kestrel Launch: 7.4 × 2.6 m hull, fixed cockpit and steerable transom outboard. */
export function createPlayerBoat(opts = {}) {
  const model = makeModel('Kestrel Launch'), mat = materials(model, opts);
  const L = 7.4, B = 2.6;
  const hull = hullMesh(model, model, 'chinedPlaningHull', L, B, .9, mat.hull); hull.position.y = -.08;
  const deck = hullMesh(model, model, 'nonskidDeck', L * .95, B * .91, .06, mat.deck, true); deck.position.y = .39;
  registerPart(model, 'hull', 'Chined hull and deck', [hull, deck], { massKg: 690 });
  const console = group(model, 'helmConsole', [0, .4, -.3]);
  addBox(model, console, 'console', [.78, .78, .56], [0, .38, 0], mat.cabin);
  addBox(model, console, 'dashboard', [.84, .1, .65], [0, .79, 0], mat.dark);
  const screen = addBox(model, console, 'reflectiveWindscreen', [.86, .44, .025], [0, 1.03, -.22], mat.glass); screen.rotation.x = -.22;
  const wheel = addCylinder(model, console, 'helmWheel', .17, .17, .023, 8, [.06, .83, .36], mat.dark, true); wheel.rotation.x = Math.PI / 2;
  addBox(model, console, 'instrumentPanel', [.34, .14, .025], [-.14, .87, .32], makeMaterial(model, { map: paintTexture('maritime:instruments', 128, 64, (c, w, h) => { c.fillStyle = '#222b30'; c.fillRect(0, 0, w, h); c.strokeStyle = '#d9d8c6'; c.lineWidth = 2; for (const x of [22, 63, 104]) { c.beginPath(); c.arc(x, 30, 17, 0, 6.3); c.stroke(); c.beginPath(); c.moveTo(x, 30); c.lineTo(x + 9, 21); c.stroke(); } }), roughness: .65 }));
  registerPart(model, 'console', 'Helm, wheel and windscreen', [console], { massKg: 47, dependsOn: 'hull' });
  const seats = group(model, 'seats');
  fittingBatch(model, seats, 'seatCushions', [matrix([0, .79, .87], [.8, .15, .7]), matrix([0, 1.01, 1.19], [.8, .42, .12]), matrix([0, .62, 2.7], [1.65, .15, .54])], mat.cabin);
  registerPart(model, 'seats', 'Helm seat and aft bench', [seats], { massKg: 24, dependsOn: 'hull' });
  const rails = group(model, 'grabRails');
  const railMatrices = [];
  for (const x of [-B * .42, B * .42]) {
    for (const z of [-1.5, 1.9]) railMatrices.push(matrix([x, .71, z], [.035, .53, .035]));
    railMatrices.push(matrix([x, .98, .2], [.035, .035, 3.45]));
  }
  fittingBatch(model, rails, 'rails', railMatrices, mat.metal);
  const cleats = [];
  for (const x of [-.76, .76]) for (const z of [-2.5, 2.75]) cleats.push(matrix([x, .48, z], [.22, .065, .06]));
  fittingBatch(model, rails, 'cleats', cleats, mat.metal);
  registerPart(model, 'rails', 'Grab rails and cleats', [rails], { massKg: 15, dependsOn: 'hull' });
  const outboard = group(model, 'outboard', [0, .31, 3.58]);
  addBox(model, outboard, 'engineCover', [.49, .62, .43], [0, .25, .24], mat.dark);
  addBox(model, outboard, 'leg', [.12, .72, .16], [0, -.39, .3], mat.metal);
  const prop = addCylinder(model, outboard, 'propellerHub', .08, .08, .21, 5, [0, -.67, .39], mat.metal); prop.rotation.x = Math.PI / 2;
  fittingBatch(model, outboard, 'propellerBlades', [matrix([.12, -.67, .48], [.24, .065, .028]), matrix([-.12, -.67, .48], [.24, .065, .028])], mat.dark);
  registerPart(model, 'outboard', 'Steerable outboard and propeller', [outboard], { massKg: 132, dependsOn: 'hull' });
  const nav = navLights(model, model, B, 3.21, .85);
  registerPart(model, 'navLights', 'Red port, green starboard, white stern lights', [nav.g], { massKg: 2, dependsOn: 'hull' });
  return finishBoat(model, { length: L, beam: B, massKg: 1110 }, nav, opts, { outboard, helmWheel: wheel });
}

/** Small fishing boat, 9.2 × 3 m; a pointed bow, flat transom, sheer, working deck and derrick. */
export function createFishingBoat(opts = {}) {
  const model = makeModel('Kestrel Fishing Boat'), mat = materials(model, { color: '#5d6860', ...opts });
  const L = 9.2, B = 3;
  const hull = hullMesh(model, model, 'chinedFishingHull', L, B, 1.45, mat.hull); hull.position.y = -.12;
  const deck = hullMesh(model, model, 'workingDeck', L * .94, B * .89, .07, mat.deck, true); deck.position.y = .56;
  registerPart(model, 'hull', 'Hull and working deck', [hull, deck], { massKg: 1750 });
  const deckhouse = group(model, 'deckhouse', [0, .58, -.8]);
  addBox(model, deckhouse, 'wheelhouse', [1.78, 1.45, 1.88], [0, .72, 0], mat.cabin);
  addBox(model, deckhouse, 'roof', [1.99, .11, 2.08], [0, 1.48, 0], mat.dark);
  fittingBatch(model, deckhouse, 'bridgeWindows', [matrix([0, 1.07, -.95], [1.45, .47, .025]), matrix([-.9, 1.07, -.08], [.025, .47, 1.27]), matrix([.9, 1.07, -.08], [.025, .47, 1.27])], mat.glass);
  registerPart(model, 'deckhouse', 'Glazed wheelhouse', [deckhouse], { massKg: 220, dependsOn: 'hull' });
  const mast = group(model, 'mastDerrick', [0, .62, .53]);
  tubeBetween(model, mast, 'mast', [0, 0, 0], [0, 3.65, 0], .045, mat.metal, 5);
  tubeBetween(model, mast, 'derrick', [0, 1.4, 0], [0, 2.8, 2.75], .045, mat.metal, 5);
  tubeBetween(model, mast, 'liftingCable', [0, 2.8, 2.75], [0, .55, 2.75], .013, mat.dark, 4);
  tubeBetween(model, mast, 'derrickStay', [0, 3.65, 0], [0, 2.8, 2.75], .012, mat.dark, 4);
  registerPart(model, 'mast', 'Mast, derrick and rigging', [mast], { massKg: 105, dependsOn: 'hull' });
  const nets = group(model, 'netsAndCrates');
  const net = paintTexture('maritime:nets', 128, 128, (c, w, h) => { c.fillStyle = '#4a5950'; c.fillRect(0, 0, w, h); c.strokeStyle = '#889181'; c.lineWidth = 1; for (let k = -128; k < 256; k += 13) { c.beginPath(); c.moveTo(k, 0); c.lineTo(k + 128, 128); c.moveTo(k, 0); c.lineTo(k - 128, 128); c.stroke(); } });
  const netMat = makeMaterial(model, { map: net, roughness: 1 });
  const bundle = addCylinder(model, nets, 'rolledNet', .33, .33, 1.35, 6, [-.73, .88, 2.39], netMat); bundle.rotation.z = Math.PI / 2;
  fittingBatch(model, nets, 'fishCrates', [matrix([.68, .79, 2.1], [.58, .4, .7]), matrix([.67, .78, 2.96], [.6, .36, .68])], mat.cabin);
  registerPart(model, 'nets', 'Fishing nets and deck crates', [nets], { massKg: 45, dependsOn: 'hull' });
  const nav = navLights(model, model, B, 3.95, 1.09);
  registerPart(model, 'navLights', 'Navigation lights', [nav.g], { massKg: 2, dependsOn: 'hull' });
  return finishBoat(model, { length: L, beam: B, massKg: 2720 }, nav, opts);
}

export const CARRIER_DECK = Object.freeze({ length: 300, width: 72, height: 20.8, landingAngleDeg: 9 });
export function carrierDeckTexture() {
  return paintTexture('maritime:carrier-deck', 1024, 2048, (c, w, h) => {
    c.fillStyle = '#3b4246'; c.fillRect(0, 0, w, h);
    const rnd = seedRandom(7717), px = x => (x / 72 + .5) * w, py = z => (z / 300 + .5) * h;
    for (let i = 0; i < 19000; i++) { c.fillStyle = i % 2 ? 'rgba(241,241,221,.038)' : 'rgba(10,15,18,.09)'; c.fillRect(rnd() * w, rnd() * h, 2, 3); }
    const a = 9 * DEG, point = (t, side) => [-10 - Math.sin(a) * t + Math.cos(a) * side, 35 - Math.cos(a) * t - Math.sin(a) * side];
    function line(points, color, width) { c.strokeStyle = color; c.lineWidth = width; c.beginPath(); points.forEach(([x, z], i) => i ? c.lineTo(px(x), py(z)) : c.moveTo(px(x), py(z))); c.stroke(); }
    const corners = [point(-95, -11), point(95, -11), point(95, 11), point(-95, 11)];
    c.fillStyle = '#464d50'; c.beginPath(); corners.forEach(([x, z], i) => i ? c.lineTo(px(x), py(z)) : c.moveTo(px(x), py(z))); c.closePath(); c.fill();
    for (const side of [-10.5, 10.5]) line([point(-95, side), point(95, side)], '#c8c9bd', 3);
    for (let t = -91; t < 95; t += 11) line([point(t, 0), point(t + 6, 0)], '#deded0', 4);
    for (const t of [-57, -48, -39]) for (const side of [-5, 5]) line([point(t, side), point(t + 5, side)], '#d6d5c5', 14);
    line([[11, -137], [11, -28]], '#bdc1b9', 6); line([[13, -137], [13, -28]], '#1f272d', 3);
    line([[-11, -135], [-11, -82]], '#b7bbb3', 5);
    c.font = 'bold 68px sans-serif'; c.fillStyle = '#d2d2c5'; c.fillText('11', px(17), py(-117));
    c.strokeStyle = '#c9bd7d'; c.lineWidth = 3;
    c.setLineDash([7, 10]); c.strokeRect(px(17), py(-35), 16 / 72 * w, 112 / 300 * h); c.setLineDash([]);
    // Subtle touchdown rubber follows the angled approach, not the keel.
    for (let i = 0; i < 90; i++) { const t = -53 + rnd() * 32, side = (rnd() - .5) * 9; line([point(t, side), point(t + rnd() * 16, side)], 'rgba(8,13,17,.06)', 2); }
  });
}

/** Resolute carrier: existing 300 × 72 m envelope, deck surface at y=20.8 m. */
export function createCarrier(opts = {}) {
  const model = makeModel(opts.name || 'CV-11 Resolute'), mat = materials(model, { color: '#48535b', ...opts });
  const H = CARRIER_DECK.height, L = 300, B = 72;
  const hull = hullMesh(model, model, 'carrierHull', L * .96, B * .75, 24, mat.hull); hull.position.y = 7.6;
  registerPart(model, 'hull', 'Carrier hull', [hull], { massKg: 76000000 });
  const deckGeo = new THREE.BoxGeometry(B, 1.6, L, 1, 1, 6), a = deckGeo.attributes.position, uv = deckGeo.attributes.uv;
  for (let i = 0; i < a.count; i++) {
    const z = a.getZ(i), x = a.getX(i), bow = clamp((-z - 75) / 75, 0, 1);
    a.setX(i, x * (1 - bow * .24));
    if (a.getY(i) > 0) uv.setXY(i, a.getX(i) / B + .5, .5 - z / L);
  }
  deckGeo.computeVertexNormals();
  const deckMat = makeMaterial(model, { map: carrierDeckTexture(), roughness: .93, metalness: .18 });
  const deck = ownMesh(model, model, 'angledFlightDeck', deckGeo, deckMat); deck.position.y = H - .8;
  registerPart(model, 'flightDeck', 'Painted angled flight deck', [deck], { massKg: 4600000, dependsOn: 'hull' });
  const island = group(model, 'carrierIsland', [25, H, 23]);
  addBox(model, island, 'islandBase', [10.5, 12, 29], [0, 6, 0], mat.hull);
  addBox(model, island, 'bridge', [13.1, 3.5, 22], [-.6, 13.2, -2], mat.cabin);
  addBox(model, island, 'priFly', [12.4, 3.3, 14.4], [-.8, 17.1, 1.4], mat.hull);
  fittingBatch(model, island, 'bridgeAndPriFlyGlass', [matrix([-.6, 13.5, -13.05], [11.8, 1.65, .08]), matrix([-7.2, 13.5, -2], [.08, 1.65, 20]), matrix([6, 13.5, -2], [.08, 1.65, 20]), matrix([-.8, 17.3, -5.84], [11.3, 1.65, .08]), matrix([-7.04, 17.3, 1.3], [.08, 1.65, 13]), matrix([-.8, 17.3, 8.65], [11.3, 1.65, .08])], mat.glass);
  const mullions = [];
  for (let x = -5; x <= 5; x += 2.5) { mullions.push(matrix([x, 13.5, -13.12], [.16, 1.9, .11])); mullions.push(matrix([x, 17.3, 8.72], [.16, 1.9, .11])); }
  fittingBatch(model, island, 'windowMullions', mullions, mat.hull);
  addBox(model, island, 'bridgeRoof', [13.4, .38, 22.4], [-.6, 15.1, -2], mat.dark);
  addBox(model, island, 'priFlyRoof', [12.8, .38, 14.8], [-.8, 19, 1.4], mat.dark);
  registerPart(model, 'island', 'Glazed bridge and Pri-Fly island', [island], { massKg: 380000, dependsOn: 'flightDeck' });
  const radar = group(island, 'horizonRadar', [0, 29, 0]);
  tubeBetween(model, island, 'radarMast', [0, 19.2, 0], [0, 29.4, 0], .35, mat.metal, 6);
  addBox(model, radar, 'radarArray', [9.8, 3.4, .44], [0, 1.4, 0], makeMaterial(model, { map: paintTexture('maritime:radar', 256, 128, (c, w, h) => { c.fillStyle = '#626b66'; c.fillRect(0, 0, w, h); c.strokeStyle = '#2c383d'; c.lineWidth = 2; for (let x = 0; x < w; x += 16) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, h); c.stroke(); } for (let y = 0; y < h; y += 16) { c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke(); } }), roughness: .68, metalness: .45 }));
  registerPart(model, 'radar', 'Horizon-sweeping radar array', [radar], { massKg: 850, dependsOn: 'island' });
  const wires = group(model, 'arresterGear'), wireMatrices = [], sheaves = [];
  const landingQ = new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), 9 * DEG);
  const wireQ = new THREE.Quaternion().setFromAxisAngle(V(0, 0, 1), Math.PI / 2).premultiply(landingQ);
  const wireCenters = [];
  for (let i = 0; i < 4; i++) {
    const t = -59 + i * 12, center = V(-10 - Math.sin(9 * DEG) * t, H + .045, 35 - Math.cos(9 * DEG) * t);
    wireCenters.push(center.clone()); wireMatrices.push(new THREE.Matrix4().compose(center, wireQ, V(.02, 24, .02)));
    for (const sign of [-1, 1]) { const p = V(sign * 12.3, 0, 0).applyQuaternion(landingQ).add(center); p.y = H + .065; sheaves.push(matrix(p.toArray(), [.3, .11, .45], landingQ)); }
  }
  addInstanced(model, wires, '0.04mArresterWires', new THREE.CylinderGeometry(1, 1, 1, 4, 1, true), mat.dark, wireMatrices);
  fittingBatch(model, wires, 'deckSheaves', sheaves, mat.metal);
  registerPart(model, 'arresterGear', 'Four arrester wires and deck sheaves', [wires], { massKg: 4400, dependsOn: 'flightDeck' });
  const ramp = addBox(model, model, 'sternRampLip', [55, 2.6, 2.2], [0, H - 1.1, 148.9], mat.hull);
  registerPart(model, 'sternRamp', 'Stern ramp strike edge', [ramp], { massKg: 14000, dependsOn: 'hull' });
  const lamps = fittingBatch(model, model, 'deckEdgeLights', Array.from({ length: 28 }, (_, i) => matrix([(i % 2 ? 1 : -1) * 34, H + .12, -63 + Math.floor(i / 2) * 15], [.14, .15, .32])), makeMaterial(model, { color: 0xbfc797, emissive: 0x9ea877, emissiveIntensity: .65 }));
  registerPart(model, 'deckLights', 'Deck edge lights', [lamps], { massKg: 24, dependsOn: 'flightDeck' });
  model.userData.radar = radar; model.userData.deck = { ...CARRIER_DECK };
  model.userData.landingAxis = V(-Math.sin(9 * DEG), 0, -Math.cos(9 * DEG));
  model.userData.arresterWireCenters = wireCenters;
  model.userData.rampStrike = impact => model.userData.strike('sternRamp', impact || {});
  return finishModel(model, { update(dt) { if (!model.userData.strikePoints.radar.detached) radar.rotation.y = (radar.rotation.y + dt * .55) % (Math.PI * 2); }, reset() { radar.rotation.y = 0; } });
}

export const previewModels = [
  { id: 'carrier', label: 'CV-11 Resolute · angled deck', create: () => createCarrier(), updateState: {}, damagePart: 'sternRamp' },
  { id: 'fishing-boat', label: 'Kestrel fishing boat', create: () => createFishingBoat(), updateState: { speedMps: 3, lights: true }, damagePart: 'mast' },
  { id: 'player-boat', label: 'Kestrel Launch', create: () => createPlayerBoat(), updateState: { speedMps: 13, steer: .35, lights: true }, damagePart: 'outboard' },
];
