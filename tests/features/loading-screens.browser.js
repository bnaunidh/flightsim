/**
 * Browser checks for the map loading screens, in the real game.
 * tests/features/loading-screens.mjs has already checked, in node, the
 * pictures, the tips, the credit line, the numbers and the wiring; this is
 * what only the running game shows:
 *
 *   - a Free Flight started from the menu puts the screen up at once, with
 *     THAT map's name, subtitle and picture, the aeroplane, a real tip (in
 *     the player's own keys) and the bar; and the flight itself has NOT
 *     started yet (the aeroplane never moves behind the screen);
 *   - a key before one second is ignored (and swallowed: the menu behind it
 *     never hears it); a key after one second skips; a tap on the screen
 *     after one second skips too;
 *   - left alone it stays about three seconds, then the flight starts and the
 *     screen is gone (not in the page, not in the way);
 *   - a start onto another map builds that map in stages behind it (all
 *     fifteen), the bar never gets ahead of the loading it stands for and
 *     never goes back, and the map is the one flown;
 *   - the boat and the van, started by their buttons (launchDrive), get it;
 *     a restart on the same map, and a start from code that is not a button's
 *     (startDrive itself), do not;
 *   - a Story chapter and a multiplayer join get it, for their own map;
 *   - every map's picture is really there, loads, and is the right size;
 *   - a map that says it is OpenStreetMap's shows "© OpenStreetMap contributors";
 *   - reduced motion stops the zoom; the fades are slow and one-way, so
 *     nothing on it can flash; it fits the screen; it makes no sound.
 *
 * `check(sim, r, say)` — r.ok(name, pass, detail) per assertion. Real timers
 * throughout (the suites freeze requestAnimationFrame, and the screen does not use it).
 */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => performance.now();

async function until(cond, ms = 6000, step = 20) {
  const t0 = now();
  while (now() - t0 < ms) {
    if (cond()) return true;
    await sleep(step);
  }
  return !!cond();
}

const screenEl = () => document.querySelector('.map-load');
const text = (sel) => {
  const el = document.querySelector(sel);
  return el ? el.textContent : null;
};

