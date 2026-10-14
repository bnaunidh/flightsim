/**
 * Node checks for Comic effects — Settings → Graphics, OFF by default. Run
 * from anywhere with plain node:
 *
 *   node tests/features/comic.mjs
 *
 * The owner: "remove the comic stuff, put it in settings and default off".
 * Everything that draws the game as a cartoon (comic words, big comic cards,
 * stars, the cartoon crashes, the starburst on the map, the "bonk" wording of
 * the meteor missions) follows ONE switch (src/render/comic.js). These are
 * the parts of it node can see:
 *
 *   1. the setting: off by default, off for a save that predates it, saved
 *      and kept once somebody turns it on;
 *   2. the helper: only a real `true` turns it on; the plain word for each
 *      comic word;
 *   3. the crash names (crashes/kinds.js): a plain title for every kind, for
 *      the aeroplane and the helicopter, with no comic word or "!" in it;
 *   4. the minimap marks (crashes/marks.js): the starburst with it on, a
 *      plain cross with it off;
 *   5. the shared effects (mpplay/shared.js): comic words and stars are never
 *      drawn with it off, a "poof" is grey smoke, and with it on they are
 *      what they were;
 *   6. the meteor missions' wording.
 *
 * The browser half (comic.browser.js) plays a PvP tag, a collision and a
 * building crash in the real game with the default settings, and with it on.
 *
 * Exit code 1 if anything fails.
 */

// localStorage and a DOM with just enough in it for the effects to be made.
if (typeof globalThis.localStorage === 'undefined') {
  const mem = new Map();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) },
  });
}
const classes = new Set();
const el = () => ({
  style: { setProperty() {} }, dataset: {}, children: [], hidden: false, textContent: '', innerHTML: '', className: '', isConnected: true,
  classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
  appendChild(c) { this.children.push(c); return c; }, append() {}, remove() {}, removeChild() {},
  querySelector: () => el(), querySelectorAll: () => [], setAttribute() {}, addEventListener() {},
  getContext: () => new Proxy({}, { get: () => () => ({ addColorStop() {}, data: new Uint8ClampedArray(4) }) }),
  width: 0, height: 0,
});
globalThis.document = {
  createElement: el, body: el(), head: el(), getElementById: () => null, querySelectorAll: () => [],
  documentElement: { classList: { toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)), contains: (c) => classes.has(c) } },
};
globalThis.window = globalThis.window || { innerWidth: 1280, innerHeight: 720, setInterval, clearInterval, addEventListener() {} };

const root = new URL('../../src/', import.meta.url);
const imp = (p) => import(new URL(p, root).href);

let pass = 0;
let fail = 0;
function ok(name, cond, detail = '') {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' ? '  — ' + detail : ''}`);
  return !!cond;
}

const CM = await imp('render/comic.js');
const { DEFAULT_SETTINGS, loadSettings, saveSettings } = await imp('core/storage.js');
const K = await imp('features/crashes/kinds.js');
const MK = await imp('features/crashes/marks.js');
const THREE = await imp('vendor/three.module.js');

/* ---- 1. the setting -------------------------------------------------- */

ok('the setting is off by default', DEFAULT_SETTINGS.comicEffects === false);
localStorage.setItem('islandsim.settings.v1', JSON.stringify({ quality: 'high', muted: true, reduceFlashing: true }));
ok('a save from before the setting existed gets it off', loadSettings().comicEffects === false);
localStorage.removeItem('islandsim.settings.v1');
ok('with no save at all it is off', loadSettings().comicEffects === false);
{
  const s = loadSettings();
  s.comicEffects = true;
  saveSettings(s);
  ok('switched on, it is saved and kept', loadSettings().comicEffects === true && JSON.parse(localStorage.getItem('islandsim.settings.v1')).comicEffects === true);
  s.comicEffects = false;
  saveSettings(s);
  ok('switched back off, it stays off', loadSettings().comicEffects === false);
}
ok('the other defaults did not move (Reduce flashing is still on)', DEFAULT_SETTINGS.reduceFlashing === true);

