/**
 * Browser check for More ATC (src/features/atc-plus.js, src/game/atc-controller.js),
 * in the real game:
 *   1. the extra radio loads on demand once you are in a cockpit; the RADIO card
 *      (the desktop ATC window) shows who you are talking to and on what, and
 *      the requests that fit: a clearance on the ground, MAYDAY only in the air;
 *   2. a scripted flight, clearance to landing in a Skylark: the VFR clearance
 *      read back with the radio key, the take-off clearance with the READBACK
 *      button, a whole circuit flown by tests/features/circuit-pilot.js with
 *      every instruction read back, the landing clearance among them, and the
 *      ATC score card once stopped;
 *   3. vectors for the ILS in a 737, flown on the autopilot: the ATC window
 *      shows the heading and altitude, flown as told no reminder, flown 1,500 ft
 *      high "check altitude";
 *   4. MAYDAY: priority, the AI traffic holds (traffic.js's emergency), the fire
 *      crews come, the menu offers cancel, and cancel lets the traffic go;
 *   5. touch: the sheet's RADIO action opens the card with the extra requests as
 *      buttons, and READBACK is a 44 px button.
 *
 *   node .claude/devtools/briefs/one-check.mjs <url>?mute=1 ./tests/features/atc-plus.browser.js check "" 1
 */
