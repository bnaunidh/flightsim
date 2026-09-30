/**
 * Browser checks for the walking and model fixes (list2/quality): what a
 * child sees walking about and looking at things up close.
 *
 *   walking   feet on the floor as drawn (the runway's tarmac, the pad's
 *             disc, a road corridor cut into a hill); the legs stop against
 *             a wall; the planted foot does not skate; the camera eases back
 *             out after a wing instead of jumping; the thumb-stick is a
 *             throttle; out of the helicopter it says helicopter.
 *   models    the Skyhook's skids on its roof pad; the fighters' port wings
 *             the right way out; the Osprey's hook stowed on the ground; the
 *             airliners' doors seams on the skin, not white cards; the
 *             story's police walk on legs.
 *
 * Every import is dynamic and wrapped: a missing module is one failed check
 * with its name on it. `check(sim, r, say)` — r.ok(name, pass, detail).
 */

async function load(path) {
  try {
    return await import(path);
  } catch (e) {
    return { __error: String((e && e.message) || e) };
  }
}

export async function check(sim, r, say = () => {}) {
  say('quality: loading');
  const THREE = await load('../../src/vendor/three.module.js');
  const OF = await load('../../src/features/onfoot.js');
  const W = await load('../../src/features/staff/walk.js');
  const P = await load('../../src/features/staff/person.js');
  const UI = await load('../../src/features/staff/ui.js');
  const T = await load('../../src/world/terrain.js');
  const MA = await load('../../src/aircraft/model-adapter.js');
  const TY = await load('../../src/aircraft/types.js');
  const EV = await load('../../src/features/events/vehicles.js');
  const mods = { THREE, OF, W, P, UI, T, MA, TY, EV };
  const missing = Object.entries(mods).filter(([, m]) => !m || m.__error).map(([k, m]) => `${k}: ${m && m.__error}`);
  r.ok('quality: its modules load', missing.length === 0, missing.join(' | '));
  if (missing.length) return r;
  const foot = OF.onFoot;
  const KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'Space'];
  const allUp = () => { for (const c of KEYS) sim.key(c, false); };
  const dt = 1 / 60;
  const run = (secs, each) => {
    const n = Math.round(secs / dt);
    for (let i = 0; i < n; i++) {
      sim.update(dt);
      if (each) each(i);
    }
  };
  const rc = new THREE.Raycaster();
  rc.camera = sim.camera;
  const down = new THREE.Vector3(0, -1, 0);
  /** The top drawn surface under (x, z) near y, among these groups: tarmac, pads, roads, terrain. */
  const drawnTop = (x, z, y, groups) => {
    rc.set(new THREE.Vector3(x, y + 0.6, z), down);
    rc.far = 1.4;
    for (const h of rc.intersectObjects(groups.filter(Boolean), true)) {
      if (!h.face || h.object.isSprite || h.object.isPoints) continue;
      if (h.face.normal.clone().transformDirection(h.object.matrixWorld).y < 0.8) continue;
      return h.point.y;
    }
    return null;
  };
  const grp = (o) => (o && (o.isObject3D ? o : o.group)) || null;
  let pads = null;

  try {
    /* ============================================================ */
    say('quality: out of the Skylark, on the runway');
    allUp();
    await sim.startMode('free', { aircraft: 'skylark', taxi: false, traffic: false, time: 'day', condition: 'clear' });
    run(1.5);
    const ac = sim.aircraft;
    sim.tap('KeyO');
    run(1.2);
    r.ok('quality: O gets you out of the Skylark', foot.active);
    if (!foot.active) return r;
    let w = foot.walker;
    const top = drawnTop(w.x, w.z, w.y, [grp(sim.airport), grp(sim.apron), sim.terrain]);
    // (The runway's painted numbers are 2 cm proud of its tarmac: within that.)
    r.ok('quality: the pilot stands ON the runway, not in it (tarmac drawn 5-6 cm up)',
      top !== null && Math.abs(w.y - top) < 0.025 && Math.abs(w.y - W.floorAt(w.x, w.z)) < 0.005,
      `feet ${top === null ? '?' : ((w.y - top) * 100).toFixed(1)} cm from the drawn surface; heightAt ${((w.y - T.heightAt(w.x, w.z)) * 100).toFixed(1)} cm below`);

    // Walk away from the aeroplane with the camera looking back through it.
    foot.setCamera((ac.heading + 270) % 360, -12);
    run(0.3);
    const cams = [];
    sim.key('KeyW', true);
    run(3, () => cams.push({ c: sim.camera.position.clone(), w: new THREE.Vector3(foot.walker.x, foot.walker.y, foot.walker.z) }));
    sim.key('KeyW', false);
    run(0.4);
    let jerk = 0;
    for (let i = 2; i < cams.length; i++) {
      const a = cams[i - 2].c, b = cams[i - 1].c, c = cams[i].c;
      jerk = Math.max(jerk, Math.hypot(c.x - 2 * b.x + a.x, c.y - 2 * b.y + a.y, c.z - 2 * b.z + a.z));
    }
    r.ok('quality: walking away from a wing, the camera eases back out (no jumps)', jerk < 0.12, `worst frame-to-frame jerk ${jerk.toFixed(3)} m (was 0.73)`);

    /* ---- a wall: the legs stop ---- */
    say('quality: into the terminal');
    let wall = null;
    for (const o of T.OBSTACLES) {
      if (!(o.x1 - o.x0 > 8) || !(o.z1 - o.z0 > 8) || !(o.y1 - o.y0 > 4)) continue;
      const cx = (o.x0 + o.x1) / 2;
      const cz = (o.z0 + o.z1) / 2;
      if (o.y0 > T.heightAt(cx, cz) + 0.5) continue;
      const d = Math.hypot(cx - ac.pos.x, cz - ac.pos.z);
      if (d < 900 && (!wall || d < wall.d)) wall = { o, d, cx };
    }
    if (!wall) {
      r.ok('quality: there is a building to walk into', false);
    } else {
      foot.place(wall.cx, wall.o.z1 + 3, 0);
      foot.setCamera(0, -10);
      run(0.2);
      sim.key('KeyW', true);
      run(3);
      w = foot.walker;
      const A = foot.model.userData.anim;
      const pressed = { speed: w.speed, legs: A.walk, gap: w.z - wall.o.z1 };
      sim.key('KeyW', false);
      run(0.3);
      r.ok('quality: pressed against a wall the legs stop (no running on the spot)',
        pressed.gap < 0.6 && pressed.speed < 0.2 && pressed.legs < 0.25,
        `${pressed.gap.toFixed(2)} m from the wall, speed ${pressed.speed.toFixed(2)} m/s (was 1.8), stride ${pressed.legs.toFixed(2)}`);
    }

    /* ---- the thumb-stick is a throttle ---- */
    say('quality: the thumb-stick');
    foot.place(ac.pos.x - 40, ac.pos.z - 60, 0);
    foot.setCamera(0, -10);
    run(0.2);
    UI.touch.x = 0;
    UI.touch.y = 0.85;
    run(1.5);
    const stickSpeed = foot.walker.speed;
    UI.touch.y = 0;
    run(0.5);
    r.ok('quality: the stick pushed 85% of the way is a jog, not a crawl', stickSpeed > 3.5 && stickSpeed < 5.3, `${stickSpeed.toFixed(2)} m/s (was 1.5)`);

    /* ---- a road cut into a hillside ---- */
    say('quality: along a road corridor');
    const rm = sim.roadMesh;
    let off = 0;
    let n = 0;
    let worst = null;
    const cut = T.MAP && T.MAP.id === 'kestrel' ? { x: -1170, z: -100 } : null;
    if (cut) {
      for (let x = cut.x - 30; x <= cut.x + 30; x += 10) {
        for (let z = cut.z - 60; z <= cut.z + 60; z += 6) {
          const f = W.floorAt(x, z);
          const t = drawnTop(x, z, f, [rm, sim.terrain]);
          if (t === null) continue;
          n++;
          if (Math.abs(f - t) > 0.25) {
            off++;
            if (!worst || Math.abs(f - t) > Math.abs(worst.d)) worst = { x, z, d: f - t };
          }
        }
      }
      r.ok('quality: along the road cut at (-1170, -100) the feet are on the drawn grass and tarmac',
        n > 50 && off === 0, `${off} of ${n} spots more than 25 cm off (was 350 of 841)${worst ? `; worst ${worst.d.toFixed(2)} m at ${worst.x}, ${worst.z}` : ''}`);
    }

    /* ---- planted feet ---- */
    say('quality: planted feet');
    const v = new THREE.Vector3();
    for (const speed of [1.8, 5.2]) {
      const p = P.createPerson({ outfit: 'pilot', seed: 5 });
      const shins = p.userData.rig.legs.map((L) => L.knee.children.find((o) => o.isMesh));
      for (let i = 0; i < 90; i++) P.posePerson(p, dt, { speed });
      let slide = 0;
      let k = 0;
      let low = 0;
      let prev = null;
      for (let i = 0; i < 90; i++) {
        P.posePerson(p, dt, { speed });
        p.position.z -= speed * dt;
        p.updateMatrixWorld(true);
        const c = shins.map((m) => new THREE.Vector3(0, -0.425, -0.045).applyMatrix4(m.matrixWorld));
        const j = c[0].y < c[1].y ? 0 : 1;
        if (prev && prev.j === j && Math.abs(c[0].y - c[1].y) > 0.015) { slide += Math.abs(c[j].z - prev.z) / dt; k++; }
        prev = { j, z: c[j].z };
        let mn = 1e9;
        for (const m of shins) {
          const pos = m.geometry.attributes.position;
          for (let q = 0; q < pos.count; q++) { v.fromBufferAttribute(pos, q).applyMatrix4(m.matrixWorld); if (v.y < mn) mn = v.y; }
        }
        low = Math.max(low, Math.abs(mn));
      }
      P.disposePerson(p);
      r.ok(`quality: at ${speed} m/s the foot on the ground stays put and on the ground`,
        k > 10 && slide / k < 0.15 && low < 0.012, `planted foot ${(slide / Math.max(1, k)).toFixed(2)} m/s over the ground, lowest shoe ${(low * 100).toFixed(1)} cm off the floor`);
    }
    foot.end(sim);

    /* ============================================================ */
    say('quality: out of the helicopter');
    sim.switchGame('heli');
    await sim.startMode('free', { aircraft: 'harrier', taxi: false, traffic: false, time: 'day', condition: 'clear' });
    run(2);
    const heli = sim.aircraft;
    sim.scene.traverse((o) => { if (o.name === 'pads') pads = o; });
    // The skids: the model's lowest point against the pad's disc under it.
    sim.model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(sim.model);
    const disc = drawnTop(heli.pos.x, heli.pos.z, box.min.y + 0.1, [pads]);
    let skid = 1e9;
    sim.model.traverse((o) => {
      if (!o.isMesh || o.isInstancedMesh || !o.geometry || !o.geometry.attributes.position) return;
      // Light cones and glows are not something it stands on.
      if (o.material && (o.material.transparent || o.material.blending === THREE.AdditiveBlending)) return;
      for (let q = o; q; q = q.parent) if (!q.visible) return;
      const pos = o.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld); if (v.y < skid) skid = v.y; }
    });
    r.ok('quality: the Skyhook\'s skids rest on its pad, not in it', disc !== null && Math.abs(skid - disc) < 0.02,
      disc === null ? 'no pad under it' : `skids ${((skid - disc) * 100).toFixed(1)} cm from the pad's surface (were 14 cm into it)`);
    sim.tap('KeyO');
    run(1.2);
    r.ok('quality: O gets you out of the helicopter', foot.active);
    if (foot.active) {
      w = foot.walker;
      const pt = drawnTop(w.x, w.z, w.y, [pads, grp(sim.airport), sim.terrain]);
      r.ok('quality: standing on the pad, not in it', pt !== null && Math.abs(w.y - pt) < 0.02, pt === null ? '-' : `${((w.y - pt) * 100).toFixed(1)} cm`);
      r.ok('quality: beside the helicopter it says helicopter', /helicopter/i.test(foot.snapshot().prompt), foot.snapshot().prompt);
      foot.end(sim);
    }
    sim.switchGame('flight');

    /* ============================================================ */
    say('quality: the models');
    const signedVolume = (o) => {
      const g = o.geometry;
      const p = g.attributes.position;
      const ix = g.index;
      const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
      const cnt = ix ? ix.count : p.count;
      let vol = 0;
      for (let i = 0; i < cnt; i += 3) {
        a.fromBufferAttribute(p, ix ? ix.getX(i) : i);
        b.fromBufferAttribute(p, ix ? ix.getX(i + 1) : i + 1);
        c.fromBufferAttribute(p, ix ? ix.getX(i + 2) : i + 2);
        vol += a.dot(b.cross(c)) / 6;
      }
      return vol;
    };
    for (const id of ['f22', 'vanguard']) {
      const m = MA.createAircraftModel({ type: TY.getAircraft(id) });
      m.updateMatrixWorld(true);
      const bad = [];
      m.traverse((o) => {
        if (!o.isMesh || o.isInstancedMesh || !/wing|aileron|flap|elevator|stabili/i.test(o.name || '')) return;
        if (o.material && o.material.side === THREE.FrontSide && signedVolume(o) * Math.sign(o.matrixWorld.determinant()) < -1e-4) bad.push(o.name);
      });
      r.ok(`quality: the ${id}'s wings and tail are all the right way out`, bad.length === 0, bad.join(', ') || 'none inside out');
    }
    const osp = MA.createAircraftModel({ type: TY.getAircraft('osprey') });
    for (let i = 0; i < 30; i++) osp.userData.update(dt, { onGround: true, gearPos: 1, controls: {}, rpm: 0.3 }, {});
    let hook = null;
    osp.traverse((o) => { if (o.name === 'Arrestor hook') hook = o; });
    const stowed = hook ? hook.rotation.x : null;
    for (let i = 0; i < 30; i++) osp.userData.update(dt, { onGround: false, gearPos: 1, controls: {}, rpm: 0.8 }, {});
    const lowered = hook ? hook.rotation.x : null;
    r.ok('quality: the Osprey\'s hook is stowed on the ground and comes down for the approach',
      hook && stowed < -1 && lowered > -0.1, hook ? `on the ground ${stowed.toFixed(2)} rad, gear down in the air ${lowered.toFixed(2)} rad` : 'no hook found');
    const a320 = MA.createAircraftModel({ type: TY.getAircraft('a320') });
    let cards = 0;
    let seams = 0;
    a320.traverse((o) => { if (o.name === 'Doors') cards++; if (o.name === 'Door seams') seams++; });
    r.ok('quality: the A320\'s doors are seams on the skin, not white cards', cards === 0 && seams > 0, `${cards} card meshes, ${seams} seam meshes`);

    const cop = EV.createPerson('police');
    const rig = cop.userData && cop.userData.rig;
    if (EV.posePersonAt) for (let i = 0; i < 20; i++) EV.posePersonAt(cop, dt, 1.7);
    const swing = rig ? Math.abs(rig.legs[0].leg.rotation.x) + Math.abs(rig.legs[1].leg.rotation.x) : 0;
    r.ok('quality: the story\'s police officer has arms and walks on legs', !!rig && rig.arms.length === 2 && swing > 0.1 && cop.name === 'person-police',
      rig ? `leg swing ${swing.toFixed(2)} rad` : 'three boxes, no rig');
    if (EV.disposeEventPerson) EV.disposeEventPerson(cop);
  } finally {
    allUp();
    if (UI.touch) { UI.touch.x = 0; UI.touch.y = 0; }
    if (foot.active) foot.end(sim);
    if (sim.game !== 'flight' && sim.switchGame) sim.switchGame('flight');
  }
  return r;
}
