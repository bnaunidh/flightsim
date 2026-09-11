import * as THREE from '../vendor/three.module.js';

/**
 * Island Flight Simulator — item 1 ONLY: a procedural utility helicopter.
 * Three.js r169, browser ES module. No loaders, external assets or build step.
 *
 * For bnaunidh.github.io/flightsim save as src/aircraft/helicopter.js.
 * See HELICOPTER-INTEGRATION.md for the existing game's adapter/hook requirements.
 *
 *   import { createHelicopter } from './helicopter.js'; // from aircraft/model.js
 *   const helicopter = createHelicopter();
 *   aircraftVisualRoot.add(helicopter);
 *   // Call exactly once per simulation frame; dt is seconds.
 *   helicopter.userData.update(dt, {
 *     rotorRpm: 400, collective: 0.7, cyclicPitch: 0.2, cyclicRoll: 0
 *   });
 *
 * Replace the helicopter's OLD visual/propeller factory with this factory.
 * Keep the existing flight physics; do not add this beside the old nose prop.
 * The existing propeller animation must not also drive these rotor groups.
 *
 * Coordinates: -Z nose/forward, +Y up, +X right. Metres throughout.
 * Origin: ground plane midway between the skids, beneath the mast. If the
 * game's visual root is at its centre of mass, offset THIS group to match it;
 * do not change the physics root. Skids touch y=0 in the neutral pose.
 *
 * Dimensions / why:
 *   Cabin: 1.64 wide x 1.36 high x 3.00 long, with a flattened lower shell.
 *   Boom: 4.05 long; tapers from radius .27 to .065, outside the cabin aft.
 *   Main rotor: 4.20 radius, four .18-chord blades, mast hub at y=2.72.
 *   Tail rotor: .80 radius, two blades, axis at x=-.24 (LEFT of the fin).
 *   Skid track: 1.84; fore/aft length about 3.12; body length about 7.3.
 * This is a simplified light utility silhouette, not an exact Bell 206 replica;
 * the requested four blades and 8.4m disc take precedence over type accuracy.
 *
 * update(dt, state):
 *   dt           finite seconds >= 0; zero makes no animation progress.
 *   rotorRpm     main rotor RPM >= 0, bounded to 1.5 * nominalRotorRpm.
 *   collective   normalized [0,1]; a visual load proxy, NOT blade-pitch degrees.
 *   cyclicPitch  normalized [-1,1]; positive tilts thrust towards -Z.
 *   cyclicRoll   normalized [-1,1]; positive tilts thrust towards +X.
 * Omitted state fields retain their last finite command; defaults are all 0.
 * Pass measured/simulated RPM, not throttle. This model does not simulate spool-up.
 *
 * userData exposes mast, mainRotorTilt, mainRotorSpin, bladePivots,
 * mainBlades (InstancedMesh), mainBlur, tailRotorSpin, tailBladePivots,
 * tailBlades (InstancedMesh), tailBlur, telemetry, dimensions, stats, update,
 * and dispose. Pivots describe each instanced blade in its spinner's frame.
 * update owns their transforms. Rotor-strike controls are documented below.
 *
 * 562 geometry triangles with both blur surfaces counted, 15 main-pass draw
 * calls when both rotors are crossfading. Shadows add passes if enabled.
 * Double-sided blur is forced to one pass.
 * Cached Canvas albedo: cabin 1024x512, blade 256x64, boom 256x512, other
 * surfaces 256x256, blur 128x128. Panel normal maps: cabin 512x256,
 * boom 256x512, other painted surfaces 256x256; glazing masks 512x256.
 * Color/severity keys reuse textures; normal and mask textures are linear data.
 * Paint follows the game's aeroplane treatment: seams, rivets, normal-map
 * grooves, faint mottling and trailing dirt, with separate metal and vents.
 * Glass has view-dependent environment reflections and masked clearcoat.
 * Shared default environment: six procedural 128x128 sky/ground canvases.
 * No downloaded textures or reflection images; geometry/draw budgets unchanged.
 * No object creation or geometry allocation in the per-frame update.
 *
 * Remove the group from its parent before calling userData.dispose().
 * dispose() also removes any rotor fragments, so wait until their animation
 * ends if you want the debris to outlive the aircraft body.
 *
 * ROTOR STRIKE — call once from your existing collision detector:
 *   helicopter.userData.strikeRotor({
 *     rotor: 'main',                    // 'main' or 'tail'
 *     debrisParent: scene,              // defaults to the containing Scene
 *     worldVelocity: aircraftVelocity,  // metres/second, WORLD axes
 *     groundHeight: (x, z) => terrainHeightAt(x, z)
 *   });
 * Optional bladeIndices selects original blade numbers (main 0..3, tail 0..1);
 * omitted means all surviving blades of that rotor. Repeated hits are ignored.
 * Each blade splits into 3 spanwise pieces. Remaining blades stay visible;
 * that rotor's blur disappears immediately, and its hub visually coasts down.
 * No RPM command can restore a broken blade; resetRotorDamage() repairs it.
 *
 * Additional strike options:
 *   worldAngularVelocity: {x,y,z} radians/sec, defaults zero.
 *   velocityOrigin: world point about which that angular velocity acts;
 *                   defaults to this group's world origin.
 *   velocityKick: extra world velocity in m/s from the collision, default zero.
 *   lifetime: seconds until fragments disappear, default 6, valid .5..12.
 *   groundHeight: a world Y number or function(x,z), optional. A non-finite
 *                 callback result means no surface at that location.
 * Without groundHeight, fragments fall freely until their lifetime expires.
 *
 * strikeRotor returns the number of new fragments. userData.rotorDamage exposes
 * main/tail flags, mainIntact[4], tailIntact[2], and activeFragments (read-only
 * by convention). userData.rotorDebris is null until the first strike, then
 * the external group containing three InstancedMesh batches.
 *
 * update(dt,state) advances debris automatically. If the body is removed and
 * you stop calling update, call updateDebris(dt) instead; never call both in
 * the same frame. resetRotorDamage() clears fragments and restores a stopped
 * rotor pose for respawn. dispose() cleans up both the model and its debris.
 * The debris parent must be outside the aircraft's moving hierarchy (normally
 * scene). Fragments retain world-space motion even if that parent moves.
 * Positive uniform aircraft scale is supported; shear/non-uniform/mirrored
 * aircraft transforms are rejected before a strike changes anything.
 *
 * Intact budget is 562 triangles. A blade's 12 triangles become 36;
 * with both rotors completely shattered the conservative total is 658,
 * including the surviving body and all 18 fragments. Debris uses at most
 * 3 extra draws and allocates its fixed pool only on the first strike.
 *
 * Visual limitations: glazing is opaque tinted glass with reflections, without
 * a modeled interior. The default reflected sky is static, not a live capture
 * of nearby objects. Pass environmentMap at construction or call
 * userData.setGlassEnvironment(texture) for the game's procedural environment
 * (CubeTexture or appropriately mapped environment Texture); null restores
 * the default. The caller owns and disposes supplied environment textures.
 * glassReflectionIntensity defaults to 1.4; userData.glassMaterial exposes the
 * material for lighting adjustments. Reflections vary with camera and airframe
 * rotation; damaged glazing has rougher reflection masks. Shared procedural
 * maps/environment survive individual model disposal for reuse.
 * Coning is a rigid hinge approximation. Tail RPM is
 * a fixed ratio. Blur thresholds and cyclic sign mapping need checking in
 * your renderer/game, especially at low frame rates. No in-game validation
 * is implied by this standalone module.
 * Breakup is visual physics (gravity, drag, tumble, simple ground bounce),
 * not a flight-dynamics/damage solver. Your game must apply loss of lift/yaw
 * authority and trigger its existing sound, smoke, or sparks separately.
 * Presentation for ages 10–12: mechanical breakup only; no people or injury effects.
 *
 * STRIKE-POINT CONTRACT v1 — use this interface on subsequent model modules.
 * userData.strikePoints contains cabin, engineCover, tailBoom, tailFin,
 * stabilizer, leftSkid, rightSkid, mainRotor and tailRotor. Each entry exposes
 * an id, label, node-relative center/halfExtents, massKg and detached status.
 * getStrikeBounds(id, reusableBox3) returns a WORLD AABB, or null after loss.
 * These are conservative hit regions for broad-phase tests, not exact collision
 * hulls. Your collision solver decides when an impact is strong enough to break.
 *
 *   const result = helicopter.userData.strike('tailBoom', {
 *     debrisParent: scene,
 *     worldVelocity: aircraftVelocity,
 *     worldAngularVelocity: aircraftAngularVelocity,
 *     impulse: contactImpulse,        // WORLD newton-seconds, optional
 *     impactPoint: contactPosition,   // WORLD metres, optional
 *     groundHeight: terrainHeightAt
 *   });
 *
 * strike returns null for an already detached section; otherwise
 * { id, body, rotorFragments }. Rotor strikes use the existing splitter and
 * return body:null. Airframe strikes reuse the real section's geometry;
 * tailBoom carries any remaining fin/stabilizer/hub, and tailFin carries its
 * hub. Losing either support also shatters surviving tail rotor blades.
 * Hitting a lost child cannot create a second copy. Both skids remain instanced.
 *
 * Airframe body fields: visual (external Group), position, quaternion,
 * velocity and angularVelocity in WORLD space; massKg and local principal
 * inertia in kg*m^2; scale is the conservative bounding-box size in metres.
 * Mass defaults are DESIGN PLACEHOLDERS, not measured aircraft data. Override
 * massKg on strike; inertia uses the box approximation. Impulse updates linear
 * momentum and, with impactPoint, angular momentum about the section's box
 * centre. Calibrated masses, accurate hulls, constraints, air loads and reaction
 * on the remaining aircraft belong to your flight/collision solver.
 *
 * For engine integration use externalPhysics:true on an AIRFRAME strike, then
 * write result.body.position/quaternion from your solver before updateDebris.
 * Built-in integration is skipped for that body; render sync/lifetime still run.
 * The older rotor-fragment simulation remains the documented visual fallback.
 * Without externalPhysics the same gravity/drag/ground-bounce preview is used.
 * update advances all debris; call updateDebris instead when the model loop is
 * gone. resetDamage() restores every section; resetRotorDamage() is now a
 * backward-compatible alias for this full reset. partBodies and airframeDamage
 * expose active airframe bodies/count. Do not mutate strike-point descriptors.
 *
 * Raycast mesh.userData.strikeId maps ordinary meshes to their section. For
 * SkidsAndStruts use userData.strikeIdsByInstance[hit.instanceId]; this mapping
 * is kept current when either skid is removed. Intact geometry is 562 tris;
 * body separation adds no rendered triangles. Full rotor breakup remains at
 * most 658 total; separated skids can add one extra main-pass draw.
 *
 * CONNECTED WRECK / TERRAIN CONTACT
 * damagePart(id, severity) deforms cabin, engineCover, mainRotor, leftSkid or
 * rightSkid in place; severity is 0..1, absolute rather than cumulative.
 * Other named sections support strike() separation, not in-place deformation.
 * Bent rotors use three instanced segments per blade and keep their connection
 * until explicitly struck. Cabin crush/scuffs and kink angles are art-directed,
 * not calculated material failure. Damage does not auto-detach every section.
 *
 * Call once after your game's crash detector fires:
 *   helicopter.userData.beginCrash({
 *     groundHeight: (x,z) => terrainHeightAt(x,z),
 *     worldVelocity: velocityAtCenterOfMass,
 *     worldAngularVelocity: angularVelocity,
 *     massKg: 900,                    // replace this DESIGN PLACEHOLDER
 *     centerOfMass: { x:0, y:1.2, z:.15 }, // local metres; also a placeholder
 *     damage: { cabin:.85, engineCover:.45, mainRotor:.85,
 *               leftSkid:.8, rightSkid:.6 }
 *   });
 * Then call update(dt) once per frame. beginCrash stops rotor commands and
 * takes ownership of THIS group's world pose, counter-transforming its parent.
 * Disable flight integration for the actual game body separately; do not run
 * two solvers on the same body. resetDamage restores the pre-crash LOCAL pose.
 * The public game source was inspected; these hooks are not deployed to it yet.
 *
 * crashBody exposes COM position, quaternion, WORLD velocity/angularVelocity,
 * massKg, local diagonal inertia, contacts, sleeping, points and wake().
 * updateCrash(dt) is available if running body physics separately; don't call
 * it as well as update(dt) in the same frame. After changing state call wake().
 * Removing/deforming a supporting section refreshes the contact cloud on the
 * next update; reread userData.crashBody after that refresh. Mass/COM stay at
 * caller-supplied values; your game must account for mass lost on detachment.
 * An optional positive local inertia:{x,y,z} overrides the box approximation.
 * Optional friction=.65 and restitution=.08 control ground response.
 *
 * Gravity is 9.81m/s² with off-centre contact torque and Coulomb friction at
 * fixed 120Hz. A nose-down body can tip onto skids, side or roof according to
 * balance; there is no canned upright rotation. Calls cap elapsed physics at
 * .25s to avoid unbounded work after a stall. Actual deformed airframe vertices
 * support the body; weak rotor blades bend visually against the terrain rather
 * than propping it up. The connected wreck persists until reset/dispose.
 * Static smooth height fields only: vertical walls, other bodies, water, high
 * speed continuous collision detection and calibrated flight dynamics need the
 * game's physics engine. This is a tested approximate ground-contact solver.
 * Detached pieces still use the older documented fallback or externalPhysics.
 * Maximum rendered geometry with bent or shattered rotors: 658 triangles;
 * worst mixed bent/broken state allows 20 main-pass draws (21 with split skids).
 */

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
function createGroundBody(options) {
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

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const textureCache = new Map();
const clamp = THREE.MathUtils.clamp;

function cachedTexture(key, width, height, paint, srgb = true) {
  if (textureCache.has(key)) return textureCache.get(key);
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('Helicopter textures require a Canvas 2D context.');
  paint(ctx, width, height);
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.anisotropy = 4;
  textureCache.set(key, texture);
  return texture;
}

// The same glazing region is used by the color map and surface masks. A single
// cabin draw can therefore have smooth glass and rough painted metal without a
// transparent overlay, depth sorting, or a second copy of the damaged shell.
function helicopterGlazingMask(kind, damage = 0) {
  const level = Math.round(clamp(damage, 0, 1) * 3);
  return cachedTexture(`glazing:${kind}:${level}`, 512, 256, (ctx, w, h) => {
    ctx.fillStyle = kind === 'coat' ? '#000000' : '#a3a3a3';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = kind === 'coat' ? '#ffffff' : (level ? '#424242' : '#1b1b1b');
    ctx.fillRect(w * .494, h * .21, w * .512, h * .405);
    ctx.fillStyle = kind === 'coat' ? '#000000' : '#9b9b9b';
    for (const u of [.57, .744, .91]) ctx.fillRect(w * u, h * .19, w * .014, h * .445);
    if (level) {
      // Broad scraped areas scatter the reflection; still-intact panes retain it.
      ctx.fillStyle = kind === 'coat' ? '#747474' : '#8a8a8a';
      for (const [u, v, width, height] of [[.66,.46,.055,.11],[.8,.34,.025,.17]])
        ctx.fillRect(w * u, h * v, w * width, h * height);
    }
  }, false);
}

let cachedHelicopterEnvironment = null;
export function helicopterReflectionEnvironment() {
  if (cachedHelicopterEnvironment) return cachedHelicopterEnvironment;
  // Seamless analytic sky/ground, evaluated in direction space on six canvases.
  // This is a static environment reflection, not a live capture of nearby objects.
  // The game can supply its own procedural environment through setGlassEnvironment.
  const size = 128, faces = [], direction = new THREE.Vector3();
  const sun = new THREE.Vector3(-.55, .72, -.42).normalize();
  for (let face = 0; face < 6; face++) {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d'), pixels = ctx.createImageData(size, size), data = pixels.data;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const u = 2 * (x + .5) / size - 1, v = 2 * (y + .5) / size - 1;
      if (face === 0) direction.set(1, -v, -u);
      else if (face === 1) direction.set(-1, -v, u);
      else if (face === 2) direction.set(u, 1, v);
      else if (face === 3) direction.set(u, -1, -v);
      else if (face === 4) direction.set(u, -v, 1);
      else direction.set(-u, -v, -1);
      direction.normalize();
      const elevation = direction.y, azimuth = Math.atan2(direction.z, direction.x);
      const ridge = .015 + .012 * Math.sin(azimuth * 5) + .008 * Math.sin(azimuth * 11 + 1);
      let r, g, b;
      if (elevation < ridge) {
        const ground = Math.sqrt(Math.max(0, -elevation));
        r = 87 + ground * 24; g = 94 + ground * 23; b = 82 + ground * 21;
      } else {
        const altitude = Math.pow(Math.max(0, elevation), .45);
        r = 214 - altitude * 96; g = 224 - altitude * 75; b = 226 - altitude * 56;
        const pattern = Math.sin(direction.x * 12 + direction.z * 5) +
          .55 * Math.sin(direction.x * 23 - direction.z * 11 + 1) + .2 * Math.sin(direction.z * 43);
        const cloud = clamp((pattern - .1) * .43, 0, .63) * smoothRange(elevation, .08, .35);
        r += (233 - r) * cloud; g += (235 - g) * cloud; b += (232 - b) * cloud;
        const glow = Math.pow(Math.max(0, direction.dot(sun)), 140) * 36;
        r += glow; g += glow; b += glow * .83;
      }
      const offset = (y * size + x) * 4;
      data[offset] = r; data[offset + 1] = g; data[offset + 2] = b; data[offset + 3] = 255;
    }
    ctx.putImageData(pixels, 0, 0); faces.push(canvas);
  }
  const texture = new THREE.CubeTexture(faces);
  texture.colorSpace = THREE.SRGBColorSpace; texture.needsUpdate = true;
  cachedHelicopterEnvironment = texture;
  return texture;
}

