/**
 * The hangar's showroom: the screen around the podium.
 *
 * hangar-showcase.js draws the room and the aeroplane; this is everything you
 * press — the category tabs, the arrows, the card with the name, the one-line
 * description, the four bars, the paint, and the button that either flies it
 * or buys it. It is a file of its own so menus.js (worked on by several people
 * at once) only gains the lines that plug it in.
 *
 * Nothing three.js is imported here. The 3D half is loaded the first time the
 * hangar opens, so the menu boots no slower and tests/features/menus.mjs can
 * still import menus.js in Node with a ten-line DOM stub.
 *
 * WHAT IS KEPT
 * The rest of the hangar is still underneath, a scroll away: rank, the list of
 * every aeroplane (now a way to put one on the podium), the military passcode,
 * the "Got a code?" box and Dev mode — same elements, same handlers.
 */

import { AIRCRAFT, performanceFor } from '../aircraft/types.js';
import { LIVERIES, schemeFor } from '../aircraft/liveries.js';
import * as Prog from '../game/progression.js';
import { icon } from './icons.js';

const LOCK_SVG =
  '<svg class="icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" ' +
  'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<rect x="5" y="10.5" width="14" height="10" rx="2.2"/><path d="M8.2 10.5V7.6a3.8 3.8 0 0 1 7.6 0v2.9"/></svg>';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** The first sentence of a blurb: the one line the card has room for. */
export function oneLine(blurb) {
  const text = String(blurb || '').trim();
  const m = text.match(/^(.+?[.!?])(\s|$)/);
  return m ? m[1] : text;
}

/*
 * The four bars, each 0..1, worked out from the numbers the flight model
 * flies on rather than typed beside them — the same rule as the Free Flight
 * card's "Top" and "Endurance".
 */
const AGILITY_WORDS = ['Turns like a bus', 'Steady', 'Nimble', 'Quick', 'Razor-sharp'];
const EASE_WORDS = ['Experts only', 'Tricky', 'Takes practice', 'Easy to fly', 'Easiest to fly'];

export function statsFor(type) {
  let perf = {};
  try {
    perf = performanceFor(type.id) || {};
  } catch (e) {
    perf = {};
  }
  const st = type.stats || {};
  const plan = type.plan || {};
  const span = plan.span || (type.shape ? type.shape.halfSpan * 2 * (type.shape.scale || 1) : 10);
  const length = plan.tail != null && plan.nose != null ? plan.tail - plan.nose : span;
  const big = Math.max(span, length);
  const log01 = (v, lo, hi) => Math.max(0.05, Math.min(1, Math.log(Math.max(v, lo) / lo) / Math.log(hi / lo)));
  const vne = perf.vne || 150;
  const endur = perf.enduranceMin || 60;
  const h = Math.max(1, Math.min(5, st.handling || 3));
  const ease = Math.max(1, Math.min(5, st.ease || 3));
  const hrs = Math.floor(endur / 60);
  const mins = endur % 60;
  const rotor = !!(type.shape && type.shape.power && type.shape.power.rotor);
  return {
    speed: { v: log01(vne, 120, 720), text: `Top ${vne} kt` },
    agility: { v: h / 5, text: AGILITY_WORDS[h - 1] },
    size: { v: log01(big, 3, 82), text: `${rotor ? 'Rotor' : 'Wingspan'} ${span.toFixed(span < 20 ? 1 : 0)} m` },
    range: { v: log01(endur * vne, 20000, 170000), text: `Fuel for ${hrs ? `${hrs} h ` : ''}${mins ? `${mins} min` : ''}`.trim() },
    ease: { v: ease / 5, text: EASE_WORDS[ease - 1] },
  };
}

/**
 * Plug the showroom into the hangar screen.
 *
 * @param {object} menus   the live Menus instance
 * @param {HTMLElement} screen  the hangar <section>
 * @param {object} kit     menus.js's own helpers, handed in rather than
 *                         imported back so the two files cannot form a cycle
 */
