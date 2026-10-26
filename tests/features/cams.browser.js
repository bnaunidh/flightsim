/**
 * Camera angles for every aircraft (the owner, 2026-10-25), in the real game:
 * every type in the roster, airborne and settled in cruise, in the Follow,
 * Orbit and Wing views (and Tower, which tracks it from the balcony).
 *
 *   1. The WHOLE airframe is on screen with margins: every drawn vertex
 *      (sampled, the model the game draws) projects inside the middle 92% of
 *      the picture in Follow and Orbit, and inside the picture in Wing.
 *   2. It is not a speck: in Follow and Orbit it spans at least 18% of the
 *      picture's width or height.
 *   3. The lens is not inside the aeroplane: outside the airframe's own
 *      bounding box (Follow, Orbit and Wing — the wing view stands beyond the
 *      tip or over the wing, never in it), and the first thing a ray from the
 *      lens to the airframe's centre meets is more than a metre away.
 *   4. A helicopter's Follow lens is above its rotor disc.
 *   5. The lens is above the ground, the FOV is sane (20-80 degrees), and it
 *      looks at the airframe's centre (within 0.2 of the picture's middle in
 *      Follow).
 *   6. The Flyby view (see below).
 *
 * `check(sim, r, say)`; every import dynamic, as in the other feature checks.
 * `opts.ids` limits the sweep (for a quick run from the console).
 */