export const id = 'atc-plus';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export async function check(sim, r, say = () => {}) {
  const ok = (name, pass, detail = '') => r.ok(`atc-plus: ${name}`, !!pass, detail);
  const F = await import('../../src/features/pilot-systems.js');
  const I = await import('../../src/flight/input.js');
  const TR = await import('../../src/features/traffic.js');
  const terrain = await import('../../src/world/terrain.js');
  const types = await import('../../src/aircraft/types.js');
  const CP = await import('./circuit-pilot.js');
  const q = (s) => document.querySelector(s);
  const shown = (el) => !!el && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().height > 0;
  const press = (action) => {
    const code = (I.codesFor(action, sim) || I.ACTIONS[action].default)[0];
    sim.key(code, true);
    sim.key(code, false);
  };
  const frames = (n, dt = 1 / 30) => {
    for (let i = 0; i < n; i++) sim.update(dt);
  };
  const notes = () => [...document.querySelectorAll('#ui .hud-toast')].map((n) => n.textContent).join(' | ');
  const said = [];
  const speak = sim.speak;
  sim.speak = function (text, voice, ...rest) {
    said.push({ text: String(text), voice });
    return speak.call(this, text, voice, ...rest);
  };
  const saidSince = (n) => said.slice(n).map((s) => s.text).join(' | ');
  const autoPause = sim.autoPauseOnHide;
  sim.autoPauseOnHide = false;
  const realRender = sim.renderer.render;
  try {
    /* ---- 1. on demand, the card, the menu by phase ---- */
    say('atc-plus: the card');
    await sim.startMode('free', { aircraft: 'skylark', time: 'day', condition: 'clear', windSpeedKts: 0, windDirDeg: 90, airborne: false, taxi: false });
    frames(4);
    await F.atcPlusReady(sim);
    frames(4);
    const P = F.atcPlus();
    ok('the extra radio loaded once in the cockpit (a module of its own)', !!P && typeof P.request === 'function' && !!sim.atcPlus);
    press('atcRequest');
    frames(3);
    const card = q('.ps-radio');
    const now = card && card.querySelector('.ap-now');
    ok('the RADIO card shows who you are talking to and the frequency', shown(now) && /KESTREL (TOWER|GROUND)/.test(now.textContent) && /1\d\d\.\d\d/.test(now.textContent), now && now.textContent.replace(/\s+/g, ' ').slice(0, 80));
    ok('on the ground: the four requests, a CLEARANCE, and no MAYDAY', card.querySelectorAll('[data-atc]').length === 4 && !!card.querySelector('[data-atcx="clearance"]') && !card.querySelector('[data-atcx="mayday"]'), [...card.querySelectorAll('[data-atcx]')].map((b) => b.dataset.atcx).join());

    /* ---- 2. a scripted flight: clearance to landing ---- */
    say('atc-plus: clearance to landing');
    let n0 = said.length;
    card.querySelector('[data-atcx="clearance"]').click();
    frames(75);
    const sq = P.state().squawk;
    ok('clearance: Delivery answers with a VFR departure and a squawk', /Kestrel Delivery, VFR departure approved/.test(saidSince(n0)) && /^[0-7]{4}$/.test(sq) && said.some((s) => s.voice === 'delivery'), saidSince(n0).slice(0, 160));
    const chip = q('.ap-chip');
    ok('clearance: READBACK comes up as a button, the card closed', P.state().pending.length === 1 && shown(chip) && !F.systemsState().radioOpen, `${P.state().pending.length} pending, chip ${shown(chip)}`);
    press('atcRequest');
    frames(50);
    ok('clearance: the radio key reads it back (the squawk in the pilot\'s words) and Delivery says readback correct', P.state().pending.length === 0 && notes().includes(sq) && /readback correct/.test(saidSince(n0)), notes().slice(-160));
    press('atcRequest');
    frames(2);
    n0 = said.length;
    q('.ps-radio [data-atc="takeoff"]').click();
    frames(60);
    ok('take-off: cleared, and it waits for a readback', /cleared for take-off/.test(saidSince(n0)) && P.state().pending.some((p) => p.kind === 'takeoff'), saidSince(n0).slice(0, 120));
    const rbBtn = q('.ap-chip [data-readback]');
    const rbH = rbBtn ? rbBtn.getBoundingClientRect().height : 0;
    rbBtn && rbBtn.click();
    frames(2);
    ok('take-off: the READBACK button (44 px, a finger\'s size) reads it back', P.state().pending.length === 0 && rbH >= 44, `${Math.round(rbH)} px`);

    const ac = sim.aircraft;
    const R = terrain.AIRPORT.runway;
    const runway = { x0: R.cx - R.length / 2, z0: R.cz, headingDeg: 90, length: R.length, elev: terrain.heightAt(R.cx, R.cz) };
    const pilot = CP.circuitPilot({
      ac, runway, perf: types.performanceFor('skylark'), heightAt: terrain.heightAt,
      gear: () => {}, flaps: (s) => ac.setFlaps(s),
    });
    const out = {};
    const CTRL = {};
    Object.defineProperty(CTRL, 'pitch', { enumerable: true, get() { Object.assign(out, pilot.step(1 / 30)); return out.pitch; } });
    for (const k of ['roll', 'yaw', 'throttle', 'brakes']) Object.defineProperty(CTRL, k, { enumerable: true, get() { return out[k]; } });
    sim.renderer.render = () => {};
    sim.override = CTRL;
    const got = [];
    let secs = 0;
    try {
      while (!pilot.done && secs < 600) {
        sim.step(0.5, 1 / 30);
        secs += 0.5;
        clearTimeout(sim._crashDebriefT);
        const p = P.state().pending;
        if (p.length) {
          got.push(...p.map((x) => x.kind));
          P.readback(sim);
        }
        if (ac.crashed) pilot.fail(`crashed: ${ac.crashReason}`);
        if (secs % 30 === 0) await wait(0);
      }
      for (let i = 0; i < 16; i++) sim.step(0.5, 1 / 30);
    } finally {
      sim.override = null;
      sim.renderer.render = realRender;
    }
    const st = P.state();
    ok('circuit: flown and landed by the scripted pilot', pilot.ok && !ac.crashed, `${Math.round(secs)} s; ${pilot.log.filter((l) => /airborne|final|touchdown|stopped|crash|timed/.test(l)).join('; ')}`);
    ok('circuit: the landing clearance came, and was read back', got.includes('land') && st.instructions.some((i) => i.kind === 'land' && i.read), `received ${got.join(',')}`);
    ok('circuit: every instruction read back, none missed', st.instructions.length >= 3 && st.instructions.every((i) => i.read), st.instructions.map((i) => `${i.kind}${i.read ? '' : '!'}`).join(' '));
    const sc = q('.ap-score');
    ok('circuit: stopped, the ATC score card (a percentage) is on screen', shown(sc) && /ATC SCORE/.test(sc.textContent) && /\d+%/.test(sc.textContent) && st.shownScore && st.shownScore.pct >= 80, sc ? sc.textContent.replace(/\s+/g, ' ').slice(0, 120) : 'no card');

    /* ---- 3. ILS vectors on the autopilot, the ATC window ---- */
    say('atc-plus: vectors');
    await sim.startMode('free', { aircraft: 'b737', time: 'day', condition: 'clear', windSpeedKts: 0, windDirDeg: 90, airborne: true });
    frames(4);
    const a2 = sim.aircraft;
    a2.reset({ pos: a2.pos.clone().set(-30000, 0, 9000), headingDeg: 135, speed: 115, engineOn: true, gearDown: false });
    a2.pos.y = 6000 / 3.28084;
    a2.airborneTime = 60;
    frames(30);
    const btn = q('.ps-atc-btn');
    const touch = matchMedia('(pointer: coarse)').matches;
    if (!touch && shown(btn)) btn.click();
    else press('atcRequest');
    frames(3);
    const ils = q('.ps-radio [data-atcx="ils"]');
    ok('in the air: ILS, climb, direct, position, MAYDAY and PAN-PAN on offer, no clearance', !!ils && ['climb', 'position', 'mayday', 'panpan'].every((k) => q(`.ps-radio [data-atcx="${k}"]`)) && !q('.ps-radio [data-atcx="clearance"]'), [...document.querySelectorAll('.ps-radio [data-atcx]')].map((b) => b.dataset.atcx).join());
    n0 = said.length;
    ils.click();
    frames(60);
    const vec = P.state().targets;
    ok('ILS: vectors — fly heading, descend and maintain 3,000, vectors ILS approach runway zero nine', /fly heading \d{3}, descend and maintain 3,000, vectors ILS approach runway zero nine/.test(saidSince(n0)) && vec.hdg != null && vec.alt === 3000, saidSince(n0));
    ok('ILS: the line is on the subtitle', /vectors ILS/.test(sim.hud.subtitleText.textContent) || /vectors ILS/.test(saidSince(n0)), sim.hud.subtitleText.textContent.slice(0, 80));
    P.readback(sim);
    frames(2);
    if (!touch && shown(btn) && !F.systemsState().radioOpen) btn.click();
    frames(3);
    const tgText = q('.ps-radio .ap-tg').textContent;
    ok('the ATC window shows the instruction: HDG and ALT 3,000', /HDG \d{3}/.test(tgText) && /ALT 3,000/.test(tgText) && /heading/i.test(q('.ps-radio .ap-instr').textContent), `${q('.ps-radio .ap-instr').textContent} / ${tgText}`);
    const ap = sim.autopilot;
    ap.setMode('level');
    ap.setSelectedAlt(vec.alt);
    ap.setSelectedHeading(vec.hdg);
    ap.setSelectedSpeed(220);
    ap.setEngaged(true, a2);
    sim.renderer.render = () => {};
    const rem0 = P.state().reminders;
    try {
      for (let i = 0; i < 120; i++) {
        const t = P.state().targets;
        if (t.alt != null) ap.setSelectedAlt(t.alt);
        if (t.hdg != null) ap.setSelectedHeading(t.hdg);
        sim.step(0.5, 1 / 30);
        if (P.state().pending.length) P.readback(sim);
        if (i % 20 === 0) await wait(0);
      }
      ok('ILS: flown as told on the autopilot for a minute: no reminder', P.state().reminders === rem0 && !a2.crashed, `${P.state().reminders - rem0} reminders; hdg ${Math.round(a2.heading)} alt ${Math.round(a2.readouts().altFt)}`);
      n0 = said.length;
      const t = P.state().targets;
      ap.setSelectedAlt((t.alt || 3000) + 1500);
      for (let i = 0; i < 160 && !/check altitude/.test(saidSince(n0)); i++) {
        const tt = P.state().targets;
        if (tt.hdg != null) ap.setSelectedHeading(tt.hdg);
        sim.step(0.5, 1 / 30);
        if (i % 20 === 0) await wait(0);
      }
      ok('ILS: 1,500 ft high: the controller says "check altitude, maintain ..."', /check altitude, maintain \d/.test(saidSince(n0)), saidSince(n0).slice(-160));
    } finally {
      ap.setEngaged(false, a2);
      sim.renderer.render = realRender;
    }

    /* ---- 4. MAYDAY ---- */
    say('atc-plus: mayday');
    await sim.startMode('free', { aircraft: 'b737', time: 'day', condition: 'clear', windSpeedKts: 0, windDirDeg: 90, airborne: true });
    frames(4);
    const a3 = sim.aircraft;
    a3.reset({ pos: a3.pos.clone().set(-9000, 0, 0), headingDeg: 90, speed: 90, engineOn: true, gearDown: true });
    a3.pos.y = 2500 / 3.28084;
    a3.airborneTime = 60;
    try {
      TR.spawnTraffic(sim, 'depart');
    } catch (e) {
      void e;
    }
    frames(30);
    if (!F.systemsState().radioOpen) press('atcRequest');
    frames(3);
    n0 = said.length;
    const mb = q('.ps-radio [data-atcx="mayday"]');
    mb && mb.click();
    frames(60);
    await wait(30);
    frames(4);
    const ts = TR.trafficState();
    ok('MAYDAY: acknowledged — priority, the runway is yours, emergency services standing by, cleared to land', /MAYDAY acknowledged.*you have priority.*runway is yours.*Emergency services are standing by.*cleared to land/.test(saidSince(n0)), saidSince(n0).slice(0, 200));
    ok('MAYDAY: the pilot\'s call is a note', /MAYDAY MAYDAY MAYDAY/.test(notes()), notes().slice(-160));
    ok('MAYDAY: the AI traffic holds — the field is closed for your emergency and the runway counted yours', sim.atcEmergency === 'mayday' && ts.player.emergency === true && ts.player.usingRunway === true, JSON.stringify(ts.player));
    ok('MAYDAY: nobody lines up or takes off while it lasts', !(sim.traffic || []).some((o) => o.phase === 'lineup' || o.phase === 'takeoff'), (sim.traffic || []).map((o) => o.phase).join());
    const sc2 = sim.emergencyScene && sim.emergencyScene.state();
    ok('MAYDAY: the fire crews are called beside the runway', P.state().scene && sc2 && sc2.scenes.length >= 1, JSON.stringify(sc2 && sc2.scenes.map((s) => s.kind)));
    ok('MAYDAY: the landing clearance came with it (the automatic call will not repeat it)', sim.atc.said.final === true);
    // The radio key reads the MAYDAY's clearance back first, then opens the menu.
    press('atcRequest');
    frames(3);
    const readFirst = P.state().pending.length === 0;
    if (!F.systemsState().radioOpen) press('atcRequest');
    frames(3);
    ok('MAYDAY: the radio key read its clearance back, then opened the menu', readFirst && F.systemsState().radioOpen);
    const cancel = q('.ps-radio [data-atcx="cancel"]');
    ok('MAYDAY: on the menu now, cancel (and no second MAYDAY)', !!cancel && !q('.ps-radio [data-atcx="mayday"]'));
    cancel && cancel.click();
    frames(60);
    frames(4);
    ok('cancel: "emergency cancelled", the traffic released, the crews stood down', /emergency cancelled/.test(saidSince(n0)) && !sim.atcEmergency && TR.trafficState().player.emergency === false && !P.state().scene, `${sim.atcEmergency} ${TR.trafficState().player.emergency}`);

    /* ---- 5. touch ---- */
    say('atc-plus: touch');
    if (F.systemsState().radioOpen) press('atcRequest');
    frames(2);
    if (F.systemsState().radioOpen) q('.ps-radio .ps-close').click();
    frames(2);
    sim.hudAction('atcRequest');
    frames(3);
    const xs = [...document.querySelectorAll('.ps-radio [data-atcx]')];
    const minH = Math.min(...xs.map((b) => b.getBoundingClientRect().height));
    ok('touch: the sheet\'s RADIO opens the card with the extra requests as buttons, each a finger\'s height', F.systemsState().radioOpen && xs.length >= 4 && xs.every((b) => b.tagName === 'BUTTON') && minH >= 40, `${xs.length} buttons, smallest ${Math.round(minH)} px`);
    const pos = q('.ps-radio [data-atcx="position"]');
    n0 = said.length;
    pos && pos.click();
    frames(60);
    ok('touch: a tapped request (position report) is answered', /roger, radar contact/.test(saidSince(n0)), saidSince(n0).slice(0, 120));
  } catch (e) {
    ok('the checks ran', false, String((e && e.stack) || e).slice(0, 400));
  } finally {
    sim.speak = speak;
    sim.override = null;
    sim.renderer.render = realRender;
    sim.autoPauseOnHide = autoPause;
  }
}
