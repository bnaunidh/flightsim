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
