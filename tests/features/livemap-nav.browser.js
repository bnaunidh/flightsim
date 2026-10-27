/**
 * Browser check for DIRECT TO on the live map (src/features/livemap/nav.js):
 *
 *   node .claude/devtools/briefs/one-check.mjs <url> ./tests/features/livemap-nav.browser.js check "" 1
 *
 *   - a tap on the chart drops a pin; its card gives the position as
 *     latitude and longitude, the distance, bearing and ETA, and DIRECT TO
 *   - DIRECT TO engages the autopilot in NAV (the HUD's heading bug reads
 *     NAV, the map's mode reads NAV), holds the height, and the aeroplane
 *     turns towards the pin while the map stays open
 *   - GO TO: a fix by name selects it; + ROUTE makes a two-leg flight plan
 *     (FROM → PIN → fix, each with its distance); a typed latitude and
 *     longitude pins exactly there
 *   - dialling a heading leaves NAV for HDG; CLEAR empties the plan
 *   - reaching a waypoint says so ("Waypoint reached"); at an airport the
 *     approach is offered, and taking it puts the autopilot on the approach
 *   - the buttons are touch-sized (40 px and more)
 * Free Flight and the autopilot are put back afterwards.
 */

export const id = 'livemap-nav';

export async function check(sim, r, say) {
  say && say('livemap-nav: DIRECT TO and the flight plan');
  let G;
  try {
    G = await import('../../src/features/livemap/geo.js');
  } catch (err) {
    r.ok('livemap-nav: the modules load', false, String(err && err.message));
    return;
  }
  const LM = sim.liveMap;
  if (!LM || !LM.directTo) {
    r.ok('livemap-nav: sim.liveMap has DIRECT TO', false, 'missing');
    return;
  }
  const wasAutoPause = sim.autoPauseOnHide;
  sim.autoPauseOnHide = false;
  const run = (s) => {
    const n = Math.max(1, Math.round(s * 60));
    for (let i = 0; i < n; i++) sim.step(1 / 60);
  };
  const q = (s) => document.querySelector(s);
  const toasts = () => [...document.querySelectorAll('.hud-toast')].map((x) => x.textContent).join(' | ');
  const ptr = (el, type, x, y) => el.dispatchEvent(new PointerEvent(type, { pointerId: 7, pointerType: 'mouse', clientX: x, clientY: y, bubbles: true, cancelable: true, button: 0 }));
  try {
    await sim.startMode('free', { loadingScreen: false, airborne: true, aircraft: 'skylark' });
    if (sim.state === 'paused') sim.resume();
    run(0.5);
    const ac = sim.aircraft;
    LM.open();
    run(0.1);

    /* ---- a tap drops a pin ---- */
    const cv = q('.lm-cv');
    const rect = cv.getBoundingClientRect();
    // 6 km north-west of the aeroplane.
    const tx = ac.pos.x - 4200;
    const tz = ac.pos.z - 4200;
    LM.setView(ac.pos.x, ac.pos.z, 1 / 40);
    run(0.1);
    const v2 = LM.view();
    const sx = rect.left + v2.W / 2 + (tx - v2.cx) * v2.s;
    const sy = rect.top + v2.H / 2 + (tz - v2.cz) * v2.s;
    ptr(cv, 'pointerdown', sx, sy);
    ptr(cv, 'pointerup', sx, sy);
    run(0.1);
    const sel = LM.selected();
    const card = q('[data-lm-selsec]');
    const cardText = card ? card.textContent : '';
    const direct = q('.lm [data-lm-act="direct"]');
    r.ok('livemap-nav: a tap on the chart drops a pin; its card has the latitude/longitude, distance, bearing, ETA and DIRECT TO',
      !!sel && (sel.kind === 'pin' || sel.kind) && card && !card.hidden && /[NS]\d\d°\d\d\.\d' [EW]\d{3}°\d\d\.\d'/.test(cardText) && /km/.test(cardText) && /\d{3}°/.test(cardText) && /ETA/.test(cardText) && !!direct,
      `${sel ? sel.kind + ' ' + sel.name : 'nothing'} · ${cardText.replace(/\s+/g, ' ').slice(0, 160)}`);

    /* ---- DIRECT TO ---- */
    const alt0 = ac.readouts().altFt;
    const brg = G.bearingDeg(ac.pos.x, ac.pos.z, sel.x, sel.z);
    const err0 = Math.abs(((brg - ac.readouts().heading + 540) % 360) - 180);
    direct.click();
    run(0.2);
    const ap = sim.autopilot;
    const bug = q('.hud') ? (document.querySelector('.hud').textContent.match(/NAV [A-Z0-9]+/) || [''])[0] : '';
    const mode = q('[data-lm-mode]') ? q('[data-lm-mode]').textContent : '';
    r.ok('livemap-nav: DIRECT TO engages the autopilot in NAV (the heading bug and the map\'s mode say NAV)', ap.engaged && ap.lateral === 'NAV' && /NAV/.test(mode) && /^NAV/.test(bug),
      `engaged ${ap.engaged}, lateral ${ap.lateral}, map "${mode}", HUD "${bug}"`);
    run(30);
    const r1 = ac.readouts();
    const brg1 = G.bearingDeg(ac.pos.x, ac.pos.z, sel.x, sel.z);
    const err1 = Math.abs(((brg1 - r1.heading + 540) % 360) - 180);
    r.ok('livemap-nav: it turns towards the pin with the map open, holding the height', LM.isOpen() && err1 < Math.max(15, err0 * 0.5) && Math.abs(r1.altFt - alt0) < 250,
      `off the bearing ${err0.toFixed(0)}° → ${err1.toFixed(0)}°, height ${alt0.toFixed(0)} → ${r1.altFt.toFixed(0)} ft`);

    /* ---- GO TO, + ROUTE ---- */
    const fix = LM.places().fixes[0];
    const input = q('.lm [data-lm-input]');
    const form = q('.lm [data-lm-form]');
    input.value = fix.name.toLowerCase();
    form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(new Event('submit', { cancelable: true }));
    run(0.1);
    const s2 = LM.selected();
    q('.lm [data-lm-act="add"]').click();
    run(0.1);
    const rows = [...document.querySelectorAll('.lm [data-lm-plan] li')].map((li) => li.textContent.replace(/\s+/g, ' ').trim());
    r.ok(`livemap-nav: GO TO a fix by name (${fix.name}) selects it; + ROUTE makes a two-leg plan, FROM → the pin → ${fix.name}, each leg with its distance`,
      s2 && s2.name === fix.name && LM.plan.legs.length === 2 && rows.length === 3 && /FROM/.test(rows[0]) && rows[2].includes(fix.name) && rows.slice(1).every((t) => /km|m ·/.test(t)),
      rows.join(' / '));
    const want = { x: ac.pos.x + 3000, z: ac.pos.z - 5000 };
    const txt = G.fmtPos(want.x, want.z, LM.origin());
    input.value = txt;
    form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(new Event('submit', { cancelable: true }));
    run(0.1);
    const s3 = LM.selected();
    const off = s3 ? Math.hypot(s3.x - want.x, s3.z - want.z) : Infinity;
    r.ok(`livemap-nav: a typed latitude and longitude (${txt}) pins that place (to the 0.1' it is written to)`, s3 && s3.kind === 'pin' && off < 200, `${off.toFixed(0)} m off`);

    /* ---- HDG, CLEAR ---- */
    if (sim.hudAction) sim.hudAction('apHdgLeft');
    run(0.2);
    r.ok('livemap-nav: dialling a heading leaves NAV for HDG (the route waits)', ap.lateral === 'HDG' && !LM.armed() && LM.plan.legs.length === 2, `${ap.lateral}, armed ${LM.armed()}`);
    q('.lm [data-lm-clear]').click();
    run(0.1);
    r.ok('livemap-nav: CLEAR empties the plan', LM.plan.legs.length === 0 && /No route/.test(q('.lm [data-lm-plan]').textContent), `${LM.plan.legs.length} legs`);

    /* ---- reaching one ---- */
    const r2 = ac.readouts();
    const h = (r2.heading * Math.PI) / 180;
    LM.directTo({ id: 'pin:near', name: 'PIN', kind: 'pin', x: ac.pos.x + Math.sin(h) * 1500, z: ac.pos.z - Math.cos(h) * 1500 });
    let reached = false;
    for (let i = 0; i < 60 && !reached; i++) {
      run(0.5);
      reached = /Waypoint reached/.test(toasts());
    }
    r.ok('livemap-nav: reaching it says "Waypoint reached" and holds (an orbit round it)', reached && LM.plan.state === 'holding' && /HOLD/.test(LM.nav.label()), `${toasts().slice(-140)} · ${LM.plan.state}`);

    /* ---- at an airport: the approach ---- */
    const field = LM.places().airports[0];
    LM.clearRoute();
    // Put the aeroplane 2 km short of the field, heading at it, and DIRECT TO it.
    const hd = G.bearingDeg(field.x - 2600, field.z + 600, field.x, field.z);
    ac.pos.set(field.x - 2600, Math.max(ac.pos.y, field.elev + 500), field.z + 600);
    // ...pointing at it.
    const hr = (hd * Math.PI) / 180;
    ac.quat.setFromAxisAngle({ x: 0, y: 1, z: 0 }, -hr);
    const sp = Math.max(50, ac.vel.length());
    ac.vel.set(Math.sin(hr) * sp, 0, -Math.cos(hr) * sp);
    run(0.1);
    const wp = LM.waypoints().find((w) => w.kind === 'airport' && w.ref === field.id);
    LM.directTo(wp);
    let offer = null;
    for (let i = 0; i < 160 && !offer; i++) {
      run(0.5);
      offer = q('.lm-offer');
    }
    const yes = offer && offer.querySelector('[data-lm-offer="yes"]');
    if (yes) yes.click();
    run(0.3);
    r.ok(`livemap-nav: arriving over ${field.code} offers the approach; taking it puts the autopilot on the approach`, !!offer && ap.engaged && ap.mode === 'approach' && !q('.lm-offer'),
      `offer ${!!offer}, mode ${ap.mode} (start bearing ${hd.toFixed(0)}°)`);

    /* ---- touch-sized ---- */
    const btns = [...document.querySelectorAll('.lm button')].filter((b) => b.offsetParent && !b.classList.contains('lm-small') && !b.classList.contains('lm-sheet-toggle'));
    const small = btns.filter((b) => b.getBoundingClientRect().height < 39.5);
    r.ok('livemap-nav: the map\'s buttons are touch-sized (40 px and more)', btns.length > 5 && small.length === 0, `${btns.length} buttons, small: ${small.map((b) => b.textContent.trim() || b.getAttribute('aria-label')).join(', ')}`);
  } catch (err) {
    r.ok('livemap-nav: the check ran to the end', false, String((err && err.stack) || err).slice(0, 400));
  } finally {
    try {
      LM.clearRoute();
      LM.close();
      if (sim.autopilot.engaged) sim.toggleAutopilot(false);
      sim.autopilot.setMode('hold');
    } catch (e) {
      /* put back as far as it goes */
    }
    sim.autoPauseOnHide = wasAutoPause;
  }
}
