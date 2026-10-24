/**
 * Browser checks for the deck — the demo polish of the start screen and the
 * HUD — on the real game. DOM and computed styles only; no screenshots.
 *
 *   const { check } = await import('./tests/features/ui-polish.browser.js');
 *   const r = { checks: [], ok(n, p, d) { this.checks.push({ n, p: !!p, d: String(d || '') }); return !!p; } };
 *   await check(window.__sim, r, console.log);
 *
 * What it proves:
 *   - the start screen's six cards are there, big enough for a finger, with
 *     a 150–250 ms transition and a frosted back;
 *   - html.fx-low (Low quality) takes every backdrop blur off the cards, the
 *     bar and the HUD's panels and leaves them a solid translucent back —
 *     the layout untouched;
 *   - the class follows the quality tier through applySetting();
 *   - the bar's switcher buttons and the credit pill are at least 38 px tall
 *     with a pointer (44 with a finger);
 *   - the HUD panels, the quick buttons and the objective share one radius.
 */

const secs = (v) => String(v || '').split(',').map((s) => parseFloat(s) || 0);
const inRange = (list) => list.length > 0 && list.every((t) => t >= 0.15 && t <= 0.25);
const blurOf = (el) => {
  const cs = getComputedStyle(el);
  return cs.backdropFilter || cs.webkitBackdropFilter || '';
};
const blurred = (el) => /blur/.test(blurOf(el));

