/**
 * HOLIDAY DECORATIONS, in the page (features/festive.js).
 *
 *   node one-check.mjs 'http://127.0.0.1:PORT/?mute=1' ./tests/features/festive.browser.js check "" 1
 *
 *   - off by default before December (unless ?festive=1);
 *   - Settings → Graphics → On builds one tree and the lights at the home
 *     field, standing on the ground by the terminal;
 *   - Off hides them again; the select is finger-sized.
 */
export const id = 'festive';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 8000, every = 50) => { const t = performance.now(); while (performance.now() - t < ms) { try { if (fn()) return true; } catch (e) { /* wait */ } await sleep(every); } return false; };

export async function check(sim, r) {
  const F = await import('../../src/features/festive.js');
  const T = await import('../../src/world/terrain.js');
  const before = sim.settings.festive;
  const dbg0 = F.festiveDebug();
  const today = F.inSeason(new Date());
  r.ok('festive: down before December unless asked', dbg0.forced || today || !dbg0.visible, JSON.stringify(dbg0));

  sim.menus.show('settings');
  const tab = sim.menus.screens.settings.querySelector('[data-tab="graphics"]');
  if (tab) tab.click();
  await sleep(50);
  const sel = sim.menus.screens.settings.querySelector('select[data-set="festive"]');
  r.ok('festive: the Holiday decorations picker is in Settings → Graphics', !!sel);
  if (sel) r.ok('festive: ...finger-sized (>= 40 px tall)', sel.getBoundingClientRect().height >= 40, `${Math.round(sel.getBoundingClientRect().height)} px`);
  sim.menus.show('main');

  sim.applySetting('festive', 'on');
  sim.settings.festive = 'on';
  // In the menu the feature hooks wait for the flight (startMode); ask it now.
  F.festiveDebug().refresh(sim);
  const up = await until(() => F.festiveDebug().visible, 4000);
  const d = F.festiveDebug();
  r.ok('festive: On puts up one tree and the lights', up && d.stats.trees === 1 && d.stats.bulbs > 120, JSON.stringify(d.stats));
  let tree = null;
  sim.scene.traverse((o) => { if (o.name === 'Holiday tree') tree = o; });
  if (tree) {
    const g = T.groundHeightAt(tree.position.x, tree.position.z);
    r.ok('festive: the tree stands on the ground', Math.abs(tree.position.y - g) < 0.5, `y ${tree.position.y.toFixed(1)} ground ${g.toFixed(1)}`);
  } else r.ok('festive: the tree is in the scene', false);
  let lights = null;
  sim.scene.traverse((o) => { if (o.name === 'Holiday lights') lights = o; });
  r.ok('festive: every bulb is one draw, and nothing is NaN', !!lights && !Array.from(lights.geometry.attributes.position.array).some((v) => !Number.isFinite(v)));

  sim.settings.festive = 'off';
  sim.applySetting('festive', 'off');
  F.festiveDebug().refresh(sim);
  const down = await until(() => !F.festiveDebug().visible, 4000);
  r.ok('festive: Off takes them down', down || F.festiveDebug().forced);
  sim.settings.festive = before || 'auto';
}
