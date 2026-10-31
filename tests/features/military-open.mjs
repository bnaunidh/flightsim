/**
 * The military passcode is gone (owner, 2026-10-30: "remove military code, we
 * dont need it"). Run from the repo root with plain node:
 *
 *   node tests/features/military-open.mjs
 *
 * What has to hold now:
 *   - progression.js has no door: no MILITARY_CODE_HASH, no needsPasscode(),
 *     no enterPasscode(), no militaryUnlocked in a fresh profile — and an old
 *     save that still carries the flag loads fine, with the flag dropped;
 *   - a military aeroplane is bought for credits exactly like the others;
 *   - the counted Missions line counts the military missions for everybody;
 *   - hijack-lead's fighterId() hands out the F-22 to whoever OWNS one, and
 *     not on an old save's flag;
 *   - the hangar screen has no passcode box (the redeem box stays), the Dev
 *     door stays, tools/hash-code.mjs knows only the Dev door;
 *   - nothing in src/ reads the old flag or the old functions any more.
 *
 * Every one of these failed on v75.5.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

global.document = {
  createElement: () => ({
    getContext: () => new Proxy({}, { get: () => () => ({ addColorStop() {}, data: new Uint8ClampedArray(4) }) }),
    width: 0,
    height: 0,
    style: {},
  }),
  body: { appendChild() {} },
};
// An OLD save: the door was opened once, and the flag is still in it.
const store = new Map([['islandsim.progression.v1', JSON.stringify({ credits: 123, earned: 456, militaryUnlocked: true, devUnlocked: false, unlocked: ['skylark', 'f22'], best: [], redeemed: [] })]]);
global.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };

const root = new URL('../../', import.meta.url);
const ROOT = root.pathname;
const load = (p) => import(new URL(p, root).href);
const Prog = await load('src/game/progression.js');
const GameUi = await load('src/ui/game-ui.js');
const HL = await load('src/game/roles/hijack-lead.js');
const Shelves = await load('src/ui/hangar-shelves.js');
const { AIRCRAFT } = await load('src/aircraft/types.js');
const { MISSIONS, gameOf } = await load('src/game/missions.js');

let passed = 0;
let failed = 0;
function ok(name, pass, detail = '') {
  if (pass) passed++;
  else failed++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}

/* ---- the door is gone ------------------------------------------------- */
ok('progression.js exports no military door', typeof Prog.MILITARY_CODE_HASH === 'undefined' && typeof Prog.needsPasscode === 'undefined' && typeof Prog.enterPasscode === 'undefined');
ok('the Dev door is still there, hashed', Prog.isCodeHash(Prog.DEV_CODE_HASH) && typeof Prog.enterDevCode === 'function' && typeof Prog.isDev === 'function');
const progSrc = readFileSync(join(ROOT, 'src/game/progression.js'), 'utf8');
ok('the military hash is deleted from the source', !/MILITARY_CODE_HASH = '/.test(progSrc) && !/[0-9a-f]{64}'.*military/i.test(progSrc));

/* ---- old saves keep working -------------------------------------------- */
{
  const p = Prog.load();
  ok('an old save with militaryUnlocked loads, keeps its credits and aeroplanes, and drops the flag',
    p.credits === 123 && p.earned === 456 && p.unlocked.includes('f22') && !('militaryUnlocked' in p), JSON.stringify(p));
  store.clear();
  const fresh = Prog.load();
  ok('a fresh profile has no militaryUnlocked at all', !('militaryUnlocked' in fresh) && fresh.devUnlocked === false, Object.keys(fresh).join(' '));
}

/* ---- military aircraft are bought like the rest ------------------------ */
{
  const mil = Prog.UNLOCKS.filter((u) => u.military);
  ok('military rows are in the shop, each priced', mil.length >= 5 && mil.every((u) => u.cost > 0), mil.map((u) => `${u.aircraft} ${u.cost}`).join(' '));
  const wallet = { credits: Prog.costOf('f22'), earned: 0, unlocked: ['skylark'], best: [], redeemed: [] };
  const bought = Prog.buy(wallet, 'f22');
  ok('the F-22 is bought for credits on a profile that never saw a passcode', bought.ok === true && Prog.isUnlocked(wallet, 'f22') && wallet.credits === 0, JSON.stringify(bought));
  const flagged = AIRCRAFT.filter((a) => a.military).map((a) => a.id);
  const unpriced = flagged.filter((id) => !(Prog.costOf(id) > 0 || AIRCRAFT.find((a) => a.id === id).price > 0));
  ok('every military type on the roster has a price (progression.js or the feature that adds its row)', flagged.length > 0 && unpriced.length === 0, unpriced.join(', ') || `${flagged.length} military types`);
  ok('the Military shelf blurb does not mention a passcode', !/passcode/i.test(Shelves.SHELVES.find((s) => s.id === 'military').blurb));
}

