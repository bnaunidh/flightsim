/**
 * Browser checks for Comic effects (Settings → Graphics, OFF by default) —
 * the real game, the real menus, the real PvP and crash features.
 * tests/features/comic.mjs has already checked the setting, the helper, the
 * crash names, the map marks and the shared effects in node; this is what
 * only the running game shows:
 *
 *   - with the DEFAULT settings the switch is off, and it is in the Graphics
 *     tab, unticked; ticking it turns the effects on, saves it and puts a
 *     class on the page; unticking puts it all back;
 *   - a PvP tag with the default settings shows no comic word, no stars and
 *     no yellow comic card: "Tag scored", "Tagged out", "Mid-air collision"
 *     on a plain card in the game's own font, and the puff is grey smoke;
 *   - each of the six crashes, and a mid-air one, with the default settings:
 *     the real crash (the fireball, the wreck, the break-up) with its plain
 *     name and the flight model's reason on the banner and the debrief — no
 *     joke, no comic word, no stars, no choreography, no crash cam — and it
 *     still goes on the map and out to the other players; a friend's crash
 *     is named in plain words too;
 *   - the same events with Comic effects ON are the cartoon they always were.
 *
 * `check(sim, r, say)` — r.ok(name, pass, detail) per assertion.
 */

export async function check(sim, r, say = () => {}) {
  let CM;
  let FS;
  let cr;
  let hap;
  let shared;
  let pvp;
  let T;
  let THREE;
  try {
    CM = await import('../../src/render/comic.js');
    FS = await import('../../src/render/flash-safety.js');
    cr = await import('../../src/features/crashes.js');
    hap = await import('../../src/game/happenings.js');
    shared = await import('../../src/features/mpplay/shared.js');
    pvp = await import('../../src/features/pvp.js');
    T = await import('../../src/world/terrain.js');
    THREE = await import('../../src/vendor/three.module.js');
  } catch (err) {
    r.ok('comic: the modules load', false, String(err && err.message));
    return;
  }
  const D = cr.crashDebug();
  const C = D.C;
  const COMIC_RE = /bonk|poof|\bpow\b|splat|\bzap\b|whirr|thunk|fwump|sploosh|tumble|seeing stars|gymnastics|lawn dart/i;
  const saved = () => JSON.parse(localStorage.getItem('islandsim.settings.v1') || '{}');
  const setComic = (on) => sim.applySetting('comicEffects', on);

  const origComic = sim.settings.comicEffects;
  const origAuto = sim.autoPauseOnHide;
  const origSlow = sim.settings.crashSlowMo;
  const flashBefore = FS.FLASH.reduce;
  sim.autoPauseOnHide = false;
  // The break-up's slow-motion beat stretches game seconds into real ones; it is not what is measured here.
  sim.settings.crashSlowMo = false;
  const noDebrief = () => clearTimeout(sim._crashDebriefT);
  const free = (extra = {}) => sim.startMode('free', { airborne: true, time: 'day', condition: 'clear', windSpeedKts: 0, windDirDeg: 0, ...extra });

  try {
    /* ---- the default, and the switch -------------------------------------- */
    r.ok('comic: with the default settings Comic effects are off (setting, switch and page)',
      origComic === false && CM.COMIC.on === false && !document.documentElement.classList.contains('comic-effects'),
      `setting ${origComic}, switch ${CM.COMIC.on}`);
    if (sim.menus && sim.menus.syncSettings) sim.menus.syncSettings(sim.settings);
    const scr = sim.menus && sim.menus.screens && sim.menus.screens.settings;
    const box = scr && scr.querySelector('[data-set="comicEffects"]');
    r.ok('comic: Settings → Graphics has a "Comic effects" switch, and it is unticked', !!box && !!box.closest('[data-panel="graphics"]') && box.checked === false, box ? `checked ${box.checked}` : 'no switch');
    if (box) {
      box.checked = true;
      box.dispatchEvent(new Event('input', { bubbles: true }));
      r.ok('comic: ticking it turns the effects on, saves it and marks the page',
        sim.settings.comicEffects === true && CM.COMIC.on === true && saved().comicEffects === true && document.documentElement.classList.contains('comic-effects'),
        `setting ${sim.settings.comicEffects}, switch ${CM.COMIC.on}, saved ${saved().comicEffects}`);
      box.checked = false;
      box.dispatchEvent(new Event('input', { bubbles: true }));
      r.ok('comic: unticking it puts it all back', sim.settings.comicEffects === false && CM.COMIC.on === false && saved().comicEffects === false && !document.documentElement.classList.contains('comic-effects'));
    }
    r.ok('comic: Reduce flashing is not touched by it', FS.FLASH.reduce === flashBefore);

    /* ---- a PvP tag ------------------------------------------------------------ */
    say('comic: a PvP tag');
    await free();
    sim.step(0.3);
    const ch = shared.ch;
    const mp = shared.mp;
    const toon = shared.toon;
    const Pd = pvp.pvpDebug().P;
    const here = sim.aircraft.pos;
    const people = [
      { id: 1, name: 'Me Myself', colour: '#33aaff', me: true, pos: here },
      { id: 7, name: 'Brave Otter', colour: '#ff8800', me: false, pos: new THREE.Vector3(here.x + 60, here.y, here.z) },
      { id: 8, name: 'Swift Falcon', colour: '#44cc44', me: false, pos: new THREE.Vector3(here.x - 60, here.y, here.z) },
    ];
    const was = { roster: ch.roster, meId: mp.meId, chMeId: ch.meId };
    ch.roster = () => people;
    mp.meId = 1;
    ch.meId = 1;
    const putBack = () => {
      Pd.down = null;
      if (sim.model) sim.model.visible = true;
    };
    const shownWords = () => toon.words.filter((w) => w.s.visible);
    const shownStars = () => toon.stars.filter((s) => s.s.visible);
    const shownPuffs = () => toon.puffs.filter((p) => p.s.visible);
    const card = () => document.querySelector('.mpp-card');
    const cardFont = () => (card() && card().querySelector('strong') ? getComputedStyle(card().querySelector('strong')).fontFamily : '');
    try {
      r.ok('comic: the shared effects are built in the real world', toon.ready, 'toon.ready');

      setComic(false);
      toon.clear();
      ch._local('pvp:down', { t: 7, by: 8, how: 0 });
      r.ok('comic: off — somebody else\'s tag draws no comic word and no stars', shownWords().length === 0 && shownStars().length === 0, `${shownWords().length} words, ${shownStars().length} stars`);
      const grey = shownPuffs();
      r.ok('comic: off — …only a few puffs of grey smoke', grey.length > 0 && grey.length <= 5 && grey.every((p) => p.s.material.color.getHexString() === shared.SMOKE_PUFF.slice(1)), `${grey.length} puffs ${grey[0] && grey[0].s.material.color.getHexString()}`);
      r.ok('comic: off — the corner feed still says who tagged who, in plain words', shared.feedLines().some((l) => /Swift Falcon tagged Brave Otter/.test(l)), shared.feedLines().join(' | '));

      toon.clear();
      ch._local('pvp:down', { t: 7, by: 1, how: 0 });
      const t1 = shared.bigCardText();
      r.ok('comic: off — tagging somebody is "Tag scored", not TAGGED!', /Tag scored/.test(t1) && /You tagged Brave Otter/.test(t1) && !/TAGGED|BONK|POW/.test(t1), t1);
      r.ok('comic: off — …on a plain card, in the game\'s own font (no Arial Black)', !!card() && card().classList.contains('is-plain') && !/Arial Black|Impact/i.test(cardFont()), cardFont());

      ch._local('pvp:down', { t: 1, by: 7, how: 0 });
      const t2 = shared.bigCardText();
      r.ok('comic: off — being tagged is "Tagged out — back in 3"', /Tagged out/.test(t2) && /Brave Otter tagged you/.test(t2) && /back in 3/.test(t2) && !/TAGGED|BONK/.test(t2), t2);
      r.ok('comic: off — …with no comic word and no stars over you', shownWords().length === 0 && shownStars().length === 0);
      putBack();

      ch._local('pvp:down', { t: 1, by: -1, how: 1 });
      const t3 = shared.bigCardText();
      r.ok('comic: off — two aeroplanes colliding is a "Mid-air collision"', /Mid-air collision/.test(t3) && /You crashed into each other/.test(t3) && !/BONK|POOF/.test(t3), t3);
      putBack();

      // A heat-seeker's hit (how 2) is a real airburst and an ejected pilot; its card is plain too.
      toon.clear();
      ch._local('pvp:down', { t: 7, by: 1, how: 2 });
      const t3a = shared.bigCardText();
      r.ok('comic: off — landing a heat-seeker is a "Missile hit" card, no comic word, no stars', /Missile hit/.test(t3a) && /You tagged Brave Otter/.test(t3a) && !/MISSILE|TAGGED/.test(t3a) && shownWords().length === 0 && shownStars().length === 0, `${t3a} | ${shownWords().length} words, ${shownStars().length} stars`);
      ch._local('pvp:down', { t: 1, by: 7, how: 2 });
      const t3b = shared.bigCardText();
      r.ok('comic: off — being hit by a heat-seeker is "Missile hit", the pilot ejected, back in 3', /Missile hit/.test(t3b) && /missile got you/.test(t3b) && /ejected safely/.test(t3b) && !/MISSILE/.test(t3b), t3b);
      putBack();

      setComic(true);
      toon.clear();
      ch._local('pvp:down', { t: 7, by: 1, how: 2 });
      const t3c = shared.bigCardText();
      r.ok('comic: on — landing a heat-seeker is the MISSILE HIT! card, as ever', /MISSILE HIT!/.test(t3c) && !!card() && !card().classList.contains('is-plain'), t3c);
      putBack();
      toon.clear();
      ch._local('pvp:down', { t: 7, by: 8, how: 1 });
      const words = shownWords();
      r.ok('comic: on — a tag draws the comic word (BONK! for a collision) and seven stars', words.length === 1 && words[0].s.material.map === toon.wordTex['BONK!'] && shownStars().length === 7, `${words.length} words, ${shownStars().length} stars`);
      r.ok('comic: on — …in white and coloured puffs', shownPuffs().some((p) => p.s.material.color.getHexString() === 'ffffff') && shownPuffs().some((p) => p.s.material.color.getHexString() === '44cc44'));
      ch._local('pvp:down', { t: 1, by: 7, how: 0 });
      const t4 = shared.bigCardText();
      r.ok('comic: on — being tagged is the TAGGED! card, as ever', /TAGGED!/.test(t4) && /Brave Otter got you/.test(t4) && !!card() && !card().classList.contains('is-plain') && /Arial Black/.test(cardFont()), `${t4} | ${cardFont()}`);
      putBack();
    } finally {
      ch.roster = was.roster;
      mp.meId = was.meId;
      ch.meId = was.chMeId;
      putBack();
      toon.clear();
    }

    /* ---- the crashes, with the default settings ----------------------------- */
    say('comic: the crashes, off');
    setComic(false);
    const heard = [];
    const off = hap.onHappening((e) => heard.push(e));
    for (const kind of ['cartwheel', 'bellyflop', 'splash', 'wingclip', 'noseplant', 'bonk']) {
      await free();
      sim.step(0.3);
      const heardBefore = heard.length;
      // A new flight starts with a clean chart, so this crash's mark is the only one.
      const marksBefore = C.marks.list.length;
      const got = cr.stageCrash(sim, kind);
      noDebrief();
      const c = C.crash;
      const plain = D.KINDS[kind].plainTitle;
      const banner = sim.hud.banner ? sim.hud.banner.textContent : '';
      r.ok(`comic: off — ${kind} is a real crash with its plain name`, got === kind && sim.aircraft.crashed && !!c && c.kind === kind && c.comic === false && c.title === plain && c.caption === '', c ? `${c.kind}: "${c.title}" / "${c.caption}"` : 'no crash recorded');
      r.ok(`comic: off — ${kind}: the banner says "${plain}" and the reason, with no joke and no comic word`, banner.includes(plain) && banner.includes(c.reason) && !COMIC_RE.test(banner), banner.slice(0, 140));
      r.ok(`comic: off — ${kind}: no choreography, no crash cam, no stars, no comic word`, !C.script && !D.CAM.active && !(C.fx && C.fx.starsOn) && !(C.fx && C.fx.word.visible) && !document.body.classList.contains('crash-cam-on'));
      const ev = heard.slice(heardBefore).find((e) => e.type === 'crash');
      r.ok(`comic: off — ${kind}: still on the map and out to the other players`, C.marks.list.length === marksBefore + 1 && !!C.newestMine && C.newestMine.kind === kind && C.marks.list.includes(C.newestMine) && !!ev && ev.kind === kind && ev.map === T.MAP.id, JSON.stringify(ev));
      const start = sim.aircraft.pos.clone();
      let maxStep = 0;
      let prev = start.clone();
      let starsEver = false;
      for (let i = 0; i < 26; i++) {
        sim.step(0.1);
        const p = sim.aircraft.pos;
        maxStep = Math.max(maxStep, p.distanceTo(prev));
        prev = p.clone();
        if (C.fx && C.fx.starsOn) starsEver = true;
      }
      r.ok(`comic: off — ${kind}: two and a half seconds later still no stars, no camera, no choreography, and the wreck sits without jumping`,
        !starsEver && !C.script && !D.CAM.active && maxStep < 8 && [prev.x, prev.y, prev.z].every(Number.isFinite), `${maxStep.toFixed(2)} m in 0.1 s at most`);
      if (kind !== 'splash') r.ok(`comic: off — ${kind}: the real fireball and smoke are there (not the cartoon cloud)`, sim.wreck.active === true && sim.wreck.group.visible === true, `active ${sim.wreck.active}`);
    }

    /* a mid-air crash: into another aeroplane, high up */
    await free();
    sim.step(0.3);
    sim.aircraft.crash('You flew into Ironhead One', { part: 'fuselage', surfaceKind: 'aircraft', worldPoint: sim.aircraft.pos.clone() });
    noDebrief();
    const bm = sim.hud.banner ? sim.hud.banner.textContent : '';
    r.ok('comic: off — flying into another aeroplane is a "Mid-air collision"', !!C.crash && C.crash.kind === 'midair' && C.crash.title === 'Mid-air collision' && bm.includes('Mid-air collision') && bm.includes('Ironhead One') && !COMIC_RE.test(bm), `${C.crash && C.crash.kind} / ${bm.slice(0, 100)}`);

    /* the debrief */
    sim.showCrashDebrief(C.crash.reason);
    const dbTitle = document.querySelector('[data-screen="debrief"] [data-title]');
    const dbBody = document.querySelector('[data-screen="debrief"] [data-body]');
    r.ok('comic: off — the debrief is titled with the plain name and has no joke over the reason',
      !!dbTitle && dbTitle.textContent === 'Mid-air collision' && !!dbBody && !dbBody.querySelector('.debrief-caption') && dbBody.textContent.includes(C.crash.reason) && !COMIC_RE.test(dbBody.textContent),
      dbTitle ? `${dbTitle.textContent} / ${dbBody.textContent.slice(0, 100)}` : 'no debrief');

    /* a friend's crash is named by MY setting */
    await free();
    sim.step(0.3);
    const ac = sim.aircraft;
    hap.receiveHappening(sim, { type: 'crash', kind: 'bonk', vehicle: 'plane', x: ac.pos.x + 300, z: ac.pos.z, map: T.MAP.id }, { name: 'Brave Otter', colour: '#ff9f1c' });
    r.ok('comic: off — a friend\'s crash is a toast in plain words ("Brave Otter: Collision")', (sim.hud.toasts || []).some((t) => /Brave Otter: Collision/.test(t.node.textContent)), (sim.hud.toasts || []).map((t) => t.node.textContent).join(' | '));
    off();

    /* ---- the same crash, with Comic effects ON --------------------------------- */
    say('comic: a crash, on');
    setComic(true);
    await free();
    sim.step(0.3);
    cr.stageCrash(sim, 'bonk');
    noDebrief();
    const cc = C.crash;
    const bon = sim.hud.banner ? sim.hud.banner.textContent : '';
    r.ok('comic: on — a building crash is the BONK: its comic title and a joke over the reason', !!cc && cc.comic === true && cc.title === 'Bonk!' && cc.caption.length > 3 && bon.includes('Bonk!') && bon.includes(cc.caption), bon.slice(0, 120));
    r.ok('comic: on — …with the crash cam and the choreography', D.CAM.active && !!C.script);
    for (let i = 0; i < 8; i++) sim.step(0.1);
    r.ok('comic: on — …and it sees stars, not the fireball', !!(C.fx && C.fx.starsOn) && !sim.wreck.active);
    sim.step(2.5);
    sim.showCrashDebrief(C.crash.reason);
    const dbBody2 = document.querySelector('[data-screen="debrief"] [data-body]');
    r.ok('comic: on — the debrief has the joke', !!dbBody2 && !!dbBody2.querySelector('.debrief-caption'));
  } finally {
    setComic(origComic === true);
    sim.autoPauseOnHide = origAuto;
    sim.settings.crashSlowMo = origSlow;
    try {
      await free();
    } catch (e) {
      /* the next check starts its own flight */
    }
  }
  r.ok('comic: the setting is back where it was', CM.COMIC.on === (origComic === true) && sim.settings.comicEffects === (origComic === true));
}
