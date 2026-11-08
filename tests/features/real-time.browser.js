// Free Flight's "Real time (your clock)" (the owner: "let time for off irl time in the free flight").
export async function check(sim, r) {
  const m = sim.menus; m.show('free');
  const s = m.screens.free; const sel = s.querySelector('[data-time]');
  r.ok('rt: option there', [...sel.options].some((o) => o.value === 'real'));
  sel.value = 'real'; sel.dispatchEvent(new Event('change', { bubbles: true }));
  r.ok('rt: slider says your clock', s.querySelector('[data-hourval]').textContent === 'your clock', s.querySelector('[data-hourval]').textContent);
  const c = m.readFree(); const d = new Date(); const want = d.getHours() + d.getMinutes() / 60;
  r.ok('rt: setup has the clock hour', c.realTime && Math.abs(c.hour - want) < 0.05 && ['day','sunset','night'].includes(c.time), JSON.stringify({h: c.hour, t: c.time}));
  await sim.startMode('free', { ...c, loadingScreen: false, airborne: true });
  for (let i = 0; i < 10; i++) sim.step(1 / 30);
  r.ok('rt: weather hour is the clock', Math.abs(sim.weather.hour - want) < 0.1, `${sim.weather.hour.toFixed(2)} vs ${want.toFixed(2)}`);
  sim.quitToMenu('main'); m.show('free');
  r.ok('rt: still Real time after a flight', s.querySelector('[data-time]').value === 'real', s.querySelector('[data-time]').value);
  const hr = s.querySelector('[data-hour]'); hr.value = 9; hr.dispatchEvent(new Event('input', { bubbles: true }));
  r.ok('rt: dragging the hour leaves Real time', sel.value !== 'real' && m.readFree().hour === 9 && !m.readFree().realTime);
  sel.value = 'real'; sel.dispatchEvent(new Event('change', { bubbles: true }));
  return r;
}
