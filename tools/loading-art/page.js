/*
 * The in-page half of capture.mjs: evaluated as the body of an async function
 * inside the running game (so `sim` is the game). It defines window.__art(id, spot, size)
 * which builds a map, lights it, places the spot's camera and its aeroplane,
 * boat or van, draws one frame and returns { b64, focus }: the canvas as a base64 JPEG, and where the
 * subject is in it ([x, y] in percent).
 *
 * A spot (spots.mjs):
 *   fov, time ('sunset'), cond ('clear'), wind [kts, deg]
 *   vehicle: { kind: 'plane'|'boat'|'car', id (an aircraft id), at: [x, z], agl | y, hdg, speed, bank }
 *   cam: EITHER { chase: true, frame, back, right, up, lookFwd, lookRight, lookUp, minAbove }
 *                  (relative to the vehicle, metres, in a frame that faces `frame` degrees, the
 *                  vehicle's own heading (+ frameAdd) if left out: back is behind it, right to its right hand;
 *                  the camera looks at the vehicle moved lookFwd / lookRight / lookUp, or at
 *                  lookAt: [x, y, z] in the world)
 *        OR { focus: [x, z], az (bearing from the focus to the camera, 0 = north), dist, up | alt, lookUp }
 *   carrier: true keeps the carrier that every map parks offshore in the picture (hidden otherwise)
 *   haze: multiplies the fog density (1 = what the weather gave)
 *   place: [x, y] in percent of the frame where the subject goes (default [34, 42]: above the title, which is bottom left); null keeps the camera as aimed
 *   anchor: [x, y, z] the subject, when the picture is about something other than the vehicle (the volcano, the carrier)
 *   subject: [x, y] in percent, what the phone crop centres on when it is not where the subject was placed
 *
 * Coordinates are the game's: X east, Z SOUTH (north is -Z); heading 0 = north, 90 = east.
 */
const T = await import('/src/world/terrain.js');
const THREE = await import('/src/vendor/three.module.js');
const ground = (x, z) => Math.max(0, T.heightAt(x, z));
const rad = (d) => (d * Math.PI) / 180;

/**
 * Where a spot says to put the vehicle: [x, z], or one of the map's own places:
 *   { harbour: 'berth' | 'mouth', dx, dz, out, side }  the quay or the gap in the breakwater (+ an offset,
 *                                               + `out` metres further out along berth -> mouth,
 *                                               + `side` metres to the right of that)
 *   { road: 'longest' | index, t, off }       t of the way along a road (+ a metre offset to its right)
 * and its heading: a number, 'out' (from the berth to the mouth), or 'road' (along the road), plus hdgAdd.
 */
function resolve(v) {
  let at = v.at;
  let hdg = typeof v.hdg === 'number' ? v.hdg : 0;
  if (at && !Array.isArray(at) && at.harbour) {
    const b = T.harbourBerth();
    const m = T.harbourMouth();
    const p = at.harbour === 'berth' ? b : m;
    const len = Math.hypot(m.x - b.x, m.z - b.z) || 1;
    const out = at.out || 0;
    const ux = (m.x - b.x) / len;
    const uz = (m.z - b.z) / len;
    // `side` metres to the right of the way out (looking out to sea).
    const side = at.side || 0;
    at = [p.x + (at.dx || 0) + ux * out - uz * side, p.z + (at.dz || 0) + uz * out + ux * side];
    if (v.hdg === 'out') hdg = (Math.atan2(m.x - b.x, -(m.z - b.z)) * 180) / Math.PI;
  } else if (at && !Array.isArray(at) && at.road != null) {
    const list = (sim.roads && sim.roads.list) || [];
    const road = at.road === 'longest' ? list.slice().sort((p, q) => q.path.length - p.path.length)[0] : list[at.road];
    const path = road.path;
    const k = Math.min(path.length - 2, Math.max(0, Math.floor((at.t || 0) * (path.length - 1))));
    const a = path[k];
    const b = path[k + 1];
    const f = (at.t || 0) * (path.length - 1) - k;
    const x = a[0] + (b[0] - a[0]) * f;
    const z = a[1] + (b[1] - a[1]) * f;
    const along = (Math.atan2(b[0] - a[0], -(b[1] - a[1])) * 180) / Math.PI;
    const off = at.off || 0;
    at = [x + Math.cos((along * Math.PI) / 180) * off, z + Math.sin((along * Math.PI) / 180) * off];
    if (v.hdg === 'road') hdg = along;
  }
  return { at, hdg: hdg + (v.hdgAdd || 0) };
}

