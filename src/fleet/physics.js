import * as THREE from '../vendor/three.module.js';

/**
 * Single rigid body against a static height field. Metres, kilograms, seconds.
 * Position is the centre of mass; points and diagonal inertia use its local axes.
 * Velocities are WORLD vectors. The supplied vectors are cloned. Mutate the
 * returned vectors and call wake() when applying an external impulse/teleport.
 * 120 Hz fixed stepping; update accepts finite dt >= 0, caps each call at .25s
 * (discarding longer stalls), and retains the fractional step for frame parity.
 * Finite terrain heights produce a surface; non-finite returns mean no surface.
 * Contact normals follow finite local height gradients; discontinuities/vertical
 * walls, mesh obstacles, body-body collisions, continuous collision detection,
 * aerodynamics, and gyroscopic precession require the game's physics engine.
 * Mass and inertia must be positive and finite. This is an approximate contact
 * solver, not a calibrated aircraft simulation. There is NO upright-rest target.
 */
export function createGroundBody(options) {
  const { position, quaternion, velocity = new THREE.Vector3(),
    angularVelocity = new THREE.Vector3(), massKg, inertia, points,
    groundHeight = 0, friction = .65, restitution = .08 } = options;
  const finiteV = v => v && ['x', 'y', 'z'].every(k => Number.isFinite(v[k]));
  if (!finiteV(position) || !finiteV(velocity) || !finiteV(angularVelocity) ||
      !finiteV(inertia) || Math.min(inertia.x, inertia.y, inertia.z) <= 0 ||
      !Number.isFinite(massKg) || massKg <= 0 || !quaternion ||
      !['x', 'y', 'z', 'w'].every(k => Number.isFinite(quaternion[k])) ||
      quaternion.lengthSq() < 1e-16 || !Array.isArray(points) || !points.length ||
      !points.every(finiteV) || !Number.isFinite(friction) || friction < 0 ||
      !Number.isFinite(restitution) || restitution < 0 || restitution > 1 ||
      !(typeof groundHeight === 'function' || Number.isFinite(groundHeight))) {
    throw new RangeError('Invalid rigid-body pose, inertia, contacts or terrain.');
  }
  const h = 1 / 120, inverseMass = 1 / massKg, margin = .012, slop = .001;
  const inverseInertia = new THREE.Vector3(1 / inertia.x, 1 / inertia.y, 1 / inertia.z);
  const state = {
    position: position.clone(), quaternion: quaternion.clone().normalize(),
    velocity: velocity.clone(), angularVelocity: angularVelocity.clone(),
    sleeping: false, contacts: 0, update, wake
  };
  const records = points.map(point => ({
    local: point.clone(), r: new THREE.Vector3(), normal: new THREE.Vector3(),
    tangentImpulse: new THREE.Vector3(), normalImpulse: 0, active: false,
    distance: 0, target: 0, normalMass: 0, bounceVelocity: 0
  }));
  const inverseQ = new THREE.Quaternion(), deltaQ = new THREE.Quaternion();
  const world = new THREE.Vector3(), impulse = new THREE.Vector3();
  const torque = new THREE.Vector3(), inverseTorque = new THREE.Vector3();
  const contactVelocity = new THREE.Vector3(), tangent = new THREE.Vector3();
  const candidate = new THREE.Vector3(), change = new THREE.Vector3();
  const active = [];
  let accumulator = 0, sleepTime = 0;
  function height(x, z) { return typeof groundHeight === 'function' ? groundHeight(x, z) : groundHeight; }
  function inverseI(input, output) {
    return output.copy(input).applyQuaternion(inverseQ).multiply(inverseInertia).applyQuaternion(state.quaternion);
  }
  function velocityAt(r, output) { return output.copy(state.angularVelocity).cross(r).add(state.velocity); }
  function effectiveMass(r, direction) {
    torque.copy(r).cross(direction);
    inverseI(torque, inverseTorque);
    return inverseMass + inverseTorque.cross(r).dot(direction);
  }
  function applyImpulse(r, value) {
    state.velocity.addScaledVector(value, inverseMass);
    torque.copy(r).cross(value);
    state.angularVelocity.add(inverseI(torque, inverseTorque));
  }
  function wake() {
    state.sleeping = false; sleepTime = 0;
    for (const contact of records) {
      contact.active = false; contact.normalImpulse = 0; contact.bounceVelocity = 0; contact.tangentImpulse.set(0, 0, 0);
    }
  }
  function substep() {
    const p = state.position, q = state.quaternion, v = state.velocity, w = state.angularVelocity;
    inverseQ.copy(q).invert();
    v.y -= 9.81 * h;
    // Very small air resistance; contact friction does the stopping on the ground.
    v.multiplyScalar(Math.exp(-.012 * h)); w.multiplyScalar(Math.exp(-.018 * h));
    active.length = 0;
    for (const contact of records) {
      contact.r.copy(contact.local).applyQuaternion(q);
      world.copy(p).add(contact.r);
      const y = height(world.x, world.z);
      if (!Number.isFinite(y)) {
        contact.active = false; contact.normalImpulse = 0; contact.bounceVelocity = 0; contact.tangentImpulse.set(0, 0, 0);
        continue;
      }
      const n = contact.normal;
      n.set(0, 1, 0);
      if (typeof groundHeight === 'function') {
        const epsilon = .04;
        const x0 = height(world.x - epsilon, world.z), x1 = height(world.x + epsilon, world.z);
        const z0 = height(world.x, world.z - epsilon), z1 = height(world.x, world.z + epsilon);
        if (Number.isFinite(x0) && Number.isFinite(x1) && Number.isFinite(z0) && Number.isFinite(z1)) {
          n.set(-(x1 - x0) / (2 * epsilon), 1, -(z1 - z0) / (2 * epsilon)).normalize();
        }
      }
      const distance = (world.y - y) * n.y;
      const normalVelocity = velocityAt(contact.r, contactVelocity).dot(n);
      // Speculative contact prevents a fast point crossing a nearby ground plane.
      if (distance > margin && distance + Math.min(0, normalVelocity) * h > margin) {
        contact.active = false; contact.normalImpulse = 0; contact.bounceVelocity = 0; contact.tangentImpulse.set(0, 0, 0);
        continue;
      }
      contact.distance = distance;
      let bounce = contact.bounceVelocity;
      contact.bounceVelocity = 0;
      if (!contact.active && normalVelocity < -1 && distance + normalVelocity * h <= slop) {
        // Reach the surface on this step; apply rebound on the next, rather than
        // letting speculative collision prevention silently remove restitution.
        if (distance > slop) contact.bounceVelocity = -restitution * normalVelocity;
        else bounce = Math.max(bounce, -restitution * normalVelocity);
      }
      contact.target = distance > slop ? -distance / h : Math.max(bounce, Math.min(2, .18 * Math.max(0, -distance - slop) / h));
      contact.normalMass = 1 / effectiveMass(contact.r, n);
      // Warm starting retains the previous support force, not a preferred pose.
      contact.normalImpulse *= .85;
      contact.tangentImpulse.addScaledVector(n, -contact.tangentImpulse.dot(n)).multiplyScalar(.85);
      if (!contact.active) { contact.normalImpulse = 0; contact.tangentImpulse.set(0, 0, 0); }
      contact.active = true;
      active.push(contact);
    }
    for (const contact of active) {
      impulse.copy(contact.normal).multiplyScalar(contact.normalImpulse).add(contact.tangentImpulse);
      applyImpulse(contact.r, impulse);
    }
    // Projected sequential impulses: normal reaction plus Coulomb friction cone.
    for (let iteration = 0; iteration < 14; iteration++) {
      // Reverse the order on alternate iterations to reduce vertex-order bias.
      for (let j = 0; j < active.length; j++) {
        const contact = active[iteration % 2 ? active.length - 1 - j : j], n = contact.normal;
        const normalVelocity = velocityAt(contact.r, contactVelocity).dot(n);
        const old = contact.normalImpulse;
        contact.normalImpulse = Math.max(0, old + (contact.target - normalVelocity) * contact.normalMass);
        impulse.copy(n).multiplyScalar(contact.normalImpulse - old);
        applyImpulse(contact.r, impulse);
        velocityAt(contact.r, contactVelocity);
        tangent.copy(contactVelocity).addScaledVector(n, -contactVelocity.dot(n));
        const speed = tangent.length();
        if (speed > 1e-9) {
          tangent.multiplyScalar(1 / speed);
          const delta = -speed / effectiveMass(contact.r, tangent);
          candidate.copy(contact.tangentImpulse).addScaledVector(tangent, delta);
          const maxFriction = friction * contact.normalImpulse;
          if (candidate.lengthSq() > maxFriction * maxFriction) candidate.setLength(maxFriction);
          change.copy(candidate).sub(contact.tangentImpulse);
          contact.tangentImpulse.copy(candidate);
          applyImpulse(contact.r, change);
        }
      }
    }
    p.addScaledVector(v, h);
    const speed = w.length();
    if (speed > 1e-12) {
      deltaQ.setFromAxisAngle(tangent.copy(w).multiplyScalar(1 / speed), speed * h);
      q.premultiply(deltaQ).normalize();
    }
    state.contacts = 0;
    for (const contact of active) if (contact.normalImpulse > 1e-8) state.contacts++;
    // Only a supported, quiet body may sleep. On its side/roof is a valid rest.
    if (state.contacts > 0 && v.lengthSq() < .035 ** 2 && w.lengthSq() < .025 ** 2) sleepTime += h;
    else sleepTime = 0;
    if (sleepTime >= .85) { state.sleeping = true; v.set(0, 0, 0); w.set(0, 0, 0); }
  }
  function update(dt) {
    if (!Number.isFinite(dt) || dt < 0) throw new RangeError('Rigid-body dt must be finite and nonnegative.');
    if (state.sleeping || dt === 0) return state;
    accumulator += Math.min(dt, .25);
    const steps = Math.floor((accumulator + 1e-12) / h);
    accumulator -= steps * h;
    for (let i = 0; i < steps && !state.sleeping; i++) substep();
    return state;
  }
  return state;
}
