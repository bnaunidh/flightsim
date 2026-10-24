/**
 * Node checks for the class-demo game switch (src/ui/shown-games.js).
 *
 *   node tests/features/mode-picker.mjs
 *
 * One flag hides every game but the aeroplane and the helicopter from the
 * three places a game is offered — the bar, the More screen, the hangar — and
 * from the rocket's own menu hook. Nothing is deleted. These checks read the
 * flag module and the source of the screens; the browser check
 * (mode-picker.browser.js) looks at the built menus.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const S = await import(new URL('../../src/ui/shown-games.js', import.meta.url).href);

let fails = 0;
let n = 0;
const ok = (name, pass, detail) => {
  n++;
  if (!pass) fails++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};
const read = (p) => readFileSync(`${ROOT}${p}`, 'utf8');

ok('the switch is on for the demo', S.HIDE_EXTRA_GAMES === true);
ok('the aeroplane and the helicopter are the games on offer', S.gameShown('flight') && S.gameShown('heli') && S.DEMO_GAMES.length === 2);
ok('the boat, the car and the rocket are not', !S.gameShown('boat') && !S.gameShown('car') && !S.gameShown('rocket') && !S.gameShown(undefined));
ok('shownGames() filters by id or by drive', JSON.stringify(S.shownGames([{ id: 'flight' }, { id: 'boat' }, { drive: 'car' }, { drive: 'heli' }])) === JSON.stringify([{ id: 'flight' }, { drive: 'heli' }]));

const menus = read('src/ui/menus.js');
ok('menus.js asks the switch in one place for the bar', /GAMES\.filter\(\(g\) => gameShown\(g\.id\)\)\.map\(/.test(menus));
ok('…and for the cards on More', /DRIVES\.filter\(\(g\) => !g\.drive \|\| gameShown\(g\.drive\)\)/.test(menus));
ok('…and for the cards in the hangar', /GAMES\.filter\(\(g\) => !g\.drive \|\| gameShown\(g\.drive\)\)/.test(menus));
ok('the boat and car entries are still defined, not deleted',
  /id: 'boat', name: 'Boat'/.test(menus) && /id: 'car', name: 'Car'/.test(menus) && /drive: 'boat'/.test(menus) && /drive: 'car'/.test(menus));
const rocket = read('src/features/rocket/menu.js');
ok('the rocket hook asks the same switch before adding its button and its card', (rocket.match(/gameShown\('rocket'\)/g) || []).length === 2 && /shown-games\.js/.test(rocket));
ok('the switch is imported from the one module everywhere', [menus, rocket].every((s) => /from '(\.\.?\/)+(ui\/)?shown-games\.js'/.test(s)));

console.log(`\n${n - fails}/${n} passed`);
process.exit(fails ? 1 : 0);