window.__art = async (id, spot, size) => {
  const Wd = size[0];
  const Ht = size[1];
  const kind = (spot.vehicle && spot.vehicle.kind) || 'plane';

  // The right kind of game for the vehicle: the aeroplane's, or the boat's or van's.
  const wantDrive = kind === 'boat' || kind === 'car';
  if (wantDrive) {
    if (sim.mode !== 'drive' || !sim.vehicle || (sim.modeOpts && sim.modeOpts.kind) !== kind) {
      if (sim.state !== 'menu') sim.quitToMenu();
      sim.settings.map = sim.settings.map; // (kept)
      await sim.borrowMapStaged(id);
      sim.startDrive(kind);
    }
  } else if (sim.mode === 'drive') {
    sim.quitToMenu();
    await sim.startMode('free', { time: 'sunset', condition: 'clear', windSpeedKts: 4, windDirDeg: 250, airborne: false, loadingScreen: false });
  }
  if (sim.settings.map !== id) await sim.borrowMapStaged(id);
  sim.weather.setRandomWinds(false);
  sim.weather.load({ time: spot.time || 'sunset', condition: spot.cond || 'clear', windSpeedKts: (spot.wind || [5, 250])[0], windDirDeg: (spot.wind || [5, 250])[1] });
  sim.sky.update(sim.weather);

  const cam = sim.camera;
  sim.renderer.setPixelRatio(1);
  sim.renderer.setSize(Wd, Ht, false);
  cam.aspect = Wd / Ht;
  cam.fov = spot.fov || 50;
  cam.updateProjectionMatrix();
  if (sim.carrier && sim.carrier.group) sim.carrier.group.visible = !!spot.carrier;

  // The vehicle.
  const v = spot.vehicle;
  let P = null;
  let hdg = 0;
  if (v) {
    const r0 = resolve(v);
    v.at = r0.at;
    hdg = r0.hdg;
    if (kind === 'plane') {
      if (!sim.aircraftType || sim.aircraftType.id !== v.id) sim.setAircraft(v.id);
      sim.aircraft.reset({ pos: { x: v.at[0], y: 0, z: v.at[1] }, headingDeg: hdg, speed: v.speed ?? 55, altAGL: v.agl == null ? null : v.agl, engineOn: true });
      sim.aircraft.controls.throttle = 0.6;
      // `y`: an exact height, for open sea (altAGL counts from the sea floor there).
      if (v.y != null) sim.aircraft.pos.y = v.y;
      sim.update(0.02);
      sim.model.visible = true;
      if (sim.cockpit) sim.cockpit.visible = false;
      P = sim.model.position.clone();
      if (v.bank) sim.model.rotateZ(rad(v.bank));
      if (v.pitch) sim.model.rotateX(rad(v.pitch));
    } else {
      sim.vehicle.reset({ pos: new THREE.Vector3(v.at[0], 0, v.at[1]), headingDeg: hdg });
      sim.update(0.05);
      sim.update(0.05);
      P = (sim.vehicleModel ? sim.vehicleModel.position : new THREE.Vector3(v.at[0], 0, v.at[1])).clone();
    }
  }
  // Time for the water, the sky and the clouds to move off their first frame.
  if (!wantDrive) sim.update(0.02);

  const c = spot.cam;
  let look;
  if (c.chase && P) {
    // The camera's own heading (`frame`) if the spot gives one, else the vehicle's.
    const fh = c.frame != null ? c.frame : hdg + (c.frameAdd || 0);
    const f = new THREE.Vector3(Math.sin(rad(fh)), 0, -Math.cos(rad(fh)));
    const r = new THREE.Vector3(Math.cos(rad(fh)), 0, Math.sin(rad(fh)));
    cam.position.copy(P).addScaledVector(f, -(c.back || 30)).addScaledVector(r, c.right || 0);
    cam.position.y += c.up || 0;
    if (c.minAbove != null) cam.position.y = Math.max(cam.position.y, ground(cam.position.x, cam.position.z) + c.minAbove);
    look = P.clone().addScaledVector(f, c.lookFwd || 0).addScaledVector(r, c.lookRight || 0);
    look.y += c.lookUp || 0;
    if (c.lookAt) look.set(c.lookAt[0], c.lookAt[1], c.lookAt[2]);
  } else {
    const f = spot.focus;
    const az = rad(c.az);
    const cx = f[0] + Math.sin(az) * c.dist;
    const cz = f[1] - Math.cos(az) * c.dist;
    cam.position.set(cx, c.alt != null ? c.alt : ground(cx, cz) + (c.up || 60), cz);
    look = new THREE.Vector3(f[0], ground(f[0], f[1]) + (c.lookUp ?? 20), f[1]);
  }
  cam.up.set(0, 1, 0);
  cam.lookAt(look);
  if (c.roll) cam.rotateZ(rad(c.roll));
  cam.updateMatrixWorld();

  // No gameplay furniture in a picture: the guidance rails and the beacon, and the additive light cones
  // (landing and search lights, beacons) that are a metre of shine in play and a green wall at this size.
  if (sim.navGuide && sim.navGuide.setEnabled) sim.navGuide.setEnabled(false);
  if (sim.beacon && sim.beacon.setTarget) sim.beacon.setTarget(null);
  sim.scene.traverse((o) => {
    const m = o.material;
    if (o.isMesh && m && m.blending === THREE.AdditiveBlending && o.geometry && /Cone|Cylinder/.test(o.geometry.type)) o.visible = false;
    if (o.isSpotLight && o.name === 'searchlight_spot') o.visible = false;
  });
  if (spot.haze && sim.scene.fog && sim.scene.fog.density != null) sim.scene.fog.density *= spot.haze;
  sim.sky.update(sim.weather);
  if (sim.renderFrame) sim.renderFrame();
  else sim.renderer.render(sim.scene, cam);
  // Compose it for the screen it goes on: the title, the aircraft's name and the tip sit bottom left, so the
  // subject goes above them (`place`, in percent of the frame; [34, 42] unless the spot says otherwise,
  // `place: null` leaves the camera as aimed). The camera turns, it does not move, so the shot is the same
  // shot with the subject where there is room for it.
  const place = spot.place === undefined ? [34, 42] : spot.place;
  const anchor = spot.anchor ? new THREE.Vector3(spot.anchor[0], spot.anchor[1], spot.anchor[2]) : P ? P.clone() : look.clone();
  if (place) {
    const tanV = Math.tan(rad(cam.fov) / 2);
    const tanH = tanV * cam.aspect;
    const a0 = anchor.clone().project(cam);
    const tx = (place[0] / 100) * 2 - 1;
    const ty = 1 - (place[1] / 100) * 2;
    // Yaw about the world's up (so the horizon stays level), then pitch.
    cam.rotateOnWorldAxis(new THREE.Vector3(0, 1, 0), Math.atan(tx * tanH) - Math.atan(a0.x * tanH));
    cam.rotateX(Math.atan(a0.y * tanV) - Math.atan(ty * tanV));
    cam.updateMatrixWorld();
    if (sim.sky && sim.sky.update) sim.sky.update(sim.weather);
    if (sim.renderFrame) sim.renderFrame();
    else sim.renderer.render(sim.scene, cam);
  }
  // Where the subject (the vehicle, else what the camera is aimed at) is in the picture, in percent: a tall
  // narrow screen shows only a slice of it, and the loading screen centres that slice here.
  const subject = anchor.clone();
  subject.project(cam);
  const focus = [Math.max(0, Math.min(100, Math.round((subject.x * 0.5 + 0.5) * 100))), Math.max(0, Math.min(100, Math.round((1 - (subject.y * 0.5 + 0.5)) * 100)))];
  const url = sim.renderer.domElement.toDataURL('image/jpeg', size[2] || 0.95);
  return { b64: url.split(',')[1], focus };
};
return 1;
