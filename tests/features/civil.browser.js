/**
 * The five civil airframes in the real game: the real startMode, the real
 * frame loop, the real key path. tests/features/civil.mjs holds the drawings
 * to the flight model headless and in far more detail; this is the part only
 * a page can prove — that main.js builds each one from its own airframe in
 * src/aircraft/models/ (not the pack, not model.js's generic fallback), that
 * it sits on the runway with its tyres or skids on the tarmac, that starting
 * the engine turns its propellers or spools its rotor — and that a running
 * rotor shows up in the actual pixels, on the runway and in the hover — and
 * that the cockpit view can be entered and left in it.
 */
const IDS = ['skylark', 'courier', 'meridian', 'tempest', 'harrier'];

/** Lowest visible vertex of the model in world space, propellers and rotors left out. */
function lowestPoint(model) {
  model.updateMatrixWorld(true);
  let low = Infinity;
  const v = model.position.clone();
  model.traverse((o) => {
    if (!o.isMesh || !o.geometry || !o.geometry.attributes.position) return;
    for (let p = o; p; p = p.parent) {
      if (!p.visible) return;
      if (/propeller|rotor/.test(p.name)) return;
    }
    const pos = o.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      if (v.y < low) low = v.y;
    }
  });
  return low;
}

/**
 * What the moving parts add to the picture: the same frame drawn with them
 * and without them, compared pixel by pixel. Returns how many pixels they
 * change by more than 2 levels of 255 (as a fraction of the frame), the
 * mean change over those, and the largest. This is how the reviewer found
 * the Skyhook's rotor missing at 93375df: 5 levels on average, 13 at most.
 */
function partsDiff(sim, parts) {
  const R = sim.renderer;
  // The suite's harnesses stub renderer.render for speed and keep the real one
  // as window.__realRender (the boat playtest draws through it too); a frame
  // drawn through the stub changes no pixel, and the rotor then "cannot be seen".
  const draw = (typeof window !== 'undefined' && window.__realRender) || R.render.bind(R);
  const gl = R && R.domElement;
  if (!gl || !gl.width || !gl.height || !sim.camera) return null;
  const W = gl.width;
  const H = gl.height;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const x = c.getContext('2d', { willReadFrequently: true });
  // Read in the same task as the render: the drawing buffer is not kept.
  const grab = () => {
    draw(sim.scene, sim.camera);
    x.clearRect(0, 0, W, H);
    x.drawImage(gl, 0, 0);
    return x.getImageData(0, 0, W, H).data;
  };
  const live = parts.filter((o) => o && o.visible);
  const shown = grab();
  for (const o of live) o.visible = false;
  const bare = grab();
  for (const o of live) o.visible = true;
  draw(sim.scene, sim.camera);
  let n = 0;
  let sum = 0;
  let max = 0;
  for (let i = 0; i < shown.length; i += 4) {
    const d = (Math.abs(shown[i] - bare[i]) + Math.abs(shown[i + 1] - bare[i + 1]) + Math.abs(shown[i + 2] - bare[i + 2])) / 3;
    if (d > 2) {
      n++;
      sum += d;
      if (d > max) max = d;
    }
  }
  return { frac: n / (W * H), mean: n ? sum / n : 0, max, drawn: live.map((o) => o.name || 'blades').join(', ') };
}

const seenText = (d) => (d ? `${(d.frac * 100).toFixed(2)}% of the frame changed, by ${d.mean.toFixed(0)} levels on average and ${d.max.toFixed(0)} at most (${d.drawn})` : 'no renderer to read');
// Clearly there: a patch of the frame, changed by far more than 5 levels.
const isSeen = (d) => !d || (d.frac > 0.004 && d.mean >= 20 && d.max >= 60);

function nanIn(model) {
  let bad = 0;
  model.updateMatrixWorld(true);
  model.traverse((o) => {
    for (const e of o.matrixWorld.elements) if (!Number.isFinite(e)) bad++;
  });
  return bad;
}

