/**
 * The Javelin after a reload (v81): a save that has already earned it (found
 * at Nullspire) comes back with its Free Flight card, and a saved pick of it
 * is the pick again, not the Skylark. No "Secret found" on the way.
 *
 *   node .claude/devtools/briefs/one-check.mjs '<url>/?mute=1' ./tests/features/javelin-reload.browser.js check "" 1
 *
 * The game under test is a second copy in an iframe (as remember-last.browser.js):
 * it shares this page's localStorage and really boots from the seeded save, on
 * the test browser's path and on the player's (?lazyfeatures=1).
 * localStorage is put back afterwards.
 */
const wait = (ms) => new Promise((res) => setTimeout(res, ms));
const SETTINGS = 'islandsim.settings.v1';

async function ready(f) {
  for (let i = 0; i < 1600; i++) {
    const w = f.contentWindow;
    const sim = w && w.__sim;
    if (sim && sim.menus && sim.state === 'menu' && sim._featuresIn) {
      w.requestAnimationFrame = () => 0;
      await wait(150);
      return { w, sim };
    }
    await wait(50);
  }
  throw new Error('the game in the frame never came to its menu');
}

export async function check(sim, r) {
  const Prog = await import('../../src/game/progression.js');
  const snapshot = {};
  for (let i = 0; i < localStorage.length; i++) snapshot[localStorage.key(i)] = localStorage.getItem(localStorage.key(i));
  let f = null;
  try {
    // An earned-Javelin save, with the Javelin picked.
    const p = Prog.load();
    if (!p.unlocked.includes('javelin')) p.unlocked.push('javelin');
    Prog.save(p);
    const s = JSON.parse(localStorage.getItem(SETTINGS) || '{}');
    s.aircraft = 'javelin';
    localStorage.setItem(SETTINGS, JSON.stringify(s));

    const base = location.href.replace(/[?#].*$/, '');
    for (const q of ['?mute=1', '?mute=1&lazyfeatures=1']) {
      if (f) f.remove();
      f = document.createElement('iframe');
      f.style.cssText = 'position:fixed;left:0;top:0;width:1280px;height:800px;z-index:9999;border:0;background:#000';
      f.src = base + q;
      document.body.appendChild(f);
      const { w, sim: g } = await ready(f);
      const free = () => g.menus.screens && g.menus.screens.free;
      let card = null;
      for (let i = 0; i < 100 && !(card && g.menus.chosenAircraft === 'javelin'); i++) {
        card = free() && free().querySelector('[data-aircraft="javelin"]');
        await wait(50);
      }
      const at = `(${q})`;
      r.ok(`javelin reload ${at}: Free Flight has its card`, !!card && !card.classList.contains('is-secret'), card ? card.querySelector('.fleet-name') && card.querySelector('.fleet-name').textContent : 'no card');
      r.ok(`javelin reload ${at}: just one card`, free().querySelectorAll('[data-aircraft="javelin"]').length === 1, String(free().querySelectorAll('[data-aircraft="javelin"]').length));
      r.ok(`javelin reload ${at}: the saved pick is the Javelin again (not the Skylark)`, g.menus.chosenAircraft === 'javelin' && g.settings.aircraft === 'javelin' && !!card && card.classList.contains('is-on'), `chosen ${g.menus.chosenAircraft}, saved ${g.settings.aircraft}`);
      r.ok(`javelin reload ${at}: no "Secret found" banner`, !/Secret found/.test(w.document.body.textContent || ''));
      await g.startMode('free', { loadingScreen: false, airborne: true, aircraft: g.menus.chosenAircraft });
      for (let i = 0; i < 10; i++) g.step(1 / 60);
      r.ok(`javelin reload ${at}: and Free Flight flies it`, g.aircraftType && g.aircraftType.id === 'javelin', g.aircraftType && g.aircraftType.id);
      g.quitToMenu();
    }
  } catch (e) {
    r.ok('javelin reload: the checks ran', false, String((e && e.stack) || e).slice(0, 300));
  } finally {
    if (f) f.remove();
    for (let i = localStorage.length - 1; i >= 0; i--) localStorage.removeItem(localStorage.key(i));
    for (const [k, v] of Object.entries(snapshot)) localStorage.setItem(k, v);
    void sim;
  }
}
