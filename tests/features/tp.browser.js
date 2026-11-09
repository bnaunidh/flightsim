// The Dev console's /tp and its Tab suggestions (the owner, 2026-11-08: "and a /tp command (it will all show things like press tab to fill in this airport").
export async function check(sim, r, say) {
  const DC = await import('../../src/features/dev-console.js');
  const wait = (ms) => new Promise((res) => setTimeout(res, ms));
  sim.autoPauseOnHide = false;
  for (let i = 0; i < 200 && !sim.worldPreview; i++) await wait(50);
  DC.open(sim);
  const root = document.querySelector('.dcon');
  const input = root.querySelector('[data-dcon-input]');
  const sugg = root.querySelector('[data-dcon-sugg]');
  const type = (t) => { input.value = t; input.dispatchEvent(new Event('input', { bubbles: true })); };
  const key = (k, shift = false) => input.dispatchEvent(new KeyboardEvent('keydown', { key: k, shiftKey: shift, bubbles: true, cancelable: true }));
  const submit = () => root.querySelector('[data-dcon-form]').dispatchEvent(new Event('submit', { cancelable: true }));
  const near = (x, z, m) => sim.aircraft && Math.hypot(sim.aircraft.pos.x - x, sim.aircraft.pos.z - z) < m;

  r.ok('tp: opening shows the commands to pick from', !sugg.hidden && /\/tp|tp/.test(sugg.textContent) && /Tab to fill in/.test(sugg.textContent), sugg.textContent.slice(0, 120));
  type('/t');
  key('Tab');
  r.ok('tp: /t then Tab is /tp, and the places show', input.value === '/tp ' && /Nullspire/.test(sugg.textContent) && /World Map airport/.test(sugg.textContent), `"${input.value}" ${sugg.textContent.slice(0, 80)}`);
  type('/tp hav');
  r.ok('tp: "/tp hav" shows "Tab to fill in Haven International"', /Tab to fill in Haven International/.test(sugg.textContent) && sugg.querySelector('.dcon-s.is-on b').textContent === 'XHVN', sugg.textContent.slice(0, 120));
  key('Tab');
  r.ok('tp: Tab fills in the airport', input.value === '/tp XHVN', input.value);
  type('/tp s');
  key('Tab');
  const first = input.value;
  key('Tab');
  const second = input.value;
  key('Tab', true);
  r.ok('tp: Tab again is the next one, Shift+Tab back', first !== second && input.value === first && /^\/tp \S+$/.test(second), `${first} → ${second} → ${input.value}`);
  type('/tp kest');
  const btn = [...sugg.querySelectorAll('[data-dcon-fill]')].find((b) => b.dataset.dconFill === '/tp kestrel');
  const tall = btn ? parseFloat(getComputedStyle(btn).minHeight) : 0;
  if (btn) btn.click();
  r.ok('tp: a tap on a suggestion fills it in (the iPad\'s Tab)', !!btn && input.value === '/tp kestrel' && tall >= 36, `${input.value}, ${tall} px`);

  // To a World Map field.
  say && say('tp: to XHVN');
  type('/tp XHVN');
  submit();
  r.ok('tp: the console steps aside for the flight', root.hidden);
  let done = await Promise.race([DC.__devConsole.pending, wait(120000).then(() => 'timeout')]);
  const haven = sim.worldPreview.airports().find((a) => a.code === 'XHVN');
  r.ok('tp: on the World Map at Haven International, flying', done === true && sim.worldPreview.active() && sim.mode === 'free' && near(haven.x, haven.z, 6000), `${done}, map ${sim.settings.map}, at ${sim.aircraft.pos.x.toFixed(0)}, ${sim.aircraft.pos.z.toFixed(0)}`);
  const log = () => root.querySelector('[data-dcon-log]').lastChild.textContent;
  r.ok('tp: and says so', /Teleported to Haven International/.test(log()), log());

  // Another field on the World Map.
  say && say('tp: to XTRN');
  DC.open(sim, '/tp tern');
  submit();
  done = await Promise.race([DC.__devConsole.pending, wait(120000).then(() => 'timeout')]);
  const tern = sim.worldPreview.airports().find((a) => a.id === 'tern');
  r.ok('tp: to another World Map field by its id', done === true && near(tern.x, tern.z, 6000), `${done}, at ${sim.aircraft.pos.x.toFixed(0)}, ${sim.aircraft.pos.z.toFixed(0)}`);

  // A spot on the World Map.
  DC.open(sim, '/tp 9km 4km');
  submit();
  done = await Promise.race([DC.__devConsole.pending, wait(120000).then(() => 'timeout')]);
  r.ok('tp: a spot on the World Map, in the air near it', done === true && sim.state === 'flying' && !sim.aircraft.onGround && near(9000, 4000, 8000), `${done}, at ${sim.aircraft.pos.x.toFixed(0)}, ${sim.aircraft.pos.z.toFixed(0)}`);

  // Another map.
  say && say('tp: to kestrel');
  DC.open(sim, '/tp kestrel');
  submit();
  done = await Promise.race([DC.__devConsole.pending, wait(120000).then(() => 'timeout')]);
  r.ok('tp: another map, Free Flight there', done === true && sim.settings.map === 'kestrel' && !sim.worldPreview.active() && sim.mode === 'free' && !!sim.aircraft, `${done}, map ${sim.settings.map}, mode ${sim.mode}`);

  // In the air on an ordinary map: moved as you fly.
  await sim.startMode('free', { aircraft: 'skylark', airborne: true, taxi: false });
  if (sim.state === 'paused') sim.resume();
  for (let i = 0; i < 10; i++) sim.step(1 / 30);
  const y0 = sim.aircraft.pos.y;
  DC.open(sim, '/tp 1500 -800');
  submit();
  r.ok('tp: in the air on a map, moved there and not into the ground', near(1500, -800, 5) && sim.aircraft.pos.y >= y0 - 1 && /Moved to 1500, -800/.test(log()), `${sim.aircraft.pos.x.toFixed(0)}, ${sim.aircraft.pos.z.toFixed(0)}`);
  for (let i = 0; i < 30; i++) sim.step(1 / 30);
  r.ok('tp: and still flying after', sim.state === 'flying' && !sim.aircraft.crashed);
  DC.close();
  return r;
}