export async function check(sim, r, say) {
  const calm = { time: 'day', condition: 'clear', windSpeedKts: 0, windDirDeg: 90, airborne: false };
  const release = () => { for (const c of ['KeyW', 'KeyS', 'ShiftLeft', 'ControlLeft', 'KeyI']) sim.key(c, false); };
  const found = sim.aircraftType ? sim.aircraftType.id : 'skylark';
  /*
   * In the full game the Skyhook is drawn by the Blender model
   * (src/vehicles/blender-models.js); this team's airframe is its fallback.
   * These checks are about the civil drawing, so the Blender models are
   * switched off for them and back on afterwards — and the Blender machine
   * gets its own "on its skids, not in the ground" check at the end.
   */
  let BM = null;
  try { BM = await import('../../src/vehicles/blender-models.js'); } catch (e) { BM = null; }
  const blenderOff = () => { if (BM && BM.setBlenderModels) BM.setBlenderModels(false); };
  const blenderOn = () => { if (BM && BM.setBlenderModels) BM.setBlenderModels(true); };
  blenderOff();

  for (const id of IDS) {
    try {
      say(`civil: ${id} on the runway`);
      release();
      await sim.startMode('free', { ...calm, aircraft: id });
      if (sim.input) sim.input.throttleTarget = 0;
      sim.step(2);
      const ac = sim.aircraft;
      const m = sim.model;
      const info = sim.renderer && sim.renderer.info ? sim.renderer.info.render : null;
      r.ok(`${id} is drawn by its own civil airframe`, sim.aircraftType.id === id && m && m.userData.civil === id && !m.userData.fleetBridge,
        `${sim.aircraftType.id}, civil ${m && m.userData.civil}${info ? `, frame ${info.calls} draw calls / ${info.triangles} triangles` : ''}`);
      r.ok(`${id} sits on its gear`, !ac.crashed && ac.onGround, `crashed ${ac.crashed}, onGround ${ac.onGround}`);

      // The drawn tyres (skids) on the tarmac: the lowest thing drawn, against
      // the ground under the aeroplane. Standing, the flight model's springs
      // are compressed and the drawn gear gives with them (civil-build.js,
      // squash); before it did, every wheel stood 9 to 16 cm into the runway.
      const ground = ac.pos.y - ac.agl;
      const gap = lowestPoint(m) - ground;
      r.ok(`${id}'s wheels are on the ground, not in it or above it`, gap > -0.04 && gap < 0.05, `lowest point ${gap.toFixed(3)} m from the ground`);

      // Start it and let it run: propellers turn, the rotor spools up, a
      // jet's engines light.
      const P = m.userData.parts;
      if (!ac.engineOn) sim.tap('KeyI');
      sim.step(4);
      if (P.rotor) {
        r.ok(`${id}'s rotor spools up when the engine starts`, ac.engineOn && P.spool > 0.3, `engine ${ac.engineOn}, spool ${P.spool.toFixed(2)}`);
        /*
         * And can be seen turning, from the view a kid flies in: at 93375df
         * the blades were hidden once spooled up and the disc drawn instead
         * could not be told from the runway behind it.
         */
        const rotorParts = [P.rotor.blades, P.rotor.disc, P.rotor.tailBlades, P.rotor.tailDisc];
        const was = sim.rig.mode;
        sim.rig.setMode('chase');
        sim.step(1);
        const ground = partsDiff(sim, rotorParts);
        r.ok(`${id}'s running rotor can be seen on the runway (chase view)`, P.spool > 0.9 && isSeen(ground), `spool ${P.spool.toFixed(2)}; ${seenText(ground)}`);
        ac.reset({ pos: ac.pos.clone(), headingDeg: ac.heading, speed: 0, altAGL: 32, engineOn: true, gearDown: true });
        sim.step(2);
        const hover = partsDiff(sim, rotorParts);
        r.ok(`${id}'s running rotor can be seen in the hover (chase view)`, !ac.crashed && ac.agl > 5 && isSeen(hover), `${ac.agl.toFixed(0)} m up; ${seenText(hover)}`);
        // Back on the runway, engine running, for the cockpit check below.
        ac.reset({ pos: ac.pos.clone(), headingDeg: ac.heading, speed: 0, engineOn: true, gearDown: true });
        sim.step(0.5);
        sim.rig.setMode(was);
      } else if (P.props.length) {
        /*
         * Turning NOW, over a tenth of a second: the angle after the 4 s is
         * no evidence. The drawn propeller turns at 9/blades rev/s at idle
         * (civil-build.js, visRev), so after exactly 4 s the Skylark's had
         * made 18 whole turns and sat where it started, and the Courier's 12.
         */
        const before = P.props.map((p) => p.spin.rotation.z);
        sim.step(0.1);
        const moved = P.props.map((p, i) => Math.abs(Math.atan2(Math.sin(p.spin.rotation.z - before[i]), Math.cos(p.spin.rotation.z - before[i]))));
        const turned = P.props.every((p, i) => p.disc.visible || (p.spin.visible && moved[i] > 0.05));
        r.ok(`${id}'s propellers turn when the engine starts`, ac.engineOn && turned,
          `engine ${ac.engineOn}, ${P.props.length} propellers, rpm ${(ac.rpm || 0).toFixed(2)}, turned ${moved.map((a) => ((a * 180) / Math.PI).toFixed(0)).join(', ')} deg in 0.1 s`);
      } else {
        r.ok(`${id}'s engines start`, ac.engineOn && P.nozzles.length > 0, `engine ${ac.engineOn}, ${P.nozzles.length} nozzle materials`);
      }

      // In and out of the cockpit.
      const view = sim.rig.mode;
      sim.rig.setMode('cockpit');
      sim.step(0.3);
      const inside = sim.rig.mode === 'cockpit' && sim.cockpit && sim.cockpit.visible;
      sim.rig.setMode(view);
      sim.step(0.1);
      r.ok(`${id}: the cockpit view opens and closes`, inside && nanIn(m) === 0, `inside ${inside}, NaN ${nanIn(m)}`);
      /*
       * A tap is only an edge; the game reads it on its next frame. Tapped
       * with no frame after it, the engine switch was read by whatever flew
       * next — the self-test's own take-off spawned with its engine off and
       * rolled at 5 kt after 4 s, failing five checks that were not about
       * the drawing at all. Step a frame so this flight consumes its own key.
       */
      if (ac.engineOn) {
        sim.tap('KeyI');
        sim.step(0.1);
      }
      release();
    } catch (err) {
      r.ok(`civil: ${id} can be flown at all`, false, String(err && err.stack ? err.stack.split('\n').slice(0, 3).join(' | ') : err));
    }
  }

  blenderOn();
  // The Blender Skyhook, when it is loaded: standing on its skids, not in the
  // runway. Its skids are modelled at the gear points' full extension and
  // rise with the springs' compression, as this team's gear does.
  try {
    // setAircraft() keeps the model when the type has not changed, so go
    // through another aeroplane to have the Skyhook drawn afresh.
    await sim.startMode('free', { ...calm, aircraft: 'skylark' });
    sim.step(0.1);
    await sim.startMode('free', { ...calm, aircraft: 'harrier' });
    if (sim.input) sim.input.throttleTarget = 0;
    sim.step(2);
    const m = sim.model;
    const status = BM && BM.blenderModelStatus ? BM.blenderModelStatus() : null;
    const heliReady = !!(status && (status.heli === 'ready' || (status.heli && status.heli.state === 'ready')));
    if (heliReady) r.ok('the Skyhook is drawn by the Blender model again after these checks', !!(m && m.userData.blenderModel), `${m && m.name}`);
    if (m && m.userData.blenderModel) {
      const ac = sim.aircraft;
      const gap = lowestPoint(m) - (ac.pos.y - ac.agl);
      r.ok("the Blender Skyhook's skids are on the ground, not in it or above it", gap > -0.04 && gap < 0.05, `lowest point ${gap.toFixed(3)} m from the ground`);
    }
  } catch (err) {
    r.ok('civil: the Blender Skyhook can be stood on the runway', false, String(err && err.message));
  }

  // Leave the game as it was found — its aeroplane, and a flight that spawns
  // with the engine running, which is how the leak above showed itself.
  try {
    release();
    await sim.startMode('free', { ...calm, aircraft: found });
    sim.step(0.2);
    r.ok('civil: the next flight after these checks starts with its engine running', sim.aircraftType.id === found && sim.aircraft.engineOn,
      `${sim.aircraftType.id}, engine ${sim.aircraft.engineOn}`);
  } catch (err) {
    r.ok('civil: the game can be put back as it was found', false, String(err && err.message));
  }
}
