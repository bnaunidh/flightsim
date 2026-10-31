// The dev console's commands (src/features/dev-console.js), run without a page.
import { runLine } from '../../src/features/dev-console.js';
import { AIRCRAFT } from '../../src/aircraft/types.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => { if (cond) pass++; else { fail++; console.log('FAIL', name, detail); } };
const p = { unlocked: ['skylark'], credits: 10 };
const sim = { prog: p };

let r = runLine(sim, '/runcmd allaircraft');
ok('allaircraft unlocks every aircraft', r.ok && AIRCRAFT.every((a) => p.unlocked.includes(a.id)), r.text);
ok('allaircraft leaves no military flag behind', !('militaryUnlocked' in p));
r = runLine(sim, 'allaircraft');
ok('works without /runcmd', r.ok && /0 new/.test(r.text), r.text);
r = runLine(sim, '/runcmd credits 5000');
ok('credits sets', r.ok && p.credits === 5000, r.text);
r = runLine(sim, '/runcmd addcredits 1,000');
ok('addcredits adds', r.ok && p.credits === 6000, r.text);
r = runLine(sim, '/runcmd credits lots');
ok('credits rejects a non-number', !r.ok && p.credits === 6000, r.text);
const q = { unlocked: [], credits: 0 };
r = runLine({ prog: q }, '/runcmd unlock A380');
ok('unlock one by id, any case', r.ok && q.unlocked.includes('a380'), r.text);
r = runLine({ prog: q }, '/runcmd unlock nope');
ok('unlock an unknown id fails politely', !r.ok, r.text);
r = runLine(sim, '/runcmd help');
ok('help lists allaircraft', r.ok && /allaircraft/.test(r.text));
r = runLine(sim, '/runcmd fly-to-the-moon');
ok('unknown command says so', !r.ok && /Unknown/.test(r.text));
r = runLine(sim, '/runcmd list');
ok('list names every id', r.ok && AIRCRAFT.every((a) => r.text.includes(a.id)));
console.log(`dev-console: ${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