/* ---- 2. the helper ---------------------------------------------------- */

const { COMIC } = CM;
ok('the switch starts off', COMIC.on === false && CM.comicOn() === false);
ok('setComicEffects(true) turns it on, and puts a class on the page', CM.setComicEffects(true) === true && COMIC.on === true && classes.has('comic-effects'));
ok('setComicEffects(false) turns it off, and takes the class off', CM.setComicEffects(false) === false && COMIC.on === false && !classes.has('comic-effects'));
ok('only a real true turns it on (not "yes", 1, undefined or null)', ['yes', 1, undefined, null, 'true'].every((v) => CM.setComicEffects(v) === false));
CM.setComicEffects(false);
ok('pick() gives the plain one off and the comic one on', CM.pick('BONK!', 'Collision') === 'Collision' && (CM.setComicEffects(true), CM.pick('BONK!', 'Collision') === 'BONK!'));
CM.setComicEffects(false);
ok('wordFor() puts each comic word in plain words with it off', CM.wordFor('BONK!') === 'Mid-air collision' && CM.wordFor('TAGGED!') === 'Tagged out' && CM.wordFor('POW!') === 'Hit' && CM.wordFor('BACK IN!') === 'Back in the game');
ok('…and no plain word is itself a comic word', Object.values(CM.PLAIN_WORDS).every((w) => !/bonk|poof|pow|splat|zap|!/i.test(w)));
ok('…leaves a signal alone ("GO!", "3")', CM.wordFor('GO!') === 'GO!' && CM.wordFor('3') === '3');
CM.setComicEffects(true);
ok('…and every word is itself with it on', Object.keys(CM.PLAIN_WORDS).every((w) => CM.wordFor(w) === w));
CM.setComicEffects(false);

/* ---- 3. the crash names ------------------------------------------------ */

const COMIC_BITS = /bonk|poof|pow\b|splat|zap\b|whirr|thunk|fwump|sploosh|tumble|ka-|!|stars|boing|wham|oops/i;
{
  const allPlain = [];
  for (const id of K.KIND_IDS) {
    for (const v of ['plane', 'heli']) {
      const t = K.titleFor(id, v, false);
      allPlain.push(t);
      ok(`crash names: "${id}" (${v}) has a plain title`, typeof t === 'string' && t.length > 3 && !COMIC_BITS.test(t), t);
      ok(`crash names: "${id}" (${v}) comic title is unchanged and different`, K.titleFor(id, v, true) === (v === 'heli' ? K.KINDS[id].heliTitle : K.KINDS[id].title) && K.titleFor(id, v, true) !== t);
    }
  }
  ok('crash names: the default is the comic one (the choreography tests were written against it)', K.titleFor('bonk', 'plane') === 'Bonk!');
  ok('crash names: a mid-air crash is a "Mid-air collision"', K.titleFor('midair', 'plane', false) === 'Mid-air collision' && K.titleFor('midair', 'heli', false) === 'Mid-air collision');
  ok('crash names: a helicopter\'s wing clip is a rotor strike, plain', K.titleFor('wingclip', 'heli', false) === 'Rotor strike' && K.titleFor('wingclip', 'plane', false) === 'Wing strike');
  ok('crash names: an unknown kind falls back to a plain belly landing', K.titleFor('nonsense', 'plane', false) === K.KINDS.bellyflop.plainTitle);
  ok('crash names: nobody is hurt in a plain title either', allPlain.every((t) => !/die|dead|hurt|blood|kill/i.test(t)));
}

/* ---- 4. the marks ------------------------------------------------------- */