// Procedural painted-aluminium treatment matched to FlightSim's aeroplanes.
// Uses only cachedTexture, THREE and Canvas2D; every pattern is deterministic.
function helicopterTextureRandom(seed) {
  let n = seed >>> 0;
  return () => { n = (Math.imul(n, 1664525) + 1013904223) >>> 0; return n / 4294967296; };
}

function helicopterPaintGrain(ctx, w, h, seed, amount = 1) {
  const random = helicopterTextureRandom(seed);
  // Overlapping faint patches make paint variation, not a repeating grid.
  for (let i = 0; i < 100; i++) {
    const x = random() * w, y = random() * h, radius = (0.04 + random() * .1) * Math.min(w, h);
    const shade = i % 2 ? '255,250,234' : '30,35,41';
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, `rgba(${shade},${(.017 + random() * .025) * amount})`);
    gradient.addColorStop(1, `rgba(${shade},0)`);
    ctx.fillStyle = gradient; ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }
  for (let i = 0; i < Math.round(w * h / 50); i++) {
    ctx.fillStyle = i % 2 ? `rgba(255,255,255,${.034 * amount})` : `rgba(13,19,24,${.045 * amount})`;
    ctx.fillRect(random() * w, random() * h, 1 + random() * 2, .7 + random());
  }
}

function helicopterPanelLine(ctx, w, h, points, rivets = true) {
  const p = points.map(([x, y]) => [x * w, y * h]);
  ctx.lineWidth = Math.max(.65, w / 780);
  // A pale seam edge alongside the narrow recessed joint gives paint depth.
  for (const [offset, shade] of [[1.1, 'rgba(238,232,212,.18)'], [0, 'rgba(29,35,42,.55)']]) {
    ctx.strokeStyle = shade; ctx.beginPath();
    p.forEach(([x, y], i) => { if (i) ctx.lineTo(x + offset, y + offset); else ctx.moveTo(x + offset, y + offset); });
    ctx.stroke();
  }
  if (!rivets) return;
  const spacing = Math.max(7, w / 59), radius = Math.max(.55, w / 850);
  for (let i = 1; i < p.length; i++) {
    const [x0, y0] = p[i - 1], dx = p[i][0] - x0, dy = p[i][1] - y0;
    const length = Math.hypot(dx, dy), nx = -dy / (length || 1), ny = dx / (length || 1);
    for (let d = spacing * .4; d < length - spacing * .25; d += spacing) {
      const x = x0 + dx * d / length + nx * 3, y = y0 + dy * d / length + ny * 3;
      ctx.fillStyle = 'rgba(26,31,37,.55)'; ctx.beginPath();ctx.arc(x, y, radius, 0, Math.PI * 2);ctx.fill();
      ctx.fillStyle = 'rgba(218,218,207,.43)'; ctx.fillRect(x - radius * .5, y - radius * .7, radius, radius * .65);
    }
  }
}

