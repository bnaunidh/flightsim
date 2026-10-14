/**
 * Browser checks for STORY MODE — "Signal Zero" (src/story), in the real game.
 * tests/features/story.mjs checks the save, the plan, the chapter graph, the
 * script and the medals in node; this is what node cannot see:
 *
 *   - the STORY card first on every game's front page, with live text;
 *   - Story → New game → Pilot → the briefing (a route picture, three
 *     bullets, GO) → chapter 1 opens IN THE AIR on Condor Rock in the Tempest,
 *     at night, in a squall, with the objective line, the tracker and the
 *     beat registered only while it runs;
 *   - a SCRIPTED PILOT plays chapter 1 to the end: climbs, catches the
 *     fireball, presses SPACE for the photo (the hand-held camera), turns
 *     home, lands on the clifftop strip — through the title cards, Cole's
 *     race and the hangar cutscene — to the debrief with a medal, then
 *     TO BE CONTINUED (chapter 2 has not shipped), with the save moved on;
 *   - LEAVE AND CONTINUE: a second new game, quit to the menu after the
 *     "alongside" checkpoint; Continue resumes the same beat and step, within
 *     a few metres of the saved pose, after the "Previously on…" card;
 *   - TEACH BY DOING: a first-timer (never landed, never said otherwise)
 *     gets power, nose and bank, one prompt each with their own keys, over
 *     inside the first minute; "I know how to fly" ends them and is saved;
 *   - FAIL AND RETRY: a fail shows one kind line and Retry / Restart / Quit,
 *     saves nothing, and Retry from checkpoint is back in the air in ≤ 3 s
 *     at the same step and the checkpoint's pose;
 *   - the one-minute guarantee: no two autosaves more than 75 s of play apart;
 *   - Reduce flashing stays on and nothing of the story is left on screen
 *     after quitting.
 *
 * It puts the player's own story save back afterwards.
 * `check(sim, r, say)` — r.ok(name, pass, detail) per assertion.
 */

export const id = 'story';

const KEY = 'islandsim.story.v1';

async function tick(ms = 40) {
  await new Promise((res) => setTimeout(res, ms));
}

async function waitFor(fn, tries = 200, ms = 40) {
  for (let i = 0; i < tries; i++) {
    if (fn()) return true;
    await tick(ms);
  }
  return !!fn();
}

