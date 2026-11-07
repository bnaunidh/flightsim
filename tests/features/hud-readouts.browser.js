/**
 * The clock and the stall speed in the real game (features/hud-readouts.js):
 * the owner's "add clock and stall speed too".
 *
 *   const { check } = await import('./tests/features/hud-readouts.browser.js');
 */
const hms = (s) => {
  const [h, m] = s.split(':').map(Number);
  return h * 60 + m;
};
const shown = (sim) => {
  const e = sim.hud.wrap.querySelector('.fc-time');
  return e ? e.textContent : '';
};
const stall = (sim) => {
  const e = sim.hud.wrap.querySelector('.fc-stall');
  return e ? e.textContent : null;
};

export async function check(sim, r) {
  const fly = (aircraft, time = 'day') => sim.startMode('free', { airborne: true, time, condition: 'clear', windSpeedKts: 0, windDirDeg: 90, aircraft });

  await fly('skylark');
  sim.step(0.5);
  const w = sim.weather;
  r.ok('clock: built once, a row of the strip', sim.hud.wrap.querySelectorAll('.hud-left > .fc-row').length === 1);
  r.ok('clock: reads the sim hour', shown(sim).startsWith('12:00'), shown(sim));
  const h0 = w.hour;
  const preset = w.preset;
  sim.step(125, 1 / 4);
  r.ok('clock: it moves, one minute a minute', shown(sim).startsWith('12:02'), shown(sim));
  r.ok('clock: the sun moved with it, in a whole step', Math.abs(w.hour - h0 - 2 / 60) < 1e-6, String(w.hour));
  r.ok('clock: a preset stays a preset (a new map still finds its Midday)', w.preset === preset);

  const elevAt = (h) => {
    w.setHour(h);
    return w.sun.elevDeg;
  };
  let dawn = 0;
  let dusk = 0;
  for (let h = 3; h < 12; h += 1 / 60) if (elevAt(h) >= 0) { dawn = h; break; }
  for (let h = 21; h > 12; h -= 1 / 60) if (elevAt(h) >= 0) { dusk = h; break; }
  w.setHour(dawn);
  sim.step(0.1);
  r.ok('clock: the sun rises at the time it says', Math.abs(hms(shown(sim)) - dawn * 60) <= 1 && Math.abs(w.sun.elevDeg) < 1, `${shown(sim)} ${w.sun.elevDeg.toFixed(2)} deg`);
  w.setHour(dusk);
  sim.step(0.1);
  r.ok('clock: and sets at the time it says', Math.abs(hms(shown(sim)) - dusk * 60) <= 1 && Math.abs(w.sun.elevDeg) < 1 && dusk > 15, `${shown(sim)} ${w.sun.elevDeg.toFixed(2)} deg`);

  sim.hud.setMissionClock(95);
  const a = sim.hud.objectiveClock.getBoundingClientRect();
  const b = sim.hud.wrap.querySelector('.fc-row').getBoundingClientRect();
  r.ok('clock: never on the mission clock', a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top, `${a.top}..${a.bottom} / ${b.top}..${b.bottom}`);
  sim.hud.setMissionClock(null);

  await fly('skylark');
  sim.step(0.6);
  const ac = sim.aircraft;
  const clean = ac.stallKt;
  r.ok('stall: the Skylark clean, beside the airspeed', Math.round(clean) === 49 && stall(sim) === 'stall 49 kt', stall(sim));
  ac.flaps = 1;
  ac.controls.flaps = 1;
  sim.step(0.4);
  r.ok('stall: flaps bring it down', ac.stallKt < clean - 3, String(ac.stallKt));
  await fly('a320');
  sim.step(0.6);
  const air = stall(sim);
  r.ok('stall: not the last aeroplane\'s number after a change', air === 'stall 85 kt', air);
  sim.rig.setMode('cockpit');
  sim.step(1);
  const lo = sim.cockpit.userData;
  r.ok('stall: reaches the PFD', sim.aircraft.stallKt > 80 && lo.family === 'airliner');
  sim.rig.setMode('chase');
  await fly('harrier');
  sim.step(0.6);
  const e = sim.hud.wrap.querySelector('.fc-stall');
  r.ok('stall: nothing on a helicopter', sim.aircraft.stallKt === 0 && (e.textContent === '' || getComputedStyle(e).display === 'none'), JSON.stringify(e.textContent));
  // The owner's "COCKPIT DOESNT EVEN UPDATE": the autopilot windows, a heading that is not 090.
  await fly('a320');
  sim.step(0.5);
  sim.rig.setMode('cockpit');
  sim.step(1.5);
  const ud = sim.cockpit.userData;
  const shownMcp = () => ud.bus && ud.bus.data.shown && ud.bus.data.shown.mcp;
  const a0 = shownMcp();
  r.ok('panel: autopilot off, the windows follow the aeroplane', a0 && Math.abs(a0.alt - sim.aircraft.alt * 3.28084) < 110 && Math.abs(a0.spd - sim.aircraft.ias * 1.94384) < 4, JSON.stringify(a0));
  sim.toggleAutopilot(true);
  sim.step(1.5);
  const a1 = shownMcp();
  r.ok('panel: engaged, the ALT window is the height it holds', a1 && a1.alt === Math.round(sim.autopilot.targetAltFt), JSON.stringify(a1) + ' ' + sim.autopilot.targetAltFt);
  sim.toggleAutopilot(false);
  sim.restart();
  await new Promise((f) => setTimeout(f, 300));
  sim.rig.setMode('cockpit');
  sim.step(1.2);
  const pf = sim.cockpit.userData.bus.data.shown.pfd;
  r.ok('panel: after a restart the PFD reads the new flight', pf && Math.abs(pf.alt - sim.aircraft.alt * 3.28084) < 60 && Math.abs(pf.ias - sim.aircraft.ias * 1.94384) < 5, JSON.stringify(pf));
  sim.rig.setMode('chase');
  await fly('skylark', 'sunset');
  sim.step(0.3);
  r.ok('clock: a Golden Sunset is a sunset hour', hms(shown(sim)) > 15 * 60 && hms(shown(sim)) < 20 * 60, shown(sim));
}
