/**
 * Does the type fit? Run at each size the game is played at (the page's own
 * viewport): 375x812, 812x375, 667x375, 360x640, 1366x768.
 *
 * On every menu screen and the flight HUD: no text is cut off by its own box,
 * and no text box runs off the screen. A box that scrolls sideways on purpose,
 * or that shortens with an ellipsis on purpose, is not cut off: the first has
 * somewhere to go and the second says so.
 */
export function overflowing(root) {
  const bad = [];
  const W = innerWidth;
  for (const el of root.querySelectorAll('*')) {
    if (!el.getClientRects().length) continue;
    const text = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!text) continue;
    if (el.classList.contains('hud-dest-lbl') || el.classList.contains('sz-new')) continue; // a sliding scale; a corner ribbon
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    const name = `${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} "${el.textContent.trim().slice(0, 28)}"`;
    const clips = cs.overflowX !== 'visible' && cs.textOverflow !== 'ellipsis';
    if (clips && el.scrollWidth > el.clientWidth + 1) bad.push(`${name} cut by ${el.scrollWidth - el.clientWidth}px`);
    // Off the screen, unless something on the way up scrolls sideways.
    if (r.right > W + 1 || r.left < -1) {
      let scrolls = false;
      for (let p = el.parentElement; p; p = p.parentElement) {
        const o = getComputedStyle(p).overflowX;
        if (o === 'auto' || o === 'scroll') scrolls = true;
      }
      if (!scrolls) bad.push(`${name} off the screen by ${Math.round(Math.max(r.right - W, -r.left))}px`);
    }
    // Clipped by a parent that hides its overflow.
    for (let p = el.parentElement, n = 0; p && n < 4; p = p.parentElement, n++) {
      const o = getComputedStyle(p).overflowX;
      if (o === 'hidden' || o === 'clip') {
        const q = p.getBoundingClientRect();
        if (r.right > q.right + 2 && q.width > 10 && cs.textOverflow !== 'ellipsis') bad.push(`${name} past its box by ${Math.round(r.right - q.right)}px`);
        break;
      }
    }
  }
  return [...new Set(bad)];
}

/**
 * The menu sweep (v78). One open screen: nothing tappable under 44 px on a
 * touch screen, no button that cannot be reached (off the sides, or below the
 * bottom of something that does not scroll), no words in a font that is not the
 * game's, and something visible to get out with. Returns what is wrong.
 */
export function sweep(root) {
  const bad = [];
  const touch = window.matchMedia('(pointer: coarse)').matches;
  const H = innerHeight;
  const W = innerWidth;
  const scrollsY = (el) => {
    for (let p = el.parentElement; p; p = p.parentElement) {
      const o = getComputedStyle(p).overflowY;
      if ((o === 'auto' || o === 'scroll') && p.scrollHeight > p.clientHeight + 1) return true;
    }
    return false;
  };
  const say = (el) => `${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} "${el.textContent.trim().slice(0, 24)}"`;
  for (const el of root.querySelectorAll('button, a[href], summary, select, input[type="range"], input[type="checkbox"], input[type="text"]')) {
    if (!el.getClientRects().length || el.disabled) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden') continue;
    if (el.tagName === 'A' && cs.display === 'inline') continue; // a link in a sentence
    const b = el.getBoundingClientRect();
    if (touch && el.type !== 'checkbox' && el.tagName !== 'INPUT' && b.height < 44 - 0.5) bad.push(`${say(el)} only ${Math.round(b.height)} px tall`);
    if (touch && el.tagName !== 'INPUT' && b.width < 44 - 0.5) bad.push(`${say(el)} only ${Math.round(b.width)} px wide`);
    if (b.right > W + 1 || b.left < -1) {
      let side = false;
      for (let p = el.parentElement; p; p = p.parentElement) if (/auto|scroll/.test(getComputedStyle(p).overflowX)) side = true;
      if (!side) bad.push(`${say(el)} off the side`);
    }
    if (b.bottom > H + 1 && !scrollsY(el)) bad.push(`${say(el)} below the screen, and nothing scrolls`);
  }
  const fonts = /Jost|Barlow Condensed|Titillium Web/;
  for (const el of root.querySelectorAll('h1, h2, h3, h4, p, button, a, strong, em, span, label, small, b, li')) {
    if (!el.getClientRects().length || !el.textContent.trim()) continue;
    if (el.closest('[data-brandfont], svg, canvas, kbd, code, .livery-card, .hs-livery, .fleet-art')) continue;
    if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
    const f = getComputedStyle(el).fontFamily;
    if (!fonts.test(f.split(',')[0])) bad.push(`${say(el)} in ${f.split(',')[0]}`);
  }
  return [...new Set(bad)];
}

