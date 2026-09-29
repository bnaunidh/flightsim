/**
 * The water the Kestrel launch makes: a bow wave, the wash astern and spray
 * off the outside chine in a hard turn.
 *
 * Ported from the module the launch's modeller baked and checked in the real
 * game (tools/blender/kestrel-launch/bake_module.py writes it; that file ships
 * the whole boat as base64, this one reads the .glb instead). Their version was
 * itself a port of maritime.js createWaterEffects, with two things that one
 * got wrong for a hull this shape:
 *
 *   - The bow wave follows where the sea actually cuts the hull. At full speed
 *     her forefoot is 0.8 m out of the water, so a quad pinned at a fixed
 *     station floated in the air.
 *   - The wash alternates between the two props and is stretched along her
 *     track. One sprite per prop every 0.12 s for 5.8 s is 97 sprites against
 *     a cap of 52, so the two trails never joined up.
 *
 * Everything it needs about the hull comes from the .glb root's
 * `extras.fit` (hull sections, transom station), which build.py writes from
 * the same geometry it exports. Nothing here is a number measured by eye.
 *
 * World-space effects: the wash is pinned to the sea, not to the hull's heave,
 * and each sprite is counter-transformed by the boat's matrix so it can stay a
 * child of the boat (one object to add, remove and dispose).
 */

import * as THREE from '../vendor/three.module.js';

const MAX_FX = 52;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

let foamTextures = null;