export async function check(sim, r, say) {
  let saved = null;
  try {
    saved = localStorage.getItem(KEY);
  } catch (e) {
    saved = null;
  }
  const origAuto = sim.autoPauseOnHide;
  sim.autoPauseOnHide = false;
  const realRender = sim.renderer.render.bind(sim.renderer);
  sim.renderer.render = () => {};
  const origReduce = sim.settings.reduceFlashing;
  // A first-timer, for the teach-by-doing prompts: the game has never seen this player land.
  const origLandings = sim.progress ? sim.progress.landings : 0;
  if (sim.progress) sim.progress.landings = 0;
  let Dir;
  let THREE;
  let Missions;
  let Ch1;
  let Airport;
  let Terrain;
  try {
    Dir = await import('../../src/story/director.js');
    THREE = await import('../../src/vendor/three.module.js');
    Missions = await import('../../src/game/missions.js');
    Ch1 = await import('../../src/story/ch01-the-glint.js');
    Airport = await import('../../src/world/airport.js');
    Terrain = await import('../../src/world/terrain.js');
  } catch (err) {
    r.ok('story: the modules load', false, String(err && err.message));
    return;
  }
  const menus = sim.menus;
  const S = () => sim.story.state;

  try {
    /* ---- a clean slate ------------------------------------------------- */
    try {
      localStorage.removeItem(KEY);
    } catch (e) {
      /* fine */
    }
    if (sim.state !== 'menu') sim.quitToMenu('main');
    Dir.reloadSave();

    /* ---- 1. the card --------------------------------------------------- */
    say('story: the card');
    const firsts = {};
    for (const g of ['flight', 'heli', 'boat', 'car']) {
      menus.setGame(g);
      const cards = [...menus.screens.main.querySelectorAll('.main-nav .card-btn')];
      firsts[g] = cards.length ? cards[0].dataset.act : null;
    }
    menus.setGame('flight');
    menus.show('main');
    r.ok('story: a STORY card first on every game\'s front page', Object.values(firsts).every((a) => a === 'story'), JSON.stringify(firsts));
    const card = menus.screens.main.querySelector('[data-act="story"]');
    r.ok('story: the card says what it is, with the kittiwake mark and a NEW ribbon before the first play', !!card && /Signal Zero/.test(card.textContent) && /12-chapter/.test(card.textContent) && !!card.querySelector('.sz-mark') && !!card.querySelector('.sz-new'), card && card.textContent.replace(/\s+/g, ' ').trim());
    card.click();
    r.ok('story: the card opens the Story screen', menus.current === 'story');
    const hub = menus.screens.story.querySelector('[data-hub]');
    r.ok('story: no save → Start the story, Chapters and Extras; no Continue', !!hub && !hub.querySelector('[data-story="continue"]') && !!hub.querySelector('[data-story="new"]') && !!hub.querySelector('[data-story="chapters"]'));
    menus.screens.story.querySelector('[data-story="chapters"]').click();
    const tiles = [...menus.screens['story-chapters'].querySelectorAll('[data-tile]')];
    r.ok('story: thirteen chapter tiles — chapter 1 open, 2-13 locked "???" coming soon', tiles.length === 13 && !tiles[0].classList.contains('is-locked') && tiles.slice(1).every((t) => t.classList.contains('is-locked') && /\?\?\?/.test(t.textContent)), `${tiles.length} tiles; locked ${tiles.filter((t) => t.classList.contains('is-locked')).length}`);

    /* ---- 2. new game → briefing → in the air ---------------------------- */
    say('story: new game');
    menus.show('story');
    menus.screens.story.querySelector('[data-story="new"]').click();
    menus.screens['story-new'].querySelector('[data-diff="pilot"]').click();
    await waitFor(() => menus.current === 'story-briefing', 50);
    const brief = menus.screens['story-briefing'];
    const bullets = brief.querySelectorAll('[data-brief-bullets] li');
    const mapCanvas = brief.querySelector('[data-brief-map]');
    let mapPainted = false;
    try {
      const px = mapCanvas.getContext('2d').getImageData(0, 0, mapCanvas.width, mapCanvas.height).data;
      let lit = 0;
      for (let i = 0; i < px.length; i += 4 * 97) if (px[i] + px[i + 1] + px[i + 2] > 120) lit++;
      mapPainted = lit > 20;
    } catch (e) {
      mapPainted = false;
    }
    r.ok('story: the briefing card — a route picture and three bullets, GO or SPACE', menus.current === 'story-briefing' && bullets.length === 3 && mapPainted && !!brief.querySelector('[data-go]'), `${bullets.length} bullets, map painted ${mapPainted}`);
    brief.querySelector('[data-go]').click();
    const flying = await waitFor(() => sim.state === 'flying' && sim.runner.def && sim.runner.def.id === 'story-ch01-chase', 400, 50);
    const ac = sim.aircraft;
    r.ok('story: chapter 1 opens in the air on Condor Rock, in the Tempest, at night in a squall',
      flying && sim.settings.map === 'condor' && sim.aircraftType.id === 'tempest' && sim.weather.time === 'night' && sim.weather.condition === 'stormy' && !ac.onGround && ac.pos.y > 1200,
      `${sim.state} ${sim.runner.def && sim.runner.def.id} ${sim.settings.map} ${sim.aircraftType && sim.aircraftType.id} y ${Math.round(ac.pos.y)}`);
    r.ok('story: the beat is in the mission list only while it runs, as a story def', !!Missions.findMission('story-ch01-chase') && Missions.gameOf(Missions.findMission('story-ch01-chase')) === 'story');
    r.ok('story: the HUD has the objective line and the arrow has a target from the first second', /Climb/.test(sim.hud.objectiveText.textContent) && !!sim.runner.activeTarget(), sim.hud.objectiveText.textContent);
    const st0 = S();
    r.ok('story: the chapter saved at the air start', st0.active && st0.phase === 'playing' && st0.saveLog.length >= 1 && st0.data.chapter === 'ch01-the-glint' && st0.data.beat === 'story-ch01-chase' && !!st0.data.pose, JSON.stringify(st0.saveLog));
    r.ok('story: a first-timer gets the "First flight" card, with "I know how to fly"', !!Ch1.CHAPTER_1._state.coachUi && !!document.querySelector('.sz-coach [data-c-skip]'));
    r.ok('story: the meteor feature runs the photo run with a hand-held camera', sim.meteors && sim.meteors.active && sim.meteors.mode === 'photo' && sim.meteors.photoInfo().manual === true && sim.meteors.photoInfo().range <= 650);

    /* ---- 3. the scripted pilot plays it to the end ------------------------ */
    say('story: the scripted pilot');
    const play = await flyChapter(sim, { THREE, Airport, Terrain, Ch1, say, tick, maxSeconds: 520 });
    const log = play.log;
    r.ok('story: the pilot caught the fireball (within 400 m)', play.steps.includes('photo') || play.photo, `${play.steps.join(' → ')} | ${log.slice(0, 20).join(' | ')}`);
    r.ok('story: SPACE took the photo (the hand-held shutter) and the race with Cole was decided', play.photo && play.photoDist > 0 && play.photoDist <= 700 && (play.coleShotT != null || play.playerShotT != null), `photo ${play.photoDist} m q${play.photoQuality} player ${play.playerShotT} cole ${play.coleShotT} | ${log.slice(0, 24).join(' | ')}`);
    r.ok('story: the title cards came up after objective 2 (SIGNAL ZERO, then THE GLINT), thin bars, and you kept flying', play.cards.includes('SIGNAL ZERO') && play.cards.includes('THE GLINT'), play.cards.join(' | '));
    r.ok('story: lines were spoken with portraits (the observatory, Cole, Mara)', ['observatory', 'cole', 'mara'].every((w) => play.whos.includes(w)), play.whos.join(','));
    r.ok('story: power, then the nose, then the bank — one prompt each, the keys the player\'s own', play.coachSeen.join() === 'throttle,pitch,roll' && /<kbd>Shift<\/kbd>/.test(play.coachFirst), `${play.coachSeen.join()} | ${play.coachFirst}`);
    r.ok('story: the prompts were over inside the first minute, and "knows how to fly" was saved', play.coachDoneT != null && play.coachDoneT <= 60 && S().data.flags.knowsFlying === true, `done at ${play.coachDoneT} s; ${JSON.stringify(play.coachResults)}`);
    r.ok('story: the landing beat followed in the same flight', play.steps.includes('approach') && play.steps.includes('land'), play.steps.join(' → '));
    r.ok('story: landed and stopped on Condor Rock, no crash', play.landed && !play.crashed, `${play.landed} crashed ${play.crashed} ${play.crashReason || ''} ${log.slice(-3).join(' | ')}`);
    r.ok('story: the hangar cutscene played (letterbox, the camera on a rail, the photo reveal) and ended', play.cutscene, JSON.stringify(play.cinemaLog.filter((e) => e.kind === 'cutscene' || e.kind === 'cutscene-end').map((e) => `${e.kind}:${e.id}:${e.how || ''}`)));
    r.ok('story: the debrief shows a medal and a score, with Next chapter / Replay / Story menu', menus.current === 'story-debrief' && !!menus.screens['story-debrief'].querySelector('.sz-medal') && /\/100/.test(menus.screens['story-debrief'].textContent) && !!menus.screens['story-debrief'].querySelector('[data-dact="next"]'), `${menus.current} ${play.verdict ? JSON.stringify(play.verdict) : ''}`);
    const data1 = S().data;
    r.ok('story: the save records chapter 1 done with its medal, and the pointer moved to chapter 2', data1.chapters['ch01-the-glint'] && data1.chapters['ch01-the-glint'].done && data1.chapters['ch01-the-glint'].medal && data1.chapter === 'ch02-fire-line' && data1.beat === null, JSON.stringify({ ch: data1.chapter, rec: data1.chapters['ch01-the-glint'] }));
    const gaps = [];
    for (let i = 1; i < play.saveLog.length; i++) gaps.push(play.saveLog[i].t - play.saveLog[i - 1].t);
    r.ok('story: no two autosaves more than 75 s of play apart (the one-minute guarantee)', gaps.length >= 3 && Math.max(...gaps) <= 75, `gaps ${gaps.map((g) => g.toFixed(0)).join(',')} s; saves ${play.saveLog.map((s) => s.id).join(',')}`);
    menus.screens['story-debrief'].querySelector('[data-dact="next"]').click();
    await waitFor(() => menus.current === 'story-tbc', 100);
    r.ok('story: Next chapter → TO BE CONTINUED, naming Fire Line as the next update, with the medal', menus.current === 'story-tbc' && /To be continued/i.test(menus.screens['story-tbc'].textContent) && /Fire Line/.test(menus.screens['story-tbc'].textContent) && !!menus.screens['story-tbc'].querySelector('.sz-medal'), menus.screens['story-tbc'].textContent.replace(/\s+/g, ' ').trim().slice(0, 160));
    r.ok('story: after the chapter the beats are out of the mission list and the story is idle', !Missions.findMission('story-ch01-chase') && !S().active && sim.state === 'menu');
    menus.show('story');
    const hub2 = menus.screens.story.querySelector('[data-hub]');
    r.ok('story: Continue now shows on the hub (the next chapter is coming)', !!hub2.querySelector('[data-story="continue"]'), hub2.textContent.replace(/\s+/g, ' ').trim().slice(0, 120));

    /* ---- 4. leave, then continue -------------------------------------------- */
    say('story: leave and continue');
    menus.screens.story.querySelector('[data-story="new"]').click();
    menus.screens['story-new'].querySelector('[data-diff="pilot"]').click();
    await waitFor(() => menus.current === 'story-new' && !menus.screens['story-new'].querySelector('[data-confirm]').hidden, 50);
    r.ok('story: New game with a save asks first ("This replaces your story progress…")', !menus.screens['story-new'].querySelector('[data-confirm]').hidden);
    menus.screens['story-new'].querySelector('[data-start-over]').click();
    await waitFor(() => menus.current === 'story-briefing', 50);
    brief.querySelector('[data-go]').click();
    await waitFor(() => sim.state === 'flying' && sim.runner.def && sim.runner.def.id === 'story-ch01-chase', 400, 50);
    const keepMedal = S().data.chapters['ch01-the-glint'];
    r.ok('story: starting over keeps the medal', !!(keepMedal && keepMedal.done));
    r.ok('story: starting over keeps "knows how to fly" — no prompts the second time', !Ch1.CHAPTER_1._state.coachUi && S().data.flags.knowsFlying === true);
    const part = await flyChapter(sim, { THREE, Airport, Terrain, Ch1, say, tick, maxSeconds: 200, stopAtCheckpoint: 'Alongside the fireball' });
    const cp = S().checkpoint;
    r.ok('story: reached the "alongside" checkpoint and it saved', !!cp && /Alongside/.test(cp.label) && S().data.step === 2 && !!S().data.pose, JSON.stringify({ cp, step: S().data.step, steps: part.steps }));
    const savedPose = S().data.pose;
    sim.step(6, 1 / 30); // fly on a little past the checkpoint, then leave
    const leftAt = sim.aircraft.pos.clone();
    sim.quitToMenu('main');
    const raw = JSON.parse(localStorage.getItem(KEY));
    r.ok('story: quitting mid-chapter keeps the last checkpoint, not the instant you left', raw && raw.chapter === 'ch01-the-glint' && raw.beat === 'story-ch01-chase' && raw.step === 2 && raw.pose && Math.hypot(raw.pose.pos[0] - savedPose.pos[0], raw.pose.pos[2] - savedPose.pos[2]) < 1 && leftAt.distanceTo(new THREE.Vector3(...raw.pose.pos)) > 50, `left ${Math.round(leftAt.distanceTo(new THREE.Vector3(...raw.pose.pos)))} m past the save`);
    r.ok('story: nothing of the story is left on screen in the menu', !S().active && (!document.getElementById('sz-cinema') || document.getElementById('sz-cinema').hidden) && !(document.getElementById('sz-tracker') && document.getElementById('sz-tracker').classList.contains('on')));
    menus.show('story');
    const contBtn = menus.screens.story.querySelector('[data-story="continue"]');
    r.ok('story: the hub offers Continue at the checkpoint', !!contBtn && /Alongside/.test(contBtn.textContent) && /saved/.test(contBtn.textContent), contBtn && contBtn.textContent.replace(/\s+/g, ' ').trim());
    contBtn.click();
    await waitFor(() => sim.state === 'flying' && S().active, 400, 50);
    const cin = sim.story.cinema;
    r.ok('story: Continue → "Previously on SIGNAL ZERO…" with the checkpoint name, the aeroplane held still', cin.card === 'SIGNAL ZERO' && cin.cardKind === 'recap' && S().ready && cin.hold, JSON.stringify({ card: cin.card, kind: cin.cardKind, ready: S().ready }));
    const pos0 = sim.aircraft.pos.clone();
    sim.step(1, 1 / 30);
    r.ok('story: frozen on the recap — the aeroplane did not move', pos0.distanceTo(sim.aircraft.pos) < 2, `${pos0.distanceTo(sim.aircraft.pos).toFixed(2)} m`);
    r.ok('story: resumed in the same beat at the same step, within metres of the saved pose, with the fireball back alongside', sim.runner.def.id === 'story-ch01-chase' && sim.runner.step && sim.runner.step.id === 'photo' && sim.aircraft.pos.distanceTo(new THREE.Vector3(...savedPose.pos)) < 30 && !!sim.meteors.giantPos(), `${sim.runner.step && sim.runner.step.id} off by ${Math.round(sim.aircraft.pos.distanceTo(new THREE.Vector3(...savedPose.pos)))} m`);
    // Skip the recap and READY: the key the hijack's cinematic uses.
    sim.tap('KeyC');
    sim.step(0.5, 1 / 30);
    sim.tap('KeyC');
    sim.step(2.5, 1 / 30);
    r.ok('story: after the READY card the controls are back and it flies on', !S().ready && !sim.story.cinema.hold && pos0.distanceTo(sim.aircraft.pos) > 20 && sim.state === 'flying', `${pos0.distanceTo(sim.aircraft.pos).toFixed(0)} m on, ready ${S().ready}`);
    r.ok('story: Reduce flashing is still on', sim.settings.reduceFlashing === origReduce);

    /* ---- 5. fail, then retry from the checkpoint ---------------------------- */
    say('story: fail and retry');
    const cpF = { step: S().data.step, pose: S().data.pose }; // the last checkpoint, as saved
    const savesF = S().saveLog.length;
    const splash = (await import('../../src/story/script.js')).LINES['c1-fail-splash'].text;
    sim.runner.fail(splash); // what the beat's failIf does when it splashes before the shot
    await waitFor(() => menus.current === 'story-fail', 50);
    const failScr = menus.screens['story-fail'];
    r.ok('story: a fail shows one kind line and Retry from checkpoint / Restart chapter / Quit', menus.current === 'story-fail' && failScr.textContent.includes(splash.slice(0, 20)) && !!failScr.querySelector('[data-fact="retry"]') && !!failScr.querySelector('[data-fact="restart"]') && !!failScr.querySelector('[data-fact="quit"]'), failScr && failScr.textContent.replace(/\s+/g, ' ').trim().slice(0, 160));
    r.ok('story: nothing is autosaved while failing', S().saveLog.length === savesF && S().phase === 'failed');
    const tR = performance.now();
    failScr.querySelector('[data-fact="retry"]').click();
    const backUp = await waitFor(() => sim.state === 'flying' && S().active && sim.runner.def && sim.runner.step, 150, 20);
    const tookR = (performance.now() - tR) / 1000;
    r.ok('story: Retry from checkpoint is back in the air in ≤ 3 s, same beat and step, at the checkpoint', backUp && tookR <= 3 && sim.runner.def.id === 'story-ch01-chase' && sim.runner.stepIndex === cpF.step && !sim.aircraft.onGround && sim.aircraft.pos.distanceTo(new THREE.Vector3(...cpF.pose.pos)) < 30, `${tookR.toFixed(2)} s; ${sim.runner.def && sim.runner.def.id} step ${sim.runner.stepIndex} of ${cpF.step}; ${Math.round(sim.aircraft.pos.distanceTo(new THREE.Vector3(...cpF.pose.pos)))} m from it`);
    r.ok('story: after the retry the fail panel is gone and the tracker is back', menus.current !== 'story-fail' && S().phase !== 'failed');

    /* ---- 6. "I know how to fly" ------------------------------------------- */
    say('story: I know how to fly');
    sim.quitToMenu('main');
    S().data.flags.knowsFlying = false;
    if (sim.progress) sim.progress.landings = 0; // chapter 1's landing above counted one
    menus.show('story');
    menus.screens.story.querySelector('[data-story="new"]').click();
    menus.screens['story-new'].querySelector('[data-diff="pilot"]').click();
    await waitFor(() => menus.current === 'story-new' && !menus.screens['story-new'].querySelector('[data-confirm]').hidden, 50);
    menus.screens['story-new'].querySelector('[data-start-over]').click();
    await waitFor(() => menus.current === 'story-briefing', 50);
    menus.screens['story-briefing'].querySelector('[data-go]').click();
    await waitFor(() => sim.state === 'flying' && sim.runner.def && sim.runner.def.id === 'story-ch01-chase', 400, 50);
    sim.step(3, 1 / 30);
    const cUi = Ch1.CHAPTER_1._state.coachUi;
    const shownFirst = cUi && cUi.showing;
    const skipBtn = document.querySelector('.sz-coach [data-c-skip]');
    if (skipBtn) skipBtn.click();
    sim.step(1, 1 / 30);
    let rawK = null;
    try {
      rawK = JSON.parse(localStorage.getItem(KEY));
    } catch (e) {
      rawK = null;
    }
    r.ok('story: "I know how to fly" ends the prompts at once and the save remembers it', shownFirst === 'throttle' && !!cUi && cUi.done && cUi.coach.current === null && S().data.flags.knowsFlying === true && (!S().storageOk || (rawK && rawK.flags.knowsFlying === true)), `first ${shownFirst}; done ${cUi && cUi.done}; saved ${rawK && rawK.flags.knowsFlying}`);
    sim.quitToMenu('main');
    r.ok('story: no "First flight" card is left on screen after quitting', !document.querySelector('.sz-coach'));
  } catch (err) {
    r.ok('story: the check ran to the end', false, String(err && err.stack || err).slice(0, 400));
  } finally {
    try {
      if (sim.state !== 'menu') sim.quitToMenu('main');
    } catch (e) {
      /* fine */
    }
    try {
      if (saved == null) localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, saved);
    } catch (e) {
      /* fine */
    }
    try {
      Dir.reloadSave();
    } catch (e) {
      /* fine */
    }
    sim.renderer.render = realRender;
    sim.autoPauseOnHide = origAuto;
    if (sim.progress) sim.progress.landings = origLandings;
  }
}

