/**
 * SETTINGS DEFAULTS that moved (src/core/storage.js MIGRATIONS), checked in node
 * with a fake localStorage:
 *   - a fresh player: the alternative aeroplane models on, the Clean HUD;
 *   - an old save (models off at rev 2, a busier HUD, no hudRev): both handed
 *     back to the new defaults once;
 *   - a save made after that (rev 3, hudRev 1) with the player's own choice:
 *     kept as they set it.
 *
 *   node tests/features/settings-defaults.mjs
 */
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
const S = await import('../../src/core/storage.js');
const KEY = 'islandsim.settings.v1';
let passed = 0;
let failed = 0;
const ok = (name, pass, detail = '') => {
  if (pass) passed++;
  else failed++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

store.clear();
let s = S.loadSettings();
ok('fresh: alternative models off by default (held off in v81.0)', s.fleetModels === false);
ok('fresh: the Clean HUD by default', s.hudDensity === 'clean');

store.clear();
store.set(KEY, JSON.stringify({ fleetModels: true, modelSetRev: 2, hudDensity: 'full' }));
s = S.loadSettings();
ok('old save: a player who turned the models on keeps them (no hand-back in v81.0)', s.fleetModels === true && s.modelSetRev === 2, `${s.fleetModels} rev ${s.modelSetRev}`);
ok('old save: the HUD handed back to Clean once (no hudRev -> 1)', s.hudDensity === 'clean' && s.hudRev === 1, `${s.hudDensity} hudRev ${s.hudRev}`);
const written = JSON.parse(store.get(KEY));
ok('old save: the handed-back HUD is written, so it happens once', written.hudRev === 1);

store.clear();
store.set(KEY, JSON.stringify({ fleetModels: false, modelSetRev: 2, hudDensity: 'full', hudRev: 1 }));
s = S.loadSettings();
ok('after the hand-back, the player\'s own choices stay', s.fleetModels === false && s.hudDensity === 'full', `${s.fleetModels} ${s.hudDensity}`);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
