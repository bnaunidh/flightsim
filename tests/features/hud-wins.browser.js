/**
 * Browser checks for the HUD quick wins (w7-hud): the touchdown card, the
 * state pills, the destination ribbon and beacon, the conditions chip and the
 * Full / Clean / Photo HUD modes.
 *
 *   1. A landing (the aeroplane's own TOUCHDOWN event) puts the card in the
 *      centre lane: the rate in ft/min, the grade word, the stars, the best
 *      in this aeroplane; a second, heavier landing names the best.
 *   2. On the runway with the parking brake on, the lane at the bottom
 *      centre has the parking-brake pill; a tap releases it and the pill goes.
 *      Gear up, low and slow: the red pill is first.
 *   3. A mission: the heading tape stands above the objective with the
 *      target marked, the arrow pill stands down, and the destination's soft
 *      beacon is in the scene. A free flight has neither.
 *   4. The folded wind card says it in words; a gale changes the word.
 *   5. The mode key cycles Clean → Photo → Full → Clean, saves the setting,
 *      and Photo hides the instruments, the strip and the objective but
 *      keeps the dock (the way back). The dock has the mode button.
 *
 * `check(sim, r, say)` — r.ok(name, pass, detail) per assertion.
 */

export async function check(sim, r, say) {
  const log = (m) => { if (say) say(`hud wins: ${m}`); };
  const origAuto = sim.autoPauseOnHide;
  sim.autoPauseOnHide = false;
  const frames = (n, dt = 1 / 30) => { for (let i = 0; i < n; i++) sim.update(dt); };
  const wait = (ms) => new Promise((res) => setTimeout(res, ms));
  const shown = (n) => !!n && n.getClientRects().length > 0;
  const q = (s) => document.querySelector(s);
  const quit = () => {
    try { sim.quitToMenu('main'); } catch (e) { /* already */ }
  };
  const BEST_KEY = 'islandsim.touchdowns.v1';
  let savedBests = null;
  try { savedBests = localStorage.getItem(BEST_KEY); } catch (e) { /* fine */ }
  const density0 = sim.settings.hudDensity;

  if (!sim.hud || !sim.hud.touchdown || !sim.hud.pills || !sim.hud.dest) {
    r.ok('hud wins: the HUD has the card, the pills and the ribbon', false, 'missing on sim.hud');
    sim.autoPauseOnHide = origAuto;
    return;
  }

  try {
    /* ---- 1. the touchdown card ---- */
    log('the touchdown card');
    try { localStorage.removeItem(BEST_KEY); } catch (e) { /* fine */ }
    await sim.startMode('free', { aircraft: 'skylark', time: 'day', condition: 'clear', windSpeedKts: 5, windDirDeg: 100, airborne: false });
    frames(30);
    const { EVENTS } = await import('../../src/aircraft/physics.js');
    const grade = (vsFpm, score) => ({ crashed: false, reason: '', quality: 'good', vsFpm, bank: 0, centreline: 0.5, onRunway: true, paved: true, speedKts: 55, score });
    sim.aircraft.emit(EVENTS.TOUCHDOWN, grade(-85, 91));
    frames(2);
    const card = q('#ui .hud-touchdown');
    const txt = (card && card.textContent) || '';
    r.ok(
      'hud wins: a landing at 85 ft/min — the card says Butter, 85 ft/min, three stars, your first landing in the Skylark',
      shown(card) && /Butter/.test(txt) && /85 ft\/min/.test(txt) && card.querySelectorAll('.hud-td-stars .is-lit').length === 3 && /first landing/.test(txt) && /91\/100/.test(txt) && card.parentNode === sim.hud.center,
      `${shown(card)} "${txt.replace(/\s+/g, ' ').trim()}" lit ${card && card.querySelectorAll('.is-lit').length}`
    );
    sim.aircraft.emit(EVENTS.TOUCHDOWN, grade(-300, 70));
    frames(2);
    const txt2 = (card && card.textContent) || '';
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(BEST_KEY) || '{}'); } catch (e) { saved = {}; }
    const acId = sim.aircraftType && sim.aircraftType.id;
    r.ok(
      'hud wins: a heavier one — Firm, one star, and the best (85) named; the best is saved per aeroplane',
      /Firm/.test(txt2) && /300 ft\/min/.test(txt2) && card.querySelectorAll('.hud-td-stars .is-lit').length === 1 && /best[^]*85 ft\/min/i.test(txt2) && saved && saved[acId] && saved[acId].rate === 85,
      `"${txt2.replace(/\s+/g, ' ').trim()}" saved ${JSON.stringify(saved)}`
    );
    frames(240); // ~8 s: the card goes on its own
    r.ok('hud wins: the card leaves after a few seconds', !shown(card), '');

    /* ---- 2. the state pills ---- */
    log('the state pills');
    const ac = sim.aircraft;
    ac.parkingBrake = true;
    frames(3);
    await wait(30);
    const lane = q('#ui .hud-pills');
    const pill = q('#ui .hud-pill[data-pill="parking"]');
    const laneBox = lane && lane.getBoundingClientRect();
    const W = window.innerWidth;
    const H = window.innerHeight;
    r.ok(
      'hud wins: on the runway with the parking brake on — the parking-brake pill, bottom centre, saying how to release it',
      shown(pill) && /Parking brake on/.test(pill.textContent) && /releases it|tap to release/.test(pill.textContent) && laneBox && Math.abs((laneBox.left + laneBox.right) / 2 - W / 2) < 40 && laneBox.top > H * 0.5 && lane.children.length <= 2,
      `${pill ? pill.textContent : 'no pill'}; lane ${laneBox ? `${Math.round(laneBox.left)},${Math.round(laneBox.top)} ${Math.round(laneBox.width)}x${Math.round(laneBox.height)}` : 'none'} of ${W}x${H}`
    );
    const sub = sim.hud.subtitle;
    sim.hud.setSubtitle('Skylark one seven two, runway zero nine, cleared for take-off.', 'Tower', 4);
    frames(16);
    await wait(30);
    const sb = sub.getBoundingClientRect();
    const lb = lane.getBoundingClientRect();
    r.ok('hud wins: the radio line sits above the pills, never on them', shown(sub) && sb.bottom <= lb.top + 1, `radio ${Math.round(sb.top)}-${Math.round(sb.bottom)} pills ${Math.round(lb.top)}-${Math.round(lb.bottom)}`);
    pill.click();
    frames(3);
    r.ok('hud wins: a tap on the pill releases the brake and the pill goes', ac.parkingBrake === false && !q('#ui .hud-pill[data-pill="parking"]'), `brake ${ac.parkingBrake}`);
    // A state that flickers across its threshold must not flash the pill.
    {
      const L = sim.hud.pills;
      const P = { id: 'flick', level: 'bad', icon: 'gear', text: 'Flicker', how: 'x', action: 'gear' };
      L.clear();
      L.set([P], 1000);
      L.set([], 1100);
      const kept = L.ids().includes('flick');
      L.set([], 2600);
      const gone = !L.ids().includes('flick');
      L.set([P], 3000);
      L.set([P], 5000);
      L.set([], 5010);
      const quick = !L.ids().includes('flick');
      L.clear();
      r.ok('hud wins: a pill stays 1.5 s once up (a flickering state is not a flashing light), then goes; an old pill goes at once', kept && gone && quick, `kept ${kept} gone ${gone} quick ${quick}`);
    }
    quit();

    await sim.startMode('free', { aircraft: 'skylark', time: 'day', condition: 'clear', windSpeedKts: 5, windDirDeg: 100, airborne: true });
    frames(10);
    const ac2 = sim.aircraft;
    // Gear up, 300 ft over the ground, descending, slow.
    let gearPill = null;
    let last = null;
    for (let i = 0; i < 40 && !gearPill; i++) {
      ac2.gearDown = false;
      ac2.gearPos = 0;
      ac2.pos.y = (ac2.pos.y - (ac2.agl || 0)) + 90;
      ac2.vel.y = -3;
      sim.update(1 / 30);
      last = ac2.readouts();
      gearPill = q('#ui .hud-pill[data-pill="gear"]');
    }
    const first = lane.children[0];
    r.ok(
      'hud wins: gear up, low and slow — the red "Gear up — low and slow?" pill, first in the lane',
      shown(gearPill) && gearPill.classList.contains('is-bad') && /Gear up/.test(gearPill.textContent) && first === gearPill,
      `${gearPill ? gearPill.textContent : 'no pill'}; agl ${last && Math.round(last.aglFt)} ft, ${last && Math.round(last.iasKts)} kt, ${last && Math.round(last.vsFpm)} ft/min, gearPos ${last && last.gearPos}`
    );
    r.ok('hud wins: a free flight has no destination ribbon and no destination beacon', !sim.hud.dest.shown && !(sim.destBeacon && sim.destBeacon.group.visible), `ribbon ${sim.hud.dest.shown} beacon ${sim.destBeacon && sim.destBeacon.group.visible}`);
    quit();

    /* ---- 3. the destination ribbon and beacon ---- */
    log('the destination ribbon');
    await sim.startMode('mission', { id: 'circuit' });
    frames(20);
    const rib = q('#ui .hud-top .hud-dest');
    const ribTxt = rib ? rib.querySelector('.hud-dest-text').textContent : '';
    const obj = q('#ui .hud-objective');
    const rb = rib && rib.getBoundingClientRect();
    const ob = obj && obj.getBoundingClientRect();
    const target = sim.activeTarget;
    const dest = sim.runner.destination && sim.runner.destination();
    r.ok(
      'hud wins: in a mission the heading tape stands at the top with the target named and its distance, above the objective; the arrow pill stands down',
      shown(rib) && target && ribTxt.includes(target.label) && /\d (km|m)\b/.test(ribTxt) && rb && ob && rb.bottom <= ob.top + 1 && !shown(sim.hud.waypoint) && rib.querySelectorAll('.hud-dest-tick').length > 60 && shown(rib.querySelector('.hud-dest-mark')),
      `"${ribTxt}" target ${target && target.label}; tape ${rb && `${Math.round(rb.top)}-${Math.round(rb.bottom)}`} objective top ${ob && Math.round(ob.top)}; arrow shown ${shown(sim.hud.waypoint)}`
    );
    const strip = rib && rib.querySelector('.hud-dest-strip');
    const t0 = strip && strip.style.transform;
    sim.aircraft.quat.setFromAxisAngle({ x: 0, y: 1, z: 0 }, Math.PI / 2);
    frames(2);
    const t1 = strip && strip.style.transform;
    r.ok('hud wins: the tape slides with the heading', t0 && t1 && t0 !== t1 && /translateX\(/.test(t1), `${t0} -> ${t1}`);
    r.ok(
      'hud wins: a soft beacon stands over the mission\'s destination in the world',
      !!dest && sim.destBeacon && sim.destBeacon.group.visible && Math.abs(sim.destBeacon.group.position.x - dest.pos.x) < 1 && Math.abs(sim.destBeacon.group.position.z - dest.pos.z) < 1 && sim.destBeacon.shells.length === 1,
      `dest ${dest && dest.label} ${dest && `${Math.round(dest.pos.x)},${Math.round(dest.pos.z)}`}; beacon ${sim.destBeacon && sim.destBeacon.group.visible} at ${sim.destBeacon && `${Math.round(sim.destBeacon.group.position.x)},${Math.round(sim.destBeacon.group.position.z)}`}`
    );

    /* ---- 4. the conditions chip ---- */
    log('the conditions chip');
    const chip = sim.hud.wxChip;
    const w0 = chip.textContent;
    sim.weather.load({ time: 'night', condition: 'stormy', windSpeedKts: 30, windDirDeg: 250 });
    frames(3);
    const w1 = chip.textContent;
    r.ok(
      'hud wins: the folded wind card says it in words — time · sky · wind — and a stormy night in a gale changes every word',
      /^(Midday|Sunset|Night) · (clear skies|cloudy|rain|storm) · (calm|light breeze|breezy|windy|gale)$/.test(w0) && w1 === 'Night · storm · gale',
      `"${w0}" -> "${w1}"`
    );
    // Folded, the chip line shows and the numbers hide; open, the other way round.
    sim.hud.setDensity('clean');
    const wxCard = sim.hud.weatherCard;
    frames(240);
    await wait(320);
    frames(2);
    const folded = wxCard.classList.contains('rs-chip');
    const chipShown = shown(chip);
    const detailShown = shown(sim.hud.windDetail);
    sim.hud.stack.poke(wxCard);
    frames(2);
    await wait(50);
    r.ok(
      'hud wins: folded, the words show and the bearing hides; a tap opens the card with the numbers',
      folded && chipShown && !detailShown && !wxCard.classList.contains('rs-chip') && !shown(chip) && shown(sim.hud.windDetail),
      `folded ${folded} chip ${chipShown} detail ${detailShown}; after tap chip ${shown(chip)} detail ${shown(sim.hud.windDetail)}`
    );

    /* ---- 5. HUD modes ---- */
    log('HUD modes');
    const btn = q('#ui .hud-buttons .hud-btn-mode');
    r.ok('hud wins: the dock has the HUD-mode button', shown(btn) && /Full \/ Clean \/ Photo/.test(btn.title), btn ? btn.title : 'no button');
    const { isKey } = await import('../../src/flight/input.js');
    r.ok('hud wins: the mode is on a key of its own (Delete by default — H is the controls card)', isKey(sim, 'hudMode', 'Delete') && isKey(sim, 'help', 'KeyH') && !isKey(sim, 'hudMode', 'KeyH'), JSON.stringify(sim.input.bindings.hudMode));
    sim.settings.hudDensity = 'clean';
    sim.hud.setDensity('clean');
    frames(2);
    const left = q('#ui .hud-left');
    const seen = [];
    sim.hudAction('hudMode'); // clean -> photo
    frames(2);
    seen.push(sim.settings.hudDensity);
    const photoHidesAll = !shown(left) && !shown(q('#ui .hud-bottom')) && !shown(q('#ui .hud-top')) && !shown(wxCard);
    const photoKeeps = shown(q('#ui .hud-buttons')) && sim.hud.wrap.classList.contains('is-photo') && document.documentElement.classList.contains('hud-photo');
    const mm = q('#ui .minimap');
    const minimapHidden = !mm || !shown(mm);
    sim.hudAction('hudMode'); // photo -> full
    frames(2);
    seen.push(sim.settings.hudDensity);
    const fullOpen = shown(left) && shown(q('#ui .hud-top')) && !sim.hud.wrap.classList.contains('is-photo') && !document.documentElement.classList.contains('hud-photo') && sim.hud.stack.density === 'full';
    sim.hudAction('hudMode'); // full -> clean
    frames(2);
    seen.push(sim.settings.hudDensity);
    let stored = null;
    try { stored = JSON.parse(localStorage.getItem('islandsim.settings.v1') || '{}').hudDensity; } catch (e) { /* fine */ }
    r.ok('hud wins: the key cycles Clean → Photo → Full → Clean and the setting is saved', seen.join() === 'photo,full,clean' && stored === 'clean', `${seen.join(' → ')} saved ${stored}`);
    r.ok('hud wins: Photo hides the instruments, the strip, the objective, the wind card and the minimap, and keeps the dock', photoHidesAll && photoKeeps && minimapHidden, `hides ${photoHidesAll} keeps ${photoKeeps} minimap hidden ${minimapHidden}`);
    r.ok('hud wins: Full opens everything again', fullOpen, '');
    const sel = document.querySelector('select[data-set="hudDensity"]');
    r.ok('hud wins: Settings → HUD density offers Photo', !!sel && [...sel.options].some((o) => o.value === 'photo'), sel ? [...sel.options].map((o) => o.value).join() : 'no select');
  } finally {
    quit();
    try {
      if (savedBests === null) localStorage.removeItem(BEST_KEY);
      else localStorage.setItem(BEST_KEY, savedBests);
    } catch (e) { /* fine */ }
    if (sim.settings.hudDensity !== density0) {
      sim.settings.hudDensity = density0;
      sim.hud.setDensity(density0);
      try { sim.menus.syncSettings(sim.settings); } catch (e) { /* fine */ }
    }
    sim.autoPauseOnHide = origAuto;
  }
}
