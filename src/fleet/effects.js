import * as THREE from '../vendor/three.module.js';
import { makeModel, addBox, addCylinder, addSphere, addPlane, addInstanced,
  makeMaterial, paintTexture, registerPart, finishModel, seedRandom }
  from './common.js';
import { createDamageTestAirframe } from './aircraft-upgrades.js';

// Procedural effects only: metres, +Y up, -Z forward. No downloaded textures.
const clamp = THREE.MathUtils.clamp;
const TAU = Math.PI * 2;
const v3 = (v, fallback = [0, 0, 0]) => v && typeof v.x === 'number'
  ? new THREE.Vector3(v.x, v.y, v.z) : new THREE.Vector3(...(v || fallback));
const pose = new THREE.Object3D();
function ownedMesh(model, name, geometry, material, parent = model) {
  model.userData.ownGeometry(geometry);
  const mesh = new THREE.Mesh(geometry, material); mesh.name = name;
  parent.add(mesh); return mesh;
}
function cameraQuaternion(model, camera, target) {
  model.updateWorldMatrix(true, false);
  model.getWorldQuaternion(target).invert();
  if (camera) {
    camera.updateWorldMatrix(true, false);
    target.multiply(camera.getWorldQuaternion(new THREE.Quaternion()));
  } else target.identity();
  return target;
}
function particleAtlas() {
  return paintTexture('effects-particle-atlas-v1', 512, 256, (ctx, w, h) => {
    const random = seedRandom(3181), tile = 128;
    ctx.clearRect(0, 0, w, h);
    for (let frame = 0; frame < 8; frame++) {
      const ox = frame % 4 * tile, oy = Math.floor(frame / 4) * tile;
      ctx.save(); ctx.beginPath(); ctx.rect(ox + 2, oy + 2, tile - 4, tile - 4); ctx.clip();
      const clumps = frame < 4 ? 11 : frame < 6 ? 5 : 1;
      for (let j = 0; j < clumps; j++) {
        const cx = ox + 64 + (random() - .5) * 40;
        const cy = oy + 64 + (random() - .5) * 40;
        const radius = frame === 7 ? 35 : 22 + random() * 28;
        const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
        gradient.addColorStop(0, frame === 7 ? 'rgba(255,255,255,.95)' : 'rgba(255,255,255,.24)');
        gradient.addColorStop(.45, 'rgba(255,255,255,.16)');
        gradient.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = gradient; ctx.fillRect(ox, oy, tile, tile);
      }
      if (frame === 6) {
        ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(ox + 64, oy + 64, 29, 0, TAU); ctx.stroke();
      }
      ctx.restore();
    }
  });
}