export async function check(sim, r, say = () => {}) {
  let LS;
  let TIPS;
  let MAPS;
  let I;
  try {
    LS = await import('../../src/features/loading-screens.js');
    TIPS = await import('../../src/ui/loading-tips.js');
    MAPS = (await import('../../src/world/maps.js')).MAPS;
    I = await import('../../src/flight/input.js');
  } catch (err) {
    r.ok('loading screens: the modules load', false, String(err && err.message));
    return;
  }
  const L = sim.loading;
  r.ok('loading screens: the game has a loading screen controller (sim.loading), with the screen off the page', !!L && !L.active && !screenEl(), L ? `enabled ${L.enabled}` : 'sim.loading is missing');
  if (!L) return;

  const wasEnabled = L.enabled;
  const wasReduced = sim.settings.reducedMotion;
  const wasMap = sim.settings.map;
  const cfg = L.config;
  r.ok('loading screens: about three seconds, skippable after one', cfg.minMs >= 3000 && cfg.minMs <= 3500 && cfg.skipAfterMs === 1000, `${cfg.minMs} ms, skip after ${cfg.skipAfterMs} ms`);
  const fakeNav = (ua, wd) => {
    try {
      Object.defineProperty(navigator, 'userAgent', { configurable: true, get: () => ua });
      Object.defineProperty(navigator, 'webdriver', { configurable: true, get: () => wd });
      return LS.isAutomated();
    } finally {
      delete navigator.userAgent;
      delete navigator.webdriver;
    }
  };
  r.ok('loading screens: a player\'s Chrome is not taken for a robot, a headless one is',
    fakeNav('Mozilla/5.0 Chrome/155.0.0.0 Safari/537.36', false) === false && fakeNav('Mozilla/5.0 HeadlessChrome/155.0.0.0', false) === true && fakeNav('Mozilla/5.0 Chrome/155', true) === true);

  const free = (extra = {}) => sim.startMode('free', { time: 'day', condition: 'clear', windSpeedKts: 0, windDirDeg: 0, ...extra });
  const toMenu = async () => {
    await until(() => !L.active, 3000);
    if (sim.state !== 'menu') sim.quitToMenu();
    await until(() => !L.active, 3000);
  };

  try {
    L.enabled = true;
    sim.settings.reducedMotion = false;
    await toMenu();
    sim.settings.map = wasMap;

    /* ---- 1. it shows on a map start, with that map's own things ---------- */
    const mapNow = MAPS.find((m) => m.id === sim.settings.map);
    const t0 = now();
    const done1 = free({ aircraft: 'skylark' }).then(() => now() - t0);
    const up = await until(() => !!screenEl() && screenEl().classList.contains('is-in'), 1500);
    r.ok('loading screens: a Free Flight from the menu puts the screen up at once', up, up ? `${Math.round(now() - t0)} ms` : 'no .map-load on the page');
    const el = screenEl();
    r.ok(`loading screens: it carries the map's name and subtitle (${mapNow.name}, ${mapNow.subtitle})`,
      text('.ml-title') === mapNow.name && text('.ml-sub') === mapNow.subtitle, `${text('.ml-title')} / ${text('.ml-sub')}`);
    const img = el && el.querySelector('.ml-art img');
    r.ok(`loading screens: it shows that map's own picture (assets/loading/${mapNow.id}.jpg)`, !!img && img.getAttribute('src') === `assets/loading/${mapNow.id}.jpg`, img ? img.getAttribute('src') : 'no picture');
    r.ok('loading screens: it names the aircraft you are flying, and the kind of flight', /Skylark/.test(text('.ml-craft') || '') && /free flight/i.test(text('.ml-kicker') || ''), `${text('.ml-craft')} / ${text('.ml-kicker')}`);
    const tip = text('.ml-tip-text') || '';
    r.ok('loading screens: it shows a real tip, with the keys written out (no braces)', tip.length > 12 && !/[{}]/.test(tip), tip);
    const tipActions = TIPS.tipsFor('flight').filter((t) => TIPS.renderTip(t, (a) => I.keyName(a, sim)) === tip);
    r.ok('loading screens: that tip is one of the game\'s own tips', tipActions.length === 1, tipActions.length ? tipActions[0] : 'not in the list');
    r.ok('loading screens: a slim progress bar is there', !!el.querySelector('.ml-bar .ml-fill') && el.querySelector('.ml-bar').getAttribute('role') === 'progressbar');
    r.ok('loading screens: behind it the flight has not started (the aeroplane never moves behind the screen)', sim.state === 'menu' && !sim.mode, `state ${sim.state}, mode ${sim.mode}`);
    const off = [...el.querySelectorAll('.ml-title, .ml-sub, .ml-craft, .ml-tip, .ml-bar')].filter((n) => {
      const b = n.getBoundingClientRect();
      return b.left < -1 || b.right > innerWidth + 1 || b.bottom > innerHeight + 1 || b.top < -1;
    });
    r.ok('loading screens: it fills the screen, its words and bar are all on it, and the page does not scroll sideways',
      el.getBoundingClientRect().width >= innerWidth - 1 && off.length === 0 && document.documentElement.scrollWidth <= innerWidth + 1, `${innerWidth} x ${innerHeight}; off-screen: ${off.map((n) => n.className).join(',') || 'none'}`);

    /* ---- 2. a key before a second does nothing, after a second skips ------ */
    const early = L.screen.elapsed;
    sim.key('KeyX', true);
    sim.key('KeyX', false);
    await sleep(60);
    r.ok('loading screens: a key before one second is ignored', early < 1000 && L.screen.skipRequested === false && !!screenEl() && sim.state === 'menu', `pressed at ${Math.round(early)} ms`);
    r.ok('loading screens: the "press any key" line is not shown yet', early < 1000 && !el.querySelector('.ml-skip').classList.contains('is-on'), `at ${Math.round(L.screen.elapsed)} ms`);
    const loaded = await until(() => img && img.complete && img.naturalWidth >= 1280, 700);
    r.ok('loading screens: the picture has loaded, 1280 px or wider, and faded up over the gradient', loaded && img.classList.contains('is-loaded'), img ? `${img.naturalWidth} x ${img.naturalHeight}, loaded class ${img.classList.contains('is-loaded')}` : '');
    await until(() => L.screen.elapsed >= 1080, 1500);
    const hintOn = await until(() => el.querySelector('.ml-skip').classList.contains('is-on'), 400);
    r.ok('loading screens: after one second it says so ("Press any key to skip")', hintOn && /skip/i.test(text('.ml-skip')), text('.ml-skip'));
    const tSkip = now() - t0;
    sim.key('KeyX', true);
    sim.key('KeyX', false);
    const ms1 = await done1;
    r.ok('loading screens: a key after one second skips it: the flight starts well before three seconds', sim.state === 'flying' && ms1 < 2600 && L.last.skipped === true, `skipped at ${Math.round(tSkip)} ms, flying after ${Math.round(ms1)} ms`);
    const gone1 = await until(() => !screenEl() && !L.active, 1500);
    r.ok('loading screens: and the screen goes away when the loading is finished (out of the page, not in the way)', gone1 && !document.querySelector('.map-load') && document.elementFromPoint(innerWidth / 2, innerHeight / 2) !== null, gone1 ? `gone ${Math.round(L.last.goneAt || 0)} ms after it started` : 'still on the page');

    /* ---- 3. left alone, about three seconds; a tap skips too -------------- */
    await toMenu();
    const t1 = now();
    const done2 = free({ aircraft: 'courier' }).then(() => now() - t1);
    await until(() => !!screenEl(), 1500);
    // sample the bar and the fades while it runs
    const samples = [];
    const opac = [];
    const sampler = setInterval(() => {
      const e = screenEl();
      if (!e) return;
      samples.push([L.screen.shown, L.screen.target, L.screen.elapsed]);
      opac.push(Number(getComputedStyle(e).opacity));
    }, 40);
    const ms2 = await done2;
    r.ok('loading screens: left alone it is up about three seconds (2.9 to 4.5 s) before the flight starts', ms2 >= 2900 && ms2 <= 4500 && sim.state === 'flying' && L.last.skipped === false, `${Math.round(ms2)} ms`);
    await until(() => !screenEl(), 1500);
    clearInterval(sampler);
    const ahead = samples.filter(([shown, target]) => shown > target + 1e-6).length;
    let back = 0;
    for (let i = 1; i < samples.length; i++) if (samples[i][0] < samples[i - 1][0] - 1e-9) back++;
    r.ok('loading screens: the bar never gets ahead of the loading it stands for, and never goes back', samples.length > 10 && ahead === 0 && back === 0, `${samples.length} samples, ${ahead} ahead, ${back} back`);
    r.ok('loading screens: the bar glides across the time (about half way at one and a half seconds)', (() => {
      const s = samples.filter(([, , e]) => e >= 1400 && e <= 1700);
      return s.length > 0 && s.every(([shown]) => shown > 0.3 && shown < 0.65);
    })(), (() => {
      const s = samples.filter(([, , e]) => e >= 1400 && e <= 1700);
      return s.length ? `${s[0][0].toFixed(2)}..${s[s.length - 1][0].toFixed(2)}` : 'no samples';
    })());
    // Fades: one rise, one fall, no flicker, and no jump bigger than half in 40 ms.
    let turns = 0;
    let maxStep = 0;
    for (let i = 1; i < opac.length; i++) maxStep = Math.max(maxStep, Math.abs(opac[i] - opac[i - 1]));
    let dir = 0;
    for (let i = 1; i < opac.length; i++) {
      const d = Math.sign(Math.round((opac[i] - opac[i - 1]) * 100));
      if (d !== 0 && d !== dir) {
        if (dir !== 0) turns++;
        dir = d;
      }
    }
    r.ok('loading screens: nothing flashes: it fades up once and down once, no step bigger than half in 40 ms', opac.length > 10 && turns <= 1 && maxStep < 0.5, `${opac.length} samples, ${turns} turn(s), biggest step ${maxStep.toFixed(2)}`);
    r.ok('loading screens: its fades are slow ones (a third of a second or more)', cfg.fadeInMs >= 300 && cfg.fadeOutMs >= 300);

    await toMenu();
    const t2 = now();
    const done3 = free({ aircraft: 'skylark' }).then(() => now() - t2);
    await until(() => !!screenEl() && L.screen.elapsed > 1060, 2500);
    const pe = screenEl();
    pe.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'touch' }));
    const ms3 = await done3;
    r.ok('loading screens: a tap on the screen after one second skips it too', L.last.skipped === true && ms3 < 2600, `${Math.round(ms3)} ms`);
    await until(() => !screenEl(), 1500);

    /* ---- 4. a map that is not the one built: built in stages behind it ---- */
    await toMenu();
    // First Light is a helicopter mission whose def names its own map (Port Kestrel) and aeroplane (the Skyhook).
    const portKestrel = MAPS.find((m) => m.id === 'kestrel-port');
    const targets = [];
    const watcher = setInterval(() => {
      if (L.active) targets.push([L.screen.shown, L.screen.target, sim._worldBuilding]);
    }, 25);
    sim.settings.map = wasMap;
    const done4 = sim.startAnyMission('firstlight');
    await until(() => !!screenEl(), 1500);
    r.ok(`loading screens: a mission on another map shows ITS map (${portKestrel.name}), not the one that was built`, text('.ml-title') === portKestrel.name, text('.ml-title'));
    r.ok('loading screens: with the mission\'s own aircraft and name (Skyhook, First Light)', /Skyhook/.test(text('.ml-craft') || '') && /first light/i.test(text('.ml-kicker') || '') && screenEl().dataset.game === 'heli', `${text('.ml-craft')} / ${text('.ml-kicker')} / ${screenEl().dataset.game}`);
    r.ok('loading screens: a helicopter tip', TIPS.tipsFor('heli').some((t) => TIPS.renderTip(t, (a) => I.keyName(a, sim)) === text('.ml-tip-text')), text('.ml-tip-text'));
    await until(() => L.last && L.last.built && L.last.steps >= 15, 12000);
    r.ok('loading screens: it built that map in all fifteen stages behind the screen', L.last.built === true && L.last.steps === 15, `${L.last.steps} stages: ${L.last.stages.slice(0, 3).join(' | ')}…`);
    r.ok('loading screens: the line under the tip says what is being built ("Shaping the land…")', L.last.stages.includes('Shaping the land…') && L.last.stages.every((x) => /…$/.test(x)), L.last.stages.join(' | '));
    await until(() => sim.state === 'flying', 12000);
    await done4;
    clearInterval(watcher);
    const ahead2 = targets.filter(([shown, target]) => shown > target + 1e-6).length;
    const sawBuilding = targets.some((t) => t[2] === true);
    r.ok('loading screens: the bar followed the real stages (never ahead of them) through the build', targets.length > 5 && ahead2 === 0, `${targets.length} samples, ${ahead2} ahead`);
    r.ok('loading screens: the frame loop was told the world was half built while it was (and is not now)', sawBuilding && sim._worldBuilding === false, `saw building ${sawBuilding}`);
    r.ok(`loading screens: the mission is flown on ${portKestrel.name}, which is borrowed and put back at the menu`,
      sim.settings.map === 'kestrel-port' && sim.mapBeforeMission === wasMap && sim.mode === 'mission' && !!sim.terrain && !!sim.sky, `map ${sim.settings.map}, will restore ${sim.mapBeforeMission}, mode ${sim.mode}`);
    await until(() => !screenEl(), 1500);
    sim.quitToMenu();
    r.ok('loading screens: quitting puts the chosen map back', sim.settings.map === wasMap, sim.settings.map);

    /* ---- 5. the boat and the van get it; a restart does not --------------- */
    await toMenu();
    const t5 = now();
    sim.launchDrive('boat', { mission: 'first-shout' });
    await until(() => !!screenEl(), 1500);
    const sennen = MAPS.find((m) => m.id === 'sennen');
    r.ok('loading screens: the boat\'s button shows the screen for the boat\'s map, with the launch', text('.ml-title') === sennen.name && /Launch/.test(text('.ml-craft') || '') && screenEl().dataset.game === 'boat', `${text('.ml-title')} / ${text('.ml-craft')}`);
    r.ok('loading screens: a boat tip', TIPS.tipsFor('boat').some((t) => TIPS.renderTip(t, (a) => I.keyName(a, sim)) === text('.ml-tip-text')) || TIPS.TIP_LISTS.any.some((t) => TIPS.renderTip(t, (a) => I.keyName(a, sim)) === text('.ml-tip-text')), text('.ml-tip-text'));
    await until(() => L.screen.elapsed > 1060, 2000);
    sim.key('Space', true);
    sim.key('Space', false);
    await until(() => sim.mode === 'drive' && sim.state === 'flying', 6000);
    r.ok('loading screens: and then the boat starts, on its own map', sim.mode === 'drive' && sim.state === 'flying' && sim.settings.map === 'sennen', `mode ${sim.mode}, map ${sim.settings.map}, ${Math.round(now() - t5)} ms`);
    await until(() => !screenEl(), 1500);
    // startDrive itself (what the race and a join call) stays synchronous and shows nothing.
    sim.quitToMenu();
    await until(() => sim.settings.map === wasMap, 8000);
    const countBefore = L.count;
    const v = sim.startDrive('boat', { mission: 'first-shout' });
    r.ok('loading screens: startDrive() itself stays synchronous (the race and a join carry on with the vehicle at once) and shows nothing', !!v && sim.mode === 'drive' && !screenEl() && L.count === countBefore, `returned ${v ? 'the vehicle' : v}, screens ${L.count - countBefore}`);
    sim.quitToMenu();
    await until(() => sim.settings.map === wasMap, 8000);

    const t6 = now();
    sim.launchDrive('car', {});
    await until(() => !!screenEl(), 1500);
    r.ok('loading screens: the van\'s button shows it too, with the van', /Van/.test(text('.ml-craft') || '') && screenEl().dataset.game === 'car', `${text('.ml-title')} / ${text('.ml-craft')}`);
    await until(() => L.screen.elapsed > 1060, 2000);
    L.skip();
    await until(() => sim.mode === 'drive' && sim.state === 'flying' && !L.active, 6000);
    r.ok('loading screens: then the van starts', sim.mode === 'drive' && sim.state === 'flying', `${Math.round(now() - t6)} ms`);
    sim.quitToMenu();
    await until(() => sim.settings.map === wasMap, 8000);

    // Restarting a flight from where you are (same map, not from the menu) shows nothing.
    await toMenu();
    L.enabled = false;
    await free({ aircraft: 'skylark' });
    L.enabled = true;
    const c0 = L.count;
    await sim.startMode(sim.mode, sim.modeOpts);
    r.ok('loading screens: a restart on the same map ("Fly again", the pause menu) shows no screen', L.count === c0 && !screenEl() && sim.state === 'flying', `${L.count - c0} screens`);

    /* ---- 5b. a Story chapter, and a multiplayer join ---------------------- */
    const STORY_KEY = 'islandsim.story.v1';
    const storySaved = localStorage.getItem(STORY_KEY);
    try {
      const Dr = await import('../../src/story/director.js');
      const ch1 = (await import('../../src/story/chapters.js')).CHAPTERS[0];
      await toMenu();
      const tChapter = now();
      const run = Dr.startChapter(ch1, { fresh: true, skipBriefing: true });
      const up = await until(() => !!screenEl(), 3000);
      const condor = MAPS.find((m) => m.id === ch1.map);
      r.ok(`loading screens: a Story chapter shows the screen for its map (${condor.name})`, up && text('.ml-title') === condor.name, text('.ml-title'));
      await until(() => L.screen.elapsed > 1060, 2000);
      L.skip();
      await until(() => sim.state === 'flying' && sim.mode === 'mission', 10000);
      r.ok('loading screens: and then chapter 1 starts, flown on that map', sim.state === 'flying' && sim.mode === 'mission' && sim.settings.map === ch1.map, `state ${sim.state}, mode ${sim.mode}, map ${sim.settings.map}, ${Math.round(now() - tChapter)} ms`);
      void run;
      await until(() => !screenEl(), 2000);
      sim.quitToMenu();
      await until(() => !Dr.D.active || sim.state === 'menu', 3000);
    } catch (err) {
      r.ok('loading screens: a Story chapter can be started behind the screen', false, String(err && err.message));
    } finally {
      if (storySaved == null) localStorage.removeItem(STORY_KEY);
      else localStorage.setItem(STORY_KEY, storySaved);
    }
    try {
      const { multiplayer: mp } = await import('../../src/features/multiplayer.js');
      r.ok('loading screens: a multiplayer join (enterWorld) is wrapped', mp._loadingWrapped === true, `wrapped ${mp._loadingWrapped}`);
      if (mp._loadingWrapped && typeof mp.install === 'function') {
        await toMenu();
        mp.install(sim);
        const meadow = MAPS.find((m) => m.id === 'meadow');
        const joined = mp.enterWorld({ map: 'meadow', game: 'flight', host: 'test' }, null, null, null);
        const upJ = await until(() => !!screenEl(), 3000);
        r.ok(`loading screens: a join onto ${meadow.name} shows ${meadow.name}, as Multiplayer`, upJ && text('.ml-title') === meadow.name && /multiplayer/i.test(text('.ml-kicker') || ''), `${text('.ml-title')} / ${text('.ml-kicker')}`);
        await until(() => L.screen.elapsed > 1060, 2000);
        L.skip();
        await joined;
        r.ok('loading screens: and then the join goes in, on that map', sim.state === 'flying' && sim.settings.map === 'meadow', `state ${sim.state}, map ${sim.settings.map}`);
        await until(() => !screenEl(), 2000);
        sim.quitToMenu();
        await until(() => sim.settings.map === wasMap, 8000);
      }
    } catch (err) {
      r.ok('loading screens: a multiplayer join can be started behind the screen', false, String(err && err.message));
    }

    /* ---- 6. every map's picture is there --------------------------------- */
    const bad = [];
    const heavy = [];
    let total = 0;
    for (const m of MAPS) {
      const url = LS.artPath(m.id);
      try {
        const res = await fetch(url, { cache: 'no-store' });
        const blob = await res.blob();
        total += blob.size;
        if (!res.ok || blob.type !== 'image/jpeg') {
          bad.push(`${m.id} (${res.status} ${blob.type})`);
          continue;
        }
        if (blob.size > 250 * 1024) heavy.push(`${m.id} ${Math.round(blob.size / 1024)} KB`);
        const bmp = await createImageBitmap(blob);
        if (bmp.width < 1280 || bmp.width > 1920 || Math.abs(bmp.width / bmp.height - 16 / 9) > 0.02) bad.push(`${m.id} ${bmp.width}x${bmp.height}`);
        bmp.close();
      } catch (e) {
        bad.push(`${m.id} (${String(e && e.message).slice(0, 40)})`);
      }
    }
    r.ok(`loading screens: each of the ${MAPS.length} maps has its picture, a 16:9 JPEG at least 1280 px wide`, bad.length === 0, bad.join(', ') || `${MAPS.length} pictures, ${(total / 1048576).toFixed(1)} MB`);
    r.ok('loading screens: and none is over 250 KB', heavy.length === 0, heavy.join(', ') || 'all light');

    /* ---- 7. the credit, reduced motion, sound ---------------------------- */
    await toMenu();
    const kestrel = MAPS.find((m) => m.id === wasMap) || MAPS[0];
    const hadOsm = kestrel.osm;
    kestrel.osm = true;
    const d4 = free({ aircraft: 'skylark' });
    await until(() => !!screenEl(), 1500);
    const credit = text('.ml-credit');
    r.ok('loading screens: a map built from OpenStreetMap shows "© OpenStreetMap contributors"', credit === '© OpenStreetMap contributors', credit);
    r.ok('loading screens: the zoom drifts by default', screenEl().classList.contains('is-drifting'));
    await until(() => L.screen.elapsed > 1060, 2000);
    L.skip();
    await d4;
    if (hadOsm === undefined) delete kestrel.osm;
    else kestrel.osm = hadOsm;
    await until(() => !screenEl(), 1500);
    await toMenu();
    r.ok('loading screens: and a map that is not, none', (() => {
      const info = L.infoFor({ mapId: wasMap, game: 'flight', vehicle: 'Skylark', kicker: 'Free Flight' });
      return info.credit === null;
    })());
    sim.settings.reducedMotion = true;
    const d5 = free({ aircraft: 'skylark' });
    await until(() => !!screenEl(), 1500);
    r.ok('loading screens: with reduced motion the picture does not zoom', !screenEl().classList.contains('is-drifting'));
    await until(() => L.screen.elapsed > 1060, 2000);
    L.skip();
    await d5;
    sim.settings.reducedMotion = false;
    await until(() => !screenEl(), 1500);

    r.ok('loading screens: no sound: the screen never touched the audio mixer', (() => {
      const mx = sim.audio && sim.audio.mixer;
      return !mx || !('loadingScreen' in mx);
    })());
    r.ok('loading screens: the screen and the game are both still standing (no console errors from the screen)', !sim._errored);
  } catch (err) {
    r.ok('loading screens: the checks ran to the end', false, String(err && err.stack || err).slice(0, 300));
  } finally {
    L.enabled = wasEnabled;
    sim.settings.reducedMotion = wasReduced;
    if (L.screen.active) L.screen.destroy();
    if (sim.state !== 'menu') sim.quitToMenu();
    if (sim.restoreChosenMap) sim.restoreChosenMap();
  }
}