export function installHangarShowcase(menus, screen, kit) {
  const { catIcon, aircraftCategory, groupByCategory, aircraftThumbnail, catStyle } = kit;
  const host = screen.querySelector('[data-showcase-host]');
  if (!host) return null;

  host.innerHTML = `
    <div class="hs" data-showcase>
      <div class="hs-tabs" role="tablist" aria-label="Kinds of aircraft" data-hs-tabs></div>
      <div class="hs-main">
        <div class="hs-stage" data-hs-stage>
          <div class="hs-fallback" data-hs-fallback hidden></div>
          <div class="hs-lock" data-hs-lock hidden></div>
          <div class="hs-q" data-hs-q aria-hidden="true" hidden>?</div>
          <button type="button" class="hs-arrow is-prev" data-hs-prev aria-label="Previous aircraft">${icon('chevronLeft', 30)}</button>
          <button type="button" class="hs-arrow is-next" data-hs-next aria-label="Next aircraft">${icon('chevronRight', 30)}</button>
          <div class="hs-under">
            <div class="hs-dots" data-hs-dots></div>
            <p class="hs-hint" data-hs-hint>Drag to spin it · swipe or press ← → for the next one</p>
          </div>
        </div>
        <aside class="hs-card" data-hs-card aria-live="polite">
          <div class="hs-kicker"><span class="hs-cat" data-hs-cat></span><span class="hs-class" data-hs-class></span><span class="hs-count" data-hs-count></span></div>
          <h3 class="hs-name" data-hs-name></h3>
          <p class="hs-line" data-hs-line></p>
          <div class="hs-pills" data-hs-pills></div>
          <div class="hs-actions" data-hs-actions></div>
          <p class="hs-msg" data-hs-msg></p>
          <div class="hs-stats" data-hs-stats></div>
          <div class="hs-paint">
            <span class="hs-label">Paint</span>
            <div class="hs-swatches" role="radiogroup" aria-label="Paint" data-hs-swatches></div>
            <span class="hs-paint-name" data-hs-paint-name></span>
          </div>
        </aside>
      </div>
      <button type="button" class="hs-more" data-hs-more>Rank, codes and the full list ${icon('chevronRight', 16)}</button>
    </div>`;

  const $ = (sel) => host.querySelector(sel);
  const stage = $('[data-hs-stage]');

  const ui = {
    id: null,
    order: [],
    groups: [],
    from: 'main',
    showcase: null,
    loading: null,
    failed: false,
  };
  menus.showcaseUi = ui;

  const prog = () => menus.prog || Prog.load();
  const livery = () => (menus.settingsRef && menus.settingsRef.livery) || 'house';
  const typeOf = (id) => AIRCRAFT.find((a) => a.id === id);
  const owned = (id) => Prog.isUnlocked(prog(), id);

  /** What can be shown: everything but what the passcode still hides. */
  ui.rebuildOrder = () => {
    const p = prog();
    const shown = AIRCRAFT.filter((a) => !Prog.needsPasscode(p, a));
    ui.groups = groupByCategory('aircraft', shown, aircraftCategory);
    ui.order = ui.groups.flatMap((g) => g.items.map((a) => a.id));
    if (ui.id && !ui.order.includes(ui.id)) ui.id = null;
  };

  const groupOf = (id) => ui.groups.find((g) => g.items.some((a) => a.id === id));

  /* ---------------- painting the screen ---------------- */

  const paintTabs = () => {
    const cur = groupOf(ui.id);
    $('[data-hs-tabs]').innerHTML = ui.groups
      .map((g) => {
        const mine = g.items.filter((a) => owned(a.id)).length;
        const on = cur && cur.def.id === g.def.id;
        return `<button type="button" class="hs-tab${on ? ' is-on' : ''}" role="tab" aria-selected="${on}" data-hs-tab="${esc(g.def.id)}" style="${catStyle(g.def)}">
          <span class="hs-tab-icon">${catIcon(g.def.icon, 18)}</span><span class="hs-tab-label">${esc(g.def.label)}</span><b>${mine}/${g.items.length}</b>
        </button>`;
      })
      .join('');
    // Keep the lit tab in view on a phone, where the row scrolls sideways —
    // by hand, because scrollIntoView would scroll the whole screen too.
    const row = $('[data-hs-tabs]');
    const lit = row.querySelector('.is-on');
    if (lit && row.scrollWidth > row.clientWidth) {
      row.scrollLeft = Math.max(0, lit.offsetLeft - (row.clientWidth - lit.offsetWidth) / 2);
    }
  };

  const paintDots = () => {
    const g = groupOf(ui.id);
    $('[data-hs-dots]').innerHTML = g
      ? g.items
          .map((a) => `<button type="button" class="hs-dot${a.id === ui.id ? ' is-on' : ''}${owned(a.id) ? '' : ' is-locked'}" data-hs-dot="${a.id}" aria-label="${esc(a.name)}"></button>`)
          .join('')
      : '';
  };

  const bar = (label, s) => `
    <div class="hs-stat">
      <span class="hs-stat-label">${label}</span>
      <span class="hs-stat-track"><span class="hs-stat-fill" style="width:${Math.round(s.v * 100)}%"></span></span>
      <span class="hs-stat-text">${esc(s.text)}</span>
    </div>`;

  const swatch = (type, l) => {
    const sch = schemeFor(type, l.id);
    const tail = sch.tail != null ? `#${sch.tail.toString(16).padStart(6, '0')}` : sch.accent;
    const on = livery() === l.id;
    return `<button type="button" class="hs-swatch${on ? ' is-on' : ''}" role="radio" aria-checked="${on}" data-hs-livery="${l.id}" title="${esc(l.name)} — ${esc(l.blurb)}"
      style="--sw-a:${sch.base};--sw-b:${sch.accent};--sw-c:${tail}"><span></span></button>`;
  };

  const paintCard = () => {
    const type = typeOf(ui.id);
    if (!type) return;
    const p = prog();
    const g = groupOf(ui.id);
    const mine = owned(type.id);
    const cost = Prog.costOf(type.id);
    const s = statsFor(type);
    const idx = ui.order.indexOf(type.id);
    host.style.setProperty('--hs-accent', (g && g.def.colour) || '#58c6ff');
    $('[data-hs-cat]').innerHTML = g ? `${catIcon(g.def.icon, 14)} ${esc(g.def.label)}` : '';
    $('[data-hs-class]').textContent = type.class || '';
    $('[data-hs-count]').textContent = `${idx + 1} of ${ui.order.length}`;
    $('[data-hs-name]').textContent = type.name;
    $('[data-hs-line]').textContent = oneLine(type.blurb);
    const chosen = menus.chosenAircraft === type.id;
    $('[data-hs-pills]').innerHTML =
      (mine
        ? `<span class="hs-pill is-yours">${icon('check', 14)} Yours</span>`
        : `<span class="hs-pill is-locked">${LOCK_SVG} Locked</span>`) +
      (chosen && mine ? '<span class="hs-pill is-chosen">Your pick</span>' : '') +
      `<span class="hs-pill">${esc(s.ease.text)}</span>`;
    $('[data-hs-stats]').innerHTML =
      bar('Speed', s.speed) + bar('Agility', s.agility) + bar('Size', s.size) + bar('Range', s.range);

    // The button that matters: fly it, or how to get it.
    const actions = $('[data-hs-actions]');
    const msg = $('[data-hs-msg]');
    if (mine) {
      // From Free Flight, or already yours: off to set the flight up with it.
      // Otherwise: make it the one Free Flight and Multiplayer start in.
      const setup = ui.from === 'free' || chosen;
      actions.innerHTML = `
        <button type="button" class="primary big hs-fly" data-hs-fly>${icon('play', 18)} Fly this</button>
        <button type="button" class="ghost hs-choose" data-hs-choose="${setup ? 'setup' : 'pick'}">${
          ui.from === 'free' ? 'Choose it and set up the flight' : setup ? 'Set up the flight' : 'Make it my aeroplane'}</button>`;
      msg.textContent = '';
    } else if (!cost) {
      actions.innerHTML = '<button type="button" class="primary big hs-buy" disabled>Not in the shop yet</button>';
      msg.textContent = 'Nobody is selling this one yet, so it cannot be flown for now.';
    } else if (p.credits >= cost) {
      actions.innerHTML = `<button type="button" class="primary big hs-buy can-buy" data-hs-buy="${type.id}">${LOCK_SVG} Unlock for ${cost.toLocaleString()} credits</button>`;
      msg.textContent = `You have ${p.credits.toLocaleString()} credits — enough.`;
    } else {
      const short = cost - p.credits;
      actions.innerHTML = `<button type="button" class="primary big hs-buy" disabled>${LOCK_SVG} ${cost.toLocaleString()} credits</button>`;
      msg.textContent = `${short.toLocaleString()} more credits to go. Fly missions to earn them, or put in a code below.`;
    }

    // Paint: house colours plus the airlines, the same list as Settings.
    $('[data-hs-swatches]').innerHTML = LIVERIES.map((l) => swatch(type, l)).join('');
    const cur = LIVERIES.find((l) => l.id === livery()) || LIVERIES[0];
    $('[data-hs-paint-name]').textContent = cur.name;

    // The lock badge on the stage, over the silhouette.
    const lock = $('[data-hs-lock]');
    lock.hidden = mine;
    lock.innerHTML = mine ? '' : `${LOCK_SVG}<span>${cost ? `${cost.toLocaleString()} credits` : 'Not in the shop yet'}</span>`;
    $('[data-hs-q]').hidden = mine;

    // Arrows wrap round, so they never grey out — but say where they go.
    const prev = typeOf(ui.order[(idx - 1 + ui.order.length) % ui.order.length]);
    const next = typeOf(ui.order[(idx + 1) % ui.order.length]);
    $('[data-hs-prev]').title = prev ? `Previous: ${prev.name}` : '';
    $('[data-hs-next]').title = next ? `Next: ${next.name}` : '';
    screen.dataset.hsAircraft = type.id;
    paintFallback();
  };

  /** The plan view from the Free Flight card, if the 3D cannot be had. */
  const paintFallback = () => {
    const box = $('[data-hs-fallback]');
    box.hidden = !ui.failed;
    if (!ui.failed || !ui.id) return;
    box.innerHTML = '';
    try {
      const art = aircraftThumbnail(typeOf(ui.id), livery());
      if (!owned(ui.id)) art.classList.add('is-locked');
      box.appendChild(art);
    } catch (e) {
      /* an empty box, not a broken screen */
    }
  };

  const paint = () => {
    paintTabs();
    paintDots();
    paintCard();
  };

  /* ---------------- the 3D half ---------------- */

  const ensureShowcase = () => {
    if (ui.showcase || ui.loading || ui.failed) return ui.loading;
    ui.loading = import('./hangar-showcase.js')
      .then((m) => {
        ui.showcase = new m.HangarShowcase({
          stage,
          isActive: () => menus.isOpen && menus.current === 'hangar',
          onFlick: (dir) => ui.step(dir),
          onSettled: () => prefetchAround(),
        });
        ui.showcase.onBroken = () => {
          ui.failed = true;
          paintFallback();
        };
        if (ui.id) putOnPodium(0);
        return ui.showcase;
      })
      .catch((err) => {
        console.warn('[hangar] the 3D showcase could not load; showing the plan view.', err);
        ui.failed = true;
        paintFallback();
      })
      .finally(() => {
        ui.loading = null;
      });
    return ui.loading;
  };

  const putOnPodium = (dir) => {
    if (!ui.showcase || !ui.id) return;
    const g = groupOf(ui.id);
    ui.showcase.show(ui.id, { livery: livery(), locked: !owned(ui.id), dir, accent: g ? g.def.colour : null });
  };

  const prefetchAround = () => {
    if (!ui.showcase || !ui.order.length) return;
    const i = ui.order.indexOf(ui.id);
    const n = ui.order.length;
    ui.showcase.prefetch([ui.order[(i + 1) % n], ui.order[(i - 1 + n) % n]], livery());
  };

  /* ---------------- moving about ---------------- */

  /** Put this aeroplane on the podium. dir: +1 from the right, -1 from the left, 0 up through the floor. */
  ui.select = (id, dir = 0) => {
    if (!ui.order.length) ui.rebuildOrder();
    if (!ui.order.includes(id)) id = ui.order[0];
    if (!id) return;
    const changed = id !== ui.id;
    ui.id = id;
    paint();
    if (changed || !ui.showcase) putOnPodium(dir);
  };

  /** Next (+1) or previous (-1), round the whole fleet. */
  ui.step = (dir) => {
    if (!ui.order.length) return;
    const i = ui.order.indexOf(ui.id);
    const n = ui.order.length;
    ui.select(ui.order[(i + dir + n) % n], dir);
  };

  /** A click in the full list below: show it, and scroll back up to it. */
  ui.view = (id) => {
    ui.select(id, 0);
    screen.scrollTo ? screen.scrollTo({ top: 0, behavior: 'smooth' }) : (screen.scrollTop = 0);
  };

  /** Whatever changed credits, ownership or the passcode: repaint. */
  ui.sync = () => {
    const before = ui.order.join();
    ui.rebuildOrder();
    if (!ui.id) ui.id = ui.order[0];
    if (menus.current === 'hangar') {
      paint();
      if (ui.showcase && ui.showcase.current) putOnPodium(0);
    }
    return before !== ui.order.join();
  };

  /** Where Back goes: wherever you came in from. */
  ui.backTo = () => ui.from || 'main';

  /** menus.show() tells us about every screen change. */
  ui.onScreen = (name, prev) => {
    const layer = menus.layer;
    if (layer) layer.classList.toggle('is-showcase', name === 'hangar');
    if (name !== 'hangar') {
      if (prev === 'hangar' && ui.showcase) ui.showcase.release();
      return;
    }
    if (prev && prev !== 'hangar') ui.from = prev;
    ui.rebuildOrder();
    // Open on the aeroplane you have chosen — the helicopter, from Rotors.
    const want = menus.currentGame === 'heli' ? 'harrier' : menus.chosenAircraft || 'skylark';
    ui.id = null;
    ui.select(ui.order.includes(want) ? want : ui.order[0], 0);
    screen.scrollTop = 0;
    ensureShowcase();
  };

  /** Called by main.js's frame loop through menus.drawView(). */
  ui.draw = (renderer, dt) => !!(ui.showcase && ui.showcase.render(renderer, dt));

  /* ---------------- what you can press ---------------- */

  const say = (text) => {
    $('[data-hs-msg]').textContent = text;
  };

  host.addEventListener('click', (e) => {
    const t = e.target;
    if (t.closest('[data-hs-prev]')) return ui.step(-1);
    if (t.closest('[data-hs-next]')) return ui.step(1);
    const tab = t.closest('[data-hs-tab]');
    if (tab) {
      const g = ui.groups.find((x) => x.def.id === tab.dataset.hsTab);
      if (!g) return;
      // Your own aeroplane in that row if you have one, else the first.
      const pick = g.items.find((a) => a.id === menus.chosenAircraft) || g.items.find((a) => owned(a.id)) || g.items[0];
      return ui.select(pick.id, 0);
    }
    const dot = t.closest('[data-hs-dot]');
    if (dot) {
      const a = ui.order.indexOf(ui.id);
      const b = ui.order.indexOf(dot.dataset.hsDot);
      return ui.select(dot.dataset.hsDot, b > a ? 1 : b < a ? -1 : 0);
    }
    const sw = t.closest('[data-hs-livery]');
    if (sw) {
      const id = sw.dataset.hsLivery;
      if (id === livery()) return;
      // The same door as Settings → Flying → Airline livery, so the two agree.
      try {
        menus.hooks.onSetting && menus.hooks.onSetting('livery', id);
      } catch (err) {
        console.warn('[hangar] repainting the game aeroplane failed', err);
      }
      if (menus.settingsRef) menus.settingsRef.livery = id;
      const sel = menus.screens.settings && menus.screens.settings.querySelector('[data-set="livery"]');
      if (sel) sel.value = id;
      paintCard();
      if (ui.showcase) ui.showcase.repaint(livery(), !owned(ui.id));
      paintFallback();
      return;
    }
    const buy = t.closest('[data-hs-buy]');
    if (buy) {
      const id = buy.dataset.hsBuy;
      const r = Prog.buy(prog(), id);
      if (!r.ok) return say(r.why);
      menus.hooks.onClick && menus.hooks.onClick('buy');
      // The hangar's own repaint (the list, the rank), the bar, the picker.
      menus.syncProgression && menus.syncProgression();
      menus.syncFleetLocks && menus.syncFleetLocks();
      const codeMsg = screen.querySelector('[data-code-msg]');
      if (codeMsg) codeMsg.textContent = 'Unlocked — it is in the hangar now.';
      paint();
      if (ui.showcase) ui.showcase.show(id, { livery: livery(), locked: false });
      say(`${typeOf(id).name} is yours. Press Fly this.`);
      return;
    }
    if (t.closest('[data-hs-fly]')) return ui.fly(ui.id);
    const choose = t.closest('[data-hs-choose]');
    if (choose) {
      if (!ui.choose(ui.id)) return;
      if (choose.dataset.hsChoose === 'setup') {
        // The Free Flight screen, with this one picked (its summary says so).
        menus.show('free');
        return;
      }
      paint();
      say(`${typeOf(ui.id).name} is your aeroplane now — Free Flight and Multiplayer will start in it.`);
      return;
    }
    if (t.closest('[data-hs-more]')) {
      const rest = screen.querySelector('[data-hangar-rest]');
      if (rest) rest.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });

  /** Make it the aeroplane Free Flight (and the multiplayer lobby) starts in. */
  ui.choose = (id) => {
    if (!owned(id)) return false;
    if (menus.pickFreeAircraft) menus.pickFreeAircraft(id);
    else menus.chosenAircraft = id;
    return true;
  };

  /**
   * Fly it, now. The world you last set up in Free Flight — time, weather,
   * wind, fuel, where you start — but not its armed failures unless you came
   * from that screen: an engine that quits because of a box ticked for some
   * other flight is not what "Fly this" promised.
   */
  ui.fly = (id) => {
    if (!owned(id) || !menus.hooks.startFree) return false;
    ui.choose(id);
    const base = menus.readFree ? menus.readFree() : {};
    const setup = ui.from === 'free'
      ? { ...base, aircraft: id }
      : { ...base, aircraft: id, failures: {}, events: {}, randomDisasters: false };
    menus.hooks.onClick && menus.hooks.onClick('fly');
    menus.hooks.startFree(setup);
    return true;
  };

  /* Keys: ← and → browse while the hangar is up and nothing is being typed in. */
  window.addEventListener('keydown', (e) => {
    if (menus.current !== 'hangar' || !menus.isOpen) return;
    const el = e.target;
    if (el && /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      ui.step(e.key === 'ArrowLeft' ? -1 : 1);
    }
  });

  ui.rebuildOrder();
  return ui;
}
