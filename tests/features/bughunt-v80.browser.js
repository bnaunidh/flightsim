/**
 * The post-demo bug hunt (v80, 2026-11-09): one check per bug a player hit
 * while the game was played headless, mode by mode, each written to fail on the
 * code before its fix.
 *
 *   node .claude/devtools/briefs/one-check.mjs '<url>?mute=1' ./tests/features/bughunt-v80.browser.js check "" 1
 *
 * @param {object} sim   window.__sim
 * @param {object} r     reporter: r.ok(name, pass, detail)
 * @param {function} say logger
 */
export const id = 'bughunt-v80';

const wait = (ms) => new Promise((f) => setTimeout(f, ms));
const key = (code, k, type) => window.dispatchEvent(new KeyboardEvent(type, { code, key: k, bubbles: true }));
const press = (sim, code, k) => {
  key(code, k, 'keydown');
  sim.step(1 / 30, 1 / 30);
  key(code, k, 'keyup');
};

export async function check(sim, r, say = () => {}) {
  const realRender = sim.renderer.render;
  sim.renderer.render = () => {};
  const auto = sim.autoPauseOnHide;
  sim.autoPauseOnHide = false;
  try {
    await gearOnGround(sim, r, say);
    await tailStrike(sim, r, say);
    await staleKeyWords(sim, r, say);
    await coachOverRadio(sim, r, say);
    await hiddenOnTablet(sim, r, say);
    await largeTextReload(sim, r, say);
    await touchKeyNames(sim, r, say);
    await raceCrash(sim, r, say);
    await getOutDoor(sim, r, say);
    await heliLeverWords(sim, r, say);
  } finally {
    sim.renderer.render = realRender;
    sim.autoPauseOnHide = auto;
    sim.override = null;
    if (sim.state !== 'menu') sim.quitToMenu();
  }
}

/*
 * 1. G (or the touch GEAR pad) on the runway raised the wheels under a parked
 * aeroplane: it sat down on its belly, "You landed with the wheels up", in
 * every type. A leg carrying the aeroplane does not fold now (weight on
 * wheels), and you are told why; in the air the gear still comes up.
 */
export async function gearOnGround(sim, r) {
  const fly = async (id) => {
    if (sim.state !== 'menu') sim.quitToMenu();
    await wait(50);
    await sim.startMode('free', { aircraft: id, taxi: false, loadingScreen: false, time: 'day', condition: 'clear', windSpeedKts: 0 });
    for (let i = 0; i < 300 && sim.state !== 'flying'; i++) await wait(10);
    sim.step(0.5, 1 / 30);
    return sim.aircraft;
  };
  const listen = async (fn) => {
    const said = [];
    const notify = sim.hud.notify;
    sim.hud.notify = function (t, ...rest) {
      said.push(t);
      return notify.call(this, t, ...rest);
    };
    try {
      await fn();
    } finally {
      sim.hud.notify = notify;
    }
    return said;
  };
  for (const id of ['skylark', 'a320']) {
    const ground = {};
    // The key, then (a fresh flight) the touch GEAR pad, each left three seconds.
    for (const [how, act] of [['G', () => press(sim, 'KeyG', 'g')], ['pad', () => sim.hudAction('gear')]]) {
      const ac = await fly(id);
      const said = await listen(async () => {
        act();
        for (let i = 0; i < 30 && !ac.crashed; i++) sim.step(0.1, 1 / 30);
      });
      ground[how] = { gearDown: ac.gearDown, crashed: ac.crashed, why: ac.crashReason, onGround: ac.onGround, said };
    }
    // ...and in the air the wheels still come up.
    const ac = sim.aircraft;
    ac.reset({ pos: ac.pos.clone(), headingDeg: 90, speed: 60, altAGL: 300, engineOn: true });
    sim.step(0.3, 1 / 30);
    const said = await listen(async () => {
      press(sim, 'KeyG', 'g');
      sim.step(0.5, 1 / 30);
    });
    const air = { gearDown: ac.gearDown, said };
    const held = (g) => g.gearDown && !g.crashed && g.onGround && g.said.some((t) => /stays down on the ground/.test(t)) && !g.said.some((t) => /coming up|Too fast/.test(t));
    r.ok(`bughunt-v80: ${id} — G and the GEAR pad on the runway leave the wheels down and say why (no belly landing)`,
      held(ground.G) && held(ground.pad), JSON.stringify(ground));
    r.ok(`bughunt-v80: ${id} — in the air G still raises the gear`, air.gearDown === false && air.said.some((t) => /coming up/.test(t)), JSON.stringify(air));
  }
  sim.quitToMenu();
  await wait(50);
}

