// The Dev console's /time (the owner, 2026-11-08: "add a /time command to set the time of day").
export async function check(sim, r) {
  const DC = await import('../../src/features/dev-console.js');
  sim.autoPauseOnHide = false;
  await sim.startMode('free', { aircraft: 'skylark', airborne: true, taxi: false, time: 'day', condition: 'clear' });
  if (sim.state === 'paused') sim.resume();
  for (let i = 0; i < 10; i++) sim.step(1 / 30);
  const sunUp = () => sim.weather.sun.elevDeg;
  const day = sunUp();
  DC.open(sim);
  const root = document.querySelector('.dcon');
  const input = root.querySelector('[data-dcon-input]');
  const sugg = root.querySelector('[data-dcon-sugg]');
  const run = (line) => { input.value = line; root.querySelector('[data-dcon-form]').dispatchEvent(new Event('submit', { cancelable: true })); return root.querySelector('[data-dcon-log]').lastChild.textContent; };
  input.value = '/time n'; input.dispatchEvent(new Event('input', { bubbles: true }));
  r.ok('time: "/time n" suggests night', /Tab to fill in Night/.test(sugg.textContent), sugg.textContent.slice(0, 80));
  let out = run('/time night');
  for (let i = 0; i < 10; i++) sim.step(1 / 30);
  r.ok('time: /time night, in flight, the sun goes down at once', day > 20 && sunUp() < -5 && sim.weather.time === 'night' && sim.state === 'flying', `${day.toFixed(0)}° → ${sunUp().toFixed(0)}°: ${out}`);
  const free = sim.menus.screens.free;
  r.ok('time: and Free Flight is set to Night', free.querySelector('[data-time]').value === 'night', free.querySelector('[data-time]').value);
  out = run('/time 2pm');
  for (let i = 0; i < 10; i++) sim.step(1 / 30);
  r.ok('time: /time 2pm', Math.abs(sim.weather.hour - 14) < 0.05 && sunUp() > 10 && /14:00/.test(out), `${sim.weather.hour.toFixed(2)}, ${out}`);
  r.ok('time: Free Flight\'s hour slider says 14:00', free.querySelector('[data-hour]').value === '14' && free.querySelector('[data-hourval]').textContent === '14:00' && sim.menus.readFree().hour === 14, free.querySelector('[data-hourval]').textContent);
  out = run('/time morning');
  r.ok('time: /time morning, Free Flight on Morning', sim.weather.hour === 7.5 && free.querySelector('[data-time]').value === 'morning' && sim.menus.readFree().morning, out);
  sim.quitToMenu('main');
  out = run('/time sunset');
  r.ok('time: from the menu, for the next flight', /next flight/.test(out) && free.querySelector('[data-time]').value === 'sunset', out);
  await sim.startMode('free', { ...sim.menus.readFree(), aircraft: 'skylark', airborne: true, taxi: false, loadingScreen: false });
  if (sim.state === 'paused') sim.resume();
  for (let i = 0; i < 10; i++) sim.step(1 / 30);
  r.ok('time: and the next flight is at sunset', sim.weather.time === 'sunset' || (sunUp() > -6 && sunUp() < 10), `${sim.weather.time}, sun ${sunUp().toFixed(1)}°`);
  // Put the Free Flight screen back to the day it was.
  const sel = free.querySelector('[data-time]'); sel.value = 'day'; sel.dispatchEvent(new Event('change', { bubbles: true }));
  DC.close();
  sim.quitToMenu('main');
  return r;
}