/** Every screen a player can reach from the menus, for sweep() and overflowing(). */
export async function checkSweep(sim, r, say = () => {}) {
  const menus = sim.menus;
  const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
  const size = `${innerWidth}x${innerHeight}`;
  const look = async (name, root) => {
    say(`sweep: ${name}`);
    await sleep(90);
    const got = [...overflowing(root), ...sweep(root)];
    r.ok(`sweep at ${size}: ${name}`, got.length === 0, got.slice(0, 14).join('; '));
  };
  if (document.fonts && document.fonts.ready) await document.fonts.ready;
  const names = ['main', 'missions', 'free', 'maps', 'more', 'hangar', 'settings', 'credits', 'story', 'story-chapters', 'story-new', 'story-extras', 'story-briefing', 'achievements', 'fun', 'multiplayer', 'lobbies', 'rocket'];
  for (const name of names) {
    if (!menus.screens[name]) continue;
    menus.show(name);
    if (name === 'hangar' && menus.showcaseUi && menus.showcaseUi.loading) await menus.showcaseUi.loading.catch(() => {});
    await look(name, menus.screens[name]);
    // A fold on these lists is one tap: every one of them opens and stays reachable.
    const folds = [...menus.screens[name].querySelectorAll('details:not([open])')].filter((d) => d.getClientRects().length).slice(0, 3);
    if (folds.length) {
      folds.forEach((d) => { d.open = true; });
      await look(`${name} (folds open)`, menus.screens[name]);
      folds.forEach((d) => { d.open = false; });
    }
  }
  menus.show('main');
  await sim.startMode('free', { loadingScreen: false, airborne: true, aircraft: 'skylark', condition: 'clear', time: 'day', windSpeedKts: 0 });
  if (sim.state === 'paused') sim.resume();
  for (let i = 0; i < 10; i++) { sim.step(1 / 30); await sleep(0); }
  sim.pause();
  const pause = menus.screens.pause;
  await look('pause', pause);
  for (const b of pause.querySelectorAll('[data-ptab]')) {
    if (b.hidden) continue;
    menus.openPauseSheet(b.dataset.ptab);
    await look(`pause: ${b.textContent}`, pause);
  }
  menus.closePauseSheet();
  pause.querySelector('[data-act="controls"]').click();
  await look('pause: Controls', pause);
  menus.closePauseSheet();
  sim.resume();
  menus.showDebrief({ title: 'Mission complete', kind: 'good', body: '<p>A fine landing on the centreline, a long way from anything.</p>', actions: [{ label: 'Fly again', primary: true, onClick() {} }, { label: 'Main menu', onClick() {} }] });
  await look('debrief', menus.screens.debrief);
  sim.quitToMenu && sim.quitToMenu();
}

export async function check(sim, r, say = () => {}) {
  const menus = sim.menus;
  const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
  const size = `${innerWidth}x${innerHeight}`;
  if (document.fonts && document.fonts.ready) await document.fonts.ready;
  for (const name of ['main', 'free', 'missions', 'settings', 'more', 'hangar', 'credits', 'maps']) {
    if (!menus.screens[name]) continue;
    say(`type fit: ${name}`);
    menus.show(name);
    if (name === 'hangar' && menus.showcaseUi && menus.showcaseUi.loading) await menus.showcaseUi.loading.catch(() => {});
    await sleep(120);
    const got = overflowing(menus.screens[name]);
    r.ok(`type fit at ${size}: ${name}`, got.length === 0, got.slice(0, 5).join('; '));
  }
  menus.show('main');
  await sim.startMode('free', { loadingScreen: false, airborne: true, aircraft: 'skylark', condition: 'clear', time: 'day', windSpeedKts: 0 });
  if (sim.state === 'paused') sim.resume();
  for (let i = 0; i < 30; i++) {
    sim.step(1 / 30);
    await sleep(0);
  }
  const hud = document.querySelector('.hud') || document.getElementById('ui');
  const got = overflowing(hud);
  r.ok(`type fit at ${size}: the flight HUD`, got.length === 0, got.slice(0, 5).join('; '));
  if (sim.quitToMenu) sim.quitToMenu();
}