/*
 * 2. S held on the take-off roll (or the touch stick pulled back) in a fighter:
 * the nose went to 19 degrees with the wheels still on the runway, "The tail
 * struck the ground", every time — F-22, F/A-18, Vanguard, F-35B, A-10. In
 * Easy and Normal the elevator now stops short of the tail-strike attitude
 * near the ground, so holding S simply flies it off. Realistic is untouched.
 */
export async function tailStrike(sim, r) {
  const V = new (await import('../../src/vendor/three.module.js')).Vector3();
  const roll = async (id, at, mode) => {
    if (sim.state !== 'menu') sim.quitToMenu();
    await wait(50);
    await sim.startMode('free', { aircraft: id, taxi: false, loadingScreen: false, time: 'day', condition: 'clear', windSpeedKts: 0 });
    for (let i = 0; i < 300 && sim.state !== 'flying'; i++) await wait(10);
    sim.step(0.3, 1 / 30);
    const ac = sim.aircraft;
    const was = ac.mode;
    if (mode) ac.mode = mode;
    let t = 0;
    let pull = -1;
    let air = -1;
    let maxPitch = 0;
    try {
      for (; t < 40 && !ac.crashed; t += 1 / 30) {
        key('ShiftLeft', 'Shift', 'keydown');
        if (pull < 0 && ac.vel.length() * 1.944 >= at) pull = t;
        if (pull >= 0) key('KeyS', 's', 'keydown');
        sim.step(1 / 30, 1 / 30);
        if (ac.onGround) maxPitch = Math.max(maxPitch, Math.asin(ac.forward(V).y) * 57.3);
        if (air < 0 && !ac.onGround && pull >= 0) air = t;
        if (air >= 0 && t - air > 4) break;
      }
    } finally {
      key('KeyS', 's', 'keyup');
      key('ShiftLeft', 'Shift', 'keyup');
      ac.mode = was;
    }
    return { crashed: ac.crashed, why: ac.crashReason, flew: air >= 0 && !ac.crashed, agl: Math.round(ac.agl), pitchOnWheels: +maxPitch.toFixed(1) };
  };
  for (const [id, at] of [['f22', 130], ['fa18', 130], ['a10', 110], ['skylark', 55]]) {
    const got = await roll(id, at);
    r.ok(`bughunt-v80: ${id} — S held from ${at} kt on the roll flies it off (no tail strike)`, got.flew && got.agl > 8, JSON.stringify(got));
  }
  const real = await roll('f22', 130, 'realistic');
  r.ok('bughunt-v80: Realistic mode keeps the real tail strike (no guard)', real.crashed && /tail/.test(real.why), JSON.stringify(real));
  sim.quitToMenu();
  await wait(50);
}

/*
 * 3. The words still named the keys from before they swapped (the autopilot
 * and T-Pose Harrison's boost went P to Y, the ground crew Y to P): the HUD's
 * Autopilot button said "Autopilot on/off (P)" — P opens the airport services
 * now; Harrison on the runway said "Take off first — then P P P", on a tablet
 * too, where it is the BOOST button; and Settings said boarding is skipped
 * with Y, which is the autopilot.
 */
