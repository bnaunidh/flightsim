/**
 * PAINT PER PLANE IN THE BROWSER (wave 18, owner: "the paint should modify
 * THAT plane, not all of them"). tests/features/plane-paint.mjs does storage,
 * migration and the wire headless; this is the real hangar and game:
 *   - a swatch pressed on plane A paints A (its card, the model in the game if
 *     A is the one you are in) and leaves plane B's swatches on B's own paint;
 *   - the saved settings carry it per type (settings.liveries) and nothing global;
 *   - Free Flight in B wears B's paint, and the Settings paint select follows
 *     the aeroplane you are in.
 */
export async function check(sim, r, say = () => {}) {
  const menus = sim.menus;
  const ui = menus && menus.showcaseUi;
  const $ = (s) => document.querySelector(s);
  const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
  if (!ui) {
    r.ok('plane paint: the showroom is installed', false, 'menus.showcaseUi missing');
    return;
  }
  const P = await import('../../src/core/plane-paint.js');
  const p = sim.prog || menus.prog;
  const saved = p ? { credits: p.credits, unlocked: [...p.unlocked] } : null;
  const liv0 = JSON.stringify(sim.settings.liveries || {});
  const A = 'skylark';
  const B = 'courier';
  try {
    say('plane paint: the hangar');
    p.unlocked = [...new Set([...(p.unlocked || []), A, B])];
    menus.syncProgression && menus.syncProgression(p);
    sim.settings.liveries = {};
    menus.setGame('flight');
    menus.show('hangar');
    if (ui.loading) await ui.loading.catch(() => {});
    for (let i = 0; i < 100 && !ui.showcase && !ui.failed; i++) await sleep(50);
    ui.select(A, 0);
    await sleep(50);
    const swA = [...document.querySelectorAll('[data-hs-swatches] [data-hs-livery]')].find((b) => b.dataset.hsLivery !== 'house');
    r.ok('plane paint: plane A shows paint swatches', !!swA, swA ? swA.dataset.hsLivery : 'none');
    if (!swA) return;
    const paint = swA.dataset.hsLivery;
    swA.click();
    await sleep(30);
    r.ok('plane paint: the swatch paints plane A', P.liveryOf(sim.settings, A) === paint, JSON.stringify(sim.settings.liveries));
    r.ok('plane paint: …and no other plane', Object.keys(sim.settings.liveries).join() === A && !('livery' in sim.settings), JSON.stringify(sim.settings.liveries));
    ui.select(B, 1);
    await sleep(50);
    const onB = document.querySelector('[data-hs-swatches] .hs-swatch.is-on');
    r.ok('plane paint: plane B in the hangar is still on its own colours', !!onB && onB.dataset.hsLivery === 'house', onB ? onB.dataset.hsLivery : 'none');
    ui.select(A, -1);
    await sleep(50);
    const onA = document.querySelector('[data-hs-swatches] .hs-swatch.is-on');
    r.ok('plane paint: back on plane A its paint is still chosen', !!onA && onA.dataset.hsLivery === paint, onA ? onA.dataset.hsLivery : 'none');
    let stored = null;
    try {
      stored = JSON.parse(localStorage.getItem('islandsim.settings.v1') || 'null');
    } catch (e) {
      stored = null;
    }
    r.ok('plane paint: the save holds it per plane, with no global paint', !!stored && stored.liveries && stored.liveries[A] === paint && !('livery' in stored), stored ? JSON.stringify(stored.liveries) : 'no save');

    say('plane paint: free flight in B, then A');
    menus.show('main');
    await sim.startMode('free', { aircraft: B, time: 'day', condition: 'clear', windSpeedKts: 0, windDirDeg: 250 });
    for (let i = 0; i < 5; i++) sim.step(1 / 30);
    const sel = menus.screens.settings && menus.screens.settings.querySelector('[data-set="livery"]');
    r.ok('plane paint: in plane B the Settings paint select shows B\'s paint (house)', sim.aircraftType.id === B && !!sel && sel.value === 'house', `${sim.aircraftType.id} ${sel && sel.value}`);
    const mineB = (await import('../../src/features/mpskin.js')).__test.mine(sim);
    r.ok('plane paint: multiplayer sends B\'s paint while flying B', mineB === 'house', mineB);
    if (sim.quitToMenu) sim.quitToMenu();
    await sim.startMode('free', { aircraft: A, time: 'day', condition: 'clear', windSpeedKts: 0, windDirDeg: 250 });
    for (let i = 0; i < 5; i++) sim.step(1 / 30);
    const mineA = (await import('../../src/features/mpskin.js')).__test.mine(sim);
    r.ok('plane paint: in plane A the select and the wire both say A\'s paint', sim.aircraftType.id === A && !!sel && sel.value === paint && mineA === paint, `${sel && sel.value} ${mineA}`);
    // Settings → Flying → Airline livery repaints the plane you are in, only.
    sim.applySetting('livery', 'house');
    r.ok('plane paint: the Settings select repaints only the plane you are in', P.liveryOf(sim.settings, A) === 'house' && Object.keys(sim.settings.liveries).length === 0, JSON.stringify(sim.settings.liveries));
  } finally {
    if (sim.quitToMenu && sim.state !== 'menu') sim.quitToMenu();
    if (saved) {
      p.credits = saved.credits;
      p.unlocked = saved.unlocked;
      menus.syncProgression && menus.syncProgression(p);
    }
    sim.settings.liveries = JSON.parse(liv0);
  }
}
