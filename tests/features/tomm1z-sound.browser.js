/**
 * Browser check for the Tomm1z video pass, item 3 — THE SCARY SOUND
 * (.claude/devtools/briefs/tomm1z-video.md, 2:49-3:20), as audio-graph data
 * in a muted page: in flight the engine loop is up; after a crash (the
 * debrief), on the main menu and in Settings nothing of the aeroplane loops —
 * engine, jet, wind, whistle, tyres, cabin, stall warner and gear horn at 0,
 * the radio queue empty. NOTHING IS PLAYED OUT LOUD: the page is muted and
 * only gain values are read.
 *
 *   node .claude/devtools/briefs/one-check.mjs <url>?mute=1 ./tests/features/tomm1z-sound.browser.js check "" 1
 */

export const id = 'tomm1z-sound';

const LOOPS = ['engine', 'jet', 'wind', 'whistle', 'tyres', 'cabin', 'stall', 'gearHorn'];
// The gains move on the audio clock, which runs in real time whatever sim.step() does: give them a moment.
const settle = (ms = 900) => new Promise((res) => setTimeout(res, ms));

export async function check(sim, r, say = () => {}) {
  const ok = (name, pass, detail = '') => r.ok(`tomm1z-sound: ${name}`, !!pass, detail);
  const autoPause = sim.autoPauseOnHide;
  sim.autoPauseOnHide = false;
  try {
    say('tomm1z-sound: nothing loops in the menu after a crash');
    await sim.startMode('free', { aircraft: 'skylark', time: 'day', condition: 'clear', windSpeedKts: 0, windDirDeg: 90 });
    const ac = sim.aircraft;
    if (!ac.engineOn) ac.startEngine();
    sim.step(3);
    const flying = sim.audio.loopLevels && sim.audio.loopLevels();
    ok('loopLevels() reads the audio graph', !!flying && typeof flying.engine === 'number', JSON.stringify(flying));
    ok('in flight the engine loop is up and nothing is hushed', flying && flying.engine > 0.05 && flying.hushed === false, flying && `engine ${flying.engine} hushed ${flying.hushed}`);
    ac.crash('Collision with the terminal', { worldPoint: ac.pos.clone(), part: 'fuselage' });
    // The crash debrief comes up 2.2 s after the impact (main.js _crashDebriefT), on the wall clock.
    for (let i = 0; i < 8 && sim.state === 'flying'; i++) {
      sim.step(0.5);
      await settle(400);
    }
    sim.step(0.5);
    await settle();
    const inDebrief = sim.audio.loopLevels();
    ok('after the crash, in the debrief, the hush is on', sim.state !== 'flying' && inDebrief && inDebrief.hushed === true, `${sim.state} ${JSON.stringify(inDebrief)}`);
    sim.quitToMenu('main');
    sim.step(3);
    await settle();
    const menu = sim.audio.loopLevels();
    ok('on the main menu nothing of the aeroplane loops (engine, jet, wind, whistle, tyres, cabin, stall warner, gear horn at 0)', menu && LOOPS.every((k) => menu[k] <= 0.01), JSON.stringify(menu));
    ok('...and the radio has nothing queued', menu && menu.radioQueue === 0 && menu.hushed === true, JSON.stringify(menu));
    sim.menus.show('settings');
    sim.step(2);
    await settle();
    const settings = sim.audio.loopLevels();
    ok('...in Settings too', settings && settings.engine <= 0.01 && settings.wind <= 0.01 && settings.radioQueue === 0, JSON.stringify(settings));
    sim.menus.show('main');
    // And flying again lifts it.
    await sim.startMode('free', { aircraft: 'skylark', time: 'day', condition: 'clear', windSpeedKts: 0, windDirDeg: 90 });
    if (!sim.aircraft.engineOn) sim.aircraft.startEngine();
    sim.step(3);
    await settle();
    const again = sim.audio.loopLevels();
    ok('the next flight has its engine back', again && again.engine > 0.05 && again.hushed === false, JSON.stringify(again));
  } finally {
    sim.autoPauseOnHide = autoPause;
    try {
      sim.quitToMenu('main');
    } catch (e) {
      void e;
    }
  }
}