export async function staleKeyWords(sim, r) {
  const I = await import('../../src/flight/input.js');
  const btn = sim.hud.btnAuto;
  const ap = I.keyName('autopilot');
  r.ok('bughunt-v80: the HUD Autopilot button names the autopilot\'s own key',
    !!btn && btn.title.includes(`(${ap})`) && !/\(P\)/.test(btn.title) && btn.getAttribute('aria-label') === btn.title, `${btn && btn.title} — autopilot is ${ap}`);
  const skip = sim.menus.screens.settings.querySelector('[data-set="autoSkipBoarding"]');
  const words = skip ? skip.closest('label').textContent : '';
  const sk = I.keyName('services', sim);
  r.ok('bughunt-v80: Settings says the boarding is skipped with the ground-crew key (P), not Y',
    sk !== '—' && words.includes(`press ${sk}`) && !/press Y\b/.test(words), `${sk}: ${words.slice(-90)}`);
  const TP = await import('../../src/features/tpose.js');
  if (sim.state !== 'menu') sim.quitToMenu();
  await wait(50);
  await sim.startMode('free', { aircraft: 'tpose', taxi: false, loadingScreen: false, time: 'day', condition: 'clear', windSpeedKts: 0 });
  for (let i = 0; i < 300 && sim.state !== 'flying'; i++) await wait(10);
  sim.step(0.5, 1 / 30);
  const said = [];
  const notify = sim.hud.notify;
  const touch = sim.touch;
  sim.hud.notify = function (t, ...rest) {
    said.push(t);
    return notify.call(this, t, ...rest);
  };
  try {
    sim.touch = null;
    TP.toggleBoost(sim);
    sim.touch = touch || {};
    TP.toggleBoost(sim);
  } finally {
    sim.touch = touch;
    sim.hud.notify = notify;
  }
  const key = I.keyLabel((sim.input.bindings.harrisonBoost || ['KeyY'])[0]);
  r.ok('bughunt-v80: Harrison on the runway names his boost key (and BOOST on a tablet), not P',
    said.length === 2 && said[0].includes(`${key} ${key} ${key}`) && /BOOST/.test(said[1]) && !said.some((t) => /P P P/.test(t)), JSON.stringify({ key, said }));
  sim.quitToMenu();
  await wait(50);
}

/*
 * 4. An iPad held upright (820 x 1180): narrower than 900 px the radio line is
 * lifted above the map (bottom 312 px), but the coach line ("Slide the
 * throttle all the way up for full power") stayed where it was, so a
 * two-line call from the tower lay over it. Laid out for real in a frame of
 * each size, with the game's own stylesheet and the HUD's own classes.
 */
export async function coachOverRadio(sim, r) {
  const lay = (w, h) => new Promise((done) => {
    const f = document.createElement('iframe');
    f.style.cssText = `position:fixed;left:-9999px;top:0;width:${w}px;height:${h}px;border:0;visibility:hidden`;
    f.srcdoc = `<!doctype html><html class="is-touch-device"><head><link rel="stylesheet" href="${location.origin}/styles/main.css"></head>
      <body style="margin:0"><div id="ui" class="ui-root" style="position:fixed;inset:0"><div class="hud is-touch has-minimap" style="position:absolute;inset:0;--bl-h:260px">
      <div class="hud-subtitle"><div class="hud-subtitle-who">Kestrel Ground</div><div class="hud-subtitle-text">Skylark one seven two, Kestrel Ground, runway zero nine, wind calm, taxi to holding point alpha one.</div></div>
      <div class="hud-coach">Slide the throttle all the way up for full power</div></div></div></body></html>`;
    f.onload = () => setTimeout(() => {
      const d = f.contentDocument;
      const box = (sel) => { const b = d.querySelector(sel).getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom) }; };
      const res = { w, h, coach: box('.hud-coach'), radio: box('.hud-subtitle') };
      f.remove();
      done(res);
    }, 300);
    document.body.appendChild(f);
  });
  for (const [w, h] of [[820, 1180], [768, 1024], [1180, 820]]) {
    const got = await lay(w, h);
    r.ok(`bughunt-v80: at ${w} x ${h} the coach line sits above a two-line radio call, not on it`,
      got.coach.bottom > 0 && got.radio.bottom - got.radio.top > 40 && got.coach.bottom <= got.radio.top, JSON.stringify(got));
  }
}

/*
 * 5. "Hide interface" (the HUD's More tray) on a tablet hid the pause button and
 * every touch control with it, and nothing brought them back: Esc (pause) is
 * the only way out and a tablet has no Esc. It even carried into the next
 * flight. A tap on the picture brings the interface back now (touch only:
 * with a mouse a click on the sky is the pointer capture).
 */