/* ====================================================================== */
/*
 * The scripted pilot for chapter 1: one controller steering heading, height
 * and speed at sim.runner.activeTarget() through sim.override (the input
 * main.js applies over the keyboard), modelled on tests/features/mission-
 * pilot.js. It presses real keys: SPACE for the photo, G for the gear. For
 * the landing: a join point 5 km short of the touchdown along the runway,
 * then a three-degree glide, flaps, wheels and a flare.
 */
async function flyChapter(sim, { THREE, Airport, Ch1, say, tick, maxSeconds = 500, stopAtCheckpoint = null }) {
  const ac = sim.aircraft;
  const { RUNWAY } = Airport;
  const heightAt = (await import('../../src/world/terrain.js')).heightAt;
  const ground = (x, z) => Math.max(0, heightAt(x, z));
  const K = Ch1.CHAPTER_1._state;
  const out = { coachSeen: [], coachFirst: '', coachResults: null, coachDoneT: null, log: [], steps: [], cards: [], whos: [], photo: false, photoDist: 0, photoQuality: 0, playerShotT: null, coleShotT: null, landed: false, crashed: false, crashReason: '', cutscene: false, cinemaLog: [], saveLog: [], verdict: null };
  let T = 0;
  const log = (s) => {
    out.log.push(`${T.toFixed(0)}s ${s}`);
  };
  const TAN3 = Math.tan((3 * Math.PI) / 180);
  const B = { hdg: ac.heading, alt: ac.pos.y, spd: 95, target: null, glide: false, flare: false, L: 90, td: new THREE.Vector3(), join: null, I: 0, Is: 0, Ix: 0, out: {}, maxBank: 28, holdHdg: false, maxSink: 10, onTrack: false };
  const compute = () => {
    const dt = 1 / 30;
    const o = B.out;
    let wantHdg = B.hdg;
    let wantY = B.alt;
    let ffVs = 0;
    if (B.glide) {
      const L = (B.L * Math.PI) / 180;
      const cross = (ac.pos.x - B.td.x) * Math.cos(L) + (ac.pos.z - B.td.z) * Math.sin(L);
      const along = (B.td.x - ac.pos.x) * Math.sin(L) - (B.td.z - ac.pos.z) * Math.cos(L);
      B.Ix = Math.max(-8, Math.min(8, B.Ix + cross * dt * 0.004));
      wantHdg = B.L - Math.max(-30, Math.min(30, cross * (along < 3000 ? 0.12 : 0.05) + B.Ix));
      wantY = B.td.y + Math.max(0, along) * TAN3;
      ffVs = -ac.groundSpeed * TAN3;
    } else if (B.target && !B.holdHdg) {
      wantHdg = ((Math.atan2(B.target.x - ac.pos.x, -(B.target.z - ac.pos.z)) * 180) / Math.PI + 360) % 360;
    }
    const err = ((wantHdg - ac.heading + 540) % 360) - 180;
    const lim = B.glide && ac.agl < 150 ? 15 : B.maxBank;
    const wantBank = ac.onGround ? 0 : Math.max(-lim, Math.min(lim, err * 0.8));
    const bank = ac.bankAngleDeg();
    o.roll = Math.max(-0.7, Math.min(0.7, (wantBank - bank) * 0.055 - ac.omega.z * 0.55));
    let wantVs = Math.max(-B.maxSink, Math.min(9, (wantY - ac.pos.y) * 0.08 + ffVs));
    if (B.glide && ac.pos.y - B.td.y < 40) wantVs = Math.max(wantVs, -3.5);
    if (B.flare) wantVs = ac.pos.y - B.td.y > 2 ? -1.6 : -0.8;
    const floorY = ground(ac.pos.x, ac.pos.z);
    if (!B.glide && !ac.onGround && ac.pos.y - floorY < 90) wantVs = Math.max(wantVs, 3);
    B.I = Math.max(-0.4, Math.min(0.5, B.I + (wantVs - ac.vs) * dt * 0.03));
    o.pitch = ac.onGround ? 0 : Math.max(-0.6, Math.min(0.75, B.I + (wantVs - ac.vs) * 0.12 - ac.omega.x * 0.6 + (Math.abs(bank) / 25) * 0.06));
    B.Is = Math.max(-0.4, Math.min(0.5, B.Is + (B.spd - ac.ias) * dt * 0.01));
    o.throttle = (B.flare && ac.agl < 8) ? 0 : ac.onGround ? 0 : Math.max(0, Math.min(1, 0.5 + (B.spd - ac.ias) * 0.05 + B.Is + wantVs * 0.02));
    o.yaw = ac.onGround ? Math.max(-1, Math.min(1, err * 0.08)) : Math.max(-0.5, Math.min(0.5, (ac.beta || 0) * 1.6));
    o.brakes = ac.onGround && ac.groundTime > 0.8 ? 1 : 0;
  };
  const CTRL = {};
  Object.defineProperty(CTRL, 'pitch', { enumerable: true, get() { compute(); return B.out.pitch; } });
  for (const k of ['roll', 'yaw', 'throttle', 'brakes']) Object.defineProperty(CTRL, k, { enumerable: true, get() { return B.out[k]; } });

  const planLanding = () => {
    const td = RUNWAY.touchdown.clone();
    const L = RUNWAY.headingDeg ?? 90;
    const rad = (L * Math.PI) / 180;
    B.td.copy(td);
    B.L = L;
    B.join = new THREE.Vector3(td.x - Math.sin(rad) * 5200, td.y + 300, td.z + Math.cos(rad) * 5200);
    B.glide = false;
    B.flare = false;
    log(`landing planned: join ${B.join.x.toFixed(0)},${B.join.z.toFixed(0)}`);
  };
  const flyLanding = () => {
    if (!B.glide) {
      B.target = B.join;
      B.alt = B.join.y;
      B.spd = 70;
      const d = Math.hypot(B.join.x - ac.pos.x, B.join.z - ac.pos.z);
      const err = Math.abs((((B.L - ac.heading) % 360) + 540) % 360 - 180);
      if (d < 800 && err < 50) {
        B.glide = true;
        log('on the glide');
      }
      return;
    }
    // Full flap, the Tempest's 1.3 × landing stall: a short, wet strip with a cliff at the end.
    B.spd = 44;
    if (!ac.gearDown) sim.tap('KeyG');
    if (ac.flapStep && ac.flapStep() < 2 && ac.pos.y - B.td.y < 500) ac.setFlaps(ac.flapStep() + 1);
    if (!B.flare && ac.pos.y - B.td.y < Math.max(8, -ac.vs * 3) && !ac.onGround) {
      B.flare = true;
      log('flare');
    }
  };

  let lastStep = null;
  let lastCards = 0;
  let snapCool = 0;
  const seenWho = new Set();
  const seenCards = new Set();
  sim.override = CTRL;
  try {
    while (T < maxSeconds) {
      sim.step(0.25, 1 / 30);
      T += 0.25;
      // The director's beat and finale hand-offs are promise continuations:
      // give them a turn every step, and the page's timers one every second.
      await Promise.resolve();
      if (T % 1 < 0.25) await tick(0);
      const st = sim.story.state;
      const cin = sim.story.cinema;
      for (const e of cin.log.slice(lastCards)) {
        if (e.kind === 'card' && !seenCards.has(e.main)) {
          seenCards.add(e.main);
          out.cards.push(e.main);
        }
        if (e.kind === 'line' && e.who && !seenWho.has(e.who)) {
          seenWho.add(e.who);
          out.whos.push(e.who);
        }
        if (e.kind === 'cutscene-end' && e.id === 'ch01-hangar') out.cutscene = true;
      }
      lastCards = cin.log.length;
      if (K.coachUi) {
        const sh = K.coachUi.showing;
        if (sh && sh !== 'ok' && !out.coachSeen.includes(sh)) {
          out.coachSeen.push(sh);
          if (!out.coachFirst) out.coachFirst = (document.querySelector('.sz-coach [data-c-line]') || {}).innerHTML || '';
        }
        out.coachResults = { ...K.coachUi.coach.results };
        if (K.coachUi.done && out.coachDoneT == null) out.coachDoneT = T;
      }
      out.cinemaLog = cin.log;
      out.saveLog = st.saveLog;
      const step = sim.runner.step;
      const stepId = step ? step.id : null;
      if (stepId !== lastStep) {
        log(`step ${stepId} (${sim.runner.def && sim.runner.def.id}) at ${ac.pos.x.toFixed(0)},${ac.pos.z.toFixed(0)} y ${ac.pos.y.toFixed(0)} ias ${ac.ias.toFixed(0)}`);
        if (stepId) out.steps.push(stepId);
        // The land step ends the moment she stops: count it here, it never comes round again.
        if (lastStep === 'land' && ac.onGround && !ac.crashed) out.landed = true;
        lastStep = stepId;
        // Short final and the landing are the same approach, flown on.
        if (stepId !== 'short-final' && stepId !== 'land') {
          B.join = null;
          B.glide = false;
          B.flare = false;
        }
        B.holdHdg = false;
      }
      if (ac.crashed) {
        out.crashed = true;
        out.crashReason = ac.crashReason;
        log(`CRASHED ${ac.crashReason}`);
        break;
      }
      if (stopAtCheckpoint && st.checkpoint && st.checkpoint.label === stopAtCheckpoint) {
        log(`checkpoint ${stopAtCheckpoint}`);
        break;
      }
      if (st.phase === 'debrief' || sim.state === 'debrief') {
        log(`debrief (${st.phase})`);
        break;
      }
      if (!st.active) {
        log('story not active');
        break;
      }
      if (st.phase === 'cutscene') {
        // Let it play: nothing to fly. (Skipping is tested elsewhere.)
        continue;
      }
      const at = sim.runner.activeTarget();
      B.target = at ? at.pos : null;
      B.spd = 95;
      B.maxSink = 10;
      B.maxBank = 28;
      if (B.target) B.alt = Math.max(B.target.y, ground(ac.pos.x, ac.pos.z) + 150);
      const def = sim.runner.def && sim.runner.def.id;
      if (def === 'story-ch01-chase') {
        const giant = sim.meteors && sim.meteors.giantPos();
        if (stepId === 'climb') B.alt = Math.max(B.alt, 1850);
        if ((stepId === 'catch' || stepId === 'photo') && giant) {
          // It crosses in front, right to left, and comes down faster than
          // you can sink at cruise. Far off: chase it (pure pursuit, a little
          // behind it), which rolls out in its wake with the dive's speed in
          // hand. Close: fly its track's heading, steer onto it and hold a
          // slot ~220 m behind it (it sits in the frame), the speed set by
          // how far ahead or behind the slot you are — a formation, not a pass.
          const d = ac.pos.distanceTo(giant);
          const gv = sim.meteors.meteors().find((m) => m.giant);
          const u = gv ? gv.vel.clone().setY(0).normalize() : new THREE.Vector3(0, 0, -1);
          const nr = new THREE.Vector3(-u.z, 0, u.x); // the track's right
          const rel = ac.pos.clone().sub(giant).setY(0);
          const along = rel.dot(u);
          const cross = rel.dot(nr);
          const gSpd = gv ? gv.speed : 75;
          if (!B.onTrack && d < 1400 && along < 0 && Math.abs(cross) < 900) B.onTrack = true;
          if (d < 650) {
            // In range: nose on it, so it sits in the middle of the frame.
            B.target = giant.clone();
            B.holdHdg = false;
            B.spd = gSpd + 6;
          } else if (!B.onTrack) {
            B.target = giant.clone().addScaledVector(u, -Math.min(400, d * 0.1));
            B.holdHdg = false;
            B.spd = 118;
          } else {
            const trackHdg = ((Math.atan2(u.x, -u.z) * 180) / Math.PI + 360) % 360;
            B.holdHdg = true;
            B.hdg = (trackHdg - Math.max(-50, Math.min(50, (cross - 40) * 0.05)) + 360) % 360;
            B.spd = Math.max(52, Math.min(118, gSpd + Math.max(-25, Math.min(34, (-220 - along) * 0.08))));
          }
          B.maxBank = 40;
          B.alt = Math.max(giant.y + (d < 650 ? 0 : 10), ground(ac.pos.x, ac.pos.z) + 120);
          // It comes down at about 15 m/s from below the climb's 6,000 ft: dive onto it.
          B.maxSink = 28;
          const info = sim.meteors.photoInfo();
          snapCool -= 0.25;
          if (stepId === 'photo' && info.inRange && !info.taken && snapCool <= 0) {
            sim.tap('Space');
            snapCool = 0.6;
            log(`SPACE at ${d.toFixed(0)} m aimed ${info.aimed}`);
          }
          const s = sim.meteors.stats;
          if (s.photoTaken && !out.photo) {
            out.photo = true;
            out.photoDist = s.photoDistance;
            out.photoQuality = s.photoQuality;
            log(`photo taken ${s.photoDistance} m ${s.photoQuality}%`);
          }
        }
        out.playerShotT = K.playerShotT;
        out.coleShotT = K.coleShotT;
      } else if (def === 'story-ch01-land') {
        if (stepId === 'approach' || stepId === 'short-final' || stepId === 'land') {
          if (!B.join) planLanding();
          flyLanding();
          if (ac.onGround && ac.groundSpeed < 1.5 && ac.groundTime > 1) out.landed = true;
        }
      }
      if (T % 15 < 0.25) {
        const g = sim.meteors && sim.meteors.giantPos && sim.meteors.giantPos();
        log(`… ${ac.pos.x.toFixed(0)},${ac.pos.z.toFixed(0)} y ${ac.pos.y.toFixed(0)} ias ${ac.ias.toFixed(0)} hdg ${ac.heading.toFixed(0)} step ${stepId} phase ${st.phase}${g ? ` giant ${g.x.toFixed(0)},${g.z.toFixed(0)} y ${g.y.toFixed(0)} d ${ac.pos.distanceTo(g).toFixed(0)}` : ''}`);
      }
    }
  } finally {
    sim.override = null;
  }
  out.verdict = sim.story.state.data.chapters['ch01-the-glint'] || null;
  out.seconds = T;
  return out;
}
