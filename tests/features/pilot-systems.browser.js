/**
 * Browser checks for the pilot's switches (features/pilot-systems.js) and the
 * parody airlines' paint, in a real page:
 *
 *   1. LIGHTS. On the apron at night the lights key cycles the preset: the
 *      HUD note names it, the LIGHTS card joins the right-hand column with a
 *      button per lamp, the pill says the preset and a tap takes it back to
 *      auto. ALL OFF really puts the fleet model's lamps out; ALL ON lights
 *      the strobes on the apron, where auto would not.
 *   2. SPOILERS and REVERSERS. Rolling on the runway, the reverser key pulls
 *      idle then MAX reverse (the pill, the engine spooling, the reverser
 *      sleeves sliding out on the model) and the aeroplane slows faster than
 *      with idle power alone; in the air the key is refused; the spoiler key
 *      in the air steps the lever and the panels stand up.
 *   3. THE RADIO. The ATC key opens the radio card with the four requests and
 *      the one that fits marked; a request puts the pilot's words in a note
 *      and the controller's answer on the radio line a moment later; the key
 *      again sends the suggested one.
 *   4. THE SHEETS. On a stand-in touch layer the SYSTEMS sheet carries
 *      LIGHTS / RADIO / SPEEDBRAKE and the GROUND sheet REVERSERS / SPOILERS,
 *      their words following the levers.
 *   5. THE AIRLINES. Nineteen airlines; a 737 builds in Kanal Royal Dutch
 *      with the crown layout, a tulip on each side of the fin and the name;
 *      an ambient airliner's callsign is a parody brand.
 *
 * `check(sim, r, say)` — r.ok(name, pass, detail) per assertion.
 */