export async function hiddenOnTablet(sim, r) {
  const html = document.documentElement;
  const had = html.classList.contains('is-touch-device');
  const view = document.getElementById('view');
  const shown = () => !!sim.hud.wrap && sim.hud.wrap.style.display !== 'none';
  if (sim.state !== 'menu') sim.quitToMenu();
  await wait(50);
  await sim.startMode('free', { aircraft: 'skylark', airborne: true, taxi: false, loadingScreen: false });
  for (let i = 0; i < 300 && sim.state !== 'flying'; i++) await wait(10);
  sim.step(0.5, 1 / 30);
  const got = {};
  try {
    html.classList.add('is-touch-device');
    sim.hudAction('hideUi');
    sim.step(0.2, 1 / 30);
    got.hidden = !shown();
    view.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    sim.step(0.2, 1 / 30);
    got.backAfterTap = shown();
    got.state = sim.state;
    // A mouse: the click is the pointer capture's, the interface stays hidden.
    html.classList.remove('is-touch-device');
    sim.hudAction('hideUi');
    view.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    sim.step(0.2, 1 / 30);
    got.mouseKeepsHidden = !shown();
    sim.hudAction('hideUi');
  } finally {
    html.classList.toggle('is-touch-device', had);
    if (sim.hud.hidden) sim.hud.setHidden(false);
  }
  r.ok('bughunt-v80: on a tablet a tap on the picture brings a hidden interface back (and a mouse click does not)',
    got.hidden && got.backAfterTap && got.state === 'flying' && got.mouseKeepsHidden, JSON.stringify(got));
  sim.quitToMenu();
  await wait(50);
}

/*
 * 6. Settings -> Accessibility -> Large text was saved, and the HUD read it at
 * boot, but the menus' own large text (body.is-large) was only put on when
 * the box was ticked: the next visit opened with small menus and the box
 * still ticked. The game is booted again in a hidden frame with the setting
 * saved, and its menus are asked.
 */
export async function largeTextReload(sim, r) {
  const S = await import('../../src/core/storage.js');
  const was = !!sim.settings.largeText;
  const boot = async () => {
    const f = document.createElement('iframe');
    f.style.cssText = 'position:fixed;left:-9999px;top:0;width:1280px;height:720px;border:0';
    f.src = `${location.origin}/?mute=1&dev=1`;
    document.body.appendChild(f);
    let got = null;
    for (let i = 0; i < 1200 && !got; i++) {
      await wait(100);
      try {
        const w = f.contentWindow;
        if (w && w.__sim && w.__sim.settings) got = { body: w.document.body.classList.contains('is-large'), hud: w.__sim.hud.wrap.classList.contains('is-large'), saved: !!w.__sim.settings.largeText };
      } catch (e) {
        got = { error: String(e && e.message) };
      }
    }
    f.remove();
    return got;
  };
  let on;
  try {
    sim.settings.largeText = true;
    S.saveSettings(sim.settings);
    on = await boot();
  } finally {
    sim.settings.largeText = was;
    S.saveSettings(sim.settings);
  }
  r.ok('bughunt-v80: Large text saved: the next visit opens with the menus large too, not just the HUD',
    !!on && on.saved && on.hud && on.body, JSON.stringify(on));
}

/*
 * 7. (Round 2.) Menu lines that name keys a tablet does not have: Settings said
 * "Show guidance to the runway or target (N)" and "Minimap ... (J)", the
 * F-35B's card "Press T and the nozzle swings down", the Skyhook's "Shift and
 * Ctrl are the collective lever". On a touch device the "(N)" and "(J)" are
 * not shown; the cards name the HOVER button, the lever and the stick, with
 * the keys "on a keyboard".
 */
export async function touchKeyNames(sim, r) {
  const html = document.documentElement;
  const had = html.classList.contains('is-touch-device');
  const box = sim.menus.screens.settings;
  const tail = (k) => {
    const el = box.querySelector(`[data-set="${k}"]`);
    const hint = el && el.closest('label').querySelector('.kbd-only');
    return hint ? `${hint.textContent}:${getComputedStyle(hint).display}` : 'none';
  };
  const got = {};
  try {
    html.classList.remove('is-touch-device');
    got.desk = [tail('guidance'), tail('minimap')];
    html.classList.add('is-touch-device');
    got.touch = [tail('guidance'), tail('minimap')];
  } finally {
    html.classList.toggle('is-touch-device', had);
  }
  r.ok('bughunt-v80: Settings names the N and J keys with a keyboard, and not on a tablet',
    got.desk[0] === ' (N):inline' && got.desk[1] === ' (J):inline' && got.touch.every((t) => /:none$/.test(t)), JSON.stringify(got));
  const { getAircraft } = await import('../../src/aircraft/types.js');
  const blurb = (getAircraft('f35b') || {}).blurb || '';
  r.ok('bughunt-v80: the F-35B card names its HOVER button as well as T', /Press HOVER \(or T\)/.test(blurb) && !/Press T and/.test(blurb), blurb.slice(0, 80));
  // The helicopters' cards (the Skyhook is the one a tablet starts in) and the B-1B's: the keys are "on a keyboard".
  const cards = ['harrier', 'bell407', 'b1b'].map((id) => (getAircraft(id) || {}).blurb || '');
  r.ok('bughunt-v80: the Skyhook, Bell 407 and B-1B cards say which words are keyboard keys',
    cards.every((b) => /on a keyboard/.test(b)) && !cards.some((b) => /Shift and Ctrl are|press \] and \[/.test(b)), cards.map((b) => b.slice(36, 110)).join(' | '));
  const c17 = (getAircraft('c17') || {}).blurb || '';
  r.ok('bughunt-v80: the C-17 card names its OPEN RAMP button as well as 6', /OPEN RAMP \(or 6\)/.test(c17) && !/Press 6/.test(c17), c17.slice(-70));
}

