import * as THREE from '../vendor/three.module.js';

const clamp = THREE.MathUtils.clamp;
const finiteVector = value => value && ['x', 'y', 'z'].every(key => Number.isFinite(value[key]));
const vector = value => new THREE.Vector3(value.x, value.y, value.z);
const UP = new THREE.Vector3(0, 1, 0);
const ZERO = { x: 0, y: 0, z: 0 };
const HARD_SURFACES = new Set(['asphalt', 'concrete', 'metal', 'obstacle', 'wall', 'carrier-ramp']);
const WALL_SURFACES = new Set(['obstacle', 'wall', 'carrier-ramp']);

/** Attach impact response to an already finished aircraft. The caller advances
 * updateImpact, resetImpact and disposeImpact alongside the model lifecycle.
 * Normal impulses on terrain belong to common's contact solver. This module
 * applies an explicit impulse only for a vertical obstacle contact. */
export function attachAircraftImpact(model, config = {}) {
  if (!model?.isObject3D || !model.userData.strikePoints || !model.userData.getStrikeBounds || !model.userData.beginCrash)
    throw new TypeError('Aircraft impact requires a finished model with named strike points.');
  if (model.userData.impact) throw new Error('Impact response is already attached.');
  const massKg = config.massKg ?? 1100;
  if (!Number.isFinite(massKg) || massKg <= 0) throw new RangeError('Aircraft mass must be positive.');
  const centerOfMass = config.centerOfMass ? vector(config.centerOfMass) : new THREE.Vector3();
  if (!finiteVector(centerOfMass)) throw new RangeError('Invalid local center of mass.');
  model.updateWorldMatrix(true, true);
  const localBounds = new THREE.Box3(), inverseRoot = model.matrixWorld.clone().invert();
  const instanceMatrix = new THREE.Matrix4();
  model.traverse(node => {
    if (!node.isMesh || !node.geometry?.attributes?.position) return;
    const positions = node.geometry.attributes.position;
    for (let k = 0; k < (node.isInstancedMesh ? node.count : 1); k++) {
      const transform = inverseRoot.clone().multiply(node.matrixWorld);
      if (node.isInstancedMesh) { node.getMatrixAt(k, instanceMatrix); transform.multiply(instanceMatrix); }
      for (let i = 0; i < positions.count; i++) localBounds.expandByPoint(new THREE.Vector3().fromBufferAttribute(positions, i).applyMatrix4(transform));
    }
  });
  const dimensions = localBounds.getSize(new THREE.Vector3()).multiply(model.getWorldScale(new THREE.Vector3()));
  const bodyInertia = config.inertia ? vector(config.inertia) : new THREE.Vector3(
    massKg * (dimensions.y ** 2 + dimensions.z ** 2) / 12,
    massKg * (dimensions.x ** 2 + dimensions.z ** 2) / 12,
    massKg * (dimensions.x ** 2 + dimensions.y ** 2) / 12).max(new THREE.Vector3(.1, .1, .1));
  if (!finiteVector(bodyInertia) || Math.min(bodyInertia.x, bodyInertia.y, bodyInertia.z) <= 0) throw new RangeError('Invalid impact inertia.');
  const capacity = 64, marks = [], dented = new Map(), damage = {}, history = [];
  const protectedParts = new Set(config.protectedParts ?? ['fuselage', 'body', 'cabin']);
  let sequence = 0, disposed = false, pool = null;
  const particles = Array.from({ length: capacity }, () => ({ alive: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(), age: 0, life: 1, size: 1, spark: false, color: new THREE.Color() }));
  let particleCursor = 0;
  function random() { sequence = (Math.imul(sequence + 1, 1664525) + 1013904223) >>> 0; return sequence / 4294967296; }
  function visible(node) { for (let p = node; p && p !== model; p = p.parent) if (!p.visible) return false; return true; }
  function nearestPart(point, requested) {
    if (requested !== undefined && !Object.hasOwn(model.userData.strikePoints, requested)) throw new RangeError(`Unknown impact part ${requested}`);
    const candidates = requested === undefined ? Object.keys(model.userData.strikePoints) : [requested];
    let best = null;
    for (const id of candidates) {
      const bounds = model.userData.getStrikeBounds(id);
      if (!bounds || bounds.isEmpty()) continue;
      const distance = bounds.distanceToPoint(point), size = bounds.getSize(new THREE.Vector3());
      const volume = Math.max(.001, size.x * size.y * size.z);
      if (!best || distance < best.distance - .00001 || (Math.abs(distance - best.distance) < .00001 && volume < best.volume))
        best = { id, part: model.userData.strikePoints[id], bounds, distance, volume };
    }
    return best;
  }
  function ensurePool(parent) {
    if (!parent) return null;
    if (!pool) {
      const geometry = new THREE.BufferGeometry();
      for (const [name, width] of [['position', 3], ['aColor', 3], ['aAlpha', 1], ['aSize', 1]]) geometry.setAttribute(name, new THREE.BufferAttribute(new Float32Array(capacity * width), width));
      const material = new THREE.ShaderMaterial({
        uniforms: { viewportHeight: { value: 720 } }, transparent: true, depthWrite: false,
        vertexShader: `attribute vec3 aColor; attribute float aAlpha; attribute float aSize; varying vec3 tint; varying float alpha; uniform float viewportHeight;
          void main(){ vec4 mv=modelViewMatrix*vec4(position,1.); gl_Position=projectionMatrix*mv;
          gl_PointSize=clamp(aSize*viewportHeight*.5/max(.1,-mv.z),1.,110.); tint=aColor; alpha=aAlpha; }`,
        fragmentShader: `varying vec3 tint; varying float alpha;
          void main(){ float r=length(gl_PointCoord-.5)*2.; float a=alpha*(1.-smoothstep(.15,1.,r)); if(a<.005)discard;
          gl_FragColor=vec4(tint,a); #include <tonemapping_fragment>\n #include <colorspace_fragment> }`.replace('; #include', ';\n#include'),
      });
      const mesh = new THREE.Points(geometry, material); mesh.name = 'Impact dust and brief metal sparks'; mesh.frustumCulled = false;
      pool = { mesh, geometry, material }; parent.add(mesh);
    } else if (pool.mesh.parent !== parent) parent.add(pool.mesh);
    return pool;
  }
  function emitParticles(point, normal, velocity, severity, surfaceKind, parent) {
    if (severity < .025 || !ensurePool(parent)) return;
    const tangent = velocity.clone().addScaledVector(normal, -velocity.dot(normal));
    const sparks = HARD_SURFACES.has(surfaceKind) && velocity.length() > 8 && severity > .12 ? Math.ceil(severity * 7) : 0;
    const dust = Math.ceil(5 + severity * 15);
    for (let i = 0; i < dust + sparks; i++) {
      const p = particles[particleCursor++ % capacity]; p.alive = true; p.age = 0; p.spark = i < sparks;
      p.life = p.spark ? .18 + random() * .48 : .7 + random() * 1.5;
      p.pos.copy(point).addScaledVector(normal, .02 + random() * .06);
      p.vel.copy(tangent).multiplyScalar(p.spark ? .12 : .035).addScaledVector(normal, (p.spark ? 1.5 : .4) + random() * (p.spark ? 5 : 1.4));
      p.vel.add(new THREE.Vector3(random() - .5, random() - .25, random() - .5).multiplyScalar(p.spark ? 3 : .8));
      p.size = p.spark ? .024 + random() * .024 : .16 + random() * .28;
      p.color.set(p.spark ? 0xffc77a : surfaceKind === 'water' ? 0xc2d6dd : surfaceKind === 'grass' ? 0x79745a : 0x89877d);
    }
  }
  function addScuff(selection, point, normal, severity) {
    if (severity < .025) return;
    const parent = selection.part.nodes.find(visible); if (!parent) return;
    const geometry = new THREE.PlaneGeometry(1, 1);
    const material = new THREE.ShaderMaterial({
      uniforms: { opacity: { value: Math.min(.76, .18 + severity * .6) } }, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      vertexShader: 'varying vec2 uvMark; void main(){uvMark=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader: `varying vec2 uvMark; uniform float opacity; void main(){vec2 p=(uvMark-.5)*2.; float grain=fract(sin(dot(floor(uvMark*120.),vec2(12.9898,78.233)))*43758.5453);
        float a=(1.-smoothstep(.2,1.,length(p*vec2(.8,1.))))*(.45+.55*grain)*opacity; if(a<.015)discard; gl_FragColor=vec4(vec3(.075,.078,.075),a);}`,
    });
    const mark = new THREE.Mesh(geometry, material); mark.name = `Contact scuff: ${selection.id}`;
    // UserData marks are carried by the same physical part if it later detaches.
    mark.userData.impactDecoration = true;
    const radius = clamp(selection.bounds.getSize(new THREE.Vector3()).length() * (.025 + severity * .06), .12, .72);
    const world = new THREE.Matrix4().compose(point.clone().addScaledVector(normal, .012), new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal), new THREE.Vector3(radius * 2, radius, 1));
    parent.updateWorldMatrix(true, false); mark.matrix.multiplyMatrices(parent.matrixWorld.clone().invert(), world); mark.matrixAutoUpdate = false;
    parent.add(mark); marks.push({ mesh: mark, geometry, material });
    if (marks.length > 12) { const old = marks.shift(); old.mesh.removeFromParent(); old.geometry.dispose(); old.material.dispose(); }
  }
  function restoreSelectedDents(selection) {
    const selected = new Set(); for (const node of selection.part.nodes) node.traverse(mesh => selected.add(mesh));
    for (const [mesh, saved] of dented) if (selected.has(mesh)) {
      if (mesh.geometry === saved.geometry) mesh.geometry = saved.original;
      saved.geometry.dispose(); dented.delete(mesh);
    }
  }
  function remainingMass() {
    const removed = Object.values(model.userData.strikePoints).reduce((sum, part) => sum + (part.detached ? part.massKg : 0), 0);
    return Math.max(.01, massKg - removed);
  }
  function localDent(selection, point, normal, severity) {
    const radius = clamp(selection.bounds.getSize(new THREE.Vector3()).length() * (.08 + severity * .08), .25, 1.6);
    const depth = Math.min(radius * .12, .025 + severity * .22);
    const visited = new Set(); let movedVertices = 0;
    for (const node of selection.part.nodes) node.traverse(mesh => {
      if (!mesh.isMesh || mesh.isInstancedMesh || mesh.userData.impactDecoration || !visible(mesh) || visited.has(mesh)) return;
      visited.add(mesh);
      if (!mesh.geometry?.attributes?.position) return;
      mesh.updateWorldMatrix(true, false);
      const src = mesh.geometry.attributes.position, indices = [];
      for (let i = 0; i < src.count; i++) { const distance = new THREE.Vector3().fromBufferAttribute(src, i).applyMatrix4(mesh.matrixWorld).distanceTo(point); if (distance < radius) indices.push([i, distance]); }
      if (!indices.length) return; // Never bend a distant vertex just to manufacture a dent.
      if (!dented.has(mesh) || dented.get(mesh).geometry !== mesh.geometry) {
        const original = mesh.geometry, geometry = original.clone(); mesh.geometry = geometry;
        const previous = dented.get(mesh); if (previous) previous.geometry.dispose();
        dented.set(mesh, { original, geometry });
      }
      const position = mesh.geometry.attributes.position, inverse = mesh.matrixWorld.clone().invert();
      for (const [index, distance] of indices) {
        const p = new THREE.Vector3().fromBufferAttribute(position, index).applyMatrix4(mesh.matrixWorld);
        p.addScaledVector(normal, depth * (1 - distance / radius) ** 2).applyMatrix4(inverse);
        position.setXYZ(index, p.x, p.y, p.z); movedVertices++;
      }
      position.needsUpdate = true; mesh.geometry.computeVertexNormals(); mesh.geometry.computeBoundingBox(); mesh.geometry.computeBoundingSphere();
    });
    if (movedVertices) model.userData.refreshStrikeGeometry?.();
    return { movedVertices, radius, depth };
  }
  function impact(options = {}) {
    if (disposed) return { ignored: true, reason: 'disposed' };
    const { worldPoint, worldNormal, partId, surfaceKind = 'asphalt', groundHeight = 0, forceCrash = false } = options;
    const velocityInput = options.worldVelocity ?? model.userData.crashBody?.velocity ?? ZERO;
    const angularInput = options.worldAngularVelocity ?? model.userData.crashBody?.angularVelocity ?? ZERO;
    if (![worldPoint, worldNormal, velocityInput, angularInput].every(finiteVector) || vector(worldNormal).lengthSq() < 1e-12)
      throw new RangeError('Impact needs finite world point, nonzero outward normal, velocity and angular velocity.');
    if (!(typeof groundHeight === 'function' || Number.isFinite(groundHeight))) throw new RangeError('groundHeight must be a finite height or function.');
    const point = vector(worldPoint), normal = vector(worldNormal).normalize(), velocity = vector(velocityInput), angular = vector(angularInput);
    const selection = nearestPart(point, partId);
    if (!selection) return { ignored: true, reason: 'part already detached or empty', partId };
    model.updateWorldMatrix(true, true);
    const origin = centerOfMass.clone().applyMatrix4(model.matrixWorld), arm = point.clone().sub(origin);
    const pointVelocity = angular.clone().cross(arm).add(velocity);
    const closingSpeed = Math.max(0, -pointVelocity.dot(normal));
    const tangentSpeed = pointVelocity.clone().addScaledVector(normal, -pointVelocity.dot(normal)).length();
    const activeMassKg = remainingMass();
    const inertia = model.userData.crashBody?.inertia?.clone() ?? bodyInertia.clone().multiplyScalar(activeMassKg / massKg);
    const lever = arm.clone().cross(normal).applyQuaternion(model.getWorldQuaternion(new THREE.Quaternion()).invert());
    const effectiveMass = 1 / (1 / activeMassKg + lever.x ** 2 / inertia.x + lever.y ** 2 / inertia.y + lever.z ** 2 / inertia.z);
    const isWing = /wing/i.test(selection.id), isProp = /prop|rotor/i.test(selection.id), isGear = /gear/i.test(selection.id);
    const strength = config.impactStrength?.[selection.id] ?? (isProp ? .28 : isWing ? .75 : isGear ? 1.5 : protectedParts.has(selection.id) ? 2 : 1);
    if (!Number.isFinite(strength) || strength <= 0) throw new RangeError('Part impact strength must be positive.');
    // A grazing scrape contributes only 4% of tangential kinetic energy.
    // A receding contact cannot cause new impact damage from speed alone.
    const energyJ = closingSpeed > .02 ? .5 * effectiveMass * (closingSpeed ** 2 + .04 * tangentSpeed ** 2) : 0;
    const resistanceJ = Math.max(10, selection.part.massKg ?? massKg * .05) * 250 * strength;
    const eventSeverity = clamp(1 - Math.exp(-energyJ / resistanceJ), 0, 1);
    const severity = Math.max(damage[selection.id] ?? 0, eventSeverity);
    damage[selection.id] = severity;
    let action = eventSeverity < .025 ? 'none' : severity < .08 ? 'scuff' : severity < .32 ? 'dent' : severity < .72 || protectedParts.has(selection.id) ? 'bend' : 'detach';
    if (eventSeverity < .025) action = 'none';
    const mode = isProp ? 'bendProp' : isWing ? 'bendWing' : 'crush';
    if (severity >= .32 && eventSeverity >= .025 && model.userData.damagePart) {
      // Return our local clone before the model records or reuses its own rest
      // geometry. Otherwise a prior small dent can become its permanent rest.
      restoreSelectedDents(selection);
      model.userData.damagePart(selection.id, severity, mode);
    }
    let dent = { movedVertices: 0, radius: 0, depth: 0 };
    if (eventSeverity >= .08) dent = localDent(selection, point, normal, severity);
    if (eventSeverity >= .025) addScuff(selection, point, normal, severity);
    const crash = !options.deferCrash && (forceCrash || eventSeverity >= .35);
    let body = model.userData.crashBody, contactImpulse = new THREE.Vector3();
    if (crash && !body) body = model.userData.beginCrash({ groundHeight, massKg: activeMassKg, centerOfMass, worldVelocity: velocity, worldAngularVelocity: angular, inertia, friction: surfaceKind === 'grass' ? .8 : .58, restitution: .055 });
    if (body && WALL_SURFACES.has(surfaceKind) && closingSpeed > 0) {
      contactImpulse.copy(normal).multiplyScalar(effectiveMass * closingSpeed * 1.04);
      model.userData.applyCrashImpulse(contactImpulse, point);
    }
    let detached = null;
    if (action === 'detach') detached = model.userData.strike(selection.id, {
      debrisParent: options.debrisParent, groundHeight, lifetime: 20,
      worldVelocity: body?.velocity ?? velocity, worldAngularVelocity: body?.angularVelocity ?? angular,
      velocityOrigin: body?.position ?? origin,
    });
    if (body && model.userData.setCrashMass && (detached || Math.abs(body.massKg - remainingMass()) > .001))
      body = model.userData.setCrashMass(remainingMass());
    emitParticles(point, normal, pointVelocity, eventSeverity, surfaceKind, options.debrisParent ?? config.effectsParent ?? model.parent);
    const result = { partId: selection.id, label: selection.part.label, action, severity: eventSeverity, accumulatedSeverity: severity, energyJ, effectiveMassKg: effectiveMass,
      closingSpeed, tangentSpeed, worldPoint: point.clone(), worldNormal: normal.clone(), pointVelocity, contactImpulse,
      worldVelocity: velocity.clone(), worldAngularVelocity: angular.clone(), crash: !!body, detached: detached?.body?.members ?? [],
      remainingMassKg: remainingMass(), movedVertices: dent.movedVertices, dentRadius: dent.radius, cameraKick: Math.min(1.25, Math.sqrt(eventSeverity) * .95),
      audio: { kind: surfaceKind === 'water' ? 'splash' : eventSeverity < .32 ? 'scrape' : 'metal-impact', intensity: eventSeverity, lowFrequency: Math.min(1, Math.log2(effectiveMass + 1) / 14) },
      surfaceKind };
    history.push(result); if (history.length > 24) history.shift();
    model.userData.lastImpact = result;
    model.userData.onImpact?.(result); config.onImpact?.(result);
    config.onCameraKick?.(result.cameraKick, result); config.onAudio?.(result.audio, result);
    return result;
  }
  function updateImpact(dt, state = {}) {
    if (!Number.isFinite(dt) || dt < 0) throw new RangeError('Impact dt must be finite seconds >= 0.');
    if (disposed || !pool) return;
    const step = Math.min(dt, .1), parent = pool.mesh.parent;
    if (!parent) return;
    parent.updateWorldMatrix(true, false); const inverse = parent.matrixWorld.clone().invert();
    const position = pool.geometry.attributes.position, color = pool.geometry.attributes.aColor, alpha = pool.geometry.attributes.aAlpha, size = pool.geometry.attributes.aSize;
    let active = 0;
    for (let i = 0; i < capacity; i++) {
      const p = particles[i]; if (p.alive) {
        p.age += dt; if (p.age >= p.life) p.alive = false;
        else { p.vel.y += (p.spark ? -9.81 : .25) * step; p.vel.multiplyScalar(Math.exp(-step * (p.spark ? .8 : 1.2))); p.pos.addScaledVector(p.vel, step); active++; }
      }
      const local = p.pos.clone().applyMatrix4(inverse);
      position.setXYZ(i, local.x, local.y, local.z); color.setXYZ(i, p.color.r, p.color.g, p.color.b);
      alpha.setX(i, p.alive ? Math.max(0, 1 - p.age / p.life) * (p.spark ? .98 : .23) : 0);
      size.setX(i, p.size * (p.spark ? 1 : 1 + p.age * 1.7));
    }
    for (const attribute of [position, color, alpha, size]) attribute.needsUpdate = true;
    pool.mesh.visible = active > 0; pool.material.uniforms.viewportHeight.value = Number.isFinite(state.viewportHeight) ? Math.max(1, state.viewportHeight) : 720;
    model.userData.impactParticleCount = active;
  }
  function resetImpact() {
    for (const mark of marks) { mark.mesh.removeFromParent(); mark.geometry.dispose(); mark.material.dispose(); } marks.length = 0;
    for (const [mesh, saved] of dented) { if (mesh.geometry === saved.geometry) mesh.geometry = saved.original; saved.geometry.dispose(); } dented.clear();
    for (const p of particles) p.alive = false;
    if (pool) pool.mesh.visible = false;
    for (const id of Object.keys(damage)) delete damage[id]; history.length = 0;
    model.userData.lastImpact = null; model.userData.impactParticleCount = 0; model.userData.refreshStrikeGeometry?.();
  }
  function disposeImpact() { if (disposed) return; resetImpact(); disposed = true; if (pool) { pool.mesh.removeFromParent(); pool.geometry.dispose(); pool.material.dispose(); pool = null; } }
  Object.assign(model.userData, { impact, updateImpact, resetImpact, disposeImpact, impactDamage: damage, impactHistory: history, impactParticleCount: 0 });
  return model;
}