// All particles share a single draw call; each instance selects an atlas tile.
// Quad orientation is updated from the actual camera; no fixed crossed sprites.
function particlePool(model, name, capacity, { additive = false } = {}) {
  const geometry = new THREE.PlaneGeometry(1, 1);
  const tint = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
  const frame = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 2), 2);
  geometry.setAttribute('particleTint', tint); geometry.setAttribute('particleFrame', frame);
  const material = new THREE.ShaderMaterial({
    uniforms: { atlas: { value: particleAtlas() } },
    transparent: true, depthWrite: false, depthTest: true,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    side: THREE.DoubleSide,
    vertexShader: `attribute vec4 particleTint;
      attribute vec2 particleFrame;
      varying vec2 atlasUV; varying vec4 tint;
      void main() {
        atlasUV = (particleFrame + vec2(.02) + uv * .96) / vec2(4., 2.);
        tint = particleTint;
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.);
      }`,
    fragmentShader: `uniform sampler2D atlas;
      varying vec2 atlasUV; varying vec4 tint;
      void main() {
        vec4 texel = texture2D(atlas, atlasUV);
        gl_FragColor = vec4(tint.rgb, texel.a * tint.a);
        if (gl_FragColor.a < .002) discard;
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  model.userData.ownMaterial(material);
  const matrices = Array.from({ length: capacity }, () => new THREE.Matrix4().makeScale(0, 0, 0));
  const mesh = addInstanced(model, model, name, geometry, material, matrices);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.frustumCulled = false;
  tint.setUsage(THREE.DynamicDrawUsage); frame.setUsage(THREE.DynamicDrawUsage);
  mesh.count = 0;
  const particles = [], facing = new THREE.Quaternion(), spin = new THREE.Quaternion();
  const axis = new THREE.Vector3(0, 0, 1);
  function draw(camera) {
    cameraQuaternion(model, camera, facing);
    mesh.count = Math.min(capacity, particles.length);
    for (let i = 0; i < mesh.count; i++) {
      const p = particles[i];
      pose.position.copy(p.position); pose.quaternion.copy(facing);
      spin.setFromAxisAngle(axis, p.rotation || 0); pose.quaternion.multiply(spin);
      pose.scale.set(p.size * (p.aspect || 1), p.size, 1); pose.updateMatrix();
      mesh.setMatrixAt(i, pose.matrix);
      tint.setXYZW(i, p.color.r, p.color.g, p.color.b, p.opacity);
      frame.setXY(i, p.frame % 4, 1 - Math.floor(p.frame / 4));
    }
    mesh.instanceMatrix.needsUpdate = true; tint.needsUpdate = true; frame.needsUpdate = true;
  }
  return { mesh, particles, draw, capacity };
}
function basicParticle(position, frame = 0) {
  return { position, velocity: new THREE.Vector3(), age: 0, life: 1,
    frame, rotation: 0, size: 1, opacity: 0, color: new THREE.Color(0xffffff) };
}

/** Curved three-sheet fall with optional camera yaw, foam and bounded mist. */
export function createWaterfall(opts = {}) {
  const g = makeModel('Waterfall'), width = Math.max(1, opts.width ?? 16);
  const height = Math.max(2, opts.height ?? 55), random = seedRandom(opts.seed ?? 810);
  const texture = paintTexture('waterfall-streams-v1', 256, 512, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    for (let i = 0; i < 78; i++) {
      const x = random() * w, stripe = 1 + random() * 5;
      const gradient = ctx.createLinearGradient(0, 0, 0, h);
      gradient.addColorStop(0, 'rgba(180,210,212,.08)');
      gradient.addColorStop(.2, 'rgba(203,224,224,.54)');
      gradient.addColorStop(.8, 'rgba(233,239,234,.25)');
      gradient.addColorStop(1, 'rgba(200,220,220,.08)');
      ctx.fillStyle = gradient; ctx.fillRect(x, 0, stripe, h);
      ctx.fillStyle = 'rgba(248,250,245,.2)';
      ctx.fillRect(x, random() * h, stripe * .5, 8 + random() * 85);
    }
  }, { repeat: [1, 2] });
  const material = makeMaterial(g, { map: texture, color: 0xc2d7d9, transparent: true,
    opacity: .62, roughness: .3, metalness: 0, side: THREE.DoubleSide,
    forceSinglePass: true, depthWrite: false });
  // Texture cache remains immutable: each waterfall owns its scrolling transform.
  const flowMap = texture.clone(); flowMap.needsUpdate = true; material.map = flowMap;
  const sheets = new THREE.Group(); sheets.name = 'Curved water sheets'; g.add(sheets);
  for (let layer = 0; layer < 3; layer++) {
    const geometry = new THREE.CylinderGeometry(width * .58, width * .67,
      height * (1 - layer * .035), 8, 4, true, -.95, 1.9);
    const sheet = ownedMesh(g, `Water curtain ${layer + 1}`, geometry, material, sheets);
    sheet.position.set((layer - 1) * width * .1, height / 2, -width * .4 + layer * .65);
    sheet.rotation.y = (layer - 1) * .28;
  }
  const foamTexture = paintTexture('waterfall-pool-foam-v1', 256, 128, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    const gradient = ctx.createRadialGradient(w / 2, h / 2, 10, w / 2, h / 2, w * .48);
    gradient.addColorStop(0, 'rgba(236,242,231,.5)');
    gradient.addColorStop(.5, 'rgba(220,237,229,.25)');
    gradient.addColorStop(1, 'rgba(200,220,215,0)');
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(230,240,229,.18)'; ctx.lineWidth = 2;
    for (let i = 0; i < 15; i++) {
      ctx.beginPath(); ctx.ellipse(w / 2 + (random() - .5) * 100,
        h / 2 + (random() - .5) * 50, 10 + random() * 25, 2 + random() * 7, 0, 0, TAU); ctx.stroke();
    }
  });
  const foamMaterial = makeMaterial(g, { color: 0xc7d5d1, map: foamTexture,
    transparent: true, opacity: .5, roughness: .9, side: THREE.DoubleSide,
    forceSinglePass: true, depthWrite: false });
  const foam = addPlane(g, g, 'Pool foam', width * 1.5, width * .75, [0, .08, 2], foamMaterial);
  foam.rotation.x = -Math.PI / 2;
  const pool = particlePool(g, 'Impact mist', 36);
  for (let i = 0; i < 36; i++) {
    const p = basicParticle(new THREE.Vector3(), i % 6); p.age = random() * 3;
    p.life = 2 + random() * 2; p.seed = random(); pool.particles.push(p);
  }
  let time = 0;
  g.userData.sheets = sheets; g.userData.mist = pool.mesh;
  g.userData.effectExemption = 'Water, foam and vapour are not solid breakaway components.';
  return finishModel(g, { update(dt, state = {}) {
    time += dt; flowMap.offset.y = (time * .34) % 1;
    if (state.camera) {
      const cp = g.worldToLocal(state.camera.getWorldPosition(new THREE.Vector3()));
      sheets.rotation.y = Math.atan2(cp.x, cp.z);
    }
    for (const p of pool.particles) {
      p.age = (p.age + dt) % p.life; const a = p.age / p.life;
      p.position.set((p.seed - .5) * width * 1.3, .5 + a * width * .35,
        1 + Math.sin(p.seed * 27) * 2 + a * width * .28);
      p.size = width * (.15 + a * .25); p.opacity = Math.sin(a * Math.PI) * .2;
      p.rotation = p.seed * TAU + a * .1; p.color.setRGB(.68, .76, .76);
    }
    pool.draw(state.camera);
  }, reset() { time = 0; }, dispose() { flowMap.dispose(); } });
}

/** Lit reef geometry entirely below the sea plane; the game's water remains separate. */
export function createReef(opts = {}) {
  const g = makeModel('Submerged reef'), width = opts.width ?? 75, depth = Math.max(2, opts.depth ?? 6);
  const seaLevel = opts.seaLevel ?? 0, random = seedRandom(opts.seed ?? 171);
  const texture = paintTexture('reef-seabed-v1', 512, 256, (ctx, w, h) => {
    ctx.fillStyle = '#627e75'; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 1600; i++) {
      ctx.fillStyle = ['#59766b', '#718775', '#526f69', '#8b9379'][i % 4];
      ctx.fillRect(random() * w, random() * h, 1 + random() * 7, 1 + random() * 4);
    }
    ctx.strokeStyle = 'rgba(192,202,153,.18)'; ctx.lineWidth = 2;
    for (let row = 0; row < 12; row++) {
      ctx.beginPath(); ctx.moveTo(0, row * 24);
      for (let x = 0; x <= w; x += 16) ctx.lineTo(x, row * 24 + Math.sin(x * .04 + row) * 6);
      ctx.stroke();
    }
  });
  const bedMaterial = makeMaterial(g, { color: 0xb6d5c7, map: texture, roughness: .96 });
  const bed = addPlane(g, g, 'Submerged sand and coral bed', width, width * .36,
    [0, seaLevel - depth, 0], bedMaterial); bed.rotation.x = -Math.PI / 2;
  const rockMaterial = makeMaterial(g, { color: 0xffffff, map: texture, roughness: 1, metalness: 0 });
  const matrices = [];
  for (let i = 0; i < 18; i++) {
    const height = .5 + random() * Math.min(1.4, depth * .2);
    pose.position.set((random() - .5) * width * .92, seaLevel - depth + height * .45,
      (random() - .5) * width * .28);
    pose.rotation.set(0, random() * TAU, (random() - .5) * .4);
    pose.scale.set(1.7 + random() * 3, height, 1.4 + random() * 2);
    pose.updateMatrix(); matrices.push(pose.matrix.clone());
  }
  const rocks = addInstanced(g, g, 'Coral outcrops', new THREE.SphereGeometry(1, 6, 3), rockMaterial, matrices);
  for (let i = 0; i < 18; i++) rocks.setColorAt(i, new THREE.Color().setHSL(.12 + random() * .24, .12, .63 + random() * .16));
  registerPart(g, 'coralOutcrops', 'Coral rock outcrops', [rocks], { massKg: 2400 });
  g.userData.seaLevel = seaLevel; g.userData.reefDepth = depth;
  g.userData.waterVisibility = 'Render through transparent water or the game underwater pass; reef geometry does not float above water.';
  return finishModel(g);
}

/** Deforming low-poly lava surface with independent drifting crust islands. */
export function createLavaLake(opts = {}) {
  const g = makeModel('Lava lake'), radius = Math.max(4, opts.radius ?? 46);
  const random = seedRandom(opts.seed ?? 963);
  const lavaTexture = paintTexture('lava-convection-v1', 512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#7b1708'; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 24; i++) {
      const x = random() * w, y = random() * h, r = 25 + random() * 100;
      const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, '#ffbf46'); grad.addColorStop(.23, '#e76312');
      grad.addColorStop(1, 'rgba(112,15,3,0)'); ctx.fillStyle = grad;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    ctx.strokeStyle = '#ffcc69'; ctx.lineWidth = 1;
    for (let i = 0; i < 15; i++) {
      let x = random() * w, y = random() * h; ctx.beginPath(); ctx.moveTo(x, y);
      for (let j = 0; j < 6; j++) { x += (random() - .5) * 40; y += random() * 25; ctx.lineTo(x, y); }
      ctx.stroke();
    }
  });
  const lavaMaterial = makeMaterial(g, { map: lavaTexture, emissiveMap: lavaTexture,
    color: 0xc96022, emissive: 0xff873c, emissiveIntensity: 1.4, roughness: .6,
    side: THREE.DoubleSide });
  const geometry = new THREE.RingGeometry(0, radius, 24, 3); geometry.rotateX(-Math.PI / 2);
  const surface = ownedMesh(g, 'Moving lava convection surface', geometry, lavaMaterial);
  const rest = geometry.attributes.position.array.slice();
  const crustTexture = paintTexture('lava-crust-v1', 256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#302c29'; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 1000; i++) {
      ctx.fillStyle = i % 3 ? '#39332f' : '#201d1a';
      ctx.fillRect(random() * w, random() * h, 1 + random() * 7, 1 + random() * 6);
    }
    ctx.strokeStyle = '#b23c10'; ctx.lineWidth = 2;
    for (let i = 0; i < 12; i++) {
      const x = random() * w; ctx.beginPath(); ctx.moveTo(x, 0);
      ctx.lineTo(x + 19, 80); ctx.lineTo(x - 13, 163); ctx.lineTo(x + 9, h); ctx.stroke();
    }
  });
  const crustMaterial = makeMaterial(g, { color: 0x6b5c4c, map: crustTexture, roughness: .98 });
  const plates = [], matrices = [];
  for (let i = 0; i < 12; i++) {
    const angle = i * 2.39996, distance = radius * (.2 + .58 * Math.sqrt((i + .5) / 12));
    plates.push({ angle, distance, size: radius * (.08 + random() * .035), phase: random() * TAU });
    matrices.push(new THREE.Matrix4());
  }
  const crust = addInstanced(g, g, 'Rafting crust plates', new THREE.CylinderGeometry(1, 1.07, .7, 5), crustMaterial, matrices);
  registerPart(g, 'crustPlates', 'Solid lava crust plates', [crust], { massKg: 8000 });
  let time = 0;
  function animate(dt) {
    time += dt; const positions = geometry.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      const x = rest[i * 3], z = rest[i * 3 + 2], edge = 1 - Math.pow(Math.hypot(x, z) / radius, 4);
      positions.setY(i, edge * (.45 * Math.sin(x * .12 + time * .32)
        + .35 * Math.cos(z * .16 - time * .26) + .18 * Math.sin((x + z) * .21 + time * .51)));
    }
    positions.needsUpdate = true; geometry.computeVertexNormals();
    if (crust.visible) for (let i = 0; i < plates.length; i++) {
      const p = plates[i], phase = time * .035 + p.phase;
      const distance = p.distance + Math.sin(phase) * radius * .042;
      pose.position.set(Math.sin(p.angle + phase * .03) * distance,
        .55 + Math.sin(phase * 2) * .17, Math.cos(p.angle + phase * .03) * distance);
      pose.rotation.set(Math.sin(phase) * .028, p.angle + time * .011, Math.cos(phase) * .025);
      pose.scale.set(p.size * 1.35, 1, p.size); pose.updateMatrix(); crust.setMatrixAt(i, pose.matrix);
    }
    crust.instanceMatrix.needsUpdate = true;
  }
  animate(0); g.userData.surface = surface; g.userData.crust = crust;
  g.userData.effectExemption = 'Molten fluid is not a breakaway mesh; solid crust is a strike part.';
  return finishModel(g, { update: animate, reset() { time = 0; animate(0); } });
}

/** Camera-facing, varied ash sprites. Wind is a WORLD-space velocity in m/s. */
export function createAshPlume(opts = {}) {
  const g = makeModel('Ash plume'), count = clamp(Math.round(opts.count ?? 180), 8, 340);
  const random = seedRandom(opts.seed ?? 721), pool = particlePool(g, 'Ash particles', count);
  const height = opts.height ?? 180, baseRadius = opts.radius ?? 7;
  let time = 0;
  for (let i = 0; i < count; i++) {
    const p = basicParticle(new THREE.Vector3(), Math.floor(random() * 6));
    p.seed = random(); p.phase = random() * TAU; p.life = 12 + random() * 15;
    p.age = random() * p.life; p.baseSize = 5 + random() * 7; pool.particles.push(p);
  }
  const wind = new THREE.Vector3(), inv = new THREE.Quaternion();
  g.userData.particles = pool.mesh; g.userData.effectExemption = 'Ash and hot gas are particles, not rigid components.';
  return finishModel(g, { update(dt, state = {}) {
    time += dt; wind.copy(v3(state.wind, [3, 0, 1]));
    g.getWorldQuaternion(inv).invert(); wind.applyQuaternion(inv);
    for (const p of pool.particles) {
      p.age = (p.age + dt) % p.life; const a = p.age / p.life, swell = baseRadius * (1 + a * 3);
      p.position.set(Math.cos(p.phase + a * 2) * swell + wind.x * p.age * .65,
        a * height + Math.sin(p.phase + time * .24) * a * 2,
        Math.sin(p.phase + a * 1.6) * swell + wind.z * p.age * .65);
      p.size = p.baseSize * (1 + a * 3.5); p.rotation = p.phase + a * .5;
      p.opacity = Math.sin(Math.PI * a) * (.33 + p.seed * .23);
      const grey = .21 + a * .16 + p.seed * .08;
      p.color.setRGB(grey + Math.max(0, .13 - a) * 1.2, grey, grey * .95);
    }
    pool.draw(state.camera);
  }, reset() { time = 0; } });
}

/** Short-lived ballistic sparks: white-yellow hot core cools to dull red. */
export function createEmbers(opts = {}) {
  const g = makeModel('Volcanic embers'), count = clamp(Math.round(opts.count ?? 64), 4, 90);
  const random = seedRandom(opts.seed ?? 827), pool = particlePool(g, 'Cooling sparks', count, { additive: true });
  const gravity = opts.gravity ?? 4.5, height = opts.height ?? 22;
  const glowScale = clamp(opts.glowScale ?? 1, .25, 4);
  function spawn(p, scatter = false) {
    const burnTime = 2.4 + random() * 3.4;
    p.seed = random(); p.rotation = random() * TAU; p.baseSize = (.18 + random() * .55) * glowScale;
    p.origin = new THREE.Vector3((random() - .5) * 6, 0, (random() - .5) * 6);
    p.velocity.set((random() - .5) * 7, Math.sqrt(2 * gravity * height) * (.65 + random() * .5), (random() - .5) * 7);
    // Expire by return to the emitter plane: sparks do not remain alive underground.
    p.life = Math.min(burnTime, 2 * p.velocity.y / gravity);
    p.age = scatter ? random() * p.life : 0;
  }
  for (let i = 0; i < count; i++) { const p = basicParticle(new THREE.Vector3(), 7); spawn(p, true); pool.particles.push(p); }
  const wind = new THREE.Vector3(), inv = new THREE.Quaternion();
  g.userData.particles = pool.mesh; g.userData.effectExemption = 'Small glowing particles are not collidable vehicle parts.';
  return finishModel(g, { update(dt, state = {}) {
    wind.copy(v3(state.wind, [2, 0, 0])); g.getWorldQuaternion(inv).invert(); wind.applyQuaternion(inv);
    for (const p of pool.particles) {
      p.age += dt; if (p.age >= p.life) spawn(p);
      const a = p.age / p.life, t = p.age;
      p.position.copy(p.origin).addScaledVector(p.velocity, t).addScaledVector(wind, t * t * .06);
      p.position.y -= gravity * t * t / 2;
      p.size = p.baseSize * (1 - a * .5);
      p.opacity = Math.min(1, a * 15) * (1 - a * a);
      if (a < .22) p.color.setRGB(1, .93 - a * 1.5, .65 - a * 2.3);
      else p.color.setRGB(1 - (a - .22) * .68, Math.max(.018, .54 * (1 - a) ** 2), .007);
      p.color.multiplyScalar(2);
    }
    pool.draw(state.camera);
  } });
}

/** A local crater glow, with optional small dark rim to make the light previewable. */
export function createCraterLight(opts = {}) {
  const g = makeModel('Local crater glow'), distance = clamp(opts.distance ?? 120, 15, 200);
  const light = new THREE.PointLight(0xff651d, opts.intensity ?? 900, distance, 2);
  light.position.set(0, 3, 0); light.name = 'Crater-only point light'; g.add(light);
  if (opts.showRim !== false) {
    const material = makeMaterial(g, { color: 0x383632, roughness: 1 });
    const matrices = [];
    for (let i = 0; i < 12; i++) {
      const a = i / 12 * TAU;
      pose.position.set(Math.sin(a) * 13, -1, Math.cos(a) * 13);
      pose.rotation.set(0, a, 0); pose.scale.set(4, 2.5, 4); pose.updateMatrix(); matrices.push(pose.matrix.clone());
    }
    const rim = addInstanced(g, g, 'Crater rim stones', new THREE.SphereGeometry(1, 6, 3), material, matrices);
    registerPart(g, 'rimRock', 'Crater rim rock', [rim], { massKg: 12000 });
    const glow = makeMaterial(g, { color: 0x65200c, emissive: 0xff6315, emissiveIntensity: 1.3 });
    const disc = ownedMesh(g, 'Small lava glow', new THREE.CircleGeometry(11, 24), glow);
    disc.rotation.x = -Math.PI / 2; disc.position.y = -.8;
  }
  let time = 0; const intensity = light.intensity;
  g.userData.light = light; g.userData.radiusMetres = distance;
  return finishModel(g, { update(dt) {
    time += dt; light.intensity = intensity * (1 + .055 * Math.sin(time * 2.4) + .025 * Math.sin(time * 5.1));
  }, reset() { time = 0; light.intensity = intensity; } });
}

/** Trigger once per airborne -> grounded transition, not once per frame. */
export function createTouchdownSmoke(opts = {}) {
  const g = makeModel('Wheel spin-up smoke'), pool = particlePool(g, 'Tyre smoke puffs', 48);
  const random = seedRandom(opts.seed ?? 117), defaultContacts = [[-1, .08, 0], [1, .08, 0]];
  let previousGrounded = opts.initialGrounded !== false, lastDescentRate = 0, burstCount = 0;
  function trigger({ descentRate = 1, contacts = defaultContacts, velocity = [0, 0, 0] } = {}) {
    const strength = clamp(Math.abs(descentRate) / 3.5, .16, 1);
    const inherited = v3(velocity); const perWheel = Math.ceil(5 + strength * 6);
    for (const contact of contacts.slice(0, 4)) for (let i = 0; i < perWheel; i++) {
      if (pool.particles.length >= pool.capacity) pool.particles.shift();
      const p = basicParticle(v3(contact), Math.floor(random() * 6));
      p.velocity.copy(inherited).multiplyScalar(.06).add(new THREE.Vector3((random() - .5) * 1.5, .3 + random() * .7, .3 + random()));
      p.life = .65 + random() * .8; p.baseSize = .15 + strength * .45;
      p.strength = strength; p.rotation = random() * TAU; pool.particles.push(p);
    }
    burstCount++; g.userData.burstCount = burstCount;
  }
  g.userData.trigger = trigger; g.userData.burstCount = 0; g.userData.particles = pool.mesh;
  g.userData.effectExemption = 'Touchdown smoke is a bounded transient particle effect.';
  return finishModel(g, { update(dt, state = {}) {
    if (typeof state.grounded === 'boolean') {
      const descent = Math.max(0, Number(state.descentRate ?? 0));
      if (state.grounded && !previousGrounded) trigger({
        descentRate: Math.max(descent, lastDescentRate), contacts: state.contacts ?? defaultContacts,
        velocity: state.velocity ?? [0, 0, 0],
      });
      if (!state.grounded) lastDescentRate = descent;
      previousGrounded = state.grounded;
    }
    for (let i = pool.particles.length - 1; i >= 0; i--) {
      const p = pool.particles[i]; p.age += dt;
      if (p.age >= p.life) { pool.particles.splice(i, 1); continue; }
      const a = p.age / p.life; p.position.addScaledVector(p.velocity, dt);
      p.size = p.baseSize * (1 + a * 3.2); p.opacity = (1 - a) ** 2 * (.15 + p.strength * .35);
      p.color.setRGB(.66, .67, .65); p.rotation += dt * .2;
    }
    pool.draw(state.camera);
  }, reset() {
    pool.particles.length = 0; previousGrounded = opts.initialGrounded !== false;
    lastDescentRate = 0; burstCount = 0; g.userData.burstCount = 0; pool.mesh.count = 0;
  } });
}

/** Water impact/sinking helper. It never turns water impact into an automatic fuel fire. */
export function createSinkingEffect(opts = {}) {
  const g = makeModel('Aircraft sinking effect'), random = seedRandom(opts.seed ?? 312);
  const pool = particlePool(g, 'Escaping bubbles', 64), seaLevel = opts.seaLevel ?? 0;
  const oilTexture = paintTexture('oil-film-v1', 256, 256, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    const grad = ctx.createRadialGradient(w / 2, h / 2, 8, w / 2, h / 2, w * .48);
    grad.addColorStop(0, 'rgba(56,60,48,.1)'); grad.addColorStop(.4, 'rgba(43,54,52,.28)');
    grad.addColorStop(.65, 'rgba(73,62,75,.21)'); grad.addColorStop(1, 'rgba(31,48,47,0)');
    ctx.fillStyle = grad; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(92,81,94,.13)'; ctx.lineWidth = 2;
    for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.ellipse(w / 2, h / 2, 28 + i * 16, 23 + i * 13, .18, 0, TAU); ctx.stroke(); }
  });
  const oilMaterial = makeMaterial(g, { color: 0x8c9690, map: oilTexture, transparent: true,
    opacity: 0, roughness: .24, metalness: .3, depthWrite: false,
    side: THREE.DoubleSide, forceSinglePass: true });
  const oil = addPlane(g, g, 'Spreading surface film', 1, 1, [0, seaLevel + .035, 0], oilMaterial);
  oil.rotation.x = -Math.PI / 2;
  let active = false, elapsed = 0, aircraft = null, saved = null, startWorld = null;
  let worldQuaternion = new THREE.Quaternion(), duration = opts.duration ?? 22;
  const filmOrigin = new THREE.Vector3(), working = new THREE.Matrix4(), sinkQ = new THREE.Quaternion();
  const pitchAxis = new THREE.Vector3(1, 0, 0), worldPosition = new THREE.Vector3();
  const worldScale = new THREE.Vector3(), offset = new THREE.Vector3();
  let emitter = 0;
  function start(startOpts = {}) {
    if (aircraft && saved) reset();
    aircraft = startOpts.aircraft ?? opts.aircraft ?? null;
    duration = Math.max(4, startOpts.duration ?? opts.duration ?? 22);
    elapsed = 0; emitter = 0; pool.particles.length = 0; active = true;
    if (aircraft) {
      aircraft.updateWorldMatrix(true, false);
      saved = { matrix: aircraft.matrix.clone(), matrixAutoUpdate: aircraft.matrixAutoUpdate,
        position: aircraft.position.clone(), quaternion: aircraft.quaternion.clone(), scale: aircraft.scale.clone() };
      startWorld = aircraft.matrixWorld.clone(); startWorld.decompose(worldPosition, worldQuaternion, worldScale);
      aircraft.matrixAutoUpdate = false; filmOrigin.set(worldPosition.x, seaLevel + .035, worldPosition.z);
    } else {
      g.updateWorldMatrix(true, false); filmOrigin.copy(g.getWorldPosition(new THREE.Vector3()));
      filmOrigin.y = seaLevel + .035; worldPosition.copy(filmOrigin);
      worldQuaternion.identity(); worldScale.set(1, 1, 1);
    }
    g.userData.active = true;
  }
  function reset() {
    if (aircraft && saved) {
      aircraft.matrix.copy(saved.matrix); aircraft.matrixAutoUpdate = saved.matrixAutoUpdate;
      aircraft.position.copy(saved.position); aircraft.quaternion.copy(saved.quaternion); aircraft.scale.copy(saved.scale);
      aircraft.matrixWorldNeedsUpdate = true;
    }
    aircraft = null; saved = null; active = false; elapsed = 0;
    pool.particles.length = 0; pool.mesh.count = 0; oilMaterial.opacity = 0; g.userData.active = false;
  }
  g.userData.start = start; g.userData.stop = () => { active = false; g.userData.active = false; };
  g.userData.oilFilm = oil; g.userData.bubbles = pool.mesh; g.userData.active = false;
  g.userData.effectExemption = 'Bubbles and fluid film do not detach; the supplied aircraft retains its own strike contract.';
  g.userData.physicsModel = 'Art-directed buoyancy loss and pitch, not a fluid or structural solver. Disable the aircraft flight/ground transform writer while this helper owns its pose.';
  if (opts.autoStart) start();
  return finishModel(g, { update(dt, state = {}) {
    if (!active) { pool.draw(state.camera); return; }
    elapsed += dt; const a = clamp(elapsed / duration, 0, 1);
    g.updateWorldMatrix(true, false);
    if (aircraft && startWorld) {
      startWorld.decompose(worldPosition, worldQuaternion, worldScale);
      // Negative local-X pitch lowers a -Z-forward nose and raises the tail first.
      const pitch = -.95 * Math.sin(Math.min(1, a * 2) * Math.PI / 2);
      sinkQ.setFromAxisAngle(pitchAxis, pitch); worldQuaternion.multiply(sinkQ);
      worldPosition.y -= 2 * a + 17 * a * a;
      const drift = v3(state.drift, [.1, 0, .04]); worldPosition.addScaledVector(drift, elapsed);
      working.compose(worldPosition, worldQuaternion, worldScale);
      if (aircraft.parent) {
        aircraft.parent.updateWorldMatrix(true, false);
        aircraft.matrix.copy(aircraft.parent.matrixWorld).invert().multiply(working);
      } else aircraft.matrix.copy(working);
      aircraft.matrix.decompose(aircraft.position, aircraft.quaternion, aircraft.scale);
      aircraft.matrixWorldNeedsUpdate = true;
    } else worldPosition.set(filmOrigin.x, seaLevel - 2 * a - 17 * a * a, filmOrigin.z);
    oil.position.copy(g.worldToLocal(filmOrigin.clone())); oil.scale.set(5 + a * 30, 3 + a * 22, 1);
    oilMaterial.opacity = Math.sin(Math.PI * a) * .52;
    emitter += dt * 12 * (1 - a);
    while (emitter >= 1 && a < .9) {
      emitter--;
      const p = basicParticle(g.worldToLocal(worldPosition.clone().add(offset.set(
        (random() - .5) * 1.5, .2, (random() - .5) * 1.5))), 6);
      p.life = 2 + random() * 3; p.baseSize = .08 + random() * .15;
      p.velocity.set((random() - .5) * .15, 1.3 + random() * .6, (random() - .5) * .15);
      if (pool.particles.length >= pool.capacity) pool.particles.shift(); pool.particles.push(p);
    }
    for (let i = pool.particles.length - 1; i >= 0; i--) {
      const p = pool.particles[i]; p.age += dt; p.position.addScaledVector(p.velocity, dt);
      const worldY = g.localToWorld(p.position.clone()).y;
      if (p.age >= p.life || worldY > seaLevel + .05) { pool.particles.splice(i, 1); continue; }
      p.size = p.baseSize * (1 + p.age * .25); p.opacity = .46 * (1 - p.age / p.life);
      p.color.setRGB(.55, .75, .76);
    }
    pool.draw(state.camera);
    if (a >= 1) { active = false; g.userData.active = false; oilMaterial.opacity = 0; pool.particles.length = 0; pool.mesh.count = 0; }
  }, reset, dispose: reset });
}

function createTouchdownPreview() {
  const wrapper = makeModel('Wheel contact smoke demonstration'), smoke = createTouchdownSmoke();
  wrapper.add(smoke);
  const rubber = makeMaterial(wrapper, { color: 0x222826, roughness: .95, metalness: 0 });
  const geometry = new THREE.CylinderGeometry(.33, .33, .23, 10); geometry.rotateZ(Math.PI / 2);
  const wheels = addInstanced(wrapper, wrapper, 'Tyres at runway contact', geometry, rubber,
    [-1, 1].map(x => new THREE.Matrix4().makeTranslation(x, .33, 0)));
  registerPart(wrapper, 'wheels', 'Demonstration wheel pair', [wheels], { massKg: 22 });
  const trigger = () => smoke.userData.trigger({ descentRate: 3.5 });
  trigger();
  return finishModel(wrapper, { update(dt, state) { smoke.userData.update(dt, state); },
    reset() { smoke.userData.resetDamage(); trigger(); }, dispose() { smoke.userData.dispose(); } });
}

function createSinkingPreview() {
  const wrapper = makeModel('Sinking aircraft demonstration');
  const aircraft = createDamageTestAirframe(), sinking = createSinkingEffect({ duration: 18 });
  aircraft.position.y = -.7; wrapper.add(aircraft, sinking);
  const waterMap = paintTexture('sinking-preview-water-v1', 256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#557e7d'; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(172,199,186,.16)'; ctx.lineWidth = 1;
    for (let j = 0; j < 26; j++) {
      ctx.beginPath(); ctx.moveTo(0, j * 11);
      for (let x = 0; x < w; x += 8) ctx.lineTo(x, j * 11 + Math.sin(x * .06 + j) * 2);
      ctx.stroke();
    }
  });
  const waterMaterial = makeMaterial(wrapper, { map: waterMap, color: 0x9bb6b0,
    transparent: true, opacity: .48, roughness: .28, metalness: .15,
    depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true });
  const water = addPlane(wrapper, wrapper, 'Preview sea surface', 14, 12, [0, 0, 0], waterMaterial);
  water.rotation.x = -Math.PI / 2;
  sinking.userData.start({ aircraft });
  wrapper.userData.aircraft = aircraft; wrapper.userData.sinking = sinking;
  wrapper.userData.effectExemption = 'Preview composition; aircraft strike controls are available on userData.aircraft.';
  return finishModel(wrapper, { update(dt, state) { sinking.userData.update(dt, state); },
    reset() { sinking.userData.resetDamage(); aircraft.userData.resetDamage(); sinking.userData.start({ aircraft }); },
    dispose() { sinking.userData.dispose(); aircraft.userData.dispose(); } });
}

export const previewModels = [
  { id: 'waterfall', label: 'Curved waterfall and mist', create: () => createWaterfall({ height: 32, width: 12 }),
    preview: { background: '#304b4b', groundColor: '#667b6e', warmup: .7, elevation: .25 } },
  { id: 'reef', label: 'Submerged lit reef', create: () => createReef(), damagePart: 'coralOutcrops',
    preview: { background: '#668e8c', groundColor: '#668e8c', elevation: .8 } },
  { id: 'lava-lake', label: 'Lava convection and rafting crust', create: () => createLavaLake(), damagePart: 'crustPlates' },
  { id: 'ash-plume', label: 'Varied wind-driven ash', create: () => createAshPlume({ height: 90, count: 150 }) },
  { id: 'embers', label: 'White-hot to dark cooling embers', create: () => createEmbers({ height: 7, glowScale: 1.8 }),
    preview: { background: '#172420', warmup: .45, elevation: .18, zoom: 1.12 } },
  { id: 'crater-light', label: 'Local crater glow', create: () => createCraterLight(), damagePart: 'rimRock' },
  { id: 'touchdown-smoke', label: 'One-shot tyre smoke at wheel contact', create: createTouchdownPreview, damagePart: 'wheels',
    preview: { background: '#374540', groundColor: '#3a423d', ground: true, warmup: .12, elevation: .24 } },
  { id: 'sinking-effect', label: 'Aircraft sinking with bubbles and surface film', create: createSinkingPreview,
    preview: { background: '#355959', groundColor: '#355959', warmup: 2.3, elevation: .55 } },
];
