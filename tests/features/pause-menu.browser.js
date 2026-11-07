/**
 * THE NEW FRONT PAGE AND PAUSE CARD (v78; the owner: "new menu screen, new pause
 * screen and unclutter pause screen"). Run in the page, at any size:
 *   - the front page has one Fly button that really takes off, and every
 *     destination the old screen had;
 *   - the pause card is small: the five actions, the Realistic cockpit switch
 *     and More options, on the screen without scrolling, and no folds;
 *   - More options is one tap away, grouped into tabs, and every item that used
 *     to be a fold of its own is in there through menus.addPauseItem and works;
 *   - on a mission the mission comes first and Restart says what it restarts.
 */
export async function check(sim, r, say = () => {}) {
  const menus = sim.menus;
  const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
  const main = menus.screens.main;
  const pause = menus.screens.pause;
  const shown = (n) => !!n && n.getClientRects().length > 0 && getComputedStyle(n).visibility !== 'hidden';
  const onScreen = (n) => { const b = n.getBoundingClientRect(); return b.top >= -1 && b.bottom <= innerHeight + 1 && b.left >= -1 && b.right <= innerWidth + 1; };
  const flyFree = async () => {
    await sim.startMode('free', { loadingScreen: false, airborne: true, aircraft: 'skylark', condition: 'clear', time: 'day', windSpeedKts: 0 });
    if (sim.state === 'paused') sim.resume();
    for (let i = 0; i < 10; i++) { sim.step(1 / 30); await sleep(0); }
  };

  say('the front page');
  menus.setGame('flight');
  menus.show('main');
  await sleep(60);
  const fly = main.querySelector('.fly-now');
  const acts = [...main.querySelectorAll('[data-act]')].map((b) => b.dataset.act);
  r.ok('menu: one Fly button, on the screen without scrolling, and the biggest thing there', shown(fly) && onScreen(fly) && fly.getBoundingClientRect().height >= 76
    && [...main.querySelectorAll('.card-btn')].every((c) => c.getBoundingClientRect().height < fly.getBoundingClientRect().height));
  r.ok('menu: every old destination is still there', ['story', 'tutorial', 'missions', 'free', 'hangar', 'maps', 'multiplayer', 'more', 'settings', 'sound', 'credits'].every((a) => acts.includes(a))
    && !!main.querySelector('[data-fun-open]') && !!main.querySelector('[data-ach-open]') && !!main.querySelector('[data-shoutout]') && !!main.querySelector('[data-fan]'), acts.join(' '));
  r.ok('menu: Fly says what it takes off in, and where', /\S/.test(main.querySelector('[data-fly-craft]').textContent) && /\S/.test(fly.querySelector('[data-map-name]').textContent), fly.textContent.replace(/\s+/g, ' ').trim());
  r.ok('menu: no emoji on the front page', !/\p{Extended_Pictographic}/u.test(main.textContent.replace(/[©→™]/g, '')));
  menus.setGame('heli');
  r.ok('menu: the helicopter front page keeps the Fly button', fly.dataset.act === 'fly-now' && shown(fly));
  menus.setGame('flight');

  say('Fly');
  fly.click();
  for (let i = 0; i < 400 && sim.state !== 'flying'; i++) await sleep(25);
  r.ok('menu: pressing Fly really starts a flight', sim.state === 'flying' && sim.mode === 'free', `${sim.state} ${sim.mode}`);
  sim.quitToMenu('main');
  await sleep(50);

  say('the pause card');
  await flyFree();
  sim.pause();
  await sleep(60);
  const act = (a) => pause.querySelector(`[data-act="${a}"]`);
  const five = ['resume', 'restart', 'settings', 'controls', 'quit'].map(act);
  r.ok('pause: Resume, Restart, Settings, Controls and Quit are all showing, with no scrolling', five.every((b) => shown(b) && onScreen(b)));
  r.ok('pause: no folds left on it', !pause.querySelector('details, .pause-fold'));
  const card = pause.querySelector('[data-pause-card]');
  // A phone on its side lays the same card out wide and short, so it fits with no scrolling.
  r.ok('pause: a small card: at most 8 tappable things showing, and most of the picture still there',
    [...card.querySelectorAll('button')].filter(shown).length <= 8 && (innerHeight <= 460 || card.getBoundingClientRect().width <= Math.min(440, innerWidth)),
    `${[...card.querySelectorAll('button')].filter(shown).length} buttons, ${Math.round(card.getBoundingClientRect().width)} px wide`);
  const real = pause.querySelector('[data-realistic]');
  r.ok('pause: Realistic cockpit is on the card, not behind anything', shown(real) && onScreen(real));
  const on0 = !!sim.settings.realisticCockpit;
  real.click();
  r.ok('pause: ...and it works', !!sim.settings.realisticCockpit === !on0 && /Realistic cockpit: (on|off)/.test(real.textContent));
  real.click();
  r.ok('pause: the HUD does not show through', !shown(sim.hud.wrap.querySelector('.hud-panel')));

  say('More options');
  pause.querySelector('[data-pause-more]').click();
  const tabs = () => [...pause.querySelectorAll('[data-ptab]')].filter((b) => !b.hidden).map((b) => b.dataset.ptab);
  r.ok('pause: More options opens one calm sheet with tabs, the card put away', shown(pause.querySelector('[data-pause-sheet]')) && !shown(card)
    && ['flight', 'world', 'practice'].every((t) => tabs().includes(t)), tabs().join(', '));
  const ids = [...pause.querySelectorAll('[data-pause-item]')].map((n) => n.dataset.pauseItem);
  r.ok('pause: everything that was a fold is an item in the sheet', ['airfield', 'free-look', 'autopilot', 'break', 'disasters', 'runaway', 'traffic', 'targets'].every((i) => ids.includes(i)), ids.join(', '));
  const go = (t) => pause.querySelector(`[data-ptab="${t}"]`).click();
  go('world');
  const tr = pause.querySelector('[data-traffic-toggle]');
  const tr0 = tr.textContent;
  tr.click();
  r.ok('pause: Other aeroplanes still switches', shown(tr) && tr.textContent !== tr0, `${tr0} -> ${tr.textContent}`);
  tr.click();
  const run = pause.querySelector('[data-runaway-toggle]');
  const run0 = run.textContent;
  run.click();
  r.ok('pause: the runaway switch still switches', shown(run) && run.textContent !== run0);
  run.click();
  go('flight');
  const look = pause.querySelector('[data-freelook]');
  const look0 = look.textContent;
  look.click();
  r.ok('pause: Free look still switches', shown(look) && look.textContent !== look0);
  look.click();
  r.ok('pause: the autopilot and its sliders are there', shown(pause.querySelector('[data-apmode]')) && shown(pause.querySelector('[data-apalt]')));
  go('practice');
  const dis = pause.querySelector('[data-natural]');
  r.ok('pause: Break something, Disasters and Targets are on the Practice tab',
    shown(pause.querySelector('[data-trigger]')) && shown(dis) && shown(pause.querySelector('[data-hsk-spawn]')));
  const stay = menus.addPauseItem('runaway');
  r.ok('pause: asking for an item again gives the same box', stay === pause.querySelector('[data-runaway-fold]'));
  const probe = menus.addPauseItem('lane-probe', { group: 'players', title: 'Probe', html: '<button>Probe</button>' });
  menus.syncPauseSheet();
  r.ok('pause: a new item needs one call, and brings its tab with it', !!probe && tabs().includes('players'));
  probe.remove();
  menus.syncPauseSheet();
  r.ok('pause: ...and a tab with nothing in it goes', !tabs().includes('players'));
  pause.querySelector('[data-pause-back]').click();
  r.ok('pause: Back returns to the card', shown(card));

  say('Controls');
  act('controls').click();
  const page = pause.querySelector('[data-pgroup="controls"]');
  const touch = document.documentElement.classList.contains('is-touch-device');
  r.ok('pause: Controls opens over the pause, and the flight stays paused', shown(page) && /\S/.test(page.textContent) && sim.state === 'paused');
  r.ok(`pause: Controls speaks ${touch ? 'touch, no keyboard keys' : 'keys'}`, touch ? /Stick/.test(page.textContent) && !shown(page.querySelector('.cc-more')) : /Shift|W/.test(page.textContent), page.textContent.slice(0, 80));
  pause.querySelector('[data-pause-back]').click();

  say('the Controls card over a flight');
  sim.hud.showControls(sim.input.bindings, (k) => k, sim.helpActions());
  sim.hud.controlsCard.click();
  r.ok('touch: the Controls card closes with a tap', sim.hud.controlsCard.style.display === 'none');

  say('settings and back');
  act('settings').click();
  r.ok('pause: Settings opens', menus.current === 'settings');
  menus.screens.settings.querySelector('[data-back]').click();
  await sleep(40);
  r.ok('pause: ...and Back comes back to the card', menus.current === 'pause' && shown(card));
  act('resume').click();
  r.ok('pause: Resume resumes, and the HUD is back', sim.state === 'flying' && shown(sim.hud.wrap.querySelector('.hud-panel')));

  say('on a mission');
  const list = sim.menus.screens.missions.querySelector('[data-start]');
  const id = list && list.closest('[data-mission]') && list.closest('[data-mission]').dataset.mission;
  if (id) {
    sim.quitToMenu('main');
    await sleep(30);
    await sim.startAnyMission(id);
    for (let i = 0; i < 400 && sim.state !== 'flying'; i++) await sleep(25);
    for (let i = 0; i < 6; i++) { sim.step(1 / 30); await sleep(0); }
    sim.pause();
    await sleep(40);
    const box = pause.querySelector('[data-pause-mission]');
    r.ok('pause: on a mission its name comes first, and what it wants now', shown(box) && /\S/.test(box.querySelector('strong').textContent) && /\S/.test(box.querySelector('em').textContent), box.textContent.replace(/\s+/g, ' ').trim());
    r.ok('pause: ...Restart says Restart mission', /Restart mission/.test(act('restart').textContent));
    r.ok('pause: ...and the five still fit', five.every((b) => shown(b) && onScreen(b)));
    r.ok('pause: ...and there is no practice tab to get lost in', (menus.syncPauseSheet(), !tabs().includes('practice')));
    sim.resume();
  }
  sim.quitToMenu('main');
  await sleep(30);
  await flyFree();
  sim.pause();
  await sleep(30);
  r.ok('pause: back in Free Flight it says plain Restart again', pause.querySelector('[data-pause-mission]').hidden && /^Restart$/.test(act('restart').textContent.trim()));
  sim.resume();
  sim.quitToMenu('main');
}
