/**
 * Node checks for the deck — the demo polish of the start screen and the HUD
 * (styles/main.css, "The deck — demo polish"). Run from the repo root:
 *
 *   node tests/features/ui-polish.mjs
 *
 * What it proves, from the files alone (no browser):
 *   1. The tokens exist on :root — glass, radius, spacing, motion — and the
 *      polish section uses them rather than new literals.
 *   2. Every transition and animation the section writes is 150–250 ms.
 *   3. html.fx-low turns every backdrop blur under the interface off (a
 *      blanket !important rule) and gives the glass a solid back; main.js
 *      toggles that class at start-up, from Settings and after the Auto
 *      probe, and the renderer still reads `settings.quality` (no feature
 *      moved).
 *   4. Touch: a coarse-pointer rule puts every tappable control at 44 px.
 *   5. Phones: a portrait rule (max-width) and a landscape rule (max-height)
 *      both reshape the start screen.
 *   6. The screen fade is opacity only (nothing a test measures moves) and
 *      is off under Reduce motion.
 *   7. No markup or keybind changed: menus.js still builds the same six
 *      start-screen cards with the same data-act values.
 */
import { readFileSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');
const css = read('styles/main.css');
const mainJs = read('src/main.js');
const menusJs = read('src/ui/menus.js');

let passed = 0;
let failed = 0;
const ok = (name, pass, detail = '') => {
  if (pass) passed++;
  else failed++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

// The banner, not the :root comment that points at it.
const start = css.lastIndexOf('The deck — demo polish (');
ok('the polish section exists, after everything it overrides', start > css.length / 2, `at ${start} of ${css.length}`);
const deck = start >= 0 ? css.slice(start) : '';
const rootBlock = (css.match(/:root \{[\s\S]*?\n\}/) || [''])[0];

/* ---- 1. tokens ---- */
const tokens = ['--glass', '--glass-strong', '--glass-hud', '--glass-solid', '--glass-line', '--glass-hi', '--r-1', '--r-2', '--r-3',
  '--sp-1', '--sp-2', '--sp-3', '--sp-4', '--sp-5', '--sp-6', '--dur-1', '--dur-2', '--dur-3', '--ease'];
const missing = tokens.filter((t) => !new RegExp(`${t.replace(/-/g, '\\-')}:`).test(rootBlock));
ok('every deck token is defined on :root', missing.length === 0, missing.join(', ') || `${tokens.length} tokens`);
ok('the radius scale is 10 / 14 / 20 and the motion scale 150 / 200 / 250 ms',
  /--r-1: 10px/.test(rootBlock) && /--r-2: 14px/.test(rootBlock) && /--r-3: 20px/.test(rootBlock)
  && /--dur-1: 150ms/.test(rootBlock) && /--dur-2: 200ms/.test(rootBlock) && /--dur-3: 250ms/.test(rootBlock));
const literalRadii = [...deck.matchAll(/border-radius:\s*([^;]+);/g)].map((m) => m[1].trim()).filter((v) => !/var\(--r-[123]\)|999px/.test(v));
ok('the section sets radii from the scale only (999px pills aside)', literalRadii.length === 0, literalRadii.join(', ') || 'all tokens');
const literalDur = [...deck.matchAll(/transition[^;]*;|animation:[^;]*;/g)].map((m) => m[0]).filter((v) => /\d+m?s\b/.test(v) && !/var\(--dur-[123]\)/.test(v));
ok('every transition and animation in the section takes its time from the motion scale', literalDur.length === 0, literalDur.join(' | ') || 'all tokens');

/* ---- 2. 150–250 ms ---- */
const durs = [...rootBlock.matchAll(/--dur-\d: (\d+)ms/g)].map((m) => +m[1]);
ok('the motion scale sits inside 150–250 ms', durs.length === 3 && durs.every((d) => d >= 150 && d <= 250), durs.join(', '));

/* ---- 3. Low quality ---- */
ok('html.fx-low kills every backdrop blur under the interface, with !important',
  /html\.fx-low \.ui-root \*[\s\S]*?backdrop-filter: none !important;[\s\S]*?-webkit-backdrop-filter: none !important;/.test(deck));
ok('…and gives the glass a solid translucent back instead (by swapping the tokens)',
  /html\.fx-low \{[^}]*--glass: var\(--glass-solid\);[^}]*--glass-hud: var\(--glass-solid\);/.test(deck) && /--glass-solid: rgba\(10, 17, 30, 0\.9/.test(rootBlock));
// A plain `html.fx-low .hud-btn { background }` out-ranks .hud-btn.is-on,
// :hover, .hud.is-contrast .hud-panel and .hud.is-touch .hud-bottom — on Low a
// lit button went dark and phones grew a dark bottom bar. Backgrounds under
// fx-low may only come from the tokens or through :where().
{
  const heavy = [];
  for (const m of deck.replace(/^[\s\S]*?\*\//, "").replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]*html\.fx-low[^{}]*)\{([^}]*)\}/g)) {
    if (!/(^|[;\s])background(-color)?\s*:/.test(m[2])) continue;
    for (const sel of m[1].split(/,(?![^(]*\))/).map((x) => x.trim()).filter(Boolean)) {
      if (!/^html\.fx-low :where\(/.test(sel) && !/^html\.fx-low \.menu-layer$/.test(sel)) heavy.push(sel);
    }
  }
  ok('Low quality never out-ranks a HUD state rule (no heavy fx-low background selector)', heavy.length === 0, heavy.join(' | '));
}
const fxSites = (mainJs.match(/this\.syncFxTier\(\)/g) || []).length;
ok('main.js toggles html.fx-low at start-up, from Settings and after the Auto probe', fxSites >= 3 && /classList\.toggle\('fx-low', this\.settings\.quality === 'low'\)/.test(mainJs), `${fxSites} call sites`);
ok('the renderer still reads settings.quality as before (the class is a mirror, not a move)', /shadowMap\.enabled = this\.settings\.quality !== 'low'/.test(mainJs));

/* ---- 4. Touch ---- */
const coarse = deck.match(/@media \(pointer: coarse\) \{[\s\S]*?\n\}/);
ok('a coarse-pointer rule puts the tappable controls at 44 px', !!coarse && /min-height: 44px/.test(coarse[0])
  && ['.ghost', 'button.primary', '.tab', '.hud-btn', '.switch-btn', '.card-btn'].every((s) => coarse[0].includes(s)));

/* ---- 5. Phones ---- */
ok('a portrait phone rule (max-width) reshapes the start screen: one column of cards',
  /@media \(max-width: 620px\) \{[\s\S]*?\.screen-main \.main-nav \{ grid-template-columns: 1fr;/.test(deck));
ok('a landscape phone rule (max-height) reshapes it too: two across, the mark gone',
  /@media \(max-height: 460px\) \{[\s\S]*?\.screen-main \.brand-mark \{ display: none; \}[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/.test(deck));

/* ---- 6. The screen fade ---- */
const kf = deck.match(/@keyframes screenIn \{([^}]*\}[^}]*)\}/);
ok('the screen fade is opacity only', !!kf && /opacity/.test(kf[1]) && !/transform|translate|scale/.test(kf[1]), kf ? kf[1].trim() : 'no keyframes');
ok('…and off under Reduce motion', /html\.reduce-motion \.menu-layer > \.screen:not\(\[hidden\]\) \{ animation: none; \}/.test(deck));

/* ---- 7. No feature changed ---- */
const main = menusJs.slice(menusJs.indexOf('buildMain() {'), menusJs.indexOf('buildMaps() {'));
const acts = [...main.matchAll(/class="card-btn" data-act="([a-z-]+)"/g)].map((m) => m[1]);
ok('the start screen still builds the same six cards, in the same order',
  acts.join(',') === 'tutorial,missions,free,multiplayer,maps,more', acts.join(', '));
ok('the polish is styles only: no new element, class hook or key in menus.js for it', !/fx-low|deck-/.test(menusJs));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
