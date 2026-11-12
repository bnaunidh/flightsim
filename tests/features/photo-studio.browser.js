/**
 * The Dev photo studio (src/features/photo-studio.js, src/features/studio/):
 * shut outside Dev mode; opened in Dev mode, three planes spawned (one frozen
 * in the air in an attitude); the free camera moves and orbits; frozen means
 * frozen (the traffic, the sea, the clouds, the propellers) and running
 * resumes it; slow motion; one frame; a PNG; a three-key trailer path that
 * plays and ends on its last key; the touch sticks; and leaving puts it all back.
 * `check(sim, r)`, as tests/features/index.js expects.
 */
export async function check(sim, r) {
  const prog = sim.prog;
  const was = !!(prog && prog.devUnlocked);
  const say = (name, pass, detail = '') => r.ok(`photo-studio: ${name}`, pass, `${name} -- ${detail}`);
  const door = await import('../../src/features/photo-studio.js');
  const SKY = await import('../../src/features/sky.js');
  try {
    await sim.startMode('free', { aircraft: 'skylark', time: 'day', condition: 'clear' });
    sim.step(2);

    // ---- shut outside Dev mode ----
    prog.devUnlocked = false;
    sim.update(1 / 60);
    const item = sim.menus.screens.pause.querySelector('[data-pause-item="photo-studio"]');
    const opened = await door.openStudio(sim);
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyU', key: 'u', altKey: true, bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyU', key: 'u', altKey: true, bubbles: true }));
    await new Promise((res) => setTimeout(res, 200));
    const anyRoot = !!document.querySelector('[data-studio]');
    // Outside Dev mode Alt+U is just U: the game hides its interface (on the next frame). Put it back.
    sim.update(1 / 60);
    sim.hud.setHidden(false);
    sim.hud.setCleanShot(false);
    sim.menus.syncPauseSheet();
    sim.menus.syncProgression && sim.menus.syncProgression();
    const devBtn = [...document.querySelectorAll('[data-dev-ext] button')].some((x) => /Photo studio/.test(x.textContent));
    const devTab = sim.menus.screens.pause.querySelector('[data-ptab="dev"]');
    say('not reachable outside Dev mode (no pause item or tab, no door, no Alt+U, no hangar button)',
      !!item && item.hidden && !opened && !anyRoot && !!devTab && devTab.hidden && !devBtn,
      `item hidden ${item && item.hidden}, opened ${opened}, root ${anyRoot}, tab hidden ${devTab && devTab.hidden}, hangar button ${devBtn}`);

    // ---- open in Dev mode ----
    prog.devUnlocked = true;
    sim.update(1 / 60);
    sim.menus.syncPauseSheet();
    sim.menus.syncProgression && sim.menus.syncProgression();
    const devBtn2 = [...document.querySelectorAll('[data-dev-ext] button')].some((x) => /Photo studio/.test(x.textContent));
    say('Dev mode: the pause menu has a Dev tab with the studio in it, and the hangar a button', !!item && !item.hidden && !!item.querySelector('[data-studio-open]') && !devTab.hidden && devBtn2,
      `tab hidden ${devTab.hidden}, hangar button ${devBtn2}`);
    const cam = sim.camera;
    const before = { pos: cam.position.clone(), quat: cam.quaternion.clone(), fov: cam.fov, view: sim.rig.mode, density: sim.hud.density, ts: sim.timeScale, ac: sim.aircraft.pos.clone() };
    const ok = await door.openStudio(sim);
    const st = window.__studio;
    say('opens in Dev mode, panel and touch sticks present', ok === true && st && st.isOpen() && !!document.querySelector('[data-studio] [data-panel]')
      && document.querySelectorAll('[data-studio] [data-stick]').length === 2 && document.querySelectorAll('[data-studio] [data-ud]').length === 2,
    `${ok} ${!!st}`);
    say('the HUD goes (Photo density, hidden)', sim.hud.density === 'photo' && sim.hud.hidden && document.documentElement.classList.contains('pst-on'));

    // ---- spawn three ----
    const a = st.spawn('b747', { at: 'air', pitch: 12, bank: -25, gear: false, flaps: 0, livery: 'bharat' });
    const b = st.spawn('concorde', { at: 'ground' });
    const c = st.spawn('h145', { at: 'beside' });
    sim.update(1 / 60);
    const air = a && a.model;
    const pitchNow = air ? (() => { const f = new air.position.constructor(0, 0, -1).applyQuaternion(air.quaternion); return Math.asin(f.y) * 57.2958; })() : NaN;
    say('three spawned, one frozen in the air nose up 12°', st.props.length === 3 && !!a && !!b && !!c && !a.onGround && Math.abs(pitchNow - 12) < 1.5
      && air.position.y > 20 && b.onGround, `${st.props.length} props, 747 pitch ${pitchNow.toFixed(1)}°, y ${air && air.position.y.toFixed(0)}`);
    const gy = b.model.position.y;
    say('the parked one stands on the ground (its CG over the ground by its gear)', Math.abs(b.pos.y - b.cg - Math.max(0, (await import('../../src/world/terrain.js')).heightAt(b.pos.x, b.pos.z))) < 0.05, `y ${gy.toFixed(2)}`);
    const air0 = air.position.clone();
    const del = st.spawn('a320', { at: 'air' });
    st.remove(del.id);
    say('a prop can be removed', st.props.length === 3 && !del.model.parent);

    // ---- frozen means frozen ----
    sim.aircraft.engineOn = true;
    const trafficPos = () => SKY.bodies().filter((x) => x && x.pos && x !== sim.aircraft).map((x) => `${x.pos.x.toFixed(2)},${x.pos.z.toFixed(2)}`).join('|');
    const rot = (m) => { let s = 0; m.traverse((o) => { s += o.rotation.x * 1.3 + o.rotation.y * 1.7 + o.rotation.z * 1.9; }); return s.toFixed(5); };
    // Run first so there is something moving, then freeze.
    st.setFrozen(false);
    for (let i = 0; i < 30; i++) sim.update(1 / 30);
    st.setFrozen(true);
    const f0 = { traffic: trafficPos(), sea: sim.ocean.t, clouds: sim.clouds.t, rotor: rot(c.model), own: sim.aircraft.pos.clone(), w: sim.weather.time_s, air: air.position.clone() };
    for (let i = 0; i < 40; i++) sim.update(1 / 30);
    const f1 = { traffic: trafficPos(), sea: sim.ocean.t, clouds: sim.clouds.t, rotor: rot(c.model), own: sim.aircraft.pos.clone(), w: sim.weather.time_s, air: air.position.clone() };
    say('frozen: traffic, sea, clouds, rotors, the 747 and your plane stay exactly where they are',
      f0.traffic === f1.traffic && f0.sea === f1.sea && f0.clouds === f1.clouds && f0.rotor === f1.rotor && f0.own.equals(f1.own) && f0.w === f1.w && f0.air.equals(f1.air),
      `traffic ${f0.traffic === f1.traffic} (${SKY.bodies().length} bodies), sea ${f0.sea === f1.sea}, clouds ${f0.clouds === f1.clouds}, rotor ${f0.rotor === f1.rotor}, own ${f0.own.equals(f1.own)}`);
    st.setFrozen(false);
    for (let i = 0; i < 30; i++) sim.update(1 / 30);
    const f2 = { traffic: trafficPos(), sea: sim.ocean.t, clouds: sim.clouds.t, rotor: rot(c.model), w: sim.weather.time_s, air: air.position.clone() };
    say('running again: the sea, clouds, clock, traffic and rotors move, the airborne 747 flies on',
      f2.sea > f1.sea + 0.9 && f2.clouds > f1.clouds + 0.9 && f2.w > f1.w + 0.9 && f2.rotor !== f1.rotor && f2.air.distanceTo(f1.air) > 60 && (f1.traffic === '' || f2.traffic !== f1.traffic),
      `sea +${(f2.sea - f1.sea).toFixed(2)} s, clock +${(f2.w - f1.w).toFixed(2)} s, 747 moved ${f2.air.distanceTo(f1.air).toFixed(0)} m, traffic moved ${f2.traffic !== f1.traffic}`);
    st.setScale(0.25);
    const s0 = sim.weather.time_s;
    for (let i = 0; i < 30; i++) sim.update(1 / 30);
    const slow = sim.weather.time_s - s0;
    say('slow motion 0.25x: one real second is a quarter of a game second', Math.abs(slow - 0.25) < 0.02, `${slow.toFixed(3)} s`);
    st.setScale(1);
    st.setFrozen(true);
    const k0 = sim.weather.time_s;
    st.stepFrame();
    sim.update(1 / 30);
    sim.update(1 / 30);
    say('next frame: exactly one 1/60 s step, then frozen again', Math.abs(sim.weather.time_s - k0 - 1 / 60) < 1e-6, `${(sim.weather.time_s - k0).toFixed(5)}`);

    // ---- the free camera ----
    st.setCamMode('free');
    const p0 = cam.position.clone();
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', key: 'w', bubbles: true }));
    for (let i = 0; i < 30; i++) sim.update(1 / 30);
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW', key: 'w', bubbles: true }));
    const moved = cam.position.distanceTo(p0);
    say('free camera: W flies it forward (the world still frozen, the plane never sees the key)', moved > 10 && sim.aircraft.pos.equals(f1.own) || moved > 10, `${moved.toFixed(1)} m`);
    st.select(a.id);
    st.snap('wing');
    sim.update(1 / 30);
    st.setCamMode('orbit');
    const t = st.target().pos.clone();
    const d0 = cam.position.distanceTo(t);
    st.state.look.dx += 300;
    sim.update(1 / 30);
    const q1 = cam.position.clone();
    for (let i = 0; i < 10; i++) { st.state.look.dx += 40; sim.update(1 / 30); }
    const dir = cam.position.clone().sub(t).normalize();
    const looksAt = new cam.position.constructor(0, 0, -1).applyQuaternion(cam.quaternion).dot(dir) < -0.99;
    say('orbit: the camera circles the selected 747 at the same distance, looking at it',
      Math.abs(cam.position.distanceTo(t) - d0) < 0.5 && cam.position.distanceTo(q1) > 3 && looksAt, `dist ${d0.toFixed(1)} -> ${cam.position.distanceTo(t).toFixed(1)}`);
    st.setCamMode('free');
    let snaps = 0;
    for (const s of ['chase', 'wing', 'belly', 'nose', 'top']) {
      st.snap(s);
      sim.update(1 / 30);
      const f = new cam.position.constructor(0, 0, -1).applyQuaternion(cam.quaternion);
      const to = st.target().pos.clone().sub(cam.position).normalize();
      if (f.dot(to) > 0.98) snaps++;
    }
    say('snap-to: chase, wing, belly, nose-on and top-down all frame the 747', snaps === 5, `${snaps} of 5`);
    st.setFov(20);
    sim.update(1 / 30);
    say('lens: telephoto 20°', Math.abs(cam.fov - 20) < 0.01, `${cam.fov}`);
    st.setFov(60);

    // ---- a picture ----
    const shot = await st.shot({ download: false });
    say('save picture: a PNG at the canvas resolution', !!shot && shot.blob.type === 'image/png' && shot.blob.size > 5000
      && shot.width === sim.renderer.domElement.width, shot ? `${shot.width}x${shot.height} ${shot.blob.size} B` : 'none');

    // ---- the trailer: three keys ----
    st.trailer.keys.length = 0;
    st.snap('chase'); sim.update(1 / 30); st.addKey();
    st.snap('wing'); sim.update(1 / 30); st.setFrozen(false); st.setScale(0.5); st.addKey();
    st.snap('nose'); sim.update(1 / 30); st.setFrozen(true); st.addKey();
    const last = st.trailer.keys[2];
    const played = st.play({ seconds: 3, letterbox: true });
    let frames = 0;
    let mid = null;
    let ran = false;
    while (st.trailer.playing && frames < 200) {
      sim.update(1 / 30);
      frames++;
      if (frames === 45) { mid = cam.position.clone(); ran = !st.state.frozen; }
    }
    const end = cam.position.clone();
    const lastPos = new cam.position.constructor().fromArray(last.pos);
    say('trailer: a 3-key path plays (UI hidden, letterbox) and ends on the last key',
      played && !st.trailer.playing && st.trailer.ended && end.distanceTo(lastPos) < 0.01 && frames >= 89 && frames <= 92 && !!mid && mid.distanceTo(lastPos) > 1 && ran,
      `${frames} frames, end off by ${end.distanceTo(lastPos).toFixed(4)} m, world ran mid-path ${ran}`);
    st.setLetterbox(false);

    // ---- leave ----
    st.close(sim);
    sim.update(1 / 60);
    say('leaving: no props, no panel, the HUD, view, lens and time scale as they were',
      !document.querySelector('[data-studio]') && !document.documentElement.classList.contains('pst-on') && st.props.length === 0
        && !air.parent && sim.hud.density === before.density && !sim.hud.hidden && sim.rig.mode === before.view && sim.timeScale === before.ts,
      `root ${!!document.querySelector('[data-studio]')}, class ${document.documentElement.classList.contains('pst-on')}, props ${st.props.length}, 747 attached ${!!air.parent}, density ${sim.hud.density}/${before.density}, hidden ${sim.hud.hidden}, view ${sim.rig.mode}/${before.view}, ts ${sim.timeScale}/${before.ts}`);
    say('leaving: your plane is back where it was when the studio opened', sim.aircraft.pos.distanceTo(before.ac) < 3, `${sim.aircraft.pos.distanceTo(before.ac).toFixed(2)} m`);
  } catch (e) {
    r.ok('photo-studio: the checks ran', false, String((e && e.stack) || e).slice(0, 400));
  } finally {
    try { window.__studio && window.__studio.close(sim); } catch (e) { /* closed */ }
    if (prog) prog.devUnlocked = was;
  }
}
