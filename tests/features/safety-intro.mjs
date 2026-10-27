/**
 * Node checks for the first-run intro and photosensitive seizure warning
 * (src/ui/safety-intro.js). Run from anywhere:
 *
 *   node tests/features/safety-intro.mjs [--verbose]
 *
 * The owner, 2026-10-26: "when u login for the first time it should have a
 * cool loading screen and say at the end 'Possible Seizure Warning'".
 *
 *   1. WHEN. First launch only; remembered in localStorage (and a browser
 *      that refuses storage, or throws, just sees it again); never for the
 *      test robots (navigator.webdriver) unless ?intro=1; ?intro=0 never.
 *   2. WHAT. The standard wording — a very small percentage, flashing lights
 *      or patterns, stop and consult a doctor, the symptoms, parents — and
 *      "Possible seizure warning" said on it.
 *   3. CALM. Every fade on it 0.7 s or slower; no animation but one slow
 *      drift, and that off under Reduce motion; no rAF; no sound.
 *   4. WIRED. main.js shows it after the boot loader, Settings → Accessibility
 *      has its button, sw.js precaches it.
 *
 * The browser half (safety-intro.browser.js) puts it up in the real game.
 * Exits non-zero if anything fails.
 */
import { readFileSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');
const SI = await import(new URL('src/ui/safety-intro.js', root).href);

const results = [];
const ok = (name, pass, detail = '') => {
  results.push({ name, pass: !!pass, detail: String(detail) });
  return !!pass;
};

const mem = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m };
};
const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };

/* ---------------------------------------------------------------- 1. when -- */
{
  const st = mem();
  ok('a first launch (nothing stored, a player\'s browser): shown', SI.shouldShowAtBoot({ search: '', store: st, automated: false }));
  ok('Continue remembers it', SI.markShown(st) && SI.wasShown(st) && st.m.has(SI.STORE_KEY));
  ok('...so the next launch does not show it', !SI.shouldShowAtBoot({ search: '', store: st, automated: false }));
  ok('?intro=1 shows it again anyway (and ?seizure=1)', SI.shouldShowAtBoot({ search: '?intro=1', store: st, automated: false }) && SI.shouldShowAtBoot({ search: '?seizure=1', store: st, automated: false }));
  ok('the test robots (navigator.webdriver) never see it at boot', !SI.shouldShowAtBoot({ search: '', store: mem(), automated: true }));
  ok('...unless the URL asks: ?intro=1', SI.shouldShowAtBoot({ search: '?intro=1', store: mem(), automated: true }));
  ok('?intro=0 never', !SI.shouldShowAtBoot({ search: '?intro=0', store: mem(), automated: false }));
  ok('a browser whose storage throws: no crash, shown (it cannot remember), and markShown says it could not', SI.shouldShowAtBoot({ search: '', store: broken, automated: false }) && SI.markShown(broken) === false && SI.wasShown(broken) === false);
  ok('isAutomated reads navigator.webdriver and HeadlessChrome', SI.isAutomated({ webdriver: true }) && SI.isAutomated({ userAgent: 'Mozilla HeadlessChrome/120' }) && !SI.isAutomated({ userAgent: 'Mozilla Safari' }));
}

