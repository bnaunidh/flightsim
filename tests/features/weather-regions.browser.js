/**
 * Regional weather on the World Map — Preview (wave 19, item 3).
 *
 *   node .claude/devtools/briefs/one-check.mjs <url>?mute=1 ./tests/features/weather-regions.browser.js check "" 1
 *
 * `check(sim, r, say)` — r.ok(name, pass, detail):
 *   - on the preview a Random flight rolls one weather per region
 *   - flying into another region is flying into its weather (and back)
 *   - worse weather on the track is called out ("Weather ahead: …") on the
 *     HUD and by the radio
 *   - the live map, zoomed out, draws an icon per region in view (the
 *     additive layer, features/wx-map.js), and the icons match the weather
 * The map and the weather are put back afterwards.
 */
const wait = (ms) => new Promise((res) => setTimeout(res, ms));

export async function check(sim, r, say = () => {}) {
  const wp = sim.worldPreview;
  r.ok('wx regions: the World Map preview is installed', !!wp);
  if (!wp) return;
  const WX = await import('../../src/world/wx.js');
  const WM = await import('../../src/features/wx-map.js');
  const LM = await import('../../src/features/livemap/livemap.js');
  const before = { weather: JSON.parse(JSON.stringify(sim.settings.weather)), map: sim.settings.map };
  const toasts = [];
  const on = sim.hud.notify.bind(sim.hud);
  sim.hud.notify = (t, ...a) => {
    toasts.push(String(t));
    return on(t, ...a);
  };
  const spoken = [];
  const os = sim.speak.bind(sim);
  sim.speak = (t, ...a) => {
    spoken.push(String(t));
    return os(t, ...a);
  };
  try {
    if (sim.state !== 'menu' && sim.quitToMenu) sim.quitToMenu();
    const done = wp.whenBuilt();
    wp.choose(wp.airports()[0].id);
    await Promise.race([done, wait(180000)]);
    await wait(50);
    window.__wxSeed = 9090;
    await sim.startMode('free', { loadingScreen: false, aircraft: 'skylark', time: 'day', condition: 'random', windSpeedKts: 8, windDirDeg: 250, airborne: true });
    sim.step(0.5);
    const w = sim.weather;
    const regions = wp.regions();
    r.ok('wx regions: a Random flight on the World Map rolls a weather for every region', w.wx && w.wx.lines.length === regions.length && regions.length >= 4,
      w.wx ? w.wx.regions.map((g, i) => `${g.id}: ${w.wx.lines[i].cond.label}`).join(', ') : 'no roll');

    // Two regions far apart, set to opposite weather.
    const home = w.wx.here;
    const far = regions.reduce((b, g, i) => (Math.hypot(g.cx - regions[home].cx, g.cz - regions[home].cz) > Math.hypot(regions[b].cx - regions[home].cx, regions[b].cz - regions[home].cz) ? i : b), 0);
    w.wx.lines[home] = new WX.WxTimeline(1, { start: 'clear' });
    w.wx.lines[far] = new WX.WxTimeline(1, { start: 'heavyRain' });
    const ac = sim.aircraft;
    const P = ac.pos.constructor;
    const g = w.wx.regions[far];
    ac.reset({ pos: new P(g.cx + w.wx.drift.x, 0, g.cz + w.wx.drift.z), headingDeg: 90, speed: 70, altAGL: 1500, engineOn: true, fuel: 1 });
    sim.step(0.5);
    const there = `${w.cond.label} ${(w.visibilityM(0) / 1000).toFixed(1)} km`;
    const wetThere = w.cond.rain > 0.5;
    const h = w.wx.regions[home];
    ac.reset({ pos: new P(h.cx + w.wx.drift.x, 0, h.cz + w.wx.drift.z), headingDeg: 90, speed: 70, altAGL: 1500, engineOn: true, fuel: 1 });
    sim.step(0.5);
    const back = `${w.cond.label} ${(w.visibilityM(0) / 1000).toFixed(1)} km`;
    r.ok('wx regions: flying into another region is flying into its weather, and back', wetThere && w.cond.rain < 0.05 && /Clear/.test(w.cond.label), `${g.name}: ${there}; ${h.name}: ${back}`);

    // Weather ahead: point at the wet region, 25 km short of it.
    const dx = g.cx - h.cx;
    const dz = g.cz - h.cz;
    const L = Math.hypot(dx, dz);
    const sx = g.cx + w.wx.drift.x - (dx / L) * 45000;
    const sz = g.cz + w.wx.drift.z - (dz / L) * 45000;
    const hdg = (Math.atan2(dx, -dz) * 180) / Math.PI;
    toasts.length = 0;
    spoken.length = 0;
    sim._wxAheadT = 0;
    sim._wxAheadSaid = '';
    ac.reset({ pos: new P(sx, 0, sz), headingDeg: hdg, speed: 70, altAGL: 1500, engineOn: true, fuel: 1 });
    sim.atc && (sim.atc.cool = 0);
    sim.step(0.2);
    const tAhead = toasts.find((t) => /Weather ahead/.test(t));
    const sAhead = spoken.find((t) => /weather ahead/i.test(t));
    r.ok('wx regions: worse weather on the track is called out on the HUD and by the radio ("Weather ahead")', !!tAhead && !!sAhead, `${tAhead || toasts.join(' / ')} | ${sAhead || spoken.join(' / ')}`);

    // The live map, zoomed right out.
    LM.open(sim);
    const S = LM.__livemap.S;
    if (S.view) {
      S.view.cx = 0;
      S.view.cz = 0;
      S.view.s = (S.W || 1200) / 420000;
      S.drawAcc = 1;
    }
    const f0 = WM.WX_MAP.frames;
    sim.step(0.2);
    const list = WM.regionWeather(w.wx);
    const icons = list.map((p) => `${p.id}:${p.icon}`);
    const okIcons = list.find((p) => p.id === w.wx.regions[far].id).icon === 'rain' && list.find((p) => p.id === w.wx.regions[home].id).icon === 'sun';
    r.ok('wx regions: the live map zoomed out draws a weather icon per region, rain where it rains and sun where it is clear', WM.WX_MAP.frames > f0 && WM.WX_MAP.icons >= 3 && okIcons, `${WM.WX_MAP.icons} icons drawn; ${icons.join(', ')}`);
    LM.close(sim);
  } finally {
    sim.hud.notify = on;
    sim.speak = os;
    window.__wxSeed = undefined;
    if (sim.state !== 'menu' && sim.quitToMenu) sim.quitToMenu();
    sim.settings.weather = before.weather;
    sim.weather.load(before.weather);
    if (before.map && before.map !== sim.settings.map && sim.setMap) {
      sim.setMap(before.map);
      await wait(2500);
    }
  }
}