/*
 * 8. (Round 2.) Crashing in a race (the Skyhook Sprint, racing alone): the
 * race line ("Hoop 1/9 300 m 0:03.5") stayed at the top of the screen over
 * the "Crashed" card, its clock frozen. It goes with the debrief now; the
 * next race shows it again.
 */
export async function raceCrash(sim, r) {
  const race = await import('../../src/features/race.js');
  const RR = await import('../../src/features/race/rules.js');
  const st = () => (race.raceState() || {}).s;
  const until = async (want, ms) => {
    const t0 = performance.now();
    while (performance.now() - t0 < ms && st() !== want) {
      sim.update(1 / 15);
      await wait(30);
    }
    return st() === want;
  };
  const bar = () => {
    const b = document.querySelector('.race-hud');
    return !!b && !b.hidden && getComputedStyle(b).display !== 'none' && b.getBoundingClientRect().width > 0;
  };
  if (sim.state !== 'menu') sim.quitToMenu();
  await wait(50);
  const got = {};
  await race.raceAlone(sim, 'heli');
  got.go = (await until(RR.S.grid, 60000)) && (await until(RR.S.go, 12000));
  for (let i = 0; i < 5; i++) sim.update(1 / 15);
  got.barRacing = bar();
  sim.aircraft.crash('Test crash');
  // The Crashed card comes up on a real-time timer after the wreck settles.
  for (let i = 0; i < 120 && sim.state !== 'debrief'; i++) {
    sim.step(0.1, 1 / 30);
    await wait(100);
  }
  got.state = sim.state;
  got.barOnDebrief = bar();
  // The next race: the line is back.
  sim.quitToMenu();
  await wait(50);
  await race.raceAlone(sim, 'heli');
  await until(RR.S.grid, 60000);
  for (let i = 0; i < 5; i++) sim.update(1 / 15);
  got.barNextRace = bar();
  r.ok('bughunt-v80: crashed in a race, the race line goes with the "Crashed" card (and is back for the next race)',
    got.go && got.barRacing && got.state === 'debrief' && !got.barOnDebrief && got.barNextRace, JSON.stringify(got));
  sim.quitToMenu();
  await wait(50);
}

/*
 * 9. (Round 2.) "Tap here to get out" (the only way out of a vehicle on a
 * touch screen) on a tablet or phone held upright:
 *   - iPad portrait (820 x 1180, 768 x 1024): it sat between the lifted coach
 *     line and the radio line, over both (coach to y762, door 755-798, radio
 *     from 788). It goes above the coach line now.
 *   - a phone, in a helicopter (375-390 px): it ran onto the left edge of the
 *     helicopter's card under the band, over "ON THE GROUND". It wraps short
 *     of the card instead.
 * Laid out for real in frames of each size with the game's stylesheet, the
 * door's own (features/staff/ui.js) and the HUD's classes; the helicopter
 * card stands where the game measured it (236 px wide, 8 px from the right,
 * y269-368).
 */
