/**
 * MARINE ONE IN THE BROWSER — the hangar side of the presidential Sea King
 * (tests/features/marine-one.mjs does the rest headless):
 *   - its card is on the Helicopters shelf, locked behind credits (no
 *     passcode, like the President's 747) until it is bought;
 *   - the paint row shows its one fixed scheme, chosen, and tapping it does
 *     not change the game's livery setting;
 *   - Free Flight starts in it on a helipad, in the Heli game, wearing the
 *     Marine One paint whatever livery the game is set to.
 */
export async function check(sim, r, say = () => {}) {
  const menus = sim.menus;
  const ui = menus && menus.showcaseUi;
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
  if (!ui) {
    r.ok('marine one: the showroom is installed', false, 'menus.showcaseUi missing');
    return;
  }
  const p = sim.prog || menus.prog;
  const saved = p ? { credits: p.credits, unlocked: [...p.unlocked] } : null;
  const livery0 = sim.settings ? JSON.stringify(sim.settings.liveries || {}) : undefined;
  try {
    say('marine one: the hangar');
    p.credits = 0;
    p.unlocked = ['skylark', 'courier', 'harrier'];
    menus.syncProgression && menus.syncProgression(p);
    menus.setGame('flight');
    menus.show('hangar');
    if (ui.loading) await ui.loading.catch(() => {});
    for (let i = 0; i < 100 && !ui.showcase && !ui.failed; i++) await sleep(50);
    r.ok('marine one: in the hangar on a fresh profile, on the Helicopters shelf', ui.shown.some((a) => a.id === 'vh3d') && !!$('[data-hs-pick="vh3d"]'),
      ui.shown.some((a) => a.id === 'vh3d') ? 'shown' : 'hidden');
    ui.select('vh3d', 0);
    for (let i = 0; i < 20; i++) menus.drawView(sim.renderer, 1 / 30);
    const sw = $$('[data-hs-swatches] .hs-swatch');
    r.ok('marine one: one paint, its own, shown chosen and not choosable', sw.length === 1 && sw[0].hasAttribute('data-hs-fixed') && !sw[0].hasAttribute('data-hs-livery') && sw[0].classList.contains('is-on')
      && /Marine One/.test($('[data-hs-paint-name]').textContent), `${sw.length} swatch(es), "${$('[data-hs-paint-name]').textContent}"`);
    const before = sim.settings && JSON.stringify(sim.settings.liveries || {});
    if (sw[0]) sw[0].click();
    r.ok('marine one: tapping it leaves the game\'s livery setting alone', !sim.settings || JSON.stringify(sim.settings.liveries || {}) === before, `${before} → ${sim.settings && JSON.stringify(sim.settings.liveries)}`);
    const buy = $('[data-hs-buy]') || $('.hs-buy');
    r.ok('marine one: locked behind credits, like the 747', !!buy && /credits/i.test(buy.textContent) && !/passcode|military/i.test($('[data-hs-msg]').textContent), buy && buy.textContent.trim());

    say('marine one: free flight');
    if (sim.settings) sim.settings.liveries = { ...(sim.settings.liveries || {}), vh3d: 'liberty' };
    await sim.startMode('free', { aircraft: 'vh3d', time: 'day', condition: 'clear', windSpeedKts: 0, windDirDeg: 250 });
    for (let i = 0; i < 20; i++) sim.step(1 / 30);
    const title = sim.model && sim.model.getObjectByName('Titling');
    r.ok('marine one: Free Flight starts in it, in the Heli game, on a pad', sim.state === 'flying' && sim.aircraftType.id === 'vh3d' && sim.menus.currentGame === 'heli' && sim.aircraft.onGround,
      `${sim.state} ${sim.aircraftType && sim.aircraftType.id} ${sim.menus.currentGame}`);
    r.ok('marine one: in its own paint with the game set to an airline\'s', !!title && title.material.map.userData.text === 'UNITED STATES OF AMERICA' && !!sim.model.getObjectByName('Star roundel'));
  } finally {
    if (saved) {
      p.credits = saved.credits;
      p.unlocked = saved.unlocked;
      menus.syncProgression && menus.syncProgression(p);
    }
    if (sim.settings && livery0 !== undefined) sim.settings.liveries = JSON.parse(livery0);
  }
}