/* ---------------------------------------------------------------- 2. what -- */
{
  const all = SI.WARNING_TEXT.join(' ').toLowerCase();
  const need = ['a very small percentage of people', 'seizure', 'flashing lights or patterns', 'stop playing immediately', 'consult a doctor', 'dizziness', 'altered vision', 'eye or muscle twitches', 'loss of awareness', 'disorientation', 'convulsions', 'parents should watch their children'];
  const missing = need.filter((w) => !all.includes(w));
  ok('the standard wording, every part of it', missing.length === 0, missing.join(', ') || `${need.length} phrases`);
  ok('the card is titled "Photosensitive seizure warning" and says "Possible seizure warning"', /photosensitive seizure warning/i.test(SI.WARNING_TITLE) && /possible seizure warning/i.test(SI.WARNING_KICKER));
  const src = read('src/ui/safety-intro.js');
  ok('its two switches are Reduce flashing (on unless switched off) and Reduce motion, and Continue', /data-si="reduceFlashing"\$\{flashOn \? ' checked'/.test(src) && /settings\.reduceFlashing !== false/.test(src) && /data-si="reducedMotion"/.test(src) && /data-si-continue/.test(src));
  ok('Enter continues; Tab stays in the card', /e\.key === 'Enter'/.test(src) && /trapTab/.test(src));
  ok('it is a dialog to a screen reader (role, aria-modal, labelled)', /role', 'dialog'/.test(src) && /aria-modal', 'true'/.test(src) && /aria-labelledby', 'si-title'/.test(src));
  ok('phone sized: the card fits the width with a 16 px gutter and scrolls if it must; 48 px targets', /min\(640px, calc\(100vw - 32px\)\)/.test(src) && /max-height: calc\(100dvh - 32px\)/.test(src) && /overflow-y: auto/.test(src) && /min-height: 48px/.test(src) && /min-height: 50px/.test(src));
}

/* ---------------------------------------------------------------- 3. calm -- */
{
  const src = read('src/ui/safety-intro.js');
  const T = SI.INTRO_TIMING;
  ok('every fade 0.7 s or slower (nothing on it can flash)', T.fadeInMs >= 700 && T.cardFadeMs >= 700 && T.fadeOutMs >= 700, JSON.stringify(T));
  const css = (src.match(/const CSS = `([\s\S]*?)`;/) || [])[1] || '';
  const trans = [...css.matchAll(/transition:[^;]*?(\d+)ms/g)].map((m) => Number(m[1]));
  ok('...and every CSS transition in it too', trans.length > 0 && trans.every((ms) => ms >= 700), trans.join(', '));
  const anims = [...css.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]);
  ok('one animation only, the slow drift (26 s), scale and position only, no opacity or colour', anims.length === 1 && /si-drift 26s/.test(css) && !/@keyframes si-drift[^}]*\b(opacity|color|background|filter)\b/.test(css), anims.join(', '));
  ok('...off under Reduce motion (the switch on the card, and the system setting)', /drift\(!motionOn\)/.test(src) && /if \(path === 'reducedMotion'\) drift\(!box\.checked\)/.test(src) && /prefers-reduced-motion: reduce[\s\S]*animation: none/.test(css));
  ok('timers only, never requestAnimationFrame; and no sound', !/requestAnimationFrame\(/.test(src) && !/Audio\(|AudioContext|\.play\(/.test(src));
}

/* --------------------------------------------------------------- 4. wired -- */
{
  const main = read('src/main.js');
  const menus = read('src/ui/menus.js');
  const sw = read('sw.js');
  ok('main.js: after the boot loader, shown if shouldShowAtBoot(), its switches applied as the game\'s own settings', /if \(shouldShowAtBoot\(\)\) this\.showSafetyIntro\(\);/.test(main) && /this\.applySetting\(path, value\);/.test(main) && main.indexOf("this.menus.show('main');") < main.indexOf('if (shouldShowAtBoot())'));
  ok('Settings → Accessibility: "Show the photosensitive seizure warning"', /data-panel="access"[\s\S]*?data-safety-intro[\s\S]*?Show the photosensitive seizure warning/.test(menus) && /closest\('\[data-safety-intro\]'\)[\s\S]{0,80}showSafetyIntro/.test(menus) && /showSafetyIntro: \(\) => this\.showSafetyIntro\(\{ skipIntro: true \}\)/.test(main));
  ok('sw.js precaches it (works offline on the first run)', sw.includes("'src/ui/safety-intro.js'"));
}

const failed = results.filter((r) => !r.pass);
for (const r of results) {
  if (!r.pass || process.argv.includes('--verbose')) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  (${r.detail})` : ''}`);
}
console.log(`\nsafety-intro: ${results.length - failed.length}/${results.length} passed`);
process.exitCode = failed.length ? 1 : 0;
