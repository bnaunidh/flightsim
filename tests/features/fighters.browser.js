/**
 * The wishlist jets in the real game: the real startMode, the real frame
 * loop, the real key path. tests/features/fighters.mjs flies the physics
 * headless in far more detail; this is the part only a page can prove —
 * that main.js builds each of them from the pack, that they sit on the
 * runway, and that T in the F-35B really reaches the hover through the
 * extension layer and back out again.
 */
const IDS = ['f22', 'f35b', 'fa18', 'massimo'];

export async function check(sim, r, say) {
  let Stovl = null;
  let Physics = null;
  try {
    Stovl = await import('../../src/features/stovl.js');
    Physics = await import('../../src/aircraft/physics.js');
  } catch (err) {
    r.ok('fighters: the STOVL module loads', false, String(err && err.message));
  }
  const up = () => { for (const c of ['KeyT', 'KeyW', 'KeyS', 'ShiftLeft', 'ControlLeft']) sim.key(c, false); };
  const calm = { time: 'day', condition: 'clear', windSpeedKts: 0, windDirDeg: 90, airborne: false };

  for (const id of IDS) {
    say(`fighters: ${id} on the runway`);
    up();
    await sim.startMode('free', { ...calm, aircraft: id });
    sim.input.throttleTarget = 0;
    sim.step(2);
    const ac = sim.aircraft;
    const m = sim.model;
    r.ok(`${id} is chosen and drawn by the fleet pack`, sim.aircraftType.id === id && !!(m && m.userData.fleetBridge),
      `${sim.aircraftType.id}, fleet ${!!(m && m.userData.fleetBridge)}`);
    r.ok(`${id} sits on its wheels with no picture offset`, !ac.crashed && ac.onGround && Math.abs(m.userData.groundOffsetY || 0) < 0.05,
      `crashed ${ac.crashed}, onGround ${ac.onGround}, offset ${(m.userData.groundOffsetY || 0).toFixed(3)}`);
  }

  if (!Stovl || !Physics) return;
  const st = Stovl.stovlState();
  say('fighters: F-35B hover through the real key path');
  up();
  await sim.startMode('free', { ...calm, aircraft: 'f35b' });
  sim.step(1);
  const ac = sim.aircraft;
  const x0 = ac.pos.x, z0 = ac.pos.z;
  const full = Physics.SPEC.thrustMax;
  sim.key('KeyT', true);
  sim.key('KeyT', false);
  sim.step(0.2);
  r.ok('T in the F-35B puts the nozzle down', st.mode === 'hover', `mode ${st.mode}`);
  const panel = typeof document !== 'undefined' && document.querySelector('.stovl-panel');
  r.ok('the hover panel and its HOVER button are on screen', !!(panel && panel.classList.contains('is-shown')));
  sim.input.throttleTarget = 1;
  sim.step(7);
  r.ok('it climbs straight up off the runway', !ac.crashed && ac.agl > 15 && Math.hypot(ac.pos.x - x0, ac.pos.z - z0) < 8,
    `${ac.agl.toFixed(1)} m up, ${Math.hypot(ac.pos.x - x0, ac.pos.z - z0).toFixed(1)} m along`);
  let rig = null;
  sim.model.traverse((o) => { if (!rig && o.userData && o.userData.stovlRig) rig = o.userData.stovlRig; });
  r.ok('the model swings its nozzle down and opens the fan door', !!rig && rig.nozzle > 0.95 && rig.doors === 1,
    rig ? `nozzle ${rig.nozzle.toFixed(2)}, doors ${rig.doors}` : 'no rig on the model');
  sim.input.throttleTarget = 0.5;
  sim.step(4);
  const h0 = ac.pos.y;
  sim.step(8);
  r.ok('middle throttle holds the height', !ac.crashed && Math.abs(ac.pos.y - h0) < 1.5, `${(ac.pos.y - h0).toFixed(2)} m in 8 s`);
  sim.input.throttleTarget = 0;
  sim.step(20);
  const td = ac.lastTouchdown;
  r.ok('throttle down lands it gently', !ac.crashed && ac.onGround && !!td && Math.abs(td.vsFpm) < 300,
    td ? `${td.vsFpm} fpm, ${td.quality}` : 'no touchdown');
  sim.key('KeyT', true);
  sim.key('KeyT', false);
  sim.step(3);
  r.ok('T on the ground stows it and gives the thrust back', st.mode === 'off' && Physics.SPEC.thrustMax === full,
    `mode ${st.mode}, thrust ${Physics.SPEC.thrustMax} of ${full}`);

  /*
   * Flying away from a low hover with the lever where the hover put it, in
   * the middle. The first pass sank a 15 m hover into the runway doing this.
   * Once on the keys (the hover moves the lever to full power) and once with
   * the lever held at half, as a finger on the touch slider would, which the
   * hover cannot move.
   */
  for (const held of [false, true]) {
    say(`fighters: F-35B flies away from a 15 m hover, lever ${held ? 'held at half' : 'on the keys'}`);
    up();
    sim.override = null;
    await sim.startMode('free', { ...calm, aircraft: 'f35b' });
    sim.step(1);
    const a = sim.aircraft;
    sim.key('KeyT', true);
    sim.key('KeyT', false);
    sim.input.throttleTarget = 1;
    for (let i = 0; i < 100 && a.agl < 13.5; i++) sim.step(0.1);
    sim.input.throttleTarget = 0.5;
    sim.step(4);
    const y0 = a.pos.y, agl0 = a.agl;
    if (held) sim.override = { throttle: 0.5 };
    sim.key('KeyT', true);
    sim.key('KeyT', false);
    sim.step(0.1);
    const lever = sim.input.throttleTarget;
    let low = y0, handed = null;
    for (let i = 0; i < 90 && !a.crashed; i++) {
      sim.step(0.5);
      low = Math.min(low, a.pos.y);
      if (handed === null && st.mode === 'off') handed = (i + 1) * 0.5;
    }
    sim.override = null;
    r.ok(`the F-35B flies away from a ${agl0.toFixed(0)} m hover without coming down (lever ${held ? 'held at half' : 'on the keys'})`,
      !a.crashed && y0 - low < 1.5 && handed !== null && (held || lever === 1),
      `${a.crashed ? a.crashReason : 'no crash'}, lowest ${(low - y0).toFixed(2)} m, lever ${lever}, handed to the wing after ${handed === null ? '—' : handed + ' s'}, ${Math.round(a.agl)} m up at ${Math.round(a.ias * 1.94384)} kt`);
    r.ok(`and afterwards the thrust is whole (lever ${held ? 'held at half' : 'on the keys'})`, st.mode === 'off' && !st.active && Physics.SPEC.thrustMax === full);
  }

  /*
   * Out of the cockpit. Drive mode keeps state 'flying' and the last
   * aircraftType, and the first pass showed the HOVER panel in the boat and
   * took T from it, putting the parked jet into a hover. Left mid-hover here,
   * which is the worst case: the boat must find the hover off.
   */
  say('fighters: the hover stays with the aeroplane, not the boat');
  up();
  await sim.startMode('free', { ...calm, aircraft: 'f35b' });
  sim.step(0.5);
  sim.key('KeyT', true);
  sim.key('KeyT', false);
  sim.input.throttleTarget = 1;
  sim.step(3);
  const hoveringBefore = st.mode === 'hover';
  await sim.startDrive('boat');
  sim.step(0.5);
  sim.key('KeyT', true);
  sim.key('KeyT', false);
  sim.step(0.5);
  const shownInBoat = !!(panel && panel.classList.contains('is-shown'));
  r.ok('in the boat the hover is off, the HOVER panel is gone and T is not taken',
    hoveringBefore && sim.mode === 'drive' && st.mode === 'off' && !st.active && !shownInBoat
      && !document.body.classList.contains('stovl-hovering') && Physics.SPEC.thrustMax === full,
    `hovering before ${hoveringBefore}, mode ${sim.mode}, hover ${st.mode}, panel shown ${shownInBoat}`);

  // T belongs to the F-35B alone.
  up();
  await sim.startMode('free', { ...calm, aircraft: 'massimo' });
  sim.step(0.5);
  sim.key('KeyT', true);
  sim.key('KeyT', false);
  sim.step(0.2);
  r.ok('T does nothing in an aeroplane that cannot hover', st.mode === 'off' && !(panel && panel.classList.contains('is-shown')));
  up();
  await sim.startMode('free', { ...calm, aircraft: 'skylark' });
  sim.step(0.3);
}
