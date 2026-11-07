/**
 * One loading screen per visit (the owner, 2026-10-31: "fix the double loading
 * screen"). A new version used to take over the moment it had downloaded and
 * reload the open page, so the whole loading screen ran twice. Now:
 *   - sw.js never calls skipWaiting by itself; only on the page's message
 *   - index.html switches to a waiting version BEFORE the game's long load,
 *     and never holds the boot up for more than 2.5 s
 *   - main.js offers a waiting version on the menu (Update now / Later),
 *     never during a flight, and writes the bar only when it changes
 */
import { readFileSync } from 'node:fs';
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
let n = 0;
let fails = 0;
const ok = (name, pass, detail = '') => {
  n++;
  if (!pass) fails++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};
const sw = read('sw.js');
const install = sw.slice(sw.indexOf("addEventListener('install'"), sw.indexOf("addEventListener('message'"));
ok('the worker does not take over by itself when it installs', !/skipWaiting\(\)/.test(install));
ok('...only when the page asks', /addEventListener\('message'[\s\S]{0,120}'skip-waiting'[\s\S]{0,40}self\.skipWaiting\(\)/.test(sw));
const html = read('index.html');
const boot = html.slice(html.indexOf('function switchToWaitingUpdate'));
ok('the boot switches to a waiting version before it imports the game', /switchToWaitingUpdate\(\)\.then\(function \(\) \{\s*bootLoad\(/.test(boot));
ok('...only for a page a worker already controls (not a first visit), and not with ?dev', /!sw\.controller/.test(boot) && /dev/.test(boot));
ok('...and never holds the boot up long (2.5 s at most)', /\}, 2500\);/.test(boot));
ok('...says so on the loading screen', /Updating to the new version/.test(boot));
const main = read('src/main.js');
ok('the game watches for a waiting version, from boot and from its own registration', /getRegistration\(\)\.then\(\(reg\) => this\.watchUpdate\(reg\)\)/.test(main) && /this\.watchUpdate\(reg\);\s*return reg\.update\(\);/.test(main));
ok('a version already downloading when the game boots is still offered (its updatefound has gone by)', /watch\(reg\.installing\);\s*\n[\s\S]{0,40}reg\.addEventListener\('updatefound', \(\) => watch\(reg\.installing\)\)/.test(main) || /watch\(reg\.installing\);[\s\S]{0,60}updatefound/.test(main));
ok('a tab left open on the menu checks again when it comes back', /visibilitychange[\s\S]{0,120}reg\.update\(\)/.test(main));
ok('after an update the menu says so, once, from either way of updating', (html.match(/setItem\('ifs-updated'/g) || []).length === 1 && (main.match(/setItem\('ifs-updated'/g) || []).length === 1 && /removeItem\('ifs-updated'\)/.test(main));
ok('the offer is on the menu only, and not once Later was pressed', /const hide = this\.state !== 'menu' \|\| !!this\._updateLater;/.test(main));
ok('...and the bar is written only when it changes (frame budget)', /if \(bar\.hidden !== hide\) bar\.hidden = hide;/.test(main));
ok('Update now asks the waiting worker to take over (then the menu reloads onto it)', /w\.postMessage\('skip-waiting'\)/.test(main));
ok('the buttons are touch-sized', /\.update-ready button \{ min-height: 44px/.test(read('styles/main.css')));
console.log(`\nupdate-once: ${n - fails}/${n} passed`);
process.exit(fails ? 1 : 0);
