/**
 * WEAK DEVICE + PERFORMANCE MODE, in the page (the Chromebook pass).
 *
 *   node one-check.mjs 'http://127.0.0.1:PORT/?mute=1' ./tests/features/weak-device.browser.js check "" 1
 *
 *   - the Performance mode checkbox is in Settings > Graphics and is big
 *     enough for a finger;
 *   - switching it on makes the game Low: settings, the fx-low class, no
 *     shadow maps, a pixel ratio of 1 or less, the dynamic resolution's
 *     floor at 0.5, Auto off, the checkbox checked;
 *   - switching it off brings the previous tier back and the floor to 0.65;
 *   - with a weak computer forced (?weak=1 is a boot-time flag, so here the
 *     detector is asked directly) the answer is "weak" for a Chromebook.
 */
export const id = 'weak-device';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 8000, every = 50) => { const t = performance.now(); while (performance.now() - t < ms) { try { if (fn()) return true; } catch (e) { /* wait */ } await sleep(every); } return false; };

export async function check(sim, r) {
  const W = await import('../../src/render/weak-device.js');
  const det = W.detectWeakDevice({ ua: 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36', hardwareConcurrency: 2, deviceMemory: 4, renderer: 'ANGLE (Intel, Intel(R) UHD Graphics 600, D3D11)' });
  r.ok('weak-device: a school Chromebook is weak for every reason', det.weak && det.reasons.length === 4, det.reasons.join(','));
  r.ok('weak-device: this browser answered the question at boot', sim.settings.weakDevice !== null && sim.settings.weakDevice !== undefined, JSON.stringify(sim.settings.weakDevice));
  r.ok('weak-device: the GPU name is readable', typeof W.gpuRendererName() === 'string');

  const menus = sim.menus;
  menus.show('settings');
  const tab = menus.screens.settings.querySelector('[data-tab="graphics"]');
  if (tab) tab.click();
  await sleep(50);
  const box = menus.screens.settings.querySelector('input[data-set="performanceMode"]');
  r.ok('weak-device: the Performance mode checkbox is in Settings', !!box);
  if (box) {
    const label = box.closest('label');
    const rect = label ? label.getBoundingClientRect() : box.getBoundingClientRect();
    r.ok('weak-device: ...and its label is finger-sized (>= 40 px tall)', rect.height >= 40, `${Math.round(rect.height)} px`);
  }

  const before = { q: sim.settings.quality, auto: sim.settings.qualityAuto, pm: sim.settings.performanceMode };
  sim.applySetting('performanceMode', true);
  const rebuilt = await until(() => sim.qualityBuilt === 'low', 20000, 100);
  r.ok('weak-device: Performance mode on -> Low is built', rebuilt && sim.settings.quality === 'low' && sim.settings.performanceMode === true && sim.settings.qualityAuto === false, `built=${sim.qualityBuilt} q=${sim.settings.quality}`);
  r.ok('weak-device: ...html.fx-low, no shadow maps, pixel ratio <= 1, floor 0.5', document.documentElement.classList.contains('fx-low') && sim.renderer.shadowMap.enabled === false && sim.renderer.getPixelRatio() <= 1 && sim.dynRes.min === 0.5, `pr=${sim.renderer.getPixelRatio()} min=${sim.dynRes.min}`);
  menus.syncSettings(sim.settings);
  r.ok('weak-device: ...the checkbox shows it', !box || box.checked === true);
  r.ok('weak-device: ...and the detail select shows Low', (menus.screens.settings.querySelector('select[data-set="quality"]') || {}).value === 'low');

  // Off again: back to what it was. (Auto would probe; a tier rebuilds.)
  sim.settings.performanceModePrev = 'high';
  sim.applySetting('performanceMode', false);
  const back = await until(() => sim.qualityBuilt === 'high', 20000, 100);
  r.ok('weak-device: Performance mode off -> the old tier is back', back && sim.settings.performanceMode === false && sim.settings.quality === 'high' && sim.dynRes.min === 0.65, `built=${sim.qualityBuilt} min=${sim.dynRes.min}`);
  r.ok('weak-device: ...and the pixel ratio follows the tier again', sim.renderer.getPixelRatio() >= 1);

  // Choosing a tier above Low in the select is a way out too.
  sim.applySetting('performanceMode', true);
  await until(() => sim.qualityBuilt === 'low', 20000, 100);
  sim.applySetting('quality', 'medium');
  await until(() => sim.qualityBuilt === 'medium', 20000, 100);
  r.ok('weak-device: picking Medium leaves Performance mode', sim.settings.performanceMode === false && sim.settings.quality === 'medium');

  // Leave the page as the suites expect it.
  const flyTab = menus.screens.settings.querySelector('[data-tab="flight"]');
  if (flyTab) flyTab.click();
  sim.applySetting('quality', before.q);
  await until(() => sim.qualityBuilt === before.q, 20000, 100);
  sim.settings.qualityAuto = before.auto;
  menus.show('main');
}