export async function getOutDoor(sim, r) {
  const src = await (await fetch(`${location.origin}/src/features/staff/ui.js`)).text();
  const css = src.slice(src.indexOf('const CSS = `') + 13, src.indexOf('`;', src.indexOf('const CSS = `')));
  const lay = (w, h, heli) => new Promise((done) => {
    const f = document.createElement('iframe');
    f.style.cssText = `position:fixed;left:-9999px;top:0;width:${w}px;height:${h}px;border:0;visibility:hidden`;
    f.srcdoc = `<!doctype html><html class="is-touch-device" style="--bl-h:150px"><head><link rel="stylesheet" href="${location.origin}/styles/main.css"><style>${css}</style></head>
      <body style="margin:0"><div id="ui" class="ui-root" style="position:fixed;inset:0"><div class="hud is-touch has-minimap" style="position:absolute;inset:0">
      <div class="hud-subtitle"><div class="hud-subtitle-who">Kestrel Ground</div><div class="hud-subtitle-text">Skylark one seven two, Kestrel Ground, runway zero nine, wind calm, taxi to holding point alpha one.</div></div>
      <div class="hud-coach">Slide the throttle all the way up for full power</div>
      ${heli ? '<div class="hud-heli" style="position:fixed;top:269px;right:8px;width:236px;height:99px;margin:0;padding:0">ON THE GROUND</div>' : ''}</div></div>
      <div id="ext-layer" style="position:fixed;inset:0"><div class="of-root" style="position:absolute;inset:0"><div class="of-prompt act on">Tap here to get out</div></div></div></body></html>`;
    f.onload = () => setTimeout(() => {
      const d = f.contentDocument;
      const box = (sel) => { const e = d.querySelector(sel); const b = e && e.getBoundingClientRect(); return b && b.width ? { l: Math.round(b.left), t: Math.round(b.top), r: Math.round(b.right), b: Math.round(b.bottom) } : null; };
      const res = { w, h, door: box('.of-prompt'), coach: box('.hud-coach'), radio: box('.hud-subtitle'), heli: heli ? box('.hud-heli') : null };
      f.remove();
      done(res);
    }, 300);
    document.body.appendChild(f);
  });
  const hit = (a, b) => !!a && !!b && Math.min(a.r, b.r) - Math.max(a.l, b.l) > 2 && Math.min(a.b, b.b) - Math.max(a.t, b.t) > 2;
  for (const [w, h] of [[820, 1180], [768, 1024]]) {
    const got = await lay(w, h, false);
    r.ok(`bughunt-v80: at ${w} x ${h} "Tap here to get out" is clear of the coach and radio lines`,
      !!got.door && got.door.t > 0 && !hit(got.door, got.coach) && !hit(got.door, got.radio), JSON.stringify(got));
  }
  const wide = await lay(1180, 820, false);
  r.ok('bughunt-v80: an iPad on its side keeps the door where it was', !!wide.door && wide.door.b === 820 - 382, JSON.stringify(wide.door));
  for (const w of [390, 375]) {
    const got = await lay(w, 844, true);
    r.ok(`bughunt-v80: a ${w} px phone in a helicopter: the door stops short of the card`, !!got.door && got.door.r > got.door.l && !hit(got.door, got.heli), JSON.stringify(got));
  }
}

/*
 * 10. (Round 2.) On a tablet in a helicopter the objective said "Slide the
 * throttle up to raise the collective" (First Light, the helicopter's first
 * lesson): the touch wording turns "Hold Shift" into the throttle, but in a
 * helicopter that slider is the lever, and the helicopter's own card says
 * "Slide the lever up". The HUD's lines say the lever there now; an
 * aeroplane keeps the throttle.
 */
export async function heliLeverWords(sim, r) {
  const c = sim.hud.wrap.classList;
  const had = [c.contains('is-touch'), c.contains('is-rotor')];
  const line = 'Hold <kbd>Shift</kbd> to raise the collective until the skids come off the pad.';
  const got = {};
  try {
    c.add('is-touch');
    c.add('is-rotor');
    got.heli = sim.hud.words(line);
    c.remove('is-rotor');
    got.plane = sim.hud.words('Hold <kbd>Shift</kbd> for full power');
    c.remove('is-touch');
    got.keys = sim.hud.words(line);
  } finally {
    c.toggle('is-touch', had[0]);
    c.toggle('is-rotor', had[1]);
  }
  r.ok('bughunt-v80: a tablet in a helicopter says "the lever" (an aeroplane "the throttle", a keyboard Shift)',
    /the lever up to raise the collective/.test(got.heli) && !/throttle/.test(got.heli) && /the throttle/.test(got.plane) && /Shift/.test(got.keys), JSON.stringify(got));
}