/* ---- missions and roles are listed for everybody ----------------------- */
{
  const flight = MISSIONS.filter((m) => gameOf(m) === 'flight');
  const milMissions = flight.filter((m) => m.military);
  ok('there are military missions to count', milMissions.length >= 4, milMissions.map((m) => m.id).join(' '));
  const words = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve',
    'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen', 'Twenty'];
  const line = GameUi.missionsLine('flight', {});
  const n = flight.length;
  ok('the Missions line counts every flight mission, the military ones too', line.startsWith(`${n < words.length ? words[n] : n} mission`), line);
  ok('…and an old save\'s flag, either way, changes nothing',
    GameUi.missionsLine('flight', { militaryUnlocked: false }) === line && GameUi.missionsLine('flight', { militaryUnlocked: true }) === line);
  const hasF22 = AIRCRAFT.some((a) => a.id === 'f22');
  ok('hijack-lead: the F-22 for whoever owns one', HL.fighterId({ unlocked: ['skylark', 'f22'] }) === (hasF22 ? 'f22' : 'vanguard'));
  ok('hijack-lead: the Vanguard for whoever does not, whatever an old save\'s flag says',
    HL.fighterId({ unlocked: ['skylark'] }) === 'vanguard' && HL.fighterId({ militaryUnlocked: true, unlocked: [] }) === 'vanguard' && HL.fighterId(null) === 'vanguard');
}

/* ---- the hangar screen and the tool ------------------------------------ */
{
  const menusSrc = readFileSync(join(ROOT, 'src/ui/menus.js'), 'utf8');
  ok('menus.js has no passcode box: no [data-mil-code], no [data-mil-enter], no "Military access" heading',
    !/data-mil-code|data-mil-enter|Military access|data-mil-note/.test(menusSrc));
  ok('menus.js keeps the redeem box and the Dev door', /data-code\b/.test(menusSrc) && /data-redeem/.test(menusSrc) && /data-dev-code/.test(menusSrc) && /enterDevCode/.test(menusSrc));
  ok('menus.js never refuses a mission, map or aeroplane for want of a passcode', !/behind a passcode — enter it in the Hangar/.test(menusSrc));
  const tool = readFileSync(join(ROOT, 'tools/hash-code.mjs'), 'utf8');
  ok('tools/hash-code.mjs knows only the Dev door', !/MILITARY_CODE_HASH/.test(tool) && /DEV_CODE_HASH/.test(tool));
}

/* ---- nothing in src/ reads the old door any more ----------------------- */
{
  const hits = [];
  const walk = (dir) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.js$/.test(f)) {
        const text = readFileSync(p, 'utf8');
        for (const [i, line] of text.split('\n').entries()) {
          if (/needsPasscode\(|enterPasscode\(|MILITARY_CODE_HASH\b/.test(line) && !/^\s*\*|^\s*\/\//.test(line)) hits.push(`${p.slice(ROOT.length)}:${i + 1}`);
          // The one allowed mention of the flag: load() dropping it.
          if (/\bmilitaryUnlocked\b/.test(line) && !/delete p\.militaryUnlocked|^\s*\*|^\s*\/\//.test(line)) hits.push(`${p.slice(ROOT.length)}:${i + 1} (flag)`);
        }
      }
    }
  };
  walk(join(ROOT, 'src'));
  ok('no file under src/ calls needsPasscode/enterPasscode, names the hash, or reads militaryUnlocked', hits.length === 0, hits.slice(0, 6).join(', ') || 'clean');
}

/*
 * ---- the ChatGPT build under gpt/ shares the save ------------------------
 * gpt/ is served from the same origin (the Dev workbench and compare.html link
 * to it) and reads the same localStorage key. The main game drops the old
 * flag on load, so a gpt/ copy that still had the door would lock its
 * military side again for everybody who had opened it — and its hash would
 * still be shipped. It has to be open too.
 */
{
  store.set('islandsim.progression.v1', JSON.stringify({ credits: 5, earned: 5, militaryUnlocked: true, devUnlocked: false, unlocked: ['skylark'], best: [], redeemed: [] }));
  const Gpt = await load('gpt/src/game/progression.js');
  ok('gpt/: no military hash or enterPasscode exported', typeof Gpt.MILITARY_CODE_HASH === 'undefined' && typeof Gpt.enterPasscode === 'undefined');
  ok('gpt/: nothing needs a passcode, on any save', Gpt.needsPasscode({}, { military: true }) === false && Gpt.needsPasscode({ militaryUnlocked: false }, { military: true }) === false);
  const gp = Gpt.load();
  ok('gpt/: an old save loads with the flag dropped, credits kept', !('militaryUnlocked' in gp) && gp.credits === 5 && !('militaryUnlocked' in (store.clear(), Gpt.load())));
  ok('gpt/: the Dev door is still there', Gpt.isCodeHash(Gpt.DEV_CODE_HASH) && typeof Gpt.enterDevCode === 'function');
  const gm = readFileSync(join(ROOT, 'gpt/src/ui/menus.js'), 'utf8');
  ok('gpt/: the hangar has no Military access box, keeps the redeem box and Dev door',
    !/data-mil-code|data-mil-enter|data-mil-note|Military access|militaryUnlocked|enterPasscode/.test(gm) && /data-code\b/.test(gm) && /data-dev-code/.test(gm));
  const gps = readFileSync(join(ROOT, 'gpt/src/game/progression.js'), 'utf8');
  ok('gpt/: progression.js names no military hash', !/MILITARY_CODE_HASH|militaryUnlocked: false/.test(gps));
}

console.log(`\nmilitary-open: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
