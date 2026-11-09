/**
 * THE iPAD CLASS DEMO (2026-11-10): what Safari on a school iPad does
 * differently, checked in the page.
 *
 *   node one-check.mjs 'http://127.0.0.1:PORT/?mute=1' ./tests/features/ipad-demo.browser.js check "" 1
 *
 *   - an iPad says it is a Mac (Macintosh UA, five touch points): the weak-device
 *     detector still answers "ios", and a real Mac with no touch is not weak;
 *   - the touch HUD forbids text selection and the long-press callout (a thumb
 *     held on the stick or a pad must not start selecting the readouts);
 *   - with the touch class on the root, every Settings picker, the Find box and
 *     the Dev console's input are 16 px text — iPad Safari zooms the whole page
 *     into any select or text box smaller than that the moment it is tapped,
 *     and does not zoom back out;
 *   - the Find box, the Dev console's input, the game switcher's icon-only
 *     buttons, the smoke chip and the master warning lamps are 44 px targets
 *     on a touch device;
 *   - the helicopter's "Press I to start the engine." reads as a tap.
 *
 * `check(sim, r, say)` — r.ok(name, pass, detail) per assertion.
 */
export const id = 'ipad-demo';

const IPAD_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shown = (n) => !!n && !n.hidden && n.getClientRects().length > 0 && n.getBoundingClientRect().width > 1;
const fontPx = (n) => parseFloat(getComputedStyle(n).fontSize);

export async function check(sim, r, say) {
  const log = (m) => { if (say) say(`ipad: ${m}`); };

  /* ---- the detector ---- */
  const W = await import('../../src/render/weak-device.js');
  const ipad = W.detectWeakDevice({ ua: IPAD_UA, hardwareConcurrency: 8, deviceMemory: null, renderer: 'Apple GPU', touchPoints: 5 });
  r.ok('ipad: an iPad (a Macintosh UA with five touch points) is weak for the reason "ios"', ipad.weak && ipad.reasons.includes('ios'), ipad.reasons.join(','));
  const mac = W.detectWeakDevice({ ua: IPAD_UA, hardwareConcurrency: 8, deviceMemory: null, renderer: 'Apple M1', touchPoints: 0 });
  r.ok('ipad: a Mac with the same UA and no touch is not weak', !mac.weak, mac.reasons.join(',') || 'not weak');

  /* ---- the stylesheet's words (Chrome drops -webkit-touch-callout from the CSSOM, so read the text) ---- */
  let css = '';
  try {
    css = await (await fetch(new URL('../../styles/main.css', import.meta.url))).text();
  } catch (e) {
    css = '';
  }
  r.ok('ipad: the stylesheet is readable', css.length > 1000, `${css.length} chars`);
  r.ok('ipad: the touch HUD and the touch layer forbid text selection and the long-press callout',
    /\.hud\.is-touch, \.touch-layer \{[^}]*-webkit-user-select: none;[^}]*-webkit-touch-callout: none;/.test(css));
  r.ok('ipad: the game switcher\'s icon-only buttons (coarse pointer) are at least 44 px wide',
    /\.switcher button:where\(\.switch-btn\) \{ padding: 9px 11px; min-width: 44px;/.test(css));
  const inlineCss = [...document.querySelectorAll('style')].map((s) => s.textContent).join('\n');
  r.ok('ipad: the smoke chip is a 44 px target on a touch device', /\.is-touch-fun \.fun-smoke \{ min-height: 44px;/.test(inlineCss));
  r.ok('ipad: the master warning lamps are 44 px targets on a touch device', /html\.is-touch-device \.wx-lamp \{ min-height: 44px; \}/.test(inlineCss));

  /* ---- computed, with the touch class on the root ---- */
  const html = document.documentElement;
  const hadTouch = html.classList.contains('is-touch-device');
  html.classList.add('is-touch-device');
  const menus = sim.menus;
  let DC = null;
  try {
    log('settings pickers');
    menus.show('settings');
    const settings = menus.screens.settings;
    const tabs = [...settings.querySelectorAll('[data-tab]')];
    const sizes = [];
    let selects = 0;
    for (const tab of tabs.length ? tabs : [null]) {
      if (tab) tab.click();
      await sleep(30);
      for (const sel of settings.querySelectorAll('select')) {
        if (!shown(sel)) continue;
        selects++;
        const fs = fontPx(sel);
        if (fs < 16) sizes.push(`${sel.dataset.set || sel.name || 'select'}:${fs}px`);
      }
    }
    r.ok('ipad: every Settings picker is 16 px text on a touch device (smaller and Safari zooms the page)', selects > 0 && sizes.length === 0, sizes.join(', ') || `${selects} pickers`);
    const firstTab = settings.querySelector('[data-tab="flight"]') || tabs[0];
    if (firstTab) firstTab.click();

    log('the Find box');
    menus.show('missions');
    await sleep(30);
    const find = menus.screens.missions.querySelector('.cat-search');
    const findInput = find && find.querySelector('input');
    r.ok('ipad: the missions board\'s Find box is 44 px tall with 16 px text', !!find && shown(find) && find.getBoundingClientRect().height >= 44 && !!findInput && fontPx(findInput) >= 16,
      find ? `${Math.round(find.getBoundingClientRect().height)} px, ${findInput ? fontPx(findInput) : '?'} px text` : 'no Find box');

    log('the hangar\'s boxes');
    menus.show('hangar');
    await sleep(30);
    const small = [];
    let seen = 0;
    for (const inp of menus.screens.hangar.querySelectorAll('input[type="text"], input[type="search"], select')) {
      if (!shown(inp)) continue;
      seen++;
      if (fontPx(inp) < 16) small.push(`${inp.getAttribute('aria-label') || inp.placeholder || inp.tagName}:${fontPx(inp)}px`);
    }
    r.ok('ipad: the hangar\'s Find box and Sort picker are 16 px text', seen > 0 && small.length === 0, small.join(', ') || `${seen} boxes, all 16 px or more`);

    log('the Dev console');
    DC = await import('../../src/features/dev-console.js');
    DC.open(sim);
    const dcon = document.querySelector('[data-dcon-input]');
    r.ok('ipad: the Dev console\'s input is 16 px text and 44 px tall', !!dcon && fontPx(dcon) >= 16 && dcon.getBoundingClientRect().height >= 44,
      dcon ? `${fontPx(dcon)} px text, ${Math.round(dcon.getBoundingClientRect().height)} px tall` : 'no console input');
  } finally {
    if (DC) DC.close();
    if (!hadTouch) html.classList.remove('is-touch-device');
    menus.show('main');
  }

  /* ---- the words ---- */
  const TW = await import('../../src/ui/touch-words.js');
  const line = TW.touchWording('Press I to start the engine.');
  r.ok('ipad: the helicopter\'s "Press I to start the engine." reads as a tap on a tablet', !TW.hasKeyWords(line) && /ENGINE/.test(line), line);
}
