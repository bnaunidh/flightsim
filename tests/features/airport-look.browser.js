/**
 * Browser checks for wave 13's airport look and UI fixes, on the real game:
 *
 *   - the minimap's chart of Nunatak Reach is snow and ice, not green, and
 *     Kestrel's is still green (MINIMAP SNOW)
 *   - the damage chip is the B-2's flying wing in the B-2 and a rotor and
 *     boom in a helicopter (DAMAGE ICON SHAPE)
 *   - the hangar marks the shelf of the aircraft on show in All, has no title
 *     tooltips, keeps its paint inside the card, says where the arrows go
 *     beside them, and keeps the drag hint clear of the dots (HANGAR POLISH)
 *   - a notice raised in the menus sits clear of the screen's title and its
 *     chips, and goes on time (top notices never cut off / never cover)
 *   - Gateway at night: the curtain wall and the roof letters lit, the halo
 *     on, the taxiway's green lights among the field's lights
 *
 *   const { check } = await import('./tests/features/airport-look.browser.js');
 */

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const rectOf = (el) => {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
};
const hits = (a, b, m = 0) => a.left < b.right - m && a.right > b.left + m && a.top < b.bottom - m && a.bottom > b.top + m;

export async function check(sim, r, say = () => {}) {
  /* ---------------- the minimap's palette ---------------- */
  say('airport-look: minimap palette');
  const px = (chart, wx, wz) => {
    const n = chart.canvas.width;
    const i = Math.round(((wx - chart.cx) / chart.extent + 0.5) * n);
    const j = Math.round(((wz - chart.cz) / chart.extent + 0.5) * n);
    const d = chart.ctx.getImageData(Math.max(0, Math.min(n - 1, i)), Math.max(0, Math.min(n - 1, j)), 1, 1).data;
    return [d[0], d[1], d[2]];
  };
  const green = ([cr, cg, cb]) => cg > cr * 1.12 && cg > cb * 1.12;
  const chartFor = async (mapId) => {
    if (sim.state !== 'menu' && sim.quitToMenu) sim.quitToMenu('main');
    if (sim.game !== 'flight' && sim.switchGame) sim.switchGame('flight');
    sim.setMap(mapId);
    await sim.startMode('free', { time: 'day', condition: 'clear' });
    sim.autoPauseOnHide = false;
    const mm = sim.minimap;
    const c = mm && mm.wholeChart && mm.wholeChart('relief', true);
    if (!c) return null;
    for (let k = 0; k < 200 && !c.done; k++) c.slice(64);
    return c;
  };
  const nun = await chartFor('nunatak');
  if (!nun) {
    r.ok('airport-look: the minimap builds a chart', false, 'no wholeChart');
  } else {
    const plain = px(nun, 300, 1400);
    const lake = px(nun, -2050, 2250);
    r.ok('airport-look: Nunatak\'s chart is snow, not green', !green(plain) && plain[2] > 150 && plain[2] >= plain[0] - 4, plain.join(','));
    r.ok('airport-look: and its frozen lake is pale ice', !green(lake) && lake[2] > 190 && lake[0] > 160, lake.join(','));
  }
  const kes = await chartFor('kestrel');
  if (kes) {
    const land = px(kes, 700, 900);
    r.ok('airport-look: Kestrel\'s chart is still green', green(land), land.join(','));
  }

  /* ---------------- the damage chip ---------------- */
  say('airport-look: damage chip');
  const planform = async (id) => {
    if (sim.state !== 'menu' && sim.quitToMenu) sim.quitToMenu('main');
    const heli = /^(bell407|h145|r44|aw139|uh60|ch47|ah64|vh3d|harrier)$/.test(id);
    if (sim.switchGame) sim.switchGame(heli ? 'heli' : 'flight');
    await sim.startMode('free', { time: 'day', condition: 'clear', airborne: true, aircraft: id });
    sim.autoPauseOnHide = false;
    sim.step(0.2, 1 / 30);
    sim.aircraft.damage.leftWing = 0.5;
    sim.hud.setDamage(sim.aircraft.damage);
    sim.step(0.1, 1 / 30);
    const p = document.querySelector('.hud-damage');
    const left = p && p.querySelector('[data-zone="leftWing"]');
    return { kind: p && p.dataset.planform, hidden: p ? p.hidden : true, lit: left ? left.getAttribute('class') : '', rings: p ? p.querySelectorAll('circle.dmg-rotor').length : 0, type: sim.aircraftType && sim.aircraftType.id };
  };
  const b2 = await planform('nightjar');
  r.ok('airport-look: in the B-2 the damage diagram is a flying wing, the hit wing coloured', b2.kind === 'flyingWing' && !b2.hidden && /is-/.test(b2.lit || ''), JSON.stringify(b2));
  const he = await planform('bell407');
  r.ok('airport-look: in a helicopter it is a cabin and boom inside the rotor disc', he.kind === 'heli' && he.rings >= 1, JSON.stringify(he));
  if (sim.state !== 'menu' && sim.quitToMenu) sim.quitToMenu('main');
  if (sim.switchGame) sim.switchGame('flight');

  /* ---------------- the hangar ---------------- */
  say('airport-look: hangar');
  const m = sim.menus;
  m.show('hangar');
  await wait(400);
  const ui = m.showcaseUi;
  if (!ui) {
    r.ok('airport-look: the hangar showroom is there', false);
  } else {
    ui.setShelf('all');
    ui.select('a320');
    await wait(100);
    const here = [...document.querySelectorAll('.hs-tab.is-here')].map((e) => e.dataset.hsTab);
    r.ok('airport-look: in All, the shelf of the aircraft on show lights up', here.length === 1 && here[0] === 'airliners' && !document.querySelector('.hs-tab.is-here.is-all'), here.join(','));
    ui.setQuery('b-2');
    await wait(50);
    const id = ui.id;
    const here2 = [...document.querySelectorAll('.hs-tab.is-here')].map((e) => e.dataset.hsTab);
    r.ok('airport-look: ...and in a search too', !id || here2.length === 1, `${id}: ${here2.join(',')}`);
    ui.setQuery('');
    const titled = [...document.querySelectorAll('[data-showcase] [title]')].map((e) => e.className || e.tagName);
    r.ok('airport-look: no title tooltips in the showroom to hang over its buttons', titled.length === 0, titled.slice(0, 5).join(', '));
    const next = document.querySelector('[data-hs-next] .hs-arrow-tip');
    r.ok('airport-look: the next arrow says where it goes, beside itself', !!next && next.textContent.trim().length > 0, next ? next.textContent : 'no tip');
    // The paint fits: every swatch inside the card, or the grid scrolls inside it.
    const card = document.querySelector('.hs-card');
    const grid = document.querySelector('[data-hs-swatches]');
    if (card && grid) {
      const cr = rectOf(card);
      const gr = rectOf(grid);
      const scrolls = grid.scrollHeight > grid.clientHeight + 1 && getComputedStyle(grid).overflowY !== 'visible';
      const sw = [...grid.querySelectorAll('.hs-swatch')];
      const inside = sw.every((e) => {
        const q = rectOf(e);
        return q.bottom <= gr.bottom + 3 || scrolls;
      });
      // Inside the card's own bottom edge, not under it: at 1280 x 800 (a laptop,
      // close to a Chromebook's 1366 x 768) the card used to scroll the paint away.
      r.ok('airport-look: the paint swatches fit in the card, not under its bottom edge', inside && gr.bottom <= cr.bottom + 2, `${sw.length} swatches, grid ${Math.round(gr.top)}-${Math.round(gr.bottom)}, card to ${Math.round(cr.bottom)}${scrolls ? ', scrolls' : ''}`);
      // ...for every aircraft, the longest names and blurbs included (the 787's).
      const spill = [];
      for (const aid of ui.order.slice()) {
        ui.select(aid);
        await wait(20);
        if (card.scrollHeight > card.clientHeight + 1) spill.push(`${aid} +${card.scrollHeight - card.clientHeight}`);
      }
      ui.select('a320');
      r.ok('airport-look: no aircraft\'s card runs past its bottom edge beside the podium', innerWidth <= 760 || spill.length === 0, spill.join(', ') || `${ui.order.length} aircraft at ${innerWidth}x${innerHeight}`);
    }
    ui.setShelf('light');
    await wait(50);
    const hint = document.querySelector('.hs-hint');
    const dots = document.querySelector('.hs-dots');
    if (hint && dots && getComputedStyle(hint).display !== 'none' && dots.children.length) {
      const hr = rectOf(hint);
      const dr = rectOf(dots);
      const stage = rectOf(document.querySelector('.hs-stage'));
      r.ok('airport-look: the drag hint is clear of the dots and inside the stage', !hits(hr, dr) && hr.bottom <= stage.bottom + 1 && hr.left >= stage.left && hr.right <= stage.right, `hint ${Math.round(hr.top)}-${Math.round(hr.bottom)}, dots ${Math.round(dr.top)}-${Math.round(dr.bottom)}`);
    } else {
      r.ok('airport-look: the drag hint is clear of the dots', true, 'hint hidden at this size or no dots');
    }
    ui.setShelf('all');

    /* ---------------- a notice in the menus ---------------- */
    say('airport-look: notices');
    // Whatever the last flight left in the queue, cleared, so this one shows.
    for (const q of sim.hud.toasts.splice(0)) q.node.remove();
    const entry = sim.hud.notify('Locked — unlock it for 500 credits in the Hangar.', 'warn', 1);
    await wait(80);
    const t = entry && entry.node;
    const h2 = document.querySelector('.screen-hangar .screen-head h2') || document.querySelector('.screen-hangar h2');
    if (t && h2) {
      const tr = rectOf(t);
      const blocked = [h2, ...document.querySelectorAll('.screen-hangar .hs-tab, .screen-hangar .screen-head button')].filter((e) => hits(tr, rectOf(e), 1));
      r.ok('airport-look: a notice in the menus covers neither the title nor the chips', tr.width > 0 && blocked.length === 0 && tr.left >= 0 && tr.right <= innerWidth, `${Math.round(tr.left)},${Math.round(tr.top)} ${Math.round(tr.width)}x${Math.round(tr.height)}; over ${blocked.map((e) => e.textContent.trim().slice(0, 16)).join(' / ')}`);
    }
    await wait(1900);
    r.ok('airport-look: and it goes on time, even though nothing is flying', !entry || !entry.node.isConnected || entry.node.classList.contains('is-out'));
    m.show('main');
  }

  /* ---------------- Gateway at night ---------------- */
  say('airport-look: Gateway at night');
  if (sim.state !== 'menu' && sim.quitToMenu) sim.quitToMenu('main');
  sim.setMap('gateway');
  await sim.startMode('free', { time: 'night', condition: 'clear' });
  sim.autoPauseOnHide = false;
  await wait(1500);
  sim.weather.time = 'night';
  sim.step(0.3, 1 / 30);
  const A = sim.apron;
  const F = sim.airport;
  r.ok('airport-look: at night the curtain wall lights only its open rooms, and the roof letters light with their halo',
    !!A && A.glassMat && A.glassMat.emissiveIntensity > 0.5 && A.lettersMat && A.lettersMat.emissiveIntensity > 1 && A.lettersHalo && A.lettersHalo.visible,
    A ? `glass ${A.glassMat && A.glassMat.emissiveIntensity}, letters ${A.lettersMat && A.lettersMat.emissiveIntensity}` : 'no apron');
  const M = F && F.markings;
  r.ok('airport-look: the taxiway\'s green centreline and exit lights are among the field\'s lights, which are on',
    !!M && M.lights.length > 50 && F.runwayLights.visible && F.runwayLights.count >= M.lights.length, M ? `${M.lights.length} taxiway lights, ${F.runwayLights.count} in all` : 'no markings');
  if (sim.quitToMenu) sim.quitToMenu('main');
  sim.setMap('kestrel');
  return r;
}