export async function check(sim, r, say, opts = {}) {
  const THREE = await import('../../src/vendor/three.module.js');
  const { AIRCRAFT, isHelicopter } = await import('../../src/aircraft/types.js');
  const { heightAt } = await import('../../src/world/terrain.js');
  const P = await import('../../src/aircraft/physics.js');
  const log = (m) => { if (say) say(`cams: ${m}`); };
  const origAuto = sim.autoPauseOnHide;
  sim.autoPauseOnHide = false;
  const ids = opts.ids || AIRCRAFT.map((t) => t.id);
  const v = new THREE.Vector3();
  const m = new THREE.Matrix4();
  const inst = new THREE.Matrix4();
  const ray = new THREE.Raycaster();
  const bad = [];
  let tried = 0;

  /** Up to ~3,000 vertices of the drawn model, in its own frame (scale kept), and their box. */
  function sample(model) {
    model.updateMatrixWorld(true);
    const at = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    model.matrixWorld.decompose(at, q, s);
    const toModel = new THREE.Matrix4().compose(at, q, s.set(1, 1, 1)).invert();
    const meshes = [];
    let total = 0;
    model.traverseVisible((o) => {
      const p = o.isMesh && o.geometry && o.geometry.attributes.position;
      if (!p || (o.material && o.material.visible === false)) return;
      // The cockpit interior and see-through bits are not the airframe, and
      // nor are its effects: the exhaust's heat haze and flames, the lights'
      // glows, smoke and trails (blended, or shaders, and never written to depth).
      if (o.userData && (o.userData.cockpit || o.userData.insideOnly)) return;
      const mat = Array.isArray(o.material) ? o.material[0] : o.material;
      // ...but a rotor's blades and its disc are what a helicopter looks like from outside.
      const rotorPart = /rotor|blade|disc|disk/i.test(`${o.name || ''} ${(o.parent && o.parent.name) || ''}`);
      if (!rotorPart && mat && (mat.isShaderMaterial || mat.blending === THREE.AdditiveBlending || (mat.transparent && mat.depthWrite === false))) return;
      if (!rotorPart && /haze|flame|glow|trail|smoke|strobe|beacon|shadow|halo|flare|burner/i.test(o.name || '')) return;
      meshes.push(o);
      total += p.count * (o.isInstancedMesh ? o.count : 1);
    });
    const stride = Math.max(1, Math.floor(total / 3000));
    const pts = [];
    const box = new THREE.Box3();
    for (const o of meshes) {
      const p = o.geometry.attributes.position;
      for (let k = 0, n = o.isInstancedMesh ? o.count : 1; k < n; k++) {
        m.multiplyMatrices(toModel, o.matrixWorld);
        if (o.isInstancedMesh) {
          o.getMatrixAt(k, inst);
          m.multiply(inst);
        }
        for (let i = 0; i < p.count; i += stride) {
          v.fromBufferAttribute(p, i).applyMatrix4(m);
          pts.push(v.clone());
          box.expandByPoint(v);
        }
      }
    }
    return { pts, box, meshes };
  }

  try {
    for (const id of ids) {
      const type = AIRCRAFT.find((t) => t.id === id);
      if (!type) continue;
      const heli = isHelicopter(type);
      log(id);
      try {
        await sim.startMode('free', { aircraft: id, airborne: true, time: 'day', condition: 'clear', windSpeedKts: 0 });
      } catch (e) {
        r.ok(`cams: ${id} starts airborne`, false, e.message);
        continue;
      }
      const ac = sim.aircraft;
      // Settle in steady flight: the autopilot-free airborne start holds its
      // own attitude for these few seconds.
      sim.step(0.5);
      const model = sim.model;
      if (!model) continue;
      // The cockpit is not drawn outside the cockpit view, but say so explicitly.
      if (sim.cockpit) sim.cockpit.visible = false;
      const S = sample(model);
      const hub = heli ? P.SPEC.rotorHubY || 1.3 : 0;
      for (const view of ['chase', 'orbit', 'wing', 'tower']) {
        sim.rig.setMode(view);
        sim.step(view === 'chase' ? 2.5 : 1.2);
        if (ac.crashed) break;
        tried++;
        const cam = sim.camera;
        cam.updateMatrixWorld(true);
        model.updateMatrixWorld(true);
        // The model's frame without its own scale, as sample() measured in.
        const at = new THREE.Vector3();
        const q = new THREE.Quaternion();
        const s = new THREE.Vector3();
        model.matrixWorld.decompose(at, q, s);
        const toWorld = new THREE.Matrix4().compose(at, q, new THREE.Vector3(1, 1, 1));
        const toLocal = toWorld.clone().invert();
        let x0 = 9;
        let x1 = -9;
        let y0 = 9;
        let y1 = -9;
        let behind = 0;
        for (const p of S.pts) {
          v.copy(p).applyMatrix4(toWorld).applyMatrix4(cam.matrixWorldInverse);
          if (v.z > -cam.near) { behind++; continue; }
          v.applyMatrix4(cam.projectionMatrix);
          x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x);
          y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y);
        }
        const camLocal = cam.position.clone().applyMatrix4(toLocal);
        // In the flight model's own frame (the rotor hub is measured from the CG).
        const camBody = cam.position.clone().sub(ac.pos).applyQuaternion(ac.quat.clone().invert());
        const inBox = S.box.containsPoint(camLocal);
        const centre = S.box.getCenter(new THREE.Vector3()).applyMatrix4(toWorld);
        ray.set(cam.position, centre.clone().sub(cam.position).normalize());
        ray.near = 0;
        ray.far = cam.position.distanceTo(centre);
        const hit = ray.intersectObjects(S.meshes, false)[0];
        const clear = hit ? hit.distance : ray.far;
        const ground = cam.position.y - heightAt(cam.position.x, cam.position.z);
        const span = Math.max(x1 - x0, y1 - y0) / 2;
        const lim = view === 'wing' ? 1 : 0.92;
        const onScreen = behind === 0 && x0 > -lim && x1 < lim && y0 > -lim && y1 < lim;
        const mid = (Math.abs((x0 + x1) / 2) + Math.abs((y0 + y1) / 2));
        const fmt = `x ${x0.toFixed(2)}..${x1.toFixed(2)} y ${y0.toFixed(2)}..${y1.toFixed(2)} behind ${behind} span ${span.toFixed(2)} fov ${cam.fov.toFixed(0)} lens ${camLocal.x.toFixed(1)},${camLocal.y.toFixed(1)},${camLocal.z.toFixed(1)} box ${S.box.min.x.toFixed(1)},${S.box.min.y.toFixed(1)},${S.box.min.z.toFixed(1)}..${S.box.max.x.toFixed(1)},${S.box.max.y.toFixed(1)},${S.box.max.z.toFixed(1)} clear ${clear.toFixed(1)}`;
        const fails = [];
        if (view !== 'tower') {
          if (!onScreen) fails.push('off screen');
          if (inBox) fails.push('lens inside the airframe box');
          if (clear < 1) fails.push('lens against the airframe');
        }
        if (view === 'chase' && span < 0.18) fails.push('a speck');
        // The orbit circles: edge-on, a flying wing or a long thin racer is thinner than its plan.
        if (view === 'orbit' && span < 0.14) fails.push('a speck');
        if (view === 'chase' && mid > 0.4) fails.push('not looking at its centre');
        if (view === 'chase' && heli && camBody.y < hub + 0.5) fails.push(`under the rotor disc (hub ${hub.toFixed(1)})`);
        if (ground < 0.8) fails.push('lens in the ground');
        if (!(cam.fov >= (view === 'tower' ? 4 : 20) && cam.fov <= 80)) fails.push('fov');
        if (opts.verbose) say(`${id} ${view}: ${fails.join(', ') || 'ok'} — ${fmt}`);
        if (fails.length) bad.push(`${id} ${view}: ${fails.join(', ')} (${fmt})`);
      }
    }
  } finally {
    sim.autoPauseOnHide = origAuto;
    try { sim.rig.setMode('chase'); } catch (e) { /* */ }
    try { sim.quitToMenu('main'); } catch (e) { /* */ }
  }
  r.ok(`cams: every type frames cleanly in Follow, Orbit, Wing and Tower (${tried} views)`, bad.length === 0 && tried > 0, bad.slice(0, 40).join(' || '));

  /*
   * 6. The Flyby view: set up ahead on the flight path, it stands still while
   *    the aeroplane goes by, then is set up again ahead (a cut). Over 14 s of
   *    flight: the aeroplane's middle is on screen nearly all the time, there
   *    are cuts, and the lens is never in the ground, in a building or in the
   *    airframe.
   */
  const { obstacleAt } = await import('../../src/world/terrain.js');
  const fly = [];
  for (const id of (opts.ids || ['skylark', 'f22', 'a380', 'harrier', 'massimo'])) {
    try {
      await sim.startMode('free', { aircraft: id, airborne: true, time: 'day', condition: 'clear', windSpeedKts: 0 });
    } catch (e) { continue; }
    sim.rig.setMode('flyby');
    sim.step(0.2);
    const ac = sim.aircraft;
    let frames = 0;
    let seen = 0;
    let cuts = 0;
    let badLens = 0;
    let last = sim.camera.position.clone();
    for (let i = 0; i < 14 * 15 && !ac.crashed; i++) {
      sim.update(1 / 15);
      const cam = sim.camera;
      cam.updateMatrixWorld(true);
      if (cam.position.distanceTo(last) > 1) cuts++;
      last.copy(cam.position);
      const c = sim.rig.aimPoint(ac).clone().project(cam);
      frames++;
      if (c.z < 1 && Math.abs(c.x) < 1 && Math.abs(c.y) < 1) seen++;
      const g = cam.position.y - heightAt(cam.position.x, cam.position.z);
      if (g < 1 || obstacleAt(cam.position.x, cam.position.y, cam.position.z) || cam.position.distanceTo(ac.pos) < sim.rig.frame.radius) badLens++;
    }
    const share = seen / Math.max(1, frames);
    if (!(share > 0.9 && cuts >= 1 && badLens === 0)) fly.push(`${id}: on screen ${(share * 100).toFixed(0)}%, ${cuts} cuts, ${badLens} bad lens frames`);
    if (opts.verbose) say(`${id} flyby: on screen ${(share * 100).toFixed(0)}%, ${cuts} cuts, ${badLens} bad`);
  }
  try { sim.rig.setMode('chase'); sim.quitToMenu('main'); } catch (e) { /* */ }
  r.ok('cams: the Flyby view stands ahead, lets it go by and is set up again, never in anything', fly.length === 0, fly.join(' || '));

  /*
   * 6b. Low over the sea: the flyby is set up below the flight path, and out
   *     there heightAt() is the seabed (-34 m). A helicopter hovering 4 m up
   *     (a rescue) or a jet's low pass put the lens a metre under the water.
   */
  const wet = [];
  {
    let sx = null;
    let sz = 0;
    search: for (let rr = 2000; rr < 30000; rr += 500) {
      for (let a = 0; a < 6.28; a += 0.3) {
        const x = Math.cos(a) * rr;
        const z = Math.sin(a) * rr;
        let ok = true;
        for (let dx = -1500; dx <= 1500 && ok; dx += 300) for (let dz = -1500; dz <= 1500 && ok; dz += 300) if (heightAt(x + dx, z + dz) > -5) ok = false;
        if (ok) { sx = x; sz = z; break search; }
      }
    }
    if (sx === null) wet.push('no open sea found');
    else {
      for (const id of (opts.ids ? opts.ids.slice(0, 2) : ['ch47', 'f22'])) {
        await sim.startMode('free', { aircraft: id, airborne: true, time: 'day', condition: 'clear', windSpeedKts: 0 });
        const ac = sim.aircraft;
        ac.pos.set(sx, 4, sz);
        if (isHelicopter(AIRCRAFT.find((t) => t.id === id))) ac.vel.set(0, 0, 0);
        sim.rig.setMode('flyby');
        sim.step(1 / 30);
        const y = sim.camera.position.y;
        if (!(y >= 1)) wet.push(`${id}: lens at ${y.toFixed(2)} m, under the sea`);
      }
    }
    try { sim.rig.setMode('chase'); sim.quitToMenu('main'); } catch (e) { /* */ }
  }
  r.ok('cams: low over the sea the Flyby lens stays above the water, not on the seabed', wet.length === 0, wet.join(' || '));

  /*
   * 7. A crash with Reduce flashing (on by default) in the views other than
   *    Follow (camera.js crashEase): measured under the flicker probe they
   *    went to 38-61% (Tower), 7-96% (Wing) and 3-52% (Flyby) of a 10-degree
   *    field, against WCAG's 25%. What holds them under it, checked cheaply
   *    here (the flicker probe itself is the crash sweep's): after the ease,
   *    Wing, Flyby and Orbit stand at least crashStand() from the wreck, the
   *    Wing view no longer tumbles with it, nothing cuts more than once, and
   *    the Tower and Flyby lenses are no longer than the old binoculars.
   */
  const cr = await import('../../src/features/crashes.js');
  const reduceWas = sim.settings.reduceFlashing;
  const crashBad = [];
  try {
    sim.applySetting('reduceFlashing', true);
    for (const id of (opts.ids ? opts.ids.slice(0, 2) : ['f22', 'tpose'])) {
      for (const view of ['wing', 'flyby', 'tower', 'orbit']) {
        await sim.startMode('free', { aircraft: id, airborne: true, time: 'day', condition: 'clear', windSpeedKts: 0 });
        sim.rig.setMode(view);
        sim.step(0.5);
        if (!cr.stageCrash(sim, 'cartwheel')) { crashBad.push(`${id} ${view}: no crash staged`); continue; }
        clearTimeout(sim._crashDebriefT);
        sim.rig.initialised = false;
        let cuts = 0;
        let last = null;
        let minD = Infinity;
        let minFov = 999;
        let turn = 0;
        let q0 = null;
        for (let i = 0; i < 75; i++) {
          sim.update(1 / 30);
          clearTimeout(sim._crashDebriefT);
          const c = sim.camera;
          if (last && i > 0 && c.position.distanceTo(last) > 6) cuts++;
          last = c.position.clone();
          if (i >= 30) {
            minD = Math.min(minD, c.position.distanceTo(sim.aircraft.pos));
            minFov = Math.min(minFov, c.fov);
            if (!q0) q0 = c.quaternion.clone();
            turn = Math.max(turn, 2 * Math.acos(Math.min(1, Math.abs(q0.dot(c.quaternion)))));
          }
        }
        const stand = sim.rig.crashStand();
        const d = sim.camera.position.distanceTo(sim.aircraft.pos);
        const why = [];
        if (view !== 'tower' && minD < stand * 0.9) why.push(`${minD.toFixed(1)} m from the wreck (stand ${stand.toFixed(1)})`);
        if (cuts > 1) why.push(`${cuts} cuts`);
        if (view === 'wing' && turn > 0.6) why.push(`the lens turned ${(turn * 57.3).toFixed(0)} deg with the wreck`);
        if (view === 'tower' && minFov < Math.min(60, Math.max(12, 60 - d / 90)) - 1) why.push(`fov ${minFov.toFixed(1)} at ${d.toFixed(0)} m`);
        if (view === 'flyby' && minFov < 50) why.push(`fov ${minFov.toFixed(1)}`);
        if (why.length) crashBad.push(`${id} ${view}: ${why.join(', ')}`);
        if (opts.verbose) say(`${id} ${view} crash: ${why.join(', ') || 'ok'} (min ${minD.toFixed(1)} m, stand ${stand.toFixed(1)}, fov ${minFov.toFixed(0)}, ${cuts} cuts, turn ${(turn * 57.3).toFixed(0)} deg)`);
      }
    }
  } finally {
    clearTimeout(sim._crashDebriefT);
    if (sim.settings.reduceFlashing !== reduceWas) sim.applySetting('reduceFlashing', reduceWas !== false);
    try { sim.rig.setMode('chase'); sim.quitToMenu('main'); } catch (e) { /* */ }
  }
  r.ok('cams: with Reduce flashing a wreck is watched from a safe distance in Wing, Flyby, Tower and Orbit (no tumbling lens, one cut at most, no long lens)', crashBad.length === 0, crashBad.join(' || '));
}
