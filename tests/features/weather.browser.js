/**
 * Random weather in the game (wave 19).
 *
 *   node .claude/devtools/briefs/one-check.mjs <url>?mute=1 ./tests/features/weather.browser.js check "" 1
 *
 * `check(sim, r, say)` — r.ok(name, pass, detail):
 *   - Free Flight's Sky picker: Random first, Clear always, every fixed sky
 *   - a Free Flight on Random rolls the day's sky from its seed (?wxseed= or
 *     window.__wxSeed); the same seed rolls the same sky; the tower's first
 *     call gives the wind (and the gusts / the visibility when there are any)
 *   - the HUD's wind card says the phase in words, and the notice of a change
 *     ("Weather changing: … in ~2 min") shows before it comes in
 *   - every phase draws (fog, mist, heavy rain, a thunderstorm, snow, far-off
 *     cells, overcast) without an error, the fog drawn is the phase's
 *   - low near the runway the murk waits (the approach hold)
 *   - Clear always is clear, with no phases
 *   - changing map keeps Random (and Clear always)
 * The weather, the map and Free Flight are put back afterwards.
 */
const wait = (ms) => new Promise((res) => setTimeout(res, ms));

export async function check(sim, r, say = () => {}) {
  const WX = await import('../../src/world/wx.js');
  const W = await import('../../src/world/weather.js');
  const before = { weather: JSON.parse(JSON.stringify(sim.settings.weather)), map: sim.settings.map };
  const errors = [];
  const oe = console.error;
  console.error = (...a) => {
    errors.push(a.map(String).join(' ').slice(0, 200));
    oe.apply(console, a);
  };
  const spoken = [];
  const os = sim.speak.bind(sim);
  sim.speak = (text, ...rest) => {
    spoken.push(String(text));
    return os(text, ...rest);
  };
  const toasts = [];
  const on = sim.hud.notify.bind(sim.hud);
  sim.hud.notify = (text, ...rest) => {
    toasts.push(String(text));
    return on(text, ...rest);
  };
  try {
    if (sim.state !== 'menu' && sim.quitToMenu) sim.quitToMenu();
    /* ---- the picker ---- */
    const free = sim.menus.screens && sim.menus.screens.free;
    const sel = free && free.querySelector('[data-cond]');
    const opts = sel ? [...sel.options].map((o) => `${o.value}:${o.textContent}`) : [];
    r.ok('weather: the Sky picker offers Random first, then Clear always, and every fixed sky', opts.length >= 5 && /^random:Random/.test(opts[0]) && opts.some((o) => /^clear:Clear always/.test(o)) && ['cloudy', 'rainy', 'stormy'].every((k) => opts.some((o) => o.startsWith(`${k}:`))), opts.join(' | '));

    /* ---- a random flight ---- */
    window.__wxSeed = 4242;
    spoken.length = 0;
    await sim.startMode('free', { loadingScreen: false, aircraft: 'skylark', time: 'day', condition: 'random', windSpeedKts: 6, windDirDeg: 250 });
    sim.step(1);
    const w = sim.weather;
    const first = w.wx ? `${w.cond.phase}|${w.windDirDeg.toFixed(2)}|${w.windSpeedKts.toFixed(2)}` : null;
    const d = w.describe();
    r.ok('weather: a Random Free Flight rolls the day\'s sky from its seed', !!w.wx && w.wx.seed === 4242 && WX.PHASES[w.cond.phase], `${d.label}, ${d.wind}${d.vis ? `, ${d.vis}` : ''}`);
    const brief = toasts.find((t) => /^Today: /.test(t));
    r.ok('weather: the flight starts with the day\'s weather in a line ("Today: … · wind … — it changes as you fly")', !!brief && brief.includes(d.word) && / · wind \d{3} at \d+/.test(brief), brief || toasts.join(' / '));
    const tower = spoken.find((t) => t.includes(d.windRadio));
    r.ok('weather: the radio\'s first call gives the day\'s wind (gusts and visibility when there are any)', !!tower && tower.includes(d.windRadio) && (!d.vis || tower.includes(d.vis)), tower || spoken.slice(0, 3).join(' / '));
    sim.quitToMenu();
    await sim.startMode('free', { loadingScreen: false, aircraft: 'skylark', time: 'day', condition: 'random', windSpeedKts: 6, windDirDeg: 250 });
    sim.step(1);
    const again = w.wx ? `${w.cond.phase}|${w.windDirDeg.toFixed(2)}|${w.windSpeedKts.toFixed(2)}` : null;
    r.ok('weather: the same seed on the same map rolls the same sky', first && first === again, `${first} / ${again}`);
    window.__wxSeed = undefined;

    /* ---- the HUD ---- */
    sim.step(0.6);
    const card = sim.hud.weatherText ? sim.hud.weatherText.textContent : '';
    const chip = sim.hud.wxChip ? sim.hud.wxChip.textContent : '';
    r.ok('weather: the wind card names the phase, the folded chip says it in words', card.startsWith(w.cond.label) && chip.toLowerCase().includes(String(w.cond.label).toLowerCase()), `"${card}" / "${chip}"`);
    // Bring the next change to two and a half minutes off.
    const L = w.wx.lines[w.wx.here];
    L.t = L.dur - L.warnS - 1;
    toasts.length = 0;
    sim.step(2);
    sim.step(0.6);
    const notice = toasts.find((t) => /Weather changing/.test(t));
    const detail = sim.hud.windDetail ? sim.hud.windDetail.textContent : '';
    r.ok('weather: a change is announced first — a notice, and the card says it ("Weather changing: … in ~N min")', !!notice && /in ~\d+ min/.test(notice) && /Weather changing/.test(detail), `${notice || toasts.join(' / ')} | card: ${detail}`);

    /* ---- every phase draws ---- */
    const drawn = [];
    const fogBad = [];
    for (const id of ['fog', 'mist', 'heavyRain', 'storm', 'snow', 'cells', 'overcast', 'haze', 'clear']) {
      w.wx.lines[w.wx.here] = new WX.WxTimeline(7, { start: id });
      const ac = sim.aircraft;
      ac.reset({ pos: new ac.pos.constructor(ac.pos.x, 0, ac.pos.z), headingDeg: 90, speed: 60, altAGL: 300, engineOn: true, fuel: 1 });
      sim.step(0.5);
      const c = w.cond;
      const fog = sim.scene.fog;
      // The scene's fog is the phase's own (the sun's scattering may thicken it a little, a cloud more).
      if (sim.cloudImmersion < 0.01 && !(fog.density >= c.fog * 0.99 && fog.density <= c.fog * 3.5)) fogBad.push(`${id}: ${fog.density.toExponential(2)} vs ${c.fog.toExponential(2)}`);
      drawn.push(`${id} ${(w.visibilityM(0) / 1000).toFixed(1)} km ${w.effectiveCondition}`);
    }
    r.ok('weather: every phase draws without an error (fog, mist, heavy rain, a storm, snow, far cells, overcast, haze, clear)', errors.length === 0 && drawn.length === 9, errors.slice(0, 2).join(' / ') || drawn.join(', '));
    r.ok('weather: the fog drawn is the phase\'s visibility', fogBad.length === 0, fogBad.join('; ') || 'all match');
    w.wx.lines[w.wx.here] = new WX.WxTimeline(7, { start: 'storm' });
    sim.step(0.2);
    r.ok('weather: a thunderstorm phase is "stormy" to everything that asks', w.effectiveCondition === 'stormy', w.effectiveCondition);

    /* ---- the approach hold ---- */
    {
      const ac = sim.aircraft;
      const RW = (await import('../../src/world/airport.js')).RUNWAY;
      ac.reset({ pos: new ac.pos.constructor(RW.cx - 3500, 0, RW.cz), headingDeg: 90, speed: 55, altAGL: 200, engineOn: true, fuel: 1 });
      sim.step(0.1);
      const held = w.obs.hold;
      ac.reset({ pos: new ac.pos.constructor(RW.cx - 30000, 0, RW.cz), headingDeg: 90, speed: 55, altAGL: 1500, engineOn: true, fuel: 1 });
      sim.step(0.1);
      r.ok('weather: low near the runway, in the air, the murk waits (approach hold); far off it does not', held === true && w.obs.hold === false, `near ${held}, far ${w.obs.hold}`);
    }

    /* ---- Clear always ---- */
    sim.quitToMenu();
    await sim.startMode('free', { loadingScreen: false, aircraft: 'skylark', time: 'day', condition: 'clear', windSpeedKts: 4, windDirDeg: 90 });
    for (let i = 0; i < 6; i++) sim.step(10, 1 / 10);
    r.ok('weather: Clear always is clear — no roll, no phases', !w.wx && w.cond === W.CONDITIONS.clear && w.effectiveCondition === 'clear', w.cond.label);
    sim.quitToMenu();

    /* ---- the map change keeps it ---- */
    sim.settings.weather.condition = 'random';
    w.load({ condition: 'random' });
    const home = sim.settings.map || 'kestrel';
    const other = home === 'atoll' ? 'kestrel' : 'atoll';
    sim.setMap(other);
    await wait(2500);
    for (let i = 0; i < 40 && sim.settings.map !== other; i++) await wait(250);
    const kept = sim.weather.condition;
    sim.setMap(home);
    await wait(2500);
    r.ok('weather: changing map keeps Random (the new map rolls its own)', kept === 'random' && sim.settings.weather.condition === 'random', `${other}: ${kept}`);
  } finally {
    console.error = oe;
    sim.speak = os;
    sim.hud.notify = on;
    window.__wxSeed = undefined;
    if (sim.state !== 'menu' && sim.quitToMenu) sim.quitToMenu();
    sim.settings.weather = before.weather;
    sim.weather.load(before.weather);
  }
}