export async function check(sim, r, say = () => {}) {
  const menus = sim.menus;
  const main = menus && menus.screens && menus.screens.main;
  if (!main) {
    r.ok('deck: the start screen exists', false, 'no menus.screens.main');
    return;
  }
  const html = document.documentElement;
  const wasLow = html.classList.contains('fx-low');
  const q0 = sim.settings && sim.settings.quality;
  const screen0 = menus.current;
  const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  const need = coarse ? 44 : 38;
  try {
    menus.show('main');
    await new Promise((res) => setTimeout(res, 50));

    // menus.js builds six; plug-ins (the story, the hangar) add their own.
    const cards = [...main.querySelectorAll('.main-nav .card-btn[data-act]')];
    const acts = cards.map((c) => c.dataset.act);
    r.ok('deck: the start screen still has its six cards (plus whatever the plug-ins add)',
      ['tutorial', 'missions', 'free', 'multiplayer', 'maps', 'more'].every((a) => acts.includes(a)), acts.join(', '));
    const core = cards.find((c) => c.dataset.act === 'tutorial') || cards[0];
    const heights = cards.map((c) => Math.round(c.getBoundingClientRect().height));
    r.ok('deck: every card is at least 56 px tall (64 on a phone layout is taller still)', heights.every((h) => h >= 56), heights.join(', '));
    const durs = cards.map((c) => getComputedStyle(c).transitionDuration);
    r.ok('deck: a card\'s hover and press transitions take 150–250 ms', durs.every((d) => inRange(secs(d))), durs[0]);
    const radius = cards.map((c) => parseFloat(getComputedStyle(c).borderRadius));
    r.ok('deck: the cards share one radius from the scale (20 px, 14 on a phone)', radius.every((v) => v === radius[0] && (v === 20 || v === 14)), radius.join(', '));
    const tiles = cards.map((c) => c.querySelector('.card-icon'));
    const tileW = tiles.map((t) => (t ? Math.round(t.getBoundingClientRect().width) : 0));
    r.ok('deck: every card has an icon tile of one size', tiles.every(Boolean) && tileW.every((w) => w === tileW[0] && w >= 36), tileW.join(', '));
    const drawn = cards.map((c) => c.querySelector('.card-icon .icon')).filter(Boolean);
    const drawnW = drawn.map((i) => Math.round(i.getBoundingClientRect().width));
    r.ok('deck: the drawn icons (the set in ui/icons.js) are one size', drawn.length >= 6 && drawnW.every((w) => w === drawnW[0] && w >= 20), drawnW.join(', '));

    // The frosted back, and its Low-quality fallback.
    // setTimeout, not requestAnimationFrame: the test harness swaps rAF out.
    // And longer than the motion scale (250 ms): the glass TRANSITIONS to
    // its new back, so a read 40 ms in sees it half-way.
    html.classList.remove('fx-low');
    await new Promise((res) => setTimeout(res, 320));
    const bar = menus.bar;
    const panel = sim.hud && sim.hud.wrap && sim.hud.wrap.querySelector('.hud-panel');
    // A square dock button, not one of the tray's wide labelled ones.
    const btn = sim.hud && sim.hud.wrap && sim.hud.wrap.querySelector('.hud-buttons > .hud-btn:not(.hud-btn-wide), .hud-btn:not(.hud-btn-wide)');
    const frosted = [core, bar, panel, btn].filter(Boolean);
    const blurOn = frosted.map(blurred);
    r.ok('deck: with blur allowed, the cards, the bar and the HUD panels are frosted glass', blurOn.every(Boolean), blurOn.join(', '));
    const layout0 = cards.map((c) => JSON.stringify(c.getBoundingClientRect()));
    html.classList.add('fx-low');
    await new Promise((res) => setTimeout(res, 320));
    const blurOff = frosted.map(blurred);
    const solid = frosted.map((el) => {
      const m = /rgba?\(([^)]+)\)/.exec(getComputedStyle(el).backgroundColor);
      const a = m ? (m[1].split(',')[3] !== undefined ? parseFloat(m[1].split(',')[3]) : 1) : 0;
      return a >= 0.85 && a < 1;
    });
    const layout1 = cards.map((c) => JSON.stringify(c.getBoundingClientRect()));
    r.ok('deck: html.fx-low takes every backdrop blur off and leaves a solid translucent back', blurOff.every((b) => !b) && solid.every(Boolean), `blur ${blurOff.join(', ')}; solid ${solid.join(', ')}`);
    r.ok('deck: …without moving anything', layout0.join('|') === layout1.join('|'));

    // Low quality must not out-rank the HUD's own states: a lit quick
    // button, high contrast's black, and the see-through engine strip on a
    // touch screen look the same whatever the tier.
    {
      const probe = document.createElement('div');
      probe.style.cssText = 'position:absolute;left:-9999px;top:0;';
      probe.innerHTML = '<div class="hud is-contrast"><div class="hud-panel"></div><div class="hud-toast"></div></div>'
        + '<div class="hud is-touch"><div class="hud-panel hud-bottom"></div></div>'
        + '<button class="hud-btn is-on"></button>';
      document.body.appendChild(probe);
      const els = [...probe.querySelectorAll('.hud-panel, .hud-toast, .hud-btn')];
      const bg = () => els.map((el) => getComputedStyle(el).backgroundColor);
      html.classList.remove('fx-low');
      await new Promise((res) => setTimeout(res, 320));
      const hi = bg();
      html.classList.add('fx-low');
      await new Promise((res) => setTimeout(res, 320));
      const lo = bg();
      probe.remove();
      r.ok('deck: Low quality keeps the HUD\'s states (lit button, high contrast, touch strip)', hi.join('|') === lo.join('|'), `high ${hi.join(', ')} / low ${lo.join(', ')}`);
    }

    // The class follows the tier (syncFxTier is what applySetting('quality')
    // and the Auto probe call; calling it directly spares the world rebuild).
    if (typeof sim.syncFxTier === 'function' && sim.settings && typeof q0 === 'string') {
      sim.settings.quality = 'low';
      sim.syncFxTier();
      const lowOn = html.classList.contains('fx-low');
      sim.settings.quality = q0 === 'low' ? 'medium' : q0;
      sim.syncFxTier();
      const lowOff = !html.classList.contains('fx-low');
      sim.settings.quality = q0;
      sim.syncFxTier();
      r.ok('deck: the Low tier puts html.fx-low on; any other tier takes it off', lowOn && lowOff, `on ${lowOn}, off ${lowOff}`);
    } else {
      r.ok('deck: main.js has syncFxTier()', false, typeof sim.syncFxTier);
    }
    html.classList.toggle('fx-low', wasLow);

    // The bar.
    const tapTargets = bar ? [...bar.querySelectorAll('.switch-btn, .credit-pill')] : [];
    const tapH = tapTargets.map((b) => Math.round(b.getBoundingClientRect().height));
    r.ok(`deck: the bar's switcher and credit pill are at least ${need} px tall`, tapH.length > 0 && tapH.every((h) => h >= need), tapH.join(', '));

    // The HUD shares the scale.
    if (panel && btn) {
      const obj = sim.hud.wrap.querySelector('.hud-objective');
      const rads = [panel, btn, obj].filter(Boolean).map((el) => parseFloat(getComputedStyle(el).borderRadius));
      r.ok('deck: HUD panels, quick buttons and the objective share the 14 px radius', rads.every((v) => v === 14), rads.join(', '));
      // In the menu the HUD is not laid out (display:none up the tree), so
      // its rects are 0: the size comes from the computed CSS instead.
      const cs = getComputedStyle(btn);
      const w = Math.max(parseFloat(cs.width) || 0, parseFloat(cs.minWidth) || 0);
      const hgt = Math.max(parseFloat(cs.height) || 0, parseFloat(cs.minHeight) || 0);
      r.ok('deck: the quick buttons are a finger\'s size', w >= 42 && hgt >= 42, `${w}x${hgt} (${coarse ? 'finger' : 'pointer'})`);
    } else {
      r.ok('deck: the HUD has a panel and a quick button to measure', false, `panel ${!!panel} btn ${!!btn}`);
    }

    // The screen fade: opacity only, off under Reduce motion.
    const anim = getComputedStyle(main).animationName;
    const reduce = html.classList.contains('reduce-motion') || (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    r.ok('deck: a screen arrives with the short fade (none under Reduce motion)', reduce ? anim === 'none' : anim === 'screenIn', `${anim}, reduce ${reduce}`);
  } finally {
    html.classList.toggle('fx-low', wasLow);
    if (screen0 && screen0 !== 'main' && menus.screens[screen0]) menus.show(screen0);
    else if (!screen0) menus.show('main');
  }
}