/** The 64 x 64 radial foam sprite, painted into a DataTexture: no canvas, no image. */
function foamTexture(dense) {
  const S = 64;
  const d = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const t = clamp((Math.hypot(x + 0.5 - S / 2, y + 0.5 - S / 2) - 2) / 28, 0, 1);
      const a = t < 0.65 ? 0.55 - 0.21 * (t / 0.65) : 0.34 * (1 - (t - 0.65) / 0.35);
      const i = (y * S + x) * 4;
      d[i] = 230;
      d[i + 1] = 239;
      d[i + 2] = 234;
      d[i + 3] = Math.round(Math.min(1, a * dense) * 255);
    }
  }
  let seed = 740;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let k = 0; k < 100; k++) {
    const x = Math.floor(rnd() * S);
    const y = Math.floor(rnd() * S);
    for (let dx = 0; dx < 2; dx++) {
      const i = (y * S + Math.min(S - 1, x + dx)) * 4;
      d[i] = Math.round(d[i] * 0.6 + 250 * 0.4);
      d[i + 1] = Math.round(d[i + 1] * 0.6 + 252 * 0.4);
      d[i + 2] = Math.round(d[i + 2] * 0.6 + 245 * 0.4);
      d[i + 3] = Math.round(d[i + 3] * 0.6 + 255 * 0.4);
    }
  }
  const tex = new THREE.DataTexture(d, S, S, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

/** Shared by every launch: two 16 KB textures, painted once. */
function textures() {
  if (!foamTextures) foamTextures = { wash: foamTexture(1), bow: foamTexture(1.8) };
  return foamTextures;
}

/**
 * Hang the water effects on a launch.
 *
 * @param {THREE.Object3D} g  the boat's root (its matrixWorld is the hull's pose)
 * @param {object} fit        the .glb root's extras.fit
 * @param {{ length: number, beam: number }} dims
 */
export function createBoatWater(g, fit, { length = 8.47, beam = 2.8 } = {}) {
  const tex = textures();
  const geo = new THREE.PlaneGeometry(1, 1);
  geo.rotateX(-Math.PI / 2);
  const opac = new THREE.InstancedBufferAttribute(new Float32Array(MAX_FX), 1);
  geo.setAttribute('particleOpacity', opac);
  const mat = new THREE.MeshStandardMaterial({
    name: 'fx_foam',
    map: tex.wash,
    color: 0xe0eee7,
    transparent: true,
    opacity: 0.7,
    depthWrite: false,
    side: THREE.DoubleSide,
    roughness: 1,
  });
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader =
      'attribute float particleOpacity; varying float vParticleOpacity;\n' +
      sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvParticleOpacity = particleOpacity;');
    sh.fragmentShader =
      'varying float vParticleOpacity;\n' +
      sh.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.a *= vParticleOpacity;');
  };
  // One program for every launch, not one per boat.
  mat.customProgramCacheKey = () => 'blender-boat-particle-opacity-v1';
  const wash = new THREE.InstancedMesh(geo, mat, MAX_FX);
  wash.name = 'fx_wash';
  wash.count = 0;
  wash.frustumCulled = false;
  wash.renderOrder = 1;
  g.add(wash);

  // The bow wave is a denser white than the wash: it has to read against a bright, streaky sea.
  const bowMat = new THREE.MeshStandardMaterial({
    name: 'fx_bow_wave',
    map: tex.bow,
    color: 0xffffff,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    side: THREE.DoubleSide,
    roughness: 1,
  });
  const bowGeo = new THREE.PlaneGeometry(1, 1);
  bowGeo.rotateX(-Math.PI / 2);
  /*
   * Port and starboard in one draw: instance 0 is port, 1 starboard, and a
   * side with no entry in the water is scaled to nothing. One object, as the
   * pack launch's bow wave is, so `visible` and `material.opacity` say
   * whether there is a bow wave at all (models.js, the boat playtest).
   */
  const bow = new THREE.InstancedMesh(bowGeo, bowMat, 2);
  bow.name = 'fx_bow_wave';
  bow.frustumCulled = false;
  bow.visible = false;
  bow.renderOrder = 1;
  const NONE = new THREE.Matrix4().makeScale(0, 0, 0);
  bow.setMatrixAt(0, NONE);
  bow.setMatrixAt(1, NONE);
  g.add(bow);

  // Starboard hull sections, stern -> stem, keel -> sheer (game axes).
  const NP = fit.hull_section_points;
  const HS = fit.hull_sections;
  const NS = HS.length / (NP * 3);
  const secs = [];
  for (let k = 0; k < NS; k++) {
    const pts = [];
    for (let j = 0; j < NP; j++) {
      const o = (k * NP + j) * 3;
      pts.push(new THREE.Vector3(HS[o], HS[o + 1], HS[o + 2]));
    }
    secs.push(pts);
  }
  const Z_WAKE = fit.transom_waterline_game_z + 0.3;
  const CHINE = 5; // section point: the outer edge of the chine flat

  const parts = [];
  const inv = new THREE.Matrix4();
  const W = new THREE.Matrix4();
  const qW = new THREE.Quaternion();
  const qa = new THREE.Quaternion();
  const qb = new THREE.Quaternion();
  const UP = new THREE.Vector3(0, 1, 0);
  const ZAX = new THREE.Vector3(0, 0, 1);
  const pv = new THREE.Vector3();
  const out_ = new THREE.Vector3();
  const v = new THREE.Vector3();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const sc = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  const right = new THREE.Vector3();
  let acc = 0;
  let side = 1;
  let seed = 8412;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

  function emit(local, size, life, type, vel = null, yaw = 0) {
    if (parts.length >= MAX_FX) parts.shift();
    parts.push({ p: local.clone().applyMatrix4(g.matrixWorld), size, life, max: life, type, vel, yaw });
  }

  /** Where the sea cuts station k on one side: the world point, or null when the station is dry. */
  function cut(k, s, sea, out) {
    const pts = secs[k];
    let prevY = 0;
    for (let j = 0; j < pts.length; j++) {
      c.set(s * pts[j].x, pts[j].y, pts[j].z).applyMatrix4(g.matrixWorld);
      const y = c.y - sea;
      if (j === 0) {
        out.keel = y;
        if (y >= 0) return null;
      } else if (prevY < 0 && y >= 0) {
        out.p.copy(pv).lerp(c, -prevY / (y - prevY));
        // Where the sea cuts the V below the chine, the water leaves the hull
        // at the chine: that is where planing spray comes out.
        if (j <= CHINE) out.skin.set(s * pts[CHINE].x, pts[CHINE].y, pts[CHINE].z).applyMatrix4(g.matrixWorld);
        else out.skin.copy(out.p);
        out.skin.y = sea;
        return out.p;
      }
      pv.copy(c);
      prevY = y;
    }
    out.skin.copy(c);
    out.skin.y = sea;
    return out.p.copy(c); // under water to the sheer: take the sheer
  }
  const cutA = { p: new THREE.Vector3(), skin: new THREE.Vector3(), keel: 0 };
  const cutB = { p: new THREE.Vector3(), skin: new THREE.Vector3(), keel: 0 };

  function update(dt, speed, steer, sea) {
    g.updateWorldMatrix(true, false);
    inv.copy(g.matrixWorld).invert();
    g.getWorldQuaternion(qW);
    fwd.set(0, 0, -1).applyQuaternion(qW);
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-8) fwd.set(0, 0, -1);
    fwd.normalize();
    right.set(-fwd.z, 0, fwd.x);
    const yaw = Math.atan2(-fwd.x, -fwd.z);
    const vAbs = Math.abs(speed);
    const plane = clamp((vAbs - 3) / 10, 0, 1);

    // ---- bow wave: at the real entry, flaring aft along the waterline
    let bowSides = 0;
    for (const [i, s] of [[0, -1], [1, 1]]) {
      let k = NS - 1;
      let lastDryKeel = null;
      let lastDry = -1;
      for (; k >= 0; k--) {
        if (cut(k, s, sea, cutA)) break;
        lastDryKeel = cutA.keel;
        lastDry = k;
      }
      if (k < 0 || vAbs <= 0.4) {
        bow.setMatrixAt(i, NONE);
        continue;
      }
      a.copy(cutA.p);
      if (lastDry >= 0) {
        // Slide the entry forward to where the keel meets the sea.
        const t = lastDryKeel / (lastDryKeel - cutA.keel);
        c.set(0, secs[lastDry][0].y, secs[lastDry][0].z).applyMatrix4(g.matrixWorld);
        a.lerp(c, clamp(1 - t, 0, 1));
      }
      a.y = sea;
      // B: the outer skin two to three metres aft. The wave runs from the entry
      // out past it, flared, and its inner edge rises against the hull as she planes.
      const k2 = Math.max(0, k - 3);
      if (!cut(k2, s, sea, cutB)) cutB.skin.copy(a).addScaledVector(fwd, -1.5).addScaledVector(right, s * 0.8);
      b.copy(cutB.skin).sub(a);
      b.y = 0;
      if (b.lengthSq() < 1e-6) b.copy(fwd).multiplyScalar(-1);
      const lab = b.length();
      b.normalize();
      const L = Math.max(lab * 1.15, 1.1 * (1 + plane * 1.25));
      const Wd = beam * (0.3 + plane * 0.3);
      const yawB = Math.atan2(b.x, b.z) + s * 0.1; // along A->B (aft and out), a touch more flare
      out_.set(Math.cos(yawB), 0, -Math.sin(yawB)); // the quad's local +x ...
      const sx = out_.dot(right) * s < 0 ? -1 : 1; // ... or -x, whichever points outboard
      out_.multiplyScalar(sx);
      c.copy(a).addScaledVector(b, L * 0.5).addScaledVector(out_, Wd * 0.42);
      c.y = sea + 0.05 + 0.04 * plane;
      qa.setFromAxisAngle(UP, yawB);
      qb.setFromAxisAngle(ZAX, -sx * 0.36 * plane); // lift the inboard edge
      qa.multiply(qb);
      W.compose(c, qa, sc.set(Wd, 1, L));
      bow.setMatrixAt(i, W.premultiply(inv));
      bowSides++;
    }
    bow.visible = bowSides > 0;
    bow.instanceMatrix.needsUpdate = true;
    bowMat.opacity = vAbs > 0.4 ? clamp(0.25 + vAbs / 8, 0, 0.95) : 0;

    // ---- the wash astern of the props, and spray off the outside chine
    acc += dt;
    if (vAbs > 0.6) {
      while (acc >= 0.12) {
        acc -= 0.12;
        side = -side;
        // The twin washes spread.
        emit(v.set(side * 0.4 + (rnd() - 0.5) * 0.2, 0, Z_WAKE), 1 + vAbs * 0.045, 5.8, 'wake',
          right.clone().multiplyScalar(side * (0.12 + 0.03 * vAbs)), yaw);
        if (Math.abs(steer) > 0.12 && vAbs > 3) {
          const o = -Math.sign(steer); // the outside of the turn
          const vel = new THREE.Vector3(o * (1 + vAbs * 0.14), 1.6, 1.2).applyQuaternion(qW);
          emit(v.set(o * beam * 0.47, 0.2, -length * 0.06), 0.3, 1.1, 'spray', vel, yaw);
        }
      }
    } else acc = 0;
    let n = 0;
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.life -= dt;
      if (p.life <= 0) {
        parts.splice(i, 1);
        continue;
      }
      if (p.type === 'wake') {
        if (p.vel) p.p.addScaledVector(p.vel, dt);
        p.p.y = sea + 0.019; // pinned to the sea, not to the hull's heave
      } else {
        p.vel.y -= 9.81 * dt;
        p.p.addScaledVector(p.vel, dt);
        if (p.p.y <= sea) {
          p.type = 'wake';
          p.p.y = sea + 0.019;
          p.life = Math.min(p.life, 0.5);
          p.vel = null;
        }
      }
      const fade = Math.min(1, p.life / 0.8);
      const age = 1 - p.life / p.max;
      const k = Math.sqrt(fade);
      // The wash: long along her track (so one prop's sprites, 0.24 s apart,
      // join up), four times wider by the end of its life. Spray: small puffs.
      if (p.type === 'wake') sc.set(p.size * (1 + 3 * age) * k, 1, p.size * 2.2 * (1 + 1.5 * age) * k);
      else sc.set(p.size * (1 + age) * k, 1, p.size * (1 + age) * k);
      qa.setFromAxisAngle(UP, p.yaw);
      W.compose(p.p, qa, sc);
      opac.setX(n, fade * (1 - age * 0.65));
      wash.setMatrixAt(n++, W.premultiply(inv));
    }
    wash.count = n;
    wash.instanceMatrix.needsUpdate = true;
    opac.needsUpdate = true;
  }

  function reset() {
    parts.length = 0;
    wash.count = 0;
    acc = 0;
    bowMat.opacity = 0;
    bow.visible = false;
  }

  return { update, reset, wash, bow, get alive() { return parts.length; } };
}