function helicopterPaintStreaks(ctx, w, h, seed, count, region = [0, 0, 1, 1], direction = 'x') {
  const random = helicopterTextureRandom(seed);
  for (let i = 0; i < count; i++) {
    const x = w * (region[0] + random() * (region[2] - region[0]));
    const y = h * (region[1] + random() * (region[3] - region[1]));
    const length = (.015 + random() * .07) * (direction === 'x' ? w : h);
    const gradient = ctx.createLinearGradient(x, y, x + (direction === 'x' ? length : 0), y + (direction === 'x' ? 0 : length));
    gradient.addColorStop(0, 'rgba(40,39,36,.15)'); gradient.addColorStop(1, 'rgba(40,39,36,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(x, y, direction === 'x' ? length : .6 + random() * 1.3, direction === 'x' ? .6 + random() * 1.3 : length);
  }
}

export function helicopterCabinTexture(bodyColor = 0x863e38, trimColor = 0xc8c5ba, damage = 0) {
  const body = new THREE.Color(bodyColor).getHexString();
  const trim = new THREE.Color(trimColor).getHexString();
  const level = Math.round(THREE.MathUtils.clamp(damage, 0, 1) * 3);
  return cachedTexture(`cabin-detail-v2:${body}:${trim}:${level}`, 1024, 512, (ctx, w, h) => {
    ctx.fillStyle = `#${body}`; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#303940'; ctx.fillRect(0, h * .735, w, h * .265);
    // The familiar pale livery band and narrow charcoal cheatline remain readable in flight.
    ctx.fillStyle = `#${trim}`; ctx.fillRect(0, h * .655, w, h * .045);
    ctx.fillStyle = 'rgba(36,43,52,.9)'; ctx.fillRect(0, h * .71, w, h * .013);
    helicopterPaintGrain(ctx, w, h, 107);

    for (const u of [.055, .16, .29, .405, .49, .585, .75, .915]) {
      helicopterPanelLine(ctx, w, h, [[u, .12], [u, .87]]);
    }
    for (const v of [.295, .48, .625, .78]) {
      helicopterPanelLine(ctx, w, h, [[.012, v], [.988, v]]);
    }
    // Rear access panel and latches; distinct from the cockpit glazing.
    helicopterPanelLine(ctx, w, h, [[.19, .32], [.335, .32], [.344, .565], [.185, .565], [.19, .32]]);
    ctx.fillStyle = 'rgba(241,228,193,.16)';ctx.fillRect(w * .202, h * .341, w * .119, h * .19);
    ctx.fillStyle = '#343b3f';
    for (const u of [.202, .316]) ctx.fillRect(w * u, h * .43, w * .009, h * .035);
    helicopterPaintStreaks(ctx, w, h, 19, 125);

    // SphereGeometry's front (-Z) is u=.75. Keep this layout in sync with
    // the separate glass roughness/reflection mask in the model material.
    ctx.fillStyle = '#253139'; ctx.fillRect(w * .48, h * .19, w * .54, h * .445);
    const glass = ctx.createLinearGradient(0, h * .21, 0, h * .615);
    glass.addColorStop(0, '#52616a'); glass.addColorStop(.5, '#34444e'); glass.addColorStop(1, '#27343c');
    ctx.fillStyle = glass; ctx.fillRect(w * .494, h * .21, w * .512, h * .405);
    for (const u of [.57, .744, .91]) {
      ctx.fillStyle = '#253139';ctx.fillRect(w * u, h * .19, w * .014, h * .445);
      ctx.fillStyle = 'rgba(205,207,197,.2)';ctx.fillRect(w * u, h * .205, w * .0014, h * .407);
    }
    // Rubber seals stay quiet; actual moving highlights come from the material.
    ctx.fillStyle = 'rgba(10,20,27,.46)';ctx.fillRect(w * .494, h * .603, w * .512, h * .012);
    for (const u of [.502, .927]) {
      helicopterPanelLine(ctx, w, h, [[u, .636], [u, .777], [u + .06, .777]], false);
      ctx.fillStyle = '#242c32';ctx.fillRect(w * (u + .012), h * .637, w * .027, h * .01);
      ctx.fillStyle = 'rgba(219,220,209,.56)';ctx.fillRect(w * (u + .014), h * .637, w * .02, h * .003);
    }
    ctx.fillStyle = 'rgba(228,226,209,.8)'; ctx.font = `500 ${Math.round(h * .019)}px Arial, sans-serif`;
    ctx.fillText('ACCESS', w * .218, h * .548);

    if (level) {
      const random = helicopterTextureRandom(702);
      // A few irregular impact-centred cracks with branches, avoiding a tiled pattern.
      for (const [ux, vy] of [[.684, .45], [.85, .525]]) {
        const cx = ux * w, cy = vy * h;
        for (let ray = 0; ray < 5 + level * 2; ray++) {
          const angle = ray * Math.PI * 2 / (5 + level * 2) + random() * .55;
          let x = cx, y = cy;
          ctx.strokeStyle = ray % 3 ? 'rgba(181,199,202,.6)' : 'rgba(6,16,22,.9)';ctx.lineWidth = .7 + random() * 1.3;
          ctx.beginPath();ctx.moveTo(x, y);
          for (let step = 0; step < 3; step++) {
            x += Math.cos(angle + (random() - .5) * .6) * (w * .005 + random() * w * .009);
            y += Math.sin(angle + (random() - .5) * .6) * (h * .015 + random() * h * .035);
            x = Math.max(w * .59, Math.min(w * .899, x));y = Math.max(h * .22, Math.min(h * .595, y));
            ctx.lineTo(x, y);
          }
          ctx.stroke();
          if (ray % 2 === 0) {
            ctx.beginPath();ctx.moveTo(x, y);ctx.lineTo(x + Math.cos(angle + 1.2) * w * .009, y + Math.sin(angle + 1.2) * h * .035);ctx.stroke();
          }
        }
      }
      if (level > 1) {
        ctx.fillStyle = '#1c262a';ctx.beginPath();
        [[.677,.419],[.696,.427],[.72,.47],[.705,.548],[.68,.571],[.665,.516],[.672,.463]].forEach(([x,y],i) => i ? ctx.lineTo(x*w,y*h) : ctx.moveTo(x*w,y*h));
        ctx.closePath();ctx.fill();
      }
      // Local sliding abrasion: irregular exposed aluminium and dirt near the crushed nose.
      for (let i = 0; i < 25 * level; i++) {
        const x = w * (.57 + random() * .34), y = h * (.635 + random() * .19);
        ctx.strokeStyle = i % 3 ? 'rgba(46,38,31,.53)' : 'rgba(180,177,162,.78)';ctx.lineWidth = .6 + random() * 1.6;
        ctx.beginPath();ctx.moveTo(x, y);ctx.lineTo(x + w * (.003 + random() * .02), y + h * (random() - .5) * .018);ctx.stroke();
      }
    }
  });
}

export function helicopterBladeTexture() {
  return cachedTexture('blade-detail-v2', 256, 64, (ctx, w, h) => {
    ctx.fillStyle = '#293137';ctx.fillRect(0, 0, w, h);
    helicopterPaintGrain(ctx, w, h, 191, .8);
    // Brushed leading-edge abrasion strip and a restrained safety tip.
    ctx.fillStyle = '#87908e';ctx.fillRect(0, 0, w, h * .075);
    ctx.fillStyle = 'rgba(215,217,205,.6)';ctx.fillRect(0, 0, w, 1);
    ctx.fillStyle = '#d3c9a7';ctx.fillRect(w * .92, 0, w * .08, h);
    ctx.fillStyle = '#1f282e';ctx.fillRect(w * .912, 0, w * .008, h);
    helicopterPaintStreaks(ctx, w, h, 19, 34);
    ctx.fillStyle = 'rgba(223,226,214,.3)';ctx.fillRect(w * .045, h * .13, w * .016, h * .62);
  });
}

export function helicopterSurfaceTexture(kind, color = 0x863e38, damage = 0) {
  if (!['cowling', 'boom', 'fin', 'metal', 'dark'].includes(kind)) throw new RangeError('Unknown helicopter surface texture.');
  const hex = new THREE.Color(color).getHexString();
  const level = Math.round(THREE.MathUtils.clamp(damage, 0, 1) * 3);
  return cachedTexture(`surface-detail-v2:${kind}:${hex}:${level}`, 256, kind === 'boom' ? 512 : 256, (ctx, w, h) => {
    ctx.fillStyle = `#${hex}`;ctx.fillRect(0, 0, w, h);
    helicopterPaintGrain(ctx, w, h, 451 + kind.length, kind === 'metal' ? .6 : 1);
    if (kind === 'cowling') {
      for (const u of [.15, .5, .85]) helicopterPanelLine(ctx, w, h, [[u,.18],[u,.82]]);
      for (const v of [.31,.7]) helicopterPanelLine(ctx, w, h, [[.03,v],[.97,v]]);
      for (const u of [.25,.64]) {
        helicopterPanelLine(ctx,w,h,[[u,.4],[u+.19,.4],[u+.19,.62],[u,.62],[u,.4]],false);
        for (let row=0;row<6;row++) {
          ctx.fillStyle='#273033';ctx.fillRect(w*(u+.018),h*(.424+row*.029),w*.154,h*.012);
          ctx.fillStyle='rgba(224,209,185,.3)';ctx.fillRect(w*(u+.018),h*(.423+row*.029),w*.154,.6);
        }
      }
      helicopterPaintStreaks(ctx,w,h,731,38,[0,.22,1,.84]);
    } else if (kind === 'boom') {
      // Cylinder v follows the boom length: ring joints and a single lengthwise seam.
      for (const v of [.16,.38,.62,.85]) helicopterPanelLine(ctx,w,h,[[0,v],[1,v]]);
      for (const u of [.24,.76]) helicopterPanelLine(ctx,w,h,[[u,.01],[u,.99]]);
      ctx.fillStyle='rgba(213,207,181,.9)';ctx.fillRect(0,h*.09,w,h*.022);
      ctx.fillStyle='rgba(36,43,50,.85)';ctx.fillRect(0,h*.122,w,h*.01);
      helicopterPaintStreaks(ctx,w,h,552,65,[0,.1,1,.94],'y');
    } else if (kind === 'fin') {
      ctx.fillStyle='rgba(220,212,185,.85)';ctx.fillRect(0,h*.17,w,h*.1);
      ctx.fillStyle='rgba(28,37,44,.75)';ctx.fillRect(0,h*.29,w,h*.022);
      helicopterPanelLine(ctx,w,h,[[.75,.01],[.75,.99]]);
      helicopterPanelLine(ctx,w,h,[[.025,.55],[.98,.55]]);
      helicopterPanelLine(ctx,w,h,[[.025,.91],[.98,.91]]);
      helicopterPaintStreaks(ctx,w,h,823,26,[.08,.31,.88,.94]);
    } else {
      const random=helicopterTextureRandom(614);
      for(let i=0;i<260;i++) {
        const y=random()*h;
        ctx.fillStyle=i%2?'rgba(228,232,225,.06)':'rgba(6,12,16,.1)';
        ctx.fillRect(random()*w,y,w*(.05+random()*.75),.4+random()*.5);
      }
      if(kind==='dark') {
        const heat=ctx.createLinearGradient(0,0,0,h);
        heat.addColorStop(0,'rgba(137,97,55,.2)');heat.addColorStop(.4,'rgba(80,82,92,.08)');heat.addColorStop(1,'rgba(0,0,0,.5)');
        ctx.fillStyle=heat;ctx.fillRect(0,0,w,h);
      } else {
        ctx.fillStyle='rgba(218,220,208,.25)';ctx.fillRect(0,h*.1,w,1);
        ctx.fillStyle='rgba(13,19,23,.22)';ctx.fillRect(0,h*.104,w,1);
      }
    }
    if(level) {
      const random=helicopterTextureRandom(511);
      for(let i=0;i<level*23;i++) {
        ctx.fillStyle=i%3?'rgba(36,32,28,.4)':'rgba(168,173,164,.62)';
        ctx.fillRect(random()*w,h*(.38+random()*.38),w*(.004+random()*.045),.6+random()*1.7);
      }
    }
  });
}

export function helicopterSurfaceNormal(kind) {
  if (!['cabin','cowling','boom','fin','metal','dark'].includes(kind)) throw new RangeError('Unknown helicopter normal texture.');
  const width=kind==='cabin'?512:256, height=kind==='boom'?512:256;
  return cachedTexture(`surface-normal-v2:${kind}`,width,height,(ctx,w,h)=>{
    const field=new Float32Array(w*h), random=helicopterTextureRandom(517);
    const uLines=kind==='cabin'?[.055,.16,.29,.405,.49,.585,.75,.915]:kind==='cowling'?[.15,.5,.85]:kind==='boom'?[.24,.76]:kind==='fin'?[.75]:[];
    const vLines=kind==='cabin'?[.295,.48,.625,.78]:kind==='cowling'?[.31,.7]:kind==='boom'?[.16,.38,.62,.85]:kind==='fin'?[.55,.91]:[];
    const glass=(u,v)=>kind==='cabin'&&u>=.478&&v>=.186&&v<=.638;
    for(let y=0;y<h;y++) for(let x=0;x<w;x++) {
      const u=(x+.5)/w,v=(y+.5)/h;
      let value=(random()-.5)*.015;
      if(glass(u,v)) value=0;
      else {
        for(const line of uLines) {
          const d=Math.abs(u-line)*w; if(d<2.5)value-=.28*Math.exp(-d*d/1.1);
        }
        for(const line of vLines) {
          const d=Math.abs(v-line)*h; if(d<2.5)value-=.28*Math.exp(-d*d/1.1);
        }
        if(kind==='cowling') for(const u0 of [.25,.64]) {
          if(u>u0+.018&&u<u0+.172) for(let row=0;row<6;row++) {
            const d=Math.abs(v-(.430+row*.029))*h;if(d<2)value-=.24*Math.exp(-d*d/.8);
          }
        }
      }
      field[y*w+x]=value;
    }
    const result=ctx.createImageData(w,h), pixels=result.data;
    for(let y=0;y<h;y++) for(let x=0;x<w;x++) {
      const i=(y*w+x)*4, u=(x+.5)/w,v=(y+.5)/h;
      let nx=0,ny=0;
      if(!glass(u,v)) {
        const dx=field[y*w+Math.min(w-1,x+1)]-field[y*w+Math.max(0,x-1)];
        const dy=field[Math.min(h-1,y+1)*w+x]-field[Math.max(0,y-1)*w+x];
        nx=-dx*.8;ny=dy*.8;
      }
      const inv=1/Math.sqrt(nx*nx+ny*ny+1);
      pixels[i]=Math.round((nx*inv*.5+.5)*255);pixels[i+1]=Math.round((ny*inv*.5+.5)*255);
      pixels[i+2]=Math.round((inv*.5+.5)*255);pixels[i+3]=255;
    }
    ctx.putImageData(result,0,0);
  },false);
}

function rotorBlurTexture() {
  return cachedTexture('rotor-blur', 128, 128, (ctx, w, h) => {
    const gradient = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    gradient.addColorStop(0, 'rgba(113,136,145,0)');
    gradient.addColorStop(.12, 'rgba(113,136,145,0)');
    gradient.addColorStop(.25, 'rgba(113,136,145,.10)');
    gradient.addColorStop(.84, 'rgba(113,136,145,.18)');
    gradient.addColorStop(.92, 'rgba(241,198,86,.20)');
    gradient.addColorStop(.975, 'rgba(241,198,86,.27)');
    gradient.addColorStop(1, 'rgba(241,198,86,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);
  });
}

function smoothRange(value, low, high) {
  const t = clamp((value - low) / (high - low), 0, 1);
  return t * t * (3 - 2 * t);
}

function bladeGeometry(rootRadius, tipRadius, chord) {
  const length = tipRadius - rootRadius;
  const geometry = new THREE.BoxGeometry(length, .018, chord);
  geometry.translate(rootRadius + length / 2, 0, 0);
  const pos = geometry.getAttribute('position');
  const uv = geometry.getAttribute('uv');
  // All box faces use spanwise UVs so the yellow paint stays at the physical tip.
  for (let i = 0; i < pos.count; i++) {
    uv.setXY(i, (pos.getX(i) - rootRadius) / length, pos.getZ(i) / chord + .5);
  }
  return geometry;
}

function mainBlurGeometry() {
  // A shallow cone keeps the swept surface attached to the hub under load.
  const geometry = new THREE.ConeGeometry(4.2, 1, 32, 1, true);
  geometry.rotateX(Math.PI);
  geometry.translate(0, .5, 0);
  const position = geometry.getAttribute('position');
  const uv = geometry.getAttribute('uv');
  for (let i = 0; i < position.count; i++) {
    uv.setXY(i, .5 + position.getX(i) / 8.4, .5 + position.getZ(i) / 8.4);
  }
  return geometry;
}

export function createHelicopter({
  color = 0x863e38,
  trimColor = 0xc8c5ba,
  nominalRotorRpm = 400,
  maxCyclicDegrees = 8,
  tailRotorRatio = 5.5,
  castShadow = false,
  environmentMap = null,
  glassReflectionIntensity = 1.4
} = {}) {
  if (!Number.isFinite(nominalRotorRpm) || nominalRotorRpm <= 0 ||
      !Number.isFinite(maxCyclicDegrees) || maxCyclicDegrees < 0 || maxCyclicDegrees > 10 ||
      !Number.isFinite(tailRotorRatio) || tailRotorRatio <= 0 ||
      !Number.isFinite(glassReflectionIntensity) || glassReflectionIntensity < 0 ||
      (environmentMap !== null && !environmentMap?.isTexture)) {
    throw new RangeError('Use positive RPM/ratio, maxCyclicDegrees 0..10, nonnegative reflection intensity and a Texture or null environment.');
  }

  const g = new THREE.Group();
  g.name = 'UtilityHelicopter';
  const geometries = new Set();
  const materials = new Set();
  const instancedMeshes = [];
  const ownedGeometry = geometry => { geometries.add(geometry); return geometry; };
  const standard = (parameters = {}) => {
    const material = new THREE.MeshStandardMaterial({ roughness: .68, metalness: .12, ...parameters });
    materials.add(material);
    return material;
  };
  const painted = kind => standard({ map: helicopterSurfaceTexture(kind, color),
    normalMap: helicopterSurfaceNormal(kind), normalScale: new THREE.Vector2(.5, .5),
    roughness: .48, metalness: .35 });
  const paint = painted('cowling'), boomPaint = painted('boom'), finPaint = painted('fin');
  const dark = standard({ map: helicopterSurfaceTexture('dark', 0x26333b), roughness: .64, metalness: .2 });
  const metal = standard({ map: helicopterSurfaceTexture('metal', 0x8b9294), roughness: .38, metalness: .7 });
  const glassPaint = new THREE.MeshPhysicalMaterial({
    map: helicopterCabinTexture(color, trimColor), roughness: 1,
    roughnessMap: helicopterGlazingMask('roughness'), metalness: .14,
    normalMap: helicopterSurfaceNormal('cabin'), normalScale: new THREE.Vector2(.5, .5),
    clearcoat: 1, clearcoatMap: helicopterGlazingMask('coat'), clearcoatRoughness: .055,
    envMap: environmentMap || helicopterReflectionEnvironment(), envMapIntensity: glassReflectionIntensity
  });
  materials.add(glassPaint);
  function setGlassEnvironment(texture = null) {
    if (texture !== null && !texture?.isTexture) throw new TypeError('Pass a procedural environment Texture/CubeTexture or null for the default sky.');
    if (disposed) return;
    glassPaint.envMap = texture || helicopterReflectionEnvironment();
    glassPaint.needsUpdate = true;
  }
  const mainBladeMaterial = standard({ map: helicopterBladeTexture(), transparent: true, depthWrite: false });
  const tailBladeMaterial = standard({ map: helicopterBladeTexture(), transparent: true, depthWrite: false });
  const blurMaterial = () => {
    const m = new THREE.MeshBasicMaterial({ map: rotorBlurTexture(), transparent: true,
      depthWrite: false, side: THREE.DoubleSide, opacity: 0, toneMapped: false });
    m.forceSinglePass = true;
    materials.add(m);
    return m;
  };
  function mesh(parent, name, geometry, material, position = [0, 0, 0]) {
    const m = new THREE.Mesh(ownedGeometry(geometry), material);
    m.name = name;
    m.position.set(...position);
    m.castShadow = castShadow && !material.transparent;
    parent.add(m);
    return m;
  }
  function group(parent, name, position = [0, 0, 0]) {
    const node = new THREE.Group();
    node.name = name;
    node.position.set(...position);
    parent.add(node);
    return node;
  }

  const cabinGeometry = new THREE.SphereGeometry(1, 12, 8);
  const cabinVertices = cabinGeometry.attributes.position;
  for (let i = 0; i < cabinVertices.count; i++) {
    const x = cabinVertices.getX(i), y = cabinVertices.getY(i), z = cabinVertices.getZ(i);
    cabinVertices.setXYZ(i, x * (1 - .16 * Math.max(0, z)), y < -.55 ? -.55 + (y + .55) * .25 : y, z);
  }
  cabinGeometry.computeVertexNormals();
  const cabin = mesh(g, 'Cabin', cabinGeometry, glassPaint, [0, 1.25, -.55]);
  cabin.scale.set(.82, .82, 1.5);
  const cowling = mesh(g, 'EngineCowling', new THREE.SphereGeometry(1, 8, 4), paint, [0, 1.85, .35]);
  cowling.scale.set(.48, .37, .95);

  const axisY = new THREE.Vector3(0, 1, 0);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const direction = new THREE.Vector3();
  const dummy = new THREE.Object3D();
  function alignTube(object, start, end, radius = 1) {
    a.set(...start);
    b.set(...end);
    direction.subVectors(b, a);
    object.position.copy(a).add(b).multiplyScalar(.5);
    object.scale.set(radius, direction.length(), radius);
    object.quaternion.setFromUnitVectors(axisY, direction.normalize());
    object.updateMatrix();
  }
  const boom = mesh(g, 'TailBoom', new THREE.CylinderGeometry(.065, .27, 1, 8), boomPaint);
  alignTube(boom, [0, 1.3, .8], [0, 1.5, 4.85]);
  const fin = mesh(g, 'TailFin', new THREE.BoxGeometry(.09, 1.32, .68), finPaint, [0, 1.82, 4.78]);
  const finVertices = fin.geometry.attributes.position;
  for (let i = 0; i < finVertices.count; i++) {
    const y = finVertices.getY(i), upper = (y + .66) / 1.32;
    finVertices.setZ(i, finVertices.getZ(i) * (1 - .42 * upper) + .18 * upper);
  }
  fin.geometry.computeVertexNormals();
  fin.rotation.x = .18;
  const stabilizer = mesh(g, 'HorizontalStabilizer', new THREE.BoxGeometry(1.55, .06, .38), dark, [0, 1.4, 3.65]);

  // The repeated open tubes are one instanced draw; intersections hide their ends.
  const skidTubes = new THREE.InstancedMesh(ownedGeometry(new THREE.CylinderGeometry(1, 1, 1, 5, 1, true)), metal, 8);
  skidTubes.name = 'SkidsAndStruts';
  skidTubes.castShadow = castShadow;
  let tubeIndex = 0;
  for (const side of [-1, 1]) {
    for (const z of [-.85, .9]) {
      const upper = z < 0 ? [side * .53, .7, z] : [side * .43, .95, .35];
      alignTube(dummy, upper, [side * .92, .055, z], .043);
      skidTubes.setMatrixAt(tubeIndex++, dummy.matrix);
    }
    alignTube(dummy, [side * .92, .055, -1.3], [side * .92, .055, 1.4], .055);
    skidTubes.setMatrixAt(tubeIndex++, dummy.matrix);
    alignTube(dummy, [side * .92, .055, -1.3], [side * .92, .26, -1.72], .055);
    skidTubes.setMatrixAt(tubeIndex++, dummy.matrix);
  }
  skidTubes.instanceMatrix.needsUpdate = true;
  const skidMatrices = Array.from({ length: 8 }, (_, i) => {
    const matrix = new THREE.Matrix4();
    skidTubes.getMatrixAt(i, matrix);
    return matrix;
  });
  g.add(skidTubes);
  instancedMeshes.push(skidTubes);

  const exhaust = mesh(g, 'Exhaust', new THREE.CylinderGeometry(.11, .11, .33, 6, 1, true), dark, [0, 1.9, 1.28]);
  exhaust.rotation.x = Math.PI / 2;
  const exhaustThroat = mesh(g, 'ExhaustThroat', new THREE.CircleGeometry(.1, 6), dark, [0, 1.9, 1.449]);

  const mast = mesh(g, 'MainMast', new THREE.CylinderGeometry(.045, .065, .71, 6), metal, [0, 2.355, -.35]);
  // High enough that a stopped 15-degree droop clears the roof and tail boom.
  const tilt = group(g, 'MainRotorTilt', [0, 2.72, -.35]);
  const spin = group(tilt, 'MainRotorSpin');
  mesh(spin, 'MainHub', new THREE.CylinderGeometry(.18, .14, .11, 6), metal);
  const mainBlades = new THREE.InstancedMesh(ownedGeometry(bladeGeometry(.16, 4.2, .18)), mainBladeMaterial, 4);
  mainBlades.name = 'MainBlades';
  mainBlades.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  // An instance initially points +X, but its future sweep covers every azimuth.
  mainBlades.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 4.22);
  spin.add(mainBlades);
  instancedMeshes.push(mainBlades);
  const bladePivots = [];
  for (let i = 0; i < 4; i++) {
    const azimuth = group(spin, `MainBladeAzimuth${i}`);
    azimuth.rotation.y = i * Math.PI / 2;
    const flap = group(azimuth, `MainBladeFlap${i}`);
    bladePivots.push(flap);
  }
  const mainBlur = mesh(tilt, 'MainRotorBlur', mainBlurGeometry(), blurMaterial());
  mainBlur.renderOrder = 1;

  const tailMount = group(g, 'TailRotorMount', [-.24, 1.87, 4.88]);
  const tailSpin = group(tailMount, 'TailRotorSpin');
  const tailHub = mesh(tailSpin, 'TailHub', new THREE.CylinderGeometry(.085, .085, .4, 6), metal);
  tailHub.rotation.z = Math.PI / 2;
  const tailBladeGeo = bladeGeometry(.065, .8, .105);
  // Reorient span +X to +Y, then thickness +Y to +X: the tail sweeps in YZ.
  tailBladeGeo.rotateZ(Math.PI / 2);
  const tailBlades = new THREE.InstancedMesh(ownedGeometry(tailBladeGeo), tailBladeMaterial, 2);
  tailBlades.name = 'TailBlades';
  tailBlades.boundingSphere = new THREE.Sphere(new THREE.Vector3(), .82);
  const tailBladePivots = [];
  for (let i = 0; i < 2; i++) {
    const pivot = group(tailSpin, `TailBlade${i}`);
    pivot.rotation.x = i * Math.PI;
    pivot.updateMatrix();
    tailBlades.setMatrixAt(i, pivot.matrix);
    tailBladePivots.push(pivot);
  }
  tailBlades.instanceMatrix.needsUpdate = true;
  tailSpin.add(tailBlades);
  instancedMeshes.push(tailBlades);
  const tailBlur = mesh(tailMount, 'TailRotorBlur', new THREE.CircleGeometry(.8, 16), blurMaterial());
  tailBlur.rotation.y = Math.PI / 2;
  tailBlur.renderOrder = 1;

  const command = { rotorRpm: 0, collective: 0, cyclicPitch: 0, cyclicRoll: 0 };
  const telemetry = { rotorRpm: 0, tailRotorRpm: 0, flapAngleDegrees: -15, discPitchDegrees: 0,
    discRollDegrees: 0, mainBlur: 0, tailBlur: 0 };
  const rotorDamage = { main: false, tail: false, mainIntact: [true, true, true, true],
    tailIntact: [true, true], activeFragments: 0 };
  let coastMainRpm = 0;
  let coastTailRpm = 0;
  let flapAngle = -15 * DEG;
  let pitch = 0;
  let roll = 0;
  let mainPhase = Math.PI / 4;
  let tailPhase = Math.PI / 4;
  let disposed = false;
  const instanceMatrix = new THREE.Matrix4();
  const sourceMatrix = new THREE.Matrix4();
  const sourceRotation = new THREE.Quaternion();
  const sourceScale = new THREE.Vector3();
  const sourcePosition = new THREE.Vector3();
  const rotorAxis = new THREE.Vector3();
  const rotorOrigin = new THREE.Vector3();
  const bodyOrigin = new THREE.Vector3();
  const radial = new THREE.Vector3();
  const tailOrientation = new THREE.Matrix4().makeRotationZ(Math.PI / 2);
  const debrisInverse = new THREE.Matrix4();
  const debrisMatrix = new THREE.Matrix4();
  const tumbleStep = new THREE.Quaternion();
  const renderScale = new THREE.Vector3();
  const fragmentSlots = [];
  const debrisBatches = [];
  const cuts = [0, .46, .77, 1];
  const deformation = { cabin: 0, engineCover: 0, mainRotor: 0, leftSkid: 0, rightSkid: 0 };
  const cabinRest = cabin.geometry.attributes.position.array.slice();
  const cowlingRest = cowling.geometry.attributes.position.array.slice();
  const skidRest = skidMatrices.map(matrix => matrix.clone());
  const bentBatches = [];
  const bentMatrices = Array.from({ length: 12 }, () => new THREE.Matrix4());
  const bendBase = new THREE.Matrix4(), bendRotation = new THREE.Matrix4();
  const bendPoint = new THREE.Vector3(), bendEnd = new THREE.Vector3();
  const bendDirection = new THREE.Vector3(), bendCenter = new THREE.Vector3(), bendDelta = new THREE.Vector3();
  const bendQuaternion = new THREE.Quaternion(), bendScale = new THREE.Vector3();
  const bendInverse = new THREE.Matrix4(), bendWorld = new THREE.Vector3();
  const axisX = new THREE.Vector3(1, 0, 0);
  let crashBody = null, crashSettings = null, crashRestore = null, contactsDirty = false;
  const crashMatrix = new THREE.Matrix4(), crashInverse = new THREE.Matrix4();
  const crashOrigin = new THREE.Vector3(), crashScale = new THREE.Vector3();
  let rotorDebris = null;
  const partBodies = [];
  const detachedSections = new Set();
  const airframeDamage = { activeParts: 0 };
  const strikePoints = {};
  const partSources = {
    cabin: [cabin], engineCover: [cowling, exhaust, exhaustThroat],
    tailBoom: [boom], tailFin: [fin], stabilizer: [stabilizer],
    leftSkid: [skidTubes], rightSkid: [skidTubes], tailRotor: [tailHub]
  };
  function strikePoint(id, label, node, center, halfExtents, massKg) {
    strikePoints[id] = { id, label, node, center: new THREE.Vector3(...center),
      halfExtents: new THREE.Vector3(...halfExtents), massKg,
      get detached() {
        return detachedSections.has(id) || (id === 'mainRotor' && !rotorDamage.mainIntact.some(Boolean)) ||
          (id === 'tailRotor' && !rotorDamage.tailIntact.some(Boolean));
      } };
    for (const source of partSources[id] || []) {
      if (source !== skidTubes) source.userData.strikeId = id;
    }
  }
  strikePoint('cabin', 'Cabin shell', g, [0, 1.25, -.55], [.82, .82, 1.5], 140);
  strikePoint('engineCover', 'Engine cover and exhaust', g, [0, 1.85, .7], [.52, .4, 1.3], 28);
  strikePoint('tailBoom', 'Tail boom attachment', g, [0, 1.4, 2.825], [.28, .3, 2.05], 34);
  strikePoint('tailFin', 'Tail fin', g, [0, 1.82, 4.78], [.05, .72, .46], 8);
  strikePoint('stabilizer', 'Horizontal stabilizer', g, [0, 1.4, 3.65], [.775, .03, .19], 4);
  strikePoint('leftSkid', 'Left skid and struts', g, [-.74, .47, -.14], [.25, .5, 1.65], 9);
  strikePoint('rightSkid', 'Right skid and struts', g, [.74, .47, -.14], [.25, .5, 1.65], 9);
  strikePoint('mainRotor', 'Main rotor sweep', tilt, [0, -.45, 0], [4.22, .8, 4.22], 32);
  strikePoint('tailRotor', 'Tail rotor sweep', tailMount, [0, 0, 0], [.15, .82, .82], 4);
  mainBlades.userData.strikeId = 'mainRotor';
  tailBlades.userData.strikeId = 'tailRotor';
  skidTubes.userData.strikeIdsByInstance = Array(4).fill('leftSkid').concat(Array(4).fill('rightSkid'));

  function getStrikeBounds(id, target = new THREE.Box3()) {
    const point = strikePoints[id];
    if (!point) throw new RangeError(`Unknown strike point: ${id}`);
    if (point.detached) return null;
    if (deformation[id] > 0) {
      g.updateWorldMatrix(true, true); target.makeEmpty();
      const sources = id === 'mainRotor' ? bentBatches : partSources[id];
      const transform = new THREE.Matrix4(), instance = new THREE.Matrix4(), corner = new THREE.Vector3();
      for (const object of sources) {
        if (!object.visible) continue;
        if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
        const box = object.geometry.boundingBox;
        for (let j = 0; j < (object.isInstancedMesh ? object.count : 1); j++) {
          if (object === skidTubes && object.userData.strikeIdsByInstance[j] !== id) continue;
          if (object.isInstancedMesh) { object.getMatrixAt(j, instance); transform.multiplyMatrices(object.matrixWorld, instance); }
          else transform.copy(object.matrixWorld);
          for (let k = 0; k < 8; k++) target.expandByPoint(corner.set(
            k & 1 ? box.max.x : box.min.x, k & 2 ? box.max.y : box.min.y, k & 4 ? box.max.z : box.min.z).applyMatrix4(transform));
        }
      }
      return target;
    }
    point.node.updateWorldMatrix(true, false);
    target.min.copy(point.center).sub(point.halfExtents);
    target.max.copy(point.center).add(point.halfExtents);
    return target.applyMatrix4(point.node.matrixWorld);
  }

  function syncSkids() {
    let count = 0;
    const labels = skidTubes.userData.strikeIdsByInstance;
    labels.length = 0;
    for (let i = 0; i < 8; i++) {
      const id = i < 4 ? 'leftSkid' : 'rightSkid';
      if (detachedSections.has(id)) continue;
      skidTubes.setMatrixAt(count++, skidMatrices[i]);
      labels.push(id);
    }
    skidTubes.count = count;
    skidTubes.visible = count > 0;
    skidTubes.instanceMatrix.needsUpdate = true;
    skidTubes.computeBoundingSphere();
  }

  // Deformation uses immutable rest geometry, so repeated severity commands do
  // not accumulate distortion. These are art-directed crush shapes, not FEM.
  function damagePart(id, severity = 1) {
    if (!(id in deformation)) throw new RangeError('Deformable parts: cabin, engineCover, mainRotor, leftSkid, rightSkid.');
    if (!Number.isFinite(severity) || severity < 0 || severity > 1) throw new RangeError('Severity must be 0..1.');
    if (disposed || detachedSections.has(id)) return false;
    deformation[id] = severity;
    if (id === 'cabin' || id === 'engineCover') {
      const object = id === 'cabin' ? cabin : cowling;
      const rest = id === 'cabin' ? cabinRest : cowlingRest;
      const p = object.geometry.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const x = rest[i * 3], y = rest[i * 3 + 1], z = rest[i * 3 + 2];
        const front = Math.max(0, -z), upper = Math.max(0, y + .3);
        const dent = Math.sin(x * 8 + z * 5) * Math.sin(y * 6 + z * 3);
        if (id === 'cabin') p.setXYZ(i,
          x * (1 - severity * (.12 + .25 * front)) + severity * .13 * front * upper,
          y * (1 - severity * .25) - severity * .55 * front * upper + severity * .10 * dent,
          z + severity * .82 * front * front + severity * .085 * dent);
        else p.setXYZ(i, x * (1 - severity * .16), y - severity * .3 * Math.max(0, y) + severity * .08 * dent, z);
      }
      p.needsUpdate = true;
      object.geometry.computeVertexNormals();
      object.geometry.computeBoundingBox(); object.geometry.computeBoundingSphere();
      if (id === 'cabin') {
        glassPaint.map = helicopterCabinTexture(color, trimColor, severity);
        glassPaint.roughnessMap = helicopterGlazingMask('roughness', severity);
        glassPaint.clearcoatMap = helicopterGlazingMask('coat', severity);
      } else paint.map = helicopterSurfaceTexture('cowling', color, severity);
    } else if (id === 'mainRotor') {
      if (severity > 0) {
        makeBentBlades();
        coastMainRpm = 0; rotorDamage.main = true;
        telemetry.rotorRpm = telemetry.mainBlur = 0;
      }
      syncBladeInstances(); setRotorFade(mainBlades, mainBlur, 0);
    } else {
      const offset = id === 'leftSkid' ? 0 : 4, side = offset ? 1 : -1;
      // Keep strut tops attached while the rail moves up and splays outward.
      if (severity === 0) for (let i = offset; i < offset + 4; i++) skidMatrices[i].copy(skidRest[i]);
      else {
        const x = side * (.92 + .20 * severity), y = .055 + .48 * severity;
        for (let i = 0; i < 2; i++) {
          const z = i ? .9 : -.85;
          const upper = i ? [side * .43, .95, .35] : [side * .53, .7 + .20 * deformation.cabin, z];
          alignTube(dummy, upper, [x, y, z], .043);
          skidMatrices[offset + i].copy(dummy.matrix);
        }
        alignTube(dummy, [x, y, -1.3], [x, y, 1.4], .055); skidMatrices[offset + 2].copy(dummy.matrix);
        alignTube(dummy, [x, y, -1.3], [x, y + .205 * (1 - severity * .8), -1.72], .055);
        skidMatrices[offset + 3].copy(dummy.matrix);
      }
      syncSkids();
    }
    contactsDirty = true;
    return true;
  }

  function makeBentBlades() {
    if (bentBatches.length) return;
    for (let segment = 0; segment < 3; segment++) {
      const geometry = ownedGeometry(new THREE.BoxGeometry(1, 1, 1));
      const p = geometry.attributes.position, uv = geometry.attributes.uv;
      for (let i = 0; i < p.count; i++) uv.setXY(i,
        cuts[segment] + (p.getX(i) + .5) * (cuts[segment + 1] - cuts[segment]), p.getZ(i) + .5);
      const batch = new THREE.InstancedMesh(geometry, mainBladeMaterial, 4);
      batch.name = `BentMainBlades${segment}`; batch.userData.strikeId = 'mainRotor';
      batch.frustumCulled = false; batch.castShadow = castShadow;
      batch.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      spin.add(batch); bentBatches.push(batch); instancedMeshes.push(batch);
    }
  }

  function syncBentBlades() {
    if (!bentBatches.length) return;
    for (const batch of bentBatches) { batch.count = 0; batch.visible = deformation.mainRotor > 0; }
    if (!deformation.mainRotor) return;
    spin.updateWorldMatrix(true, false); bendInverse.copy(spin.matrixWorld).invert();
    const severity = deformation.mainRotor;
    for (let i = 0; i < 4; i++) {
      if (!rotorDamage.mainIntact[i]) continue;
      bendBase.multiplyMatrices(bladePivots[i].parent.matrix, bladePivots[i].matrix);
      bendPoint.set(.16, 0, 0).applyMatrix4(bendBase);
      for (let segment = 0; segment < 3; segment++) {
        const length = 4.04 * (cuts[segment + 1] - cuts[segment]);
        const kink = [ .32, -.18, -.62, .16 ][i] * severity * (segment + .25);
        bendRotation.makeRotationZ(kink);
        bendDirection.set(1, 0, 0).applyMatrix4(bendRotation).transformDirection(bendBase);
        bendEnd.copy(bendPoint).addScaledVector(bendDirection, length);
        // Flexible rotor blades are not rigid ground supports. Bend each linked
        // segment upward on contact, preserving its length and shared endpoint.
        if (crashSettings) {
          bendWorld.copy(bendEnd).applyMatrix4(spin.matrixWorld);
          const terrain = crashSettings.groundHeight;
          const height = typeof terrain === 'function' ? terrain(bendWorld.x, bendWorld.z) : terrain;
          const clearance = .10 * crashSettings.scale;
          if (Number.isFinite(height) && bendWorld.y < height + clearance) {
            bendWorld.y = height + clearance;
            bendEnd.copy(bendWorld).applyMatrix4(bendInverse);
            const upLocal = bendDirection.set(0, 1, 0).transformDirection(bendInverse);
            const delta = bendDelta.copy(bendEnd).sub(bendPoint), vertical = Math.min(length, delta.dot(upLocal));
            delta.addScaledVector(upLocal, -delta.dot(upLocal));
            if (delta.lengthSq() > 1e-12) delta.setLength(Math.sqrt(Math.max(0, length * length - vertical * vertical)));
            bendEnd.copy(bendPoint).add(delta).addScaledVector(upLocal, vertical);
          }
        }
        bendDirection.subVectors(bendEnd, bendPoint).normalize();
        bendQuaternion.setFromUnitVectors(axisX, bendDirection);
        bendCenter.copy(bendPoint).add(bendEnd).multiplyScalar(.5);
        bendScale.set(length, .018, .18);
        const matrix = bentMatrices[i * 3 + segment].compose(bendCenter, bendQuaternion, bendScale);
        const batch = bentBatches[segment]; batch.setMatrixAt(batch.count++, matrix);
        bendPoint.copy(bendEnd);
      }
    }
    for (const batch of bentBatches) { batch.visible = batch.count > 0; batch.instanceMatrix.needsUpdate = true; }
  }

  function collectCrashPoints(scale, center) {
    g.updateWorldMatrix(true, true);
    const inverse = g.matrixWorld.clone().invert(), points = [], seen = new Set();
    const transform = new THREE.Matrix4(), instance = new THREE.Matrix4();
    const sources = [cabin, cowling, boom, fin, stabilizer, skidTubes, mast, exhaust, exhaustThroat,
      spin.getObjectByName('MainHub'), tailHub];
    for (const object of sources) {
      let visible = true;
      for (let node = object; node && node !== g; node = node.parent) if (!node.visible) visible = false;
      if (!visible) continue;
      const p = object.geometry.attributes.position;
      const local = new THREE.Matrix4().multiplyMatrices(inverse, object.matrixWorld);
      for (let j = 0; j < (object.isInstancedMesh ? object.count : 1); j++) {
        if (object.isInstancedMesh) { object.getMatrixAt(j, instance); transform.multiplyMatrices(local, instance); }
        else transform.copy(local);
        for (let i = 0; i < p.count; i++) {
          const v = new THREE.Vector3().fromBufferAttribute(p, i).applyMatrix4(transform).sub(center).multiplyScalar(scale);
          const key = `${v.x.toFixed(4)},${v.y.toFixed(4)},${v.z.toFixed(4)}`;
          if (!seen.has(key)) { seen.add(key); points.push(v); }
        }
      }
    }
    return points;
  }

  function buildCrashBody(position, quaternion, velocity, angularVelocity) {
    const s = crashSettings, points = collectCrashPoints(s.scale, s.centerOfMass);
    const bounds = new THREE.Box3().setFromPoints(points), size = bounds.getSize(new THREE.Vector3());
    const inertia = s.inertia || new THREE.Vector3(size.y ** 2 + size.z ** 2,
      size.x ** 2 + size.z ** 2, size.x ** 2 + size.y ** 2).multiplyScalar(s.massKg / 12);
    const next = createGroundBody({ ...s, position, quaternion, velocity, angularVelocity, inertia, points });
    Object.assign(next, { massKg: s.massKg, inertia, points, centerOfMass: s.centerOfMass.clone() });
    crashBody = next; g.userData.crashBody = next; contactsDirty = false;
    return next;
  }

  function beginCrash(options = {}) {
    if (disposed) return null;
    if (crashBody) return crashBody;
    const { groundHeight = 0, massKg = 900, centerOfMass = { x: 0, y: 1.2, z: .15 },
      worldVelocity = { x: 0, y: 0, z: 0 }, worldAngularVelocity = { x: 0, y: 0, z: 0 },
      friction = .65, restitution = .08, inertia = null, damage = {} } = options;
    const finite = v => v && ['x', 'y', 'z'].every(k => Number.isFinite(v[k]));
    if (![centerOfMass, worldVelocity, worldAngularVelocity].every(finite) || !Number.isFinite(massKg) || massKg <= 0 ||
      !(typeof groundHeight === 'function' || Number.isFinite(groundHeight)) ||
      !Number.isFinite(friction) || friction < 0 || !Number.isFinite(restitution) || restitution < 0 || restitution > 1 ||
      (inertia && (!finite(inertia) || Math.min(inertia.x, inertia.y, inertia.z) <= 0)) || !damage ||
      Object.entries(damage).some(([id, value]) => !(id in deformation) || !Number.isFinite(value) || value < 0 || value > 1)) {
      throw new RangeError('Invalid crash terrain, mass, inertia, vectors or damage.');
    }
    g.updateWorldMatrix(true, true);
    const e = g.matrixWorld.elements;
    a.set(e[0], e[1], e[2]); b.set(e[4], e[5], e[6]); direction.set(e[8], e[9], e[10]);
    const scale = a.length();
    if (scale < 1e-8 || g.matrixWorld.determinant() <= 0 ||
      Math.abs(b.length() - scale) > scale * 1e-5 || Math.abs(direction.length() - scale) > scale * 1e-5 ||
      Math.abs(a.dot(b)) > scale * scale * 1e-5 || Math.abs(a.dot(direction)) > scale * scale * 1e-5 ||
      Math.abs(b.dot(direction)) > scale * scale * 1e-5) throw new RangeError('Crash requires positive uniform world scale.');
    crashRestore = { matrix: g.matrix.clone(), auto: g.matrixAutoUpdate };
    for (const [id, value] of Object.entries(damage)) damagePart(id, value);
    crashSettings = { groundHeight, massKg, centerOfMass: new THREE.Vector3().copy(centerOfMass),
      scale, friction, restitution, inertia: inertia && new THREE.Vector3().copy(inertia) };
    const q = new THREE.Quaternion();
    g.matrixWorld.decompose(crashOrigin, q, crashScale);
    const position = crashSettings.centerOfMass.clone().applyMatrix4(g.matrixWorld);
    buildCrashBody(position, q, new THREE.Vector3().copy(worldVelocity), new THREE.Vector3().copy(worldAngularVelocity));
    // The crash solver now owns this visual's world pose. Stop the game's flight
    // solver separately; this module cannot change an unseen game physics body.
    g.matrixAutoUpdate = false;
    coastMainRpm = coastTailRpm = 0; rotorDamage.main = rotorDamage.tail = true;
    telemetry.rotorRpm = telemetry.tailRotorRpm = telemetry.mainBlur = telemetry.tailBlur = 0;
    command.rotorRpm = 0;
    update(0);
    return crashBody;
  }

  function updateCrash(dt) {
    if (!Number.isFinite(dt) || dt < 0) throw new RangeError('dt must be finite seconds >= 0.');
    if (!crashBody) return null;
    if (contactsDirty) buildCrashBody(crashBody.position, crashBody.quaternion, crashBody.velocity, crashBody.angularVelocity);
    crashBody.update(dt);
    crashOrigin.copy(crashSettings.centerOfMass).multiplyScalar(crashSettings.scale).applyQuaternion(crashBody.quaternion);
    crashOrigin.negate().add(crashBody.position);
    crashScale.setScalar(crashSettings.scale);
    crashMatrix.compose(crashOrigin, crashBody.quaternion, crashScale);
    if (g.parent) {
      g.parent.updateWorldMatrix(true, false);
      if (Math.abs(g.parent.matrixWorld.determinant()) < 1e-12) throw new RangeError('Crash parent must remain invertible.');
      crashInverse.copy(g.parent.matrixWorld).invert();
      g.matrix.multiplyMatrices(crashInverse, crashMatrix);
    } else g.matrix.copy(crashMatrix);
    g.matrix.decompose(g.position, g.quaternion, g.scale); g.matrixWorldNeedsUpdate = true;
    return crashBody;
  }

  function syncPartBodies() {
    for (const body of partBodies) {
      if (!body.active) continue;
      const parent = body.visual.parent;
      if (!parent) continue;
      parent.updateWorldMatrix(true, false);
      if (Math.abs(parent.matrixWorld.determinant()) < 1e-12) { body.visual.visible = false; continue; }
      body.visual.visible = true;
      debrisInverse.copy(parent.matrixWorld).invert();
      const fade = Math.min(1, (body.lifetime - body.age) / Math.min(.65, body.lifetime * .25));
      renderScale.copy(body.visualScale).multiplyScalar(fade);
      debrisMatrix.compose(body.position, body.quaternion, renderScale);
      body.visual.matrix.multiplyMatrices(debrisInverse, debrisMatrix);
      body.visual.matrixWorldNeedsUpdate = true;
    }
  }

  function clearPartBodies() {
    for (const body of partBodies) {
      body.active = false;
      body.visual.removeFromParent();
      for (const instance of body.ownedInstances) instance.dispose();
    }
    partBodies.length = 0;
    airframeDamage.activeParts = 0;
    detachedSections.clear();
    for (const sources of Object.values(partSources)) for (const source of sources) source.visible = true;
    tailMount.visible = true;
    syncSkids();
  }

  function strike(id, options = {}) {
    if (disposed) return null;
    if (!strikePoints[id]) throw new RangeError(`Unknown strike point: ${id}`);
    if (detachedSections.has(id)) return null;
    if (id === 'mainRotor' || id === 'tailRotor') {
      const count = strikeRotor({ ...options, rotor: id === 'mainRotor' ? 'main' : 'tail' });
      return count ? { id, body: null, rotorFragments: count } : null;
    }
    const {
      worldVelocity = crashBody?.velocity || { x: 0, y: 0, z: 0 }, worldAngularVelocity = crashBody?.angularVelocity || { x: 0, y: 0, z: 0 },
      velocityOrigin = crashBody?.position || null, velocityKick = { x: 0, y: 0, z: 0 },
      impulse = { x: 0, y: 0, z: 0 }, impactPoint = null,
      groundHeight = null, lifetime = 6, externalPhysics = false
    } = options;
    let parent = options.debrisParent;
    const finite = v => v && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
    if (![worldVelocity, worldAngularVelocity, velocityKick, impulse].every(finite) ||
        (velocityOrigin !== null && !finite(velocityOrigin)) || (impactPoint !== null && !finite(impactPoint)) ||
        !Number.isFinite(lifetime) || lifetime < .5 || lifetime > 12 ||
        (groundHeight !== null && typeof groundHeight !== 'function' && !Number.isFinite(groundHeight))) {
      throw new RangeError('Strike vectors must be finite; lifetime .5..12; groundHeight a function or finite Y.');
    }
    if (!parent) for (let ancestor = g.parent; ancestor; ancestor = ancestor.parent) {
      if (ancestor.isScene) { parent = ancestor; break; }
    }
    if (!parent?.isObject3D) throw new Error('Attach the helicopter to a Scene or pass debrisParent: scene.');
    for (let ancestor = parent; ancestor; ancestor = ancestor.parent) {
      if (ancestor === g || ancestor === rotorDebris || partBodies.some(body => body.visual === ancestor)) {
        throw new Error('Debris parent must be outside the helicopter/debris hierarchy.');
      }
    }
    g.updateWorldMatrix(true, true);
    parent.updateWorldMatrix(true, false);
    const e = g.matrixWorld.elements;
    a.set(e[0], e[1], e[2]); b.set(e[4], e[5], e[6]); direction.set(e[8], e[9], e[10]);
    const scale = a.length();
    if (scale < 1e-8 || g.matrixWorld.determinant() <= 0 ||
        Math.abs(b.length() - scale) > scale * 1e-5 || Math.abs(direction.length() - scale) > scale * 1e-5 ||
        Math.abs(a.dot(b)) > scale * scale * 1e-5 || Math.abs(a.dot(direction)) > scale * scale * 1e-5 ||
        Math.abs(b.dot(direction)) > scale * scale * 1e-5 || Math.abs(parent.matrixWorld.determinant()) < 1e-12) {
      throw new RangeError('Strikes require positive uniform aircraft scale and an invertible debris parent.');
    }
    const members = (id === 'tailBoom' ? ['tailBoom', 'tailFin', 'stabilizer', 'tailRotor'] :
      id === 'tailFin' ? ['tailFin', 'tailRotor'] : [id]).filter(name => !detachedSections.has(name));
    const massKg = options.massKg ?? members.reduce((sum, name) => sum + strikePoints[name].massKg, 0);
    if (!Number.isFinite(massKg) || massKg <= 0) throw new RangeError('massKg must be positive.');
    const visual = new THREE.Group();
    visual.name = `Detached_${id}`;
    visual.matrixAutoUpdate = false;
    const ownedInstances = [];
    const rootInverse = g.matrixWorld.clone().invert();
    for (const name of members) for (const source of partSources[name]) {
      let copy;
      if (source === skidTubes) {
        copy = new THREE.InstancedMesh(source.geometry, source.material, 4);
        const offset = name === 'leftSkid' ? 0 : 4;
        for (let i = 0; i < 4; i++) copy.setMatrixAt(i, skidMatrices[offset + i]);
        copy.instanceMatrix.needsUpdate = true;
        ownedInstances.push(copy);
      } else copy = new THREE.Mesh(source.geometry, source.material);
      copy.name = source.name;
      copy.castShadow = castShadow;
      copy.matrixAutoUpdate = false;
      copy.matrix.multiplyMatrices(rootInverse, source.matrixWorld);
      visual.add(copy);
    }
    visual.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(visual, true);
    const center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3()).multiplyScalar(scale);
    const shift = new THREE.Matrix4().makeTranslation(-center.x, -center.y, -center.z);
    for (const copy of visual.children) { copy.matrix.premultiply(shift); copy.matrixWorldNeedsUpdate = true; }
    const position = center.clone().applyMatrix4(g.matrixWorld);
    const quaternion = new THREE.Quaternion();
    g.matrixWorld.decompose(sourcePosition, quaternion, sourceScale);
    const velocity = new THREE.Vector3().copy(worldVelocity).add(velocityKick);
    bodyOrigin.copy(velocityOrigin || sourcePosition);
    radial.subVectors(position, bodyOrigin);
    velocity.add(a.copy(worldAngularVelocity).cross(radial)).addScaledVector(impulse, 1 / massKg);
    const inertia = new THREE.Vector3(size.y * size.y + size.z * size.z,
      size.x * size.x + size.z * size.z, size.x * size.x + size.y * size.y).multiplyScalar(massKg / 12);
    const angularVelocity = new THREE.Vector3().copy(worldAngularVelocity);
    if (impactPoint) {
      a.copy(impactPoint).sub(position).cross(impulse);
      const inverseRotation = quaternion.clone().invert();
      a.applyQuaternion(inverseRotation);
      a.set(a.x / Math.max(inertia.x, 1e-8), a.y / Math.max(inertia.y, 1e-8), a.z / Math.max(inertia.z, 1e-8));
      angularVelocity.add(a.applyQuaternion(quaternion));
    }
    const body = { id, active: true, visual, ownedInstances, position, quaternion, velocity, angularVelocity,
      massKg, inertia, scale: size, visualScale: new THREE.Vector3(scale, scale, scale),
      externalPhysics: Boolean(externalPhysics), tumbleAxis: new THREE.Vector3(), tumbleSpeed: 0,
      age: 0, lifetime, groundHeight, sleeping: false, members };
    visual.userData.rigidBody = body;
    // Severing the support also breaks its spinning tail rotor; already lost parts stay lost.
    const rotorFragments = members.includes('tailRotor') ? strikeRotor({ ...options, debrisParent: parent, rotor: 'tail', bladeIndices: undefined }) : 0;
    for (const name of members) {
      detachedSections.add(name);
      for (const source of partSources[name]) if (source !== skidTubes) source.visible = false;
    }
    if (members.includes('tailRotor')) tailMount.visible = false;
    syncSkids();
    parent.add(visual);
    partBodies.push(body);
    airframeDamage.activeParts++;
    contactsDirty = true;
    syncPartBodies();
    return { id, body, rotorFragments };
  }

  function makeDebrisPool() {
    if (rotorDebris) return;
    rotorDebris = new THREE.Group();
    rotorDebris.name = 'RotorStrikeDebris';
    g.userData.rotorDebris = rotorDebris;
    const debrisMaterial = standard({ map: helicopterBladeTexture() });
    for (let segment = 0; segment < 3; segment++) {
      const geometry = ownedGeometry(new THREE.BoxGeometry(1, 1, 1));
      const pos = geometry.getAttribute('position');
      const uv = geometry.getAttribute('uv');
      for (let i = 0; i < pos.count; i++) {
        uv.setXY(i, cuts[segment] + (pos.getX(i) + .5) * (cuts[segment + 1] - cuts[segment]), pos.getZ(i) + .5);
      }
      const batch = new THREE.InstancedMesh(geometry, debrisMaterial, 6);
      batch.name = `RotorFragments${segment}`;
      batch.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      batch.count = 0;
      // A tiny bounded effect should not be culled by a stale world-space sweep.
      batch.frustumCulled = false;
      batch.castShadow = castShadow;
      rotorDebris.add(batch);
      debrisBatches.push(batch);
      instancedMeshes.push(batch);
    }
    for (let i = 0; i < 18; i++) fragmentSlots.push({ active: false, segment: i % 3,
      position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), scale: new THREE.Vector3(),
      velocity: new THREE.Vector3(), tumbleAxis: new THREE.Vector3(), tumbleSpeed: 0,
      age: 0, lifetime: 6, groundHeight: null, sleeping: false });
  }

  function syncBladeInstances() {
    let count = 0;
    for (let i = 0; i < 4; i++) {
      const flap = bladePivots[i];
      flap.rotation.z = flapAngle;
      flap.updateMatrix();
      flap.parent.updateMatrix();
      if (!rotorDamage.mainIntact[i]) continue;
      instanceMatrix.multiplyMatrices(flap.parent.matrix, flap.matrix);
      mainBlades.setMatrixAt(count++, instanceMatrix);
    }
    mainBlades.count = count;
    mainBlades.instanceMatrix.needsUpdate = true;
    count = 0;
    for (let i = 0; i < 2; i++) {
      if (!rotorDamage.tailIntact[i]) continue;
      tailBladePivots[i].updateMatrix();
      tailBlades.setMatrixAt(count++, tailBladePivots[i].matrix);
    }
    tailBlades.count = count;
    tailBlades.instanceMatrix.needsUpdate = true;
    syncBentBlades();
  }

  function syncDebrisInstances() {
    if (!rotorDebris) return;
    rotorDebris.updateWorldMatrix(true, false);
    if (Math.abs(rotorDebris.matrixWorld.determinant()) < 1e-12) {
      rotorDebris.visible = false;
      return;
    }
    rotorDebris.visible = true;
    debrisInverse.copy(rotorDebris.matrixWorld).invert();
    for (const batch of debrisBatches) batch.count = 0;
    for (const part of fragmentSlots) {
      if (!part.active) continue;
      const fade = Math.min(1, (part.lifetime - part.age) / Math.min(.65, part.lifetime * .25));
      renderScale.copy(part.scale).multiplyScalar(fade);
      debrisMatrix.compose(part.position, part.quaternion, renderScale);
      instanceMatrix.multiplyMatrices(debrisInverse, debrisMatrix);
      const batch = debrisBatches[part.segment];
      batch.setMatrixAt(batch.count++, instanceMatrix);
    }
    for (const batch of debrisBatches) {
      batch.visible = batch.count > 0;
      batch.instanceMatrix.needsUpdate = true;
    }
    if (!rotorDamage.activeFragments) rotorDebris.removeFromParent();
  }

  function strikeRotor({ rotor = 'main', bladeIndices, debrisParent,
    worldVelocity = crashBody?.velocity || { x: 0, y: 0, z: 0 }, worldAngularVelocity = crashBody?.angularVelocity || { x: 0, y: 0, z: 0 },
    velocityOrigin = crashBody?.position || null, velocityKick = { x: 0, y: 0, z: 0 },
    groundHeight = null, lifetime = 6 } = {}) {
    if (disposed) return 0;
    if (rotor !== 'main' && rotor !== 'tail') throw new RangeError('rotor must be main or tail.');
    if (rotor === 'tail' && detachedSections.has('tailRotor')) return 0;
    const intact = rotor === 'main' ? rotorDamage.mainIntact : rotorDamage.tailIntact;
    const indices = bladeIndices === undefined ? intact.map((_, i) => i) : bladeIndices;
    if (!Array.isArray(indices) || indices.some(i => !Number.isInteger(i) || i < 0 || i >= intact.length)) {
      throw new RangeError('bladeIndices must contain original rotor blade indices.');
    }
    const selected = [...new Set(indices)].filter(i => intact[i]);
    if (!selected.length) return 0;
    const finiteVector = v => v && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
    if (!finiteVector(worldVelocity) || !finiteVector(worldAngularVelocity) || !finiteVector(velocityKick) ||
        (velocityOrigin !== null && !finiteVector(velocityOrigin)) || !Number.isFinite(lifetime) || lifetime < .5 || lifetime > 12 ||
        (groundHeight !== null && typeof groundHeight !== 'function' && !Number.isFinite(groundHeight))) {
      throw new RangeError('Strike vectors must be finite; lifetime .5..12; groundHeight a function or finite Y.');
    }
    if (!debrisParent) {
      for (let parent = g.parent; parent; parent = parent.parent) {
        if (parent.isScene) { debrisParent = parent; break; }
      }
    }
    if (!debrisParent?.isObject3D) throw new Error('Attach the helicopter to a Scene or pass debrisParent: scene.');
    for (let parent = debrisParent; parent; parent = parent.parent) {
      if (parent === g || parent === rotorDebris) throw new Error('Debris parent must be outside the helicopter/debris hierarchy.');
    }
    g.updateWorldMatrix(true, true);
    debrisParent.updateWorldMatrix(true, false);
    const elements = g.matrixWorld.elements;
    a.set(elements[0], elements[1], elements[2]);
    b.set(elements[4], elements[5], elements[6]);
    direction.set(elements[8], elements[9], elements[10]);
    const length = a.length();
    if (length < 1e-8 || g.matrixWorld.determinant() <= 0 ||
        Math.abs(b.length() - length) > length * 1e-5 || Math.abs(direction.length() - length) > length * 1e-5 ||
        Math.abs(a.dot(b)) > length * length * 1e-5 || Math.abs(a.dot(direction)) > length * length * 1e-5 ||
        Math.abs(b.dot(direction)) > length * length * 1e-5 || Math.abs(debrisParent.matrixWorld.determinant()) < 1e-12) {
      throw new RangeError('Rotor strikes require positive uniform aircraft scale and an invertible debris parent.');
    }
    makeDebrisPool();
    debrisParent.add(rotorDebris);
    const spinner = rotor === 'main' ? spin : tailSpin;
    const rpm = rotor === 'main' ? telemetry.rotorRpm : telemetry.tailRotorRpm;
    const omega = rpm / 60 * TAU;
    rotorOrigin.setFromMatrixPosition(spinner.matrixWorld);
    rotorAxis.set(rotor === 'main' ? 0 : 1, rotor === 'main' ? 1 : 0, 0).transformDirection(spinner.matrixWorld);
    if (velocityOrigin) bodyOrigin.copy(velocityOrigin);
    else bodyOrigin.setFromMatrixPosition(g.matrixWorld);
    const rootRadius = rotor === 'main' ? .16 : .065;
    const tipRadius = rotor === 'main' ? 4.2 : .8;
    const chord = rotor === 'main' ? .18 : .105;
    for (const index of selected) {
      if (rotor === 'main') sourceMatrix.copy(bladePivots[index].matrixWorld);
      else sourceMatrix.multiplyMatrices(tailBladePivots[index].matrixWorld, tailOrientation);
      sourceMatrix.decompose(sourcePosition, sourceRotation, sourceScale);
      for (let segment = 0; segment < 3; segment++) {
        const part = fragmentSlots[(rotor === 'main' ? index : index + 4) * 3 + segment];
        const span = tipRadius - rootRadius;
        const from = rootRadius + span * cuts[segment];
        const to = rootRadius + span * cuts[segment + 1];
        part.position.set((from + to) / 2, 0, 0).applyMatrix4(sourceMatrix);
        part.quaternion.copy(sourceRotation);
        part.scale.set((to - from) * sourceScale.x, .018 * sourceScale.y, chord * sourceScale.z);
        if (rotor === 'main' && deformation.mainRotor > 0) {
          // Shards begin at the actual kinked segments, without straightening.
          instanceMatrix.multiplyMatrices(spin.matrixWorld, bentMatrices[index * 3 + segment]);
          instanceMatrix.decompose(part.position, part.quaternion, part.scale);
        }
        radial.subVectors(part.position, rotorOrigin);
        part.velocity.crossVectors(rotorAxis, radial).multiplyScalar(omega).add(worldVelocity).add(velocityKick);
        radial.subVectors(part.position, bodyOrigin);
        a.copy(worldAngularVelocity).cross(radial);
        part.velocity.add(a);
        // Different tumble axes make shards readable without an arbitrary explosion.
        part.tumbleAxis.set(.35 + segment * .23, (index % 2 ? -1 : 1) * .8, .7 - segment * .21)
          .applyQuaternion(sourceRotation).normalize();
        part.tumbleSpeed = 2 + Math.min(omega, 35) * .24 + segment * 1.3;
        part.age = 0;
        part.lifetime = lifetime;
        part.groundHeight = groundHeight;
        part.sleeping = false;
        part.active = true;
        rotorDamage.activeFragments++;
      }
      intact[index] = false;
    }
    if (rotor === 'main') {
      if (!rotorDamage.main) coastMainRpm = telemetry.rotorRpm;
      rotorDamage.main = true;
      telemetry.mainBlur = 0;
    } else {
      if (!rotorDamage.tail) coastTailRpm = telemetry.tailRotorRpm;
      rotorDamage.tail = true;
      telemetry.tailBlur = 0;
    }
    syncBladeInstances();
    setRotorFade(mainBlades, mainBlur, telemetry.mainBlur);
    setRotorFade(tailBlades, tailBlur, telemetry.tailBlur);
    syncDebrisInstances();
    return selected.length * 3;
  }

  function updateDebris(dt) {
    if (disposed) return;
    if (!Number.isFinite(dt) || dt < 0) throw new RangeError('dt must be finite seconds >= 0.');
    if (!rotorDamage.activeFragments && !airframeDamage.activeParts) return;
    for (let slot = 0; slot < fragmentSlots.length + partBodies.length; slot++) {
      const part = slot < fragmentSlots.length ? fragmentSlots[slot] : partBodies[slot - fragmentSlots.length];
      if (!part.active) continue;
      part.age += dt;
      if (part.age >= part.lifetime) {
        part.active = false;
        if (part.visual) { airframeDamage.activeParts--; part.visual.removeFromParent(); }
        else rotorDamage.activeFragments--;
        continue;
      }
      let remaining = dt;
      // Bounded substeps prevent long frames tunneling through the ground plane.
      while (remaining > 0 && !part.sleeping && !part.externalPhysics) {
        const h = Math.min(remaining, 1 / 60);
        const damping = Math.exp(-.7 * h);
        const travel = (1 - damping) / .7;
        part.position.addScaledVector(part.velocity, travel);
        part.position.y -= 9.81 * (h - travel) / .7;
        part.velocity.multiplyScalar(damping);
        part.velocity.y -= 9.81 * travel;
        if (part.visual) {
          part.tumbleSpeed = part.angularVelocity.length();
          if (part.tumbleSpeed > 0) part.tumbleAxis.copy(part.angularVelocity).multiplyScalar(1 / part.tumbleSpeed);
        }
        tumbleStep.setFromAxisAngle(part.tumbleAxis, part.tumbleSpeed * h);
        part.quaternion.premultiply(tumbleStep).normalize();
        part.tumbleSpeed *= Math.exp(-.3 * h);
        const height = typeof part.groundHeight === 'function' ? part.groundHeight(part.position.x, part.position.z) : part.groundHeight;
        if (Number.isFinite(height)) {
          debrisMatrix.makeRotationFromQuaternion(part.quaternion);
          const e = debrisMatrix.elements;
          const halfHeight = (Math.abs(e[1]) * part.scale.x + Math.abs(e[5]) * part.scale.y + Math.abs(e[9]) * part.scale.z) / 2;
          if (part.position.y < height + halfHeight) {
            part.position.y = height + halfHeight;
            if (part.velocity.y < 0) part.velocity.y *= -.18;
            part.velocity.x *= .6;
            part.velocity.z *= .6;
            part.tumbleSpeed *= .55;
            if (part.velocity.lengthSq() < .12 && part.tumbleSpeed < .3) part.sleeping = true;
          }
        }
        if (part.visual) part.angularVelocity.copy(part.tumbleAxis).multiplyScalar(part.tumbleSpeed);
        remaining -= h;
      }
    }
    syncDebrisInstances();
    syncPartBodies();
  }

  function resetRotorDamage() {
    if (disposed) return;
    crashBody = null; g.userData.crashBody = null; crashSettings = null; contactsDirty = false;
    if (crashRestore) {
      g.matrix.copy(crashRestore.matrix); g.matrix.decompose(g.position, g.quaternion, g.scale);
      g.matrixAutoUpdate = crashRestore.auto; g.matrixWorldNeedsUpdate = true; crashRestore = null;
    }
    clearPartBodies();
    for (const id of Object.keys(deformation)) damagePart(id, 0);
    contactsDirty = false;
    rotorDamage.main = false;
    rotorDamage.tail = false;
    rotorDamage.mainIntact.fill(true);
    rotorDamage.tailIntact.fill(true);
    rotorDamage.activeFragments = 0;
    for (const part of fragmentSlots) part.active = false;
    if (rotorDebris) {
      rotorDebris.removeFromParent();
      for (const batch of debrisBatches) { batch.count = 0; batch.visible = false; }
    }
    command.rotorRpm = command.collective = command.cyclicPitch = command.cyclicRoll = 0;
    coastMainRpm = coastTailRpm = 0;
    flapAngle = -15 * DEG;
    pitch = roll = 0;
    mainPhase = tailPhase = Math.PI / 4;
    telemetry.rotorRpm = telemetry.tailRotorRpm = telemetry.mainBlur = telemetry.tailBlur = 0;
    update(0);
  }

  function setRotorFade(blades, blur, amount) {
    if (blades === mainBlades && deformation.mainRotor > 0) {
      blades.visible = false; blur.visible = false; blur.material.opacity = 0; blades.material.opacity = 1;
      return;
    }
    blades.material.opacity = 1 - amount;
    blades.visible = blades.count > 0 && amount < .999;
    blur.material.opacity = amount;
    blur.visible = amount > .001;
  }

  function update(dt, state = {}) {
    if (disposed) return;
    if (!Number.isFinite(dt) || dt < 0) throw new RangeError('dt must be finite seconds >= 0.');
    state = state || {};
    if (Number.isFinite(state.rotorRpm)) command.rotorRpm = clamp(state.rotorRpm, 0, nominalRotorRpm * 1.5);
    if (Number.isFinite(state.collective)) command.collective = clamp(state.collective, 0, 1);
    if (Number.isFinite(state.cyclicPitch)) command.cyclicPitch = clamp(state.cyclicPitch, -1, 1);
    if (Number.isFinite(state.cyclicRoll)) command.cyclicRoll = clamp(state.cyclicRoll, -1, 1);
    if (crashBody) command.rotorRpm = command.collective = command.cyclicPitch = command.cyclicRoll = 0;
    updateCrash(dt);
    if (dt > 0) {
      const rpm = rotorDamage.main ? coastMainRpm : command.rotorRpm;
      const tailRpm = rotorDamage.tail ? coastTailRpm : command.rotorRpm * tailRotorRatio;
      const mainTime = rotorDamage.main ? .65 * (1 - Math.exp(-dt / .65)) : dt;
      const tailTime = rotorDamage.tail ? .45 * (1 - Math.exp(-dt / .45)) : dt;
      // A pause must not produce an unbounded angle; phase still follows elapsed time.
      mainPhase = (mainPhase + rpm / 60 * TAU * mainTime) % TAU;
      tailPhase = (tailPhase + tailRpm / 60 * TAU * tailTime) % TAU;
      coastMainRpm = rpm * Math.exp(-dt / .65);
      coastTailRpm = tailRpm * Math.exp(-dt / .45);
      telemetry.rotorRpm = rotorDamage.main ? coastMainRpm : rpm;
      telemetry.tailRotorRpm = rotorDamage.tail ? coastTailRpm : tailRpm;
      const spinning = smoothRange(telemetry.rotorRpm / nominalRotorRpm, .08, .7);
      const targetFlap = (-15 * (1 - spinning) + 4 * command.collective * spinning) * DEG;
      const flapBlend = 1 - Math.exp(-dt / .22);
      flapAngle += (targetFlap - flapAngle) * flapBlend;
      const cyclicLength = Math.hypot(command.cyclicPitch, command.cyclicRoll);
      const cyclicScale = Math.tan(maxCyclicDegrees * DEG) * spinning / Math.max(1, cyclicLength);
      // Normalizing the command pair also caps diagonal cyclic at the chosen limit.
      const targetPitch = command.cyclicPitch * cyclicScale;
      const targetRoll = command.cyclicRoll * cyclicScale;
      const cyclicBlend = 1 - Math.exp(-dt / .1);
      pitch += (targetPitch - pitch) * cyclicBlend;
      roll += (targetRoll - roll) * cyclicBlend;
      // Avoid sampled blades appearing to turn backwards at flying RPM.
      telemetry.mainBlur = rotorDamage.main ? 0 : smoothRange(rpm / nominalRotorRpm, .2, .85);
      telemetry.tailBlur = rotorDamage.tail ? 0 : smoothRange(tailRpm / (nominalRotorRpm * tailRotorRatio), .1, .6);
    }

    // Using a normal instead of sequential Euler tilts keeps combined cyclic bounded.
    direction.set(roll, 1, -pitch).normalize();
    tilt.quaternion.setFromUnitVectors(axisY, direction);
    spin.rotation.y = mainPhase;
    tailSpin.rotation.x = tailPhase;
    syncBladeInstances();
    // Scaling the open cone also matches the blade tips while drooping or coning.
    mainBlur.scale.set(Math.cos(flapAngle), 4.2 * Math.sin(flapAngle), Math.cos(flapAngle));
    setRotorFade(mainBlades, mainBlur, telemetry.mainBlur);
    setRotorFade(tailBlades, tailBlur, telemetry.tailBlur);
    telemetry.flapAngleDegrees = flapAngle / DEG;
    telemetry.discPitchDegrees = Math.atan(pitch) / DEG;
    telemetry.discRollDegrees = Math.atan(roll) / DEG;
    updateDebris(dt);
  }

  function dispose() {
    if (disposed) return;
    crashBody = null; crashSettings = null; g.userData.crashBody = null;
    clearPartBodies();
    disposed = true;
    if (rotorDebris) rotorDebris.removeFromParent();
    for (const part of fragmentSlots) part.active = false;
    rotorDamage.activeFragments = 0;
    for (const instanced of instancedMeshes) instanced.dispose();
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    // Shared cached textures survive individual helicopter removal.
  }

  let triangles = 0;
  let meshCount = 0;
  g.traverse(node => {
    if (!node.isMesh) return;
    const index = node.geometry.getIndex();
    triangles += (index ? index.count : node.geometry.getAttribute('position').count) / 3 * (node.isInstancedMesh ? node.count : 1);
    meshCount++;
  });
  Object.assign(g.userData, {
    glassMaterial: glassPaint, setGlassEnvironment,
    mast, mainRotorTilt: tilt, mainRotorSpin: spin, bladePivots, mainBlades,
    mainBlur, tailRotorSpin: tailSpin, tailBladePivots, tailBlades, tailBlur,
    telemetry, dimensions: { cabinLength: 3, cabinWidth: 1.64, boomLength: 4.05494,
      mainRotorRadius: 4.2, tailRotorRadius: .8, skidTrack: 1.84, mainHubHeight: 2.72 },
    stats: { triangles, meshes: meshCount, maxDrawCalls: meshCount,
      maxTrianglesWithRotorDamage: 658, maxDrawCallsWithRotorDamage: meshCount + 5,
      maxDrawCallsWithAirframeDamage: meshCount + 6 },
    damageContractVersion: 1, strikePoints, getStrikeBounds, strike,
    airframeDamage, partBodies, resetDamage: resetRotorDamage,
    deformation, damagePart, beginCrash, updateCrash, crashBody,
    rotorDamage, rotorDebris, strikeRotor, updateDebris, resetRotorDamage, update, dispose
  });
  update(0);
  return g;
}