export async function check(sim, r, say) {
  const log = (m) => { if (say) say(`pilot systems: ${m}`); };
  const origAuto = sim.autoPauseOnHide;
  sim.autoPauseOnHide = false;
  const frames = (n, dt = 1 / 30) => { for (let i = 0; i < n; i++) sim.update(dt); };
  const wait = (ms) => new Promise((res) => setTimeout(res, ms));
  const shown = (n) => !!n && n.getClientRects().length > 0;
  const q = (s) => document.querySelector(s);
  const I = await import('../../src/flight/input.js');
  const F = await import('../../src/features/pilot-systems.js');
  const L = await import('../../src/aircraft/liveries.js');
  const SYS = await import('../../src/aircraft/systems.js');
  const press = (action) => {
    const code = (I.codesFor(action, sim) || I.ACTIONS[action].default)[0];
    sim.key(code, true);
    sim.key(code, false);
  };
  const lastNote = () => {
    const notes = [...document.querySelectorAll('#ui .hud-toast')];
    return notes.map((n) => n.textContent).join(' | ');
  };
  const pillText = () => (q('#ui .hud-pills') ? q('#ui .hud-pills').textContent : '');
  const lampsOf = (model) => {
    const out = {};
    model.traverse((o) => { if (o.isSprite && o.userData && o.userData.baseScale) out[o.name || `s${Object.keys(out).length}`] = o; });
    return out;
  };

  try {
    /* ---- 1. lights ---- */
    log('lights');
    await sim.startMode('free', { aircraft: 'b737', time: 'night', condition: 'clear', windSpeedKts: 0, airborne: false });
    frames(20);
    const ac = sim.aircraft;
    r.ok('pilot systems: a fresh flight has every lamp on auto, the lever in, spoilers armed, reversers stowed', ac.lights && SYS.lightPresetOf(ac.lights).id === 'auto' && ac.speedbrake === 0 && ac.spoilersArmed === true && ac.reverse === 0);
    if (!ac.engineOn) sim.pressStarter(false);
    frames(90);
    const strobeBefore = () => {
      let most = 0;
      for (let i = 0; i < 45; i++) {
        frames(1);
        let lit = 0;
        sim.model.traverse((o) => { if (o.isSprite && o.visible && o.material && o.material.opacity > 0.05 && o.material.color && o.material.color.r > 0.9 && o.material.color.g > 0.9) lit++; });
        most = Math.max(most, lit);
      }
      return most;
    };
    const whiteOnApron = strobeBefore();
    press('lights');
    frames(2);
    r.ok('pilot systems: the lights key goes to NAV + BEACON and the note says so', SYS.lightPresetOf(ac.lights).id === 'apron' && /nav and beacon/i.test(lastNote()), `${SYS.lightPresetOf(ac.lights) && SYS.lightPresetOf(ac.lights).id} "${lastNote().slice(0, 80)}"`);
    frames(10);
    const card = q('#ext-layer .ps-lights, .hud-rstack .ps-lights');
    r.ok('pilot systems: the LIGHTS card is in the HUD\'s right-hand column (open, folded or waiting, as the stack decides) with a button per lamp', !!card && card.parentNode && card.parentNode.classList.contains('hud-rstack') && card.classList.contains('rs-card') && card.querySelectorAll('[data-lamp]').length === 5 && /NAV \+ BEACON/.test(card.textContent), card ? `${card.parentNode && card.parentNode.className} ${card.className}: ${card.textContent.replace(/\s+/g, ' ').slice(0, 80)}` : 'no card');
    r.ok('pilot systems: the pill says the preset', /Lights: NAV \+ BEACON/.test(pillText()), pillText());
    press('lights'); // taxi
    press('lights'); // all on
    const whiteAllOn = strobeBefore();
    r.ok('pilot systems: ALL ON lights the strobes on the apron, where auto keeps them off', SYS.lightPresetOf(ac.lights).id === 'all' && whiteAllOn > whiteOnApron, `${whiteOnApron} white lamps lit on auto, ${whiteAllOn} on ALL ON`);
    press('lights'); // all off
    frames(40);
    let anyLit = 0;
    sim.model.traverse((o) => { if (o.isSprite && o.visible && o.material && o.material.opacity > 0.05) anyLit++; });
    r.ok('pilot systems: ALL OFF puts every lamp out', SYS.lightPresetOf(ac.lights).id === 'off' && anyLit === 0, `${anyLit} lamps still lit`);
    const lampBtn = card && card.querySelector('[data-lamp="nav"]');
    if (lampBtn) lampBtn.click();
    frames(2);
    r.ok('pilot systems: tapping one lamp on the card cycles its own switch (off → auto), and the card says SET BY HAND', ac.lights.nav === 'auto' && /SET BY HAND/.test(card.textContent), `nav ${ac.lights.nav}`);
    const pill = q('#ui .hud-pills [data-pill="lights"]');
    if (pill) pill.click();
    frames(2);
    r.ok('pilot systems: the pill\'s tap takes every lamp back to auto, and the pill goes', SYS.lightPresetOf(ac.lights).id === 'auto' && !/Lights:/.test(pillText()), pillText());

    /* ---- 2. spoilers and reversers ---- */
    log('spoilers and reversers');
    ac.parkingBrake = false;
    ac.pos.set(-500, ac.pos.y, 0);
    ac.vel.set(55, 0, 0);
    ac.spoilersArmed = false;
    ac.controls.throttle = 0;
    frames(10);
    const gs0 = ac.groundSpeed;
    press('reversers');
    frames(2);
    r.ok('pilot systems: on the roll the reverser key pulls idle reverse, and the pill says so', ac.reverse === 0.5 && /Idle reverse/.test(pillText()), `reverse ${ac.reverse}; ${pillText()}`);
    press('reversers');
    frames(60);
    const gs1 = ac.groundSpeed;
    let sleeves = 0;
    sim.model.traverse((o) => { if (/Reverser sleeve/.test(o.name) && o.visible) sleeves++; });
    r.ok('pilot systems: MAX reverse — the engine spools, the sleeves slide out on the model, the pill says MAX', ac.reverse === 1 && ac.rpm > 0.5 && sleeves > 0 && /MAX reverse/.test(pillText()), `rpm ${ac.rpm.toFixed(2)}, ${sleeves} sleeves, ${pillText()}`);
    const lost = gs0 - gs1;
    r.ok('pilot systems: it slows the roll — more than 2.5 m/s lost in two seconds with no brakes and no spoilers', lost > 2.5 && !ac.crashed, `${gs0.toFixed(1)} → ${gs1.toFixed(1)} m/s`);
    const revPill = q('#ui .hud-pills [data-pill="reverse"]');
    if (revPill) revPill.click();
    frames(2);
    r.ok('pilot systems: the pill\'s tap stows the reversers', ac.reverse === 0);
    press('spoilers');
    frames(2);
    r.ok('pilot systems: rolling fast on the ground the spoiler key puts the ground spoilers up by hand', ac.speedbrake === 1 && /Ground spoilers up/.test(lastNote()), `lever ${ac.speedbrake}; ${lastNote().slice(0, 80)}`);
    frames(40);
    r.ok('pilot systems: they come up on the model and the pill says so', ac.spoilerPos > 0.8 && /Ground spoilers up/.test(pillText()), `pos ${ac.spoilerPos.toFixed(2)}; ${pillText()}`);
    ac.vel.set(0, 0, 0);
    frames(20);
    ac.speedbrake = 0;
    ac.spoilersArmed = false;
    press('spoilers');
    frames(2);
    r.ok('pilot systems: stopped, the spoiler key arms the ground spoilers', ac.spoilersArmed === true && /ARMED/.test(lastNote()), `armed ${ac.spoilersArmed}; ${lastNote().slice(0, 80)}`);

    await sim.startMode('free', { aircraft: 'b737', time: 'day', condition: 'clear', windSpeedKts: 0, airborne: true });
    frames(30);
    const ac2 = sim.aircraft;
    press('reversers');
    frames(2);
    r.ok('pilot systems: in the air the reverser key is refused with a word', ac2.reverse === 0 && /locked out in the air/i.test(lastNote()), lastNote().slice(0, 80));
    press('spoilers');
    frames(30);
    let panels = 0;
    sim.model.traverse((o) => { if (/Spoiler panel|spoilers/i.test(o.name) && o.visible) panels++; });
    r.ok('pilot systems: in the air the spoiler key puts the speedbrake to ½, the panels stand up and the pill says so', ac2.speedbrake === 0.5 && ac2.spoilerPos > 0.3 && panels > 0 && /Speedbrake ½/.test(pillText()), `lever ${ac2.speedbrake}, pos ${ac2.spoilerPos.toFixed(2)}, ${panels} panels, ${pillText()}`);
    press('spoilers');
    frames(2);
    r.ok('pilot systems: again, FULL', ac2.speedbrake === 1 && /Speedbrake FULL/.test(pillText()));
    const sbPill = q('#ui .hud-pills [data-pill="speedbrake"]');
    if (sbPill) sbPill.click();
    frames(2);
    r.ok('pilot systems: the pill\'s tap retracts it', ac2.speedbrake === 0);

    /* ---- 3. the radio ---- */
    log('the radio');
    press('atcRequest');
    frames(2);
    const radio = q('.ps-radio');
    r.ok('pilot systems: the ATC key opens the radio card in the column with the four requests, landing marked (we are airborne)',
      shown(radio) && radio.querySelectorAll('[data-atc]').length === 4 && radio.querySelector('[data-atc="landing"]').classList.contains('is-pick') && F.systemsState().radioOpen, radio ? radio.textContent.replace(/\s+/g, ' ').slice(0, 100) : 'no card');
    press('atcRequest');
    frames(2);
    const st = F.systemsState();
    r.ok('pilot systems: the key again sends the suggested request (landing), the card closes, and the pilot\'s words are a note', st.lastRequest === 'landing' && st.pending && !st.radioOpen && /request landing/.test(lastNote()), `${st.lastRequest} pending ${st.pending}; "${lastNote().slice(0, 90)}"`);
    frames(60);
    await wait(50);
    const said = sim.atc && sim.atc.said;
    r.ok('pilot systems: a moment later the controller clears us to land, and the automatic call will not repeat it', !F.systemsState().pending && said && said.final === true && /cleared to land/.test(F.systemsState().lastAnswer.text), `final ${said && said.final}; ${F.systemsState().lastAnswer && F.systemsState().lastAnswer.text}`);
    await sim.startMode('free', { aircraft: 'skylark', time: 'day', condition: 'clear', windSpeedKts: 0, airborne: false });
    frames(20);
    press('atcRequest');
    frames(2);
    const radio2 = q('.ps-radio');
    const pick = radio2 && radio2.querySelector('.is-pick');
    r.ok('pilot systems: on the ground the suggestion is taxi (or pushback on a stand), never landing', pick && pick.dataset.atc !== 'landing', pick ? pick.dataset.atc : 'none');
    const where = F.radioContext(sim);
    radio2.querySelector('[data-atc="takeoff"]').click();
    frames(60);
    await wait(30);
    const ans = F.systemsState().lastAnswer;
    r.ok(where.lined ? 'pilot systems: asking for take-off lined up on the runway gets the clearance, and the automatic one will not repeat it' : 'pilot systems: asking for take-off off the runway gets "hold short", not a clearance',
      ans && (where.lined ? ans.ok && /cleared for take-off/.test(ans.text) && sim.atc.said.clearance === true : !ans.ok && /hold short|line up/i.test(ans.text) && sim.atc.said.clearance !== true), `${where.onRunway ? 'on' : 'off'} the runway: ${ans && ans.text}`);

    /* ---- 4. the sheets ---- */
    log('the sheets');
    const TC = await import('../../src/ui/touch.js');
    const layer = sim.hud.wrap;
    let touch = null;
    try {
      touch = new TC.TouchControls(layer, { input: sim.input, onAction: (a) => sim.hudAction(a), onHold: () => {}, state: () => sim.touchState() });
      layer.classList.add('is-touch');
    } catch (e) {
      r.ok('pilot systems: a stand-in touch layer builds', false, e.message);
    }
    if (touch) {
      const acts = [...layer.querySelectorAll('.touch-sheet-btn')].map((b) => b.dataset.act);
      r.ok('pilot systems: the sheets carry LIGHTS, RADIO, SPEEDBRAKE (SYSTEMS) and REVERSERS, SPOILERS (GROUND)', ['lights', 'atcRequest', 'reversers'].every((a) => acts.includes(a)) && acts.filter((a) => a === 'spoilers').length === 2, acts.join(','));
      touch.syncSheets(sim.touchState());
      const lightsBtn = layer.querySelector('.touch-sheet-btn[data-act="lights"]');
      const armBtn = [...layer.querySelectorAll('.touch-sheet-btn[data-act="spoilers"]')].find((b) => /SPOILERS/.test(b.textContent));
      r.ok('pilot systems: the sheet buttons say the state — LIGHTS: AUTO, SPOILERS: ARMED', lightsBtn && /LIGHTS: AUTO/.test(lightsBtn.textContent) && armBtn && /ARMED/.test(armBtn.textContent), `${lightsBtn && lightsBtn.textContent} / ${armBtn && armBtn.textContent}`);
      lightsBtn.click();
      frames(2);
      touch.syncSheets(sim.touchState());
      r.ok('pilot systems: tapping LIGHTS on the sheet presses the key: NAV + BEACON, and the button says so', SYS.lightPresetOf(sim.aircraft.lights).id === 'apron' && /NAV \+ BEACON/.test(lightsBtn.textContent), lightsBtn.textContent);
      sim.hudAction('lightsAuto');
      try { touch.closeSheets(); touch.layer.remove(); } catch (e) { /* fine */ }
      if (sim.input) sim.input.touch = null;
      layer.classList.remove('is-touch');
    }

    /* ---- 5. the airlines ---- */
    log('the airlines');
    r.ok('airlines: nineteen airlines, every one with a radio brand of its own', L.AIRLINE_LIVERIES.length === 19 && new Set(L.AIRLINE_LIVERIES.map((l) => L.radioBrand(l))).size === 19);
    const TY = await import('../../src/aircraft/types.js');
    const AD = await import('../../src/aircraft/model-adapter.js');
    const type = TY.getAircraft('b737');
    const m = AD.createAircraftModel({ type, livery: L.schemeFor(type, 'krd') });
    let skin = null;
    let marks = 0;
    let titles = 0;
    m.traverse((o) => {
      if (!o.isMesh) return;
      for (const mat of [].concat(o.material)) if (mat && mat.name === 'Airliner_livery') skin = mat;
      if (o.name === 'Tail emblem') marks++;
      if (o.name === 'Titling') titles++;
    });
    r.ok('airlines: a 737 for Kanal Royal Dutch builds in the crown layout with a tulip each side of the fin and its name', !!skin && skin.map && /"layout":"crown"/.test(skin.map.name) && marks === 2 && titles === 2, `${skin && skin.map && skin.map.name.slice(0, 80)}; ${marks} marks, ${titles} titles`);
    if (m.userData.dispose) m.userData.dispose();
    const TR = await import('../../src/features/traffic.js');
    const brands = new Set();
    for (let i = 0; i < 200; i++) brands.add(L.radioBrand(TR.pickAirlineScheme(Math.random, type)));
    r.ok('airlines: an ambient 737 flies for the airlines that fly one, under parody brands', brands.has('Kanal') && brands.has('Bosphorus') && !brands.has('Spit') && [...brands].every((b) => !/KLM|Delta|United|Turkish|Japan/.test(b)), [...brands].join(','));
  } finally {
    sim.autoPauseOnHide = origAuto;
    try { sim.quitToMenu('main'); } catch (e) { /* already */ }
  }
}
