// The Dev console's /give (the owner, 2026-11-08: "a /give command in dev mode i can give myself all planes or a certain plane").
export async function check(sim, r) {
  const DC = await import('../../src/features/dev-console.js');
  const { AIRCRAFT } = await import('../../src/aircraft/types.js');
  const { secrets } = await import('../../src/features/secrets.js');
  const keep = {};
  for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (/^islandsim/.test(k)) keep[k] = localStorage.getItem(k); }
  const was = [...sim.prog.unlocked];
  try {
    secrets.forget();
    sim.prog.unlocked = ['skylark'];
    DC.open(sim);
    const root = document.querySelector('.dcon');
    const input = root.querySelector('[data-dcon-input]');
    const run = (line) => { input.value = line; root.querySelector('[data-dcon-form]').dispatchEvent(new Event('submit', { cancelable: true })); return root.querySelector('[data-dcon-log]').lastChild.textContent; };
    r.ok('give: the console opens, /give in its hint', !root.hidden && /\/give/.test(input.placeholder), input.placeholder);
    let out = run('/give a320');
    r.ok('give: one plane, into progression and saved', sim.prog.unlocked.includes('a320') && /A320/i.test(out) && (JSON.parse(localStorage.getItem('islandsim.progression.v1') || '{}').unlocked || []).includes('a320'), out);
    const sec = AIRCRAFT.find((a) => a.secret && a.id !== 'af1');
    out = run(`/give ${sec.name}`);
    r.ok('give: a secret plane by name, found as if you had found it', sim.prog.unlocked.includes(sec.id) && !!(JSON.parse(localStorage.getItem('islandsim.secrets.v1') || '{}').planes || {})[sec.id], `${sec.name}: ${out}`);
    out = run('/give javelin');
    await DC.__devConsole.pending;
    r.ok('give: the Javelin, earned and in the roster', sim.prog.unlocked.includes('javelin') && AIRCRAFT.some((a) => a.id === 'javelin'), out);
    sim.prog.unlocked = ['skylark'];
    out = run('/give all');
    await DC.__devConsole.pending;
    r.ok('give: all, every plane in the Hangar', AIRCRAFT.every((a) => sim.prog.unlocked.includes(a.id)) && /all \d+ planes/.test(out), out);
    sim.menus.show('free');
    const card = sim.menus.screens.free.querySelector('[data-aircraft="javelin"]');
    r.ok('give: the Javelin has a Free Flight card', !!card, card ? card.dataset.aircraft : 'no card');
    out = run('/give nothing-like-a-plane');
    r.ok('give: an unknown name is a polite error', /No plane/.test(out) && root.querySelector('[data-dcon-log]').lastChild.className === 'err', out);
    DC.close();
  } finally {
    secrets.forget();
    for (const k of Object.keys(keep)) localStorage.setItem(k, keep[k]);
    sim.prog.unlocked = was;
    if (sim.menus.syncFleetLocks) sim.menus.syncFleetLocks();
  }
  return r;
}