{
  const calls = (comic) => {
    const rec = { lineTo: 0, moveTo: 0, fill: 0, stroke: 0, arc: 0 };
    const ctx = new Proxy({}, {
      get: (_, k) => (k in rec ? () => { rec[k]++; } : () => {}),
      set: () => true,
    });
    const marks = new MK.CrashMarks();
    marks.add({ x: 100, z: 0, kind: 'bonk', map: 'kestrel', mine: true, now: 1 });
    marks.add({ x: -400, z: 300, kind: 'cartwheel', map: 'kestrel', mine: false, colour: '#33aaff', now: 1 });
    const n = MK.drawCrashMarks(ctx, marks, { x: 0, z: 0 }, 4000, 190, 5, 'kestrel', marks.list[0], 1, comic);
    return { n, rec };
  };
  const on = calls(true);
  const off = calls(false);
  ok('marks: both marks are drawn either way', on.n === 2 && off.n === 2, `${on.n} / ${off.n}`);
  ok('marks: with it on each is a 16-point starburst, filled', on.rec.lineTo >= 2 * 15 && on.rec.fill >= 2, JSON.stringify(on.rec));
  ok('marks: with it off each is a plain cross (two strokes of a line), nothing filled', off.rec.fill === 0 && off.rec.lineTo === 2 * 2 && off.rec.moveTo >= 2 * 2, JSON.stringify(off.rec));
  ok('marks: the default is the starburst', (() => {
    const rec = { lineTo: 0 };
    const ctx = new Proxy({}, { get: (_, k) => (k in rec ? () => { rec[k]++; } : () => {}), set: () => true });
    const marks = new MK.CrashMarks();
    marks.add({ x: 100, z: 0, kind: 'bonk', map: 'kestrel', mine: true, now: 1 });
    MK.drawCrashMarks(ctx, marks, { x: 0, z: 0 }, 4000, 190, 5, 'kestrel');
    return rec.lineTo >= 15;
  })());
}

/* ---- 5. the shared effects ---------------------------------------------- */

{
  let S;
  try {
    S = await imp('features/mpplay/shared.js');
    ok('shared effects: the module loads in node', true);
  } catch (err) {
    ok('shared effects: the module loads in node', false, err && err.stack && err.stack.split('\n').slice(0, 3).join(' | '));
  }
  if (S) {
    const scene = new THREE.Scene();
    const group = new THREE.Group();
    scene.add(group);
    const { toon } = S;
    toon.build(group);
    const cam = new THREE.PerspectiveCamera();
    const at = new THREE.Vector3(0, 100, 0);
    const shown = (list) => list.filter((p) => (p.s || p).visible).length;
    const words = () => toon.words.filter((w) => w.s.visible).length;
    const stars = () => toon.stars.filter((w) => w.s.visible).length;
    const puffs = () => toon.puffs.filter((w) => w.s.visible);

    CM.setComicEffects(false);
    toon.clear();
    toon.word('BONK!', at, cam, 1);
    toon.word('POOF!', at, cam, 1);
    toon.word('GO!', at, cam, 1);
    toon.starBurst(at, 7, 12);
    ok('shared effects: off — no comic word is drawn (BONK!, POOF!, GO!)', words() === 0);
    ok('shared effects: off — no stars are drawn', stars() === 0);
    toon.poof(at, { n: 10, size: 9 });
    const p = puffs();
    ok('shared effects: off — a poof is half as many puffs of plain grey smoke', p.length === 5 && p.every((q) => q.s.material.color.getHexString() === S.SMOKE_PUFF.slice(1)), `${p.length} puffs, ${p[0] && p[0].s.material.color.getHexString()}`);

    CM.setComicEffects(true);
    toon.clear();
    toon.word('BONK!', at, cam, 1);
    toon.starBurst(at, 7, 12);
    toon.poof(at, { n: 10, size: 9 });
    ok('shared effects: on — the comic word is drawn', words() === 1);
    ok('shared effects: on — seven stars are drawn', stars() === 7);
    ok('shared effects: on — a poof is ten white puffs', puffs().length === 10 && puffs().every((q) => q.s.material.color.getHexString() === 'ffffff'));
    toon.clear();
    CM.setComicEffects(false);
    toon.puff(at, '#ffd23f', { n: 4 });
    ok('shared effects: a coloured puff (a race gate, a hit) is left alone either way', puffs().length === 4 && puffs().every((q) => q.s.material.color.getHexString() === 'ffd23f'));
    toon.clear();
  }
}

/* ---- 6. the meteor missions' wording -------------------------------------- */

{
  let ALL;
  try {
    ALL = await imp('game/missions.js');
  } catch (err) {
    ok('meteor missions: the list loads in node', false, err && err.stack && err.stack.split('\n').slice(0, 3).join(' | '));
  }
  if (ALL) {
    const dodge = ALL.findMission('meteor-dodge');
    const town = ALL.findMission('meteor-town');
    const lost = (def, stats) => def.failIf({ sim: { meteors: { stats } } });
    CM.setComicEffects(false);
    ok('meteor missions: off — the briefings say hit, not bonk', !/bonk|whoosh/i.test(dodge.blurb + town.blurb), dodge.blurb.slice(60, 140));
    ok('meteor missions: off — losing says hits, not bonks', !/bonk/i.test(lost(dodge, { shields: 0 })) && /Three hits/.test(lost(dodge, { shields: 0 })) && !/bonk/i.test(lost(town, { landedTown: 5 })));
    ok('meteor missions: off — the briefings still read as sentences', /Last three minutes with a shield left\.$/.test(dodge.blurb) && /for one evening\.$/.test(town.blurb));
    CM.setComicEffects(true);
    ok('meteor missions: on — the wording is the same as ever',
      /will bonk you\. Turn, climb and dive, and watch them whoosh past\. Last three minutes/.test(dodge.blurb)
      && /the town has had enough bonks for one evening\.$/.test(town.blurb)
      && /^Three bonks — out of shields!/.test(lost(dodge, { shields: 0 }))
      && /^Five rocks bonked the town\./.test(lost(town, { landedTown: 5 })));
    ok('meteor missions: nothing to say while nothing is lost', lost(dodge, { shields: 2 }) === null && lost(town, { landedTown: 1 }) === null);
    CM.setComicEffects(false);
  }
}

/* ---- 7. the heat-seeker's card and the owner's trolls ------------------- */
{
  const { readFileSync } = await import('node:fs');
  CM.setComicEffects(false);
  ok('the missile card is plain off ("Missile hit") and itself on',
    CM.wordFor('MISSILE HIT!') === 'Missile hit' && (CM.setComicEffects(true), CM.wordFor('MISSILE HIT!') === 'MISSILE HIT!'));
  CM.setComicEffects(false);
  const trollWords = ['YEET!', 'WHOOSH', 'HI 👋'];
  ok('the trolls\' and teleports\' card words are plain off ("Launched", "Teleported", "Visitor")',
    trollWords.map((w) => CM.wordFor(w)).join('|') === 'Launched|Teleported|Visitor');
  CM.setComicEffects(true);
  ok('…and themselves on', trollWords.every((w) => CM.wordFor(w) === w));
  CM.setComicEffects(false);
  // The troll cards are made by the same bigCard() as the tag card, so they pass through wordFor; and the one joke
  // that is a LINE, not a word ("jk 😂"), must only ever reach the screen through pick().
  const trolls = readFileSync(new URL('features/owner/trolls.js', root), 'utf8');
  const jk = trolls.split('\n').filter((l) => /jk 😂.*got you/.test(l) && !/^\s*(\/?\*|\/\/)/.test(l));
  ok('the fake WASTED\'s "jk 😂" is behind pick() (one line, with a plain choice beside it)', jk.length === 1 && /pick\(/.test(jk[0]) && /Just a joke/.test(jk[0]), jk.join(' | ').slice(0, 120));
  const pvp = readFileSync(new URL('features/pvp.js', root), 'utf8');
  ok('pvp.js: the cartoon cloud, stars and word are one gated branch (poof/starBurst/word are gated in the pool)',
    /toon\.poof\(c, \{ n: 10/.test(pvp) && !/toon\.puff\(c, '#ffffff'/.test(pvp) && /if \(COMIC\.on\) toon\.puff\(c, by/.test(pvp));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
