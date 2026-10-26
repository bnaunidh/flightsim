/**
 * The hangar's showroom: the screen around the podium.
 *
 * hangar-showcase.js draws the room and the aeroplane; this is everything you
 * press — the shelf chips, the search box, the sort and the filters, the
 * arrows, the card with the name, the one-line description, the four bars,
 * the paint, the star, and the button that either flies it or buys it. Under
 * the podium: your favourites, what you flew last, and every aircraft on the
 * shelf you are looking at as a card you can tap. It is a file of its own so
 * menus.js (worked on by several people at once) only gains the lines that
 * plug it in.
 *
 * Nothing three.js is imported here. The 3D half is loaded the first time the
 * hangar opens, so the menu boots no slower and tests/features/menus.mjs can
 * still import menus.js in Node with a ten-line DOM stub.
 *
 * WHAT IS KEPT
 * The rest of the hangar is still underneath, a scroll away: rank, the list of
 * every aeroplane under the five picker headings (a way to put one on the
 * podium), the military passcode, the "Got a code?" box and Dev mode — same
 * elements, same handlers. Buying and unlocking go through progression.js
 * exactly as before; this screen only decides what is shown and in what order.
 *
 * ORGANISATION (v71 wishlist, "organize hangar A LOT more")
 * The eight shelves, the search, the sorts, the filters, "New" and what is
 * remembered are all in hangar-shelves.js, which is pure and tested in Node.
 */

import { AIRCRAFT, performanceFor } from '../aircraft/types.js';
import { LIVERIES, schemeFor, liveriesFor } from '../aircraft/liveries.js';
import { fontStack, faceFor } from '../render/airline-fonts.js';
import * as Prog from '../game/progression.js';
import { icon } from './icons.js';
import {
  shelve, shelfDef, isNew, visibleFleet, keyStats, SORTS, SORT_IDS, FILTERS, FILTER_IDS, idList, STORE_KEYS,
} from './hangar-shelves.js';

const LOCK_SVG =
  '<svg class="icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" ' +
  'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<rect x="5" y="10.5" width="14" height="10" rx="2.2"/><path d="M8.2 10.5V7.6a3.8 3.8 0 0 1 7.6 0v2.9"/></svg>';

const STAR_SVG = (filled) =>
  `<svg class="icon" viewBox="0 0 24 24" width="20" height="20" fill="${filled ? 'currentColor' : 'none'}" stroke="currentColor" ` +
  'stroke-width="1.8" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M12 3.2l2.7 5.6 6.1.8-4.4 4.3 1.1 6.1L12 17.1 6.5 20l1.1-6.1L3.2 9.6l6.1-.8Z"/></svg>';

const SEARCH_SVG =
  '<svg class="icon" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" ' +
  'stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="10.6" cy="10.6" r="6.2"/><path d="m15.2 15.2 5 5"/></svg>';

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

/** performanceFor, fenced: a type the flight model cannot size yet still gets a card. */
function perfOf(id) {
  try {
    return performanceFor(id) || {};
  } catch (e) {
    return {};
  }
}

/** The thumbnail on a card: this wide, in CSS pixels. Drawn at up to 2x. */
const ART_W = 176;
const ART_H = 110;
/** Show the dots under the podium only while there are few enough to tell apart. */
const MAX_DOTS = 14;

/**
 * Plug the showroom into the hangar screen.
 *
 * @param {object} menus   the live Menus instance
 * @param {HTMLElement} screen  the hangar <section>
 * @param {object} kit     menus.js's own helpers, handed in rather than
 *                         imported back so the two files cannot form a cycle
 */
export function installHangarShowcase(menus, screen, kit) {
  const { catIcon, aircraftCategory, aircraftThumbnail, catStyle } = kit;
  const host = screen.querySelector('[data-showcase-host]');
  if (!host) return null;

  host.innerHTML = `
    <div class="hs" data-showcase>
      <div class="hs-tabs" role="tablist" aria-label="Shelves" data-hs-tabs></div>
      <div class="hs-tools" data-hs-tools>
        <label class="hs-search" data-hs-search-wrap>
          ${SEARCH_SVG}
          <input type="search" data-hs-search placeholder="Find an aircraft" aria-label="Find an aircraft"
            autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="search">
        </label>
        <div class="hs-filters" role="group" aria-label="Show" data-hs-filters></div>
        <label class="hs-sort">
          <span>Sort</span>
          <select data-hs-sort aria-label="Sort the aircraft">${SORTS.map((s) => `<option value="${s.id}">${esc(s.label)}</option>`).join('')}</select>
        </label>
      </div>
      <div class="hs-main">
        <div class="hs-stage" data-hs-stage>
          <div class="hs-fallback" data-hs-fallback hidden></div>
          <div class="hs-lock" data-hs-lock hidden></div>
          <div class="hs-q" data-hs-q aria-hidden="true" hidden>?</div>
          <button type="button" class="hs-arrow is-prev" data-hs-prev aria-label="Previous aircraft">${icon('chevronLeft', 30)}<span class="hs-arrow-tip" aria-hidden="true"></span></button>
          <button type="button" class="hs-arrow is-next" data-hs-next aria-label="Next aircraft">${icon('chevronRight', 30)}<span class="hs-arrow-tip" aria-hidden="true"></span></button>
          <div class="hs-under">
            <div class="hs-dots" data-hs-dots></div>
            <p class="hs-hint" data-hs-hint>Drag to spin it · swipe or press ← → for the next one</p>
          </div>
        </div>
        <aside class="hs-card" data-hs-card aria-live="polite">
          <div class="hs-kicker">
            <span class="hs-cat" data-hs-cat></span><span class="hs-class" data-hs-class></span><span class="hs-count" data-hs-count></span>
            <button type="button" class="hs-star" data-hs-fav aria-pressed="false" aria-label="Favourite — keep it in the row above the fleet">${STAR_SVG(false)}</button>
          </div>
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
      <section class="hs-strip" data-hs-strip="favourites" hidden>
        <h4 class="hs-strip-title">${STAR_SVG(true)} Favourites</h4>
        <div class="hs-strip-row" data-hs-strip-row="favourites"></div>
      </section>
      <section class="hs-strip" data-hs-strip="recent" hidden>
        <h4 class="hs-strip-title">${icon('restart', 16)} Recently flown</h4>
        <div class="hs-strip-row" data-hs-strip-row="recent"></div>
      </section>
      <section class="hs-fleet" data-hs-fleet>
        <header class="hs-fleet-head">
          <h4 class="hs-fleet-title" data-hs-fleet-title>All aircraft</h4>
          <span class="hs-fleet-blurb" data-hs-fleet-blurb></span>
          <span class="hs-fleet-count" data-hs-fleet-count></span>
        </header>
        <div class="hs-grid" data-hs-grid></div>
        <p class="hs-empty" data-hs-empty hidden>
          <span data-hs-empty-text></span>
          <button type="button" class="ghost" data-hs-clear>Show them all</button>
        </p>
      </section>
      <button type="button" class="hs-more" data-hs-more>Rank, codes and the full list ${icon('chevronRight', 16)}</button>
    </div>`;

  const $ = (sel) => host.querySelector(sel);
  const stage = $('[data-hs-stage]');
  const storage = (() => {
    try {
      return typeof localStorage !== 'undefined' ? localStorage : null;
    } catch (e) {
      return null;
    }
  })();
  const favs = idList(STORE_KEYS.favourites, storage, 40);
  const recent = idList(STORE_KEYS.recent, storage, 8);
  const sortStore = idList(STORE_KEYS.sort, storage, 1);

  const ui = {
    id: null,
    order: [],
    shown: [],
    shelves: [],
    groups: [],
    shelf: 'all',
    query: '',
    filter: 'all',
    sort: SORT_IDS.includes(sortStore.get()[0]) ? sortStore.get()[0] : 'shelf',
    from: 'main',
    showcase: null,
    loading: null,
    failed: false,
    favs,
    recent,
  };
  menus.showcaseUi = ui;

  const prog = () => menus.prog || Prog.load();
  const livery = () => (menus.settingsRef && menus.settingsRef.livery) || 'house';
  const typeOf = (id) => AIRCRAFT.find((a) => a.id === id);
  const owned = (id) => Prog.isUnlocked(prog(), id);
  const rosterIndex = (id) => AIRCRAFT.findIndex((a) => a.id === id);
  const ctx = () => ({ catOf: aircraftCategory, owned, costOf: Prog.costOf, credits: prog().credits, perfFor: perfOf, rosterIndex });

  /** What can be shown: everything but what the passcode still hides — then the shelf, the search, the filter, the sort. */
  ui.rebuildOrder = () => {
    const p = prog();
    ui.shown = AIRCRAFT.filter((a) => !Prog.needsPasscode(p, a));
    ui.shelves = shelve(ui.shown, aircraftCategory);
    ui.groups = ui.shelves;
    if (ui.shelf !== 'all' && !ui.shelves.some((g) => g.def.id === ui.shelf)) ui.shelf = 'all';
    ui.order = visibleFleet(ui.shown, { shelf: ui.shelf, query: ui.query, filter: ui.filter, sort: ui.sort }, ctx()).map((a) => a.id);
    if (ui.id && !ui.shown.some((a) => a.id === ui.id)) ui.id = null;
  };

  const groupOf = (id) => ui.shelves.find((g) => g.items.some((a) => a.id === id));
  const shelfIdOf = (id) => {
    const g = groupOf(id);
    return g ? g.def.id : 'special';
  };

  /* ---------------- the pictures on the cards ---------------- */

  /*
   * One small canvas per aircraft and paint, drawn from the Free Flight card's
   * plan view and shrunk: forty cards of the full 600x380 picture would be
   * thirty-odd megabytes on a Chromebook. Copies for the strips are drawn from
   * the cached one. The cache empties when the paint changes or the hangar
   * closes.
   */
  const artCache = new Map();
  let artLivery = null;
  const dpr = () => Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
  const artFor = (type) => {
    if (artLivery !== livery()) {
      artCache.clear();
      artLivery = livery();
    }
    let c = artCache.get(type.id);
    if (c) return c;
    try {
      const big = aircraftThumbnail(type, livery());
      const k = dpr();
      c = document.createElement('canvas');
      c.width = Math.round(ART_W * k);
      c.height = Math.round(ART_H * k);
      c.className = 'hs-art';
      const g = c.getContext('2d');
      // Fit the whole plan view in, centred: the picture is 300x190, the slot is wider than that.
      const s = Math.min(c.width / big.width, c.height / big.height);
      const w = big.width * s;
      const h = big.height * s;
      g.drawImage(big, (c.width - w) / 2, (c.height - h) / 2, w, h);
      artCache.set(type.id, c);
    } catch (e) {
      c = null;
    }
    return c;
  };
  const artCopy = (type) => {
    const src = artFor(type);
    if (!src) return null;
    const c = document.createElement('canvas');
    c.width = src.width;
    c.height = src.height;
    c.className = 'hs-art';
    c.getContext('2d').drawImage(src, 0, 0);
    return c;
  };
  let artToken = 0;
  /**
   * Fill the empty art slots a few at a time, so a Chromebook does not stall
   * drawing forty pictures at once. On a timer rather than requestAnimationFrame:
   * the game's own loop owns rAF, and a hidden tab (or the test harness, which
   * freezes rAF) would otherwise leave the cards blank.
   */
  const fillArt = (slots) => {
    const token = ++artToken;
    const queue = [...slots];
    const step = () => {
      if (token !== artToken) return;
      for (let i = 0; i < 6 && queue.length; i++) {
        const slot = queue.shift();
        const type = typeOf(slot.dataset.hsArt);
        if (!type) continue;
        const c = slot.dataset.hsArtCopy ? artCopy(type) : artFor(type);
        if (c) {
          slot.innerHTML = '';
          slot.appendChild(c);
        }
      }
      if (queue.length) setTimeout(step, 16);
    };
    step();
  };

  /* ---------------- painting the screen ---------------- */

  let tabsScrolledFor = null;
  const paintTabs = () => {
    const all = ui.shelf === 'all';
    const allBtn = `<button type="button" class="hs-tab is-all${all ? ' is-on' : ''}" role="tab" aria-selected="${all}" data-hs-tab="all">
        <span class="hs-tab-label">All</span><b>${ui.shown.length}</b></button>`;
    /*
     * Owner (Oct 25): "if u show it should show which category is in". The
     * shelf the aircraft on the podium belongs to is marked whatever is
     * selected — in All, in a search, from a favourite — with a ring in its
     * colour and a bar under it ("is-here"); when that shelf is the one
     * selected it is simply the lit chip.
     */
    const hereG = ui.id ? groupOf(ui.id) : null;
    const here = hereG ? hereG.def.id : null;
    $('[data-hs-tabs]').innerHTML =
      allBtn +
      ui.shelves
        .map((g) => {
          const mine = g.items.filter((a) => owned(a.id)).length;
          const on = ui.shelf === g.def.id;
          const isHere = here === g.def.id;
          const fresh = g.items.some((a) => isNew(a.id));
          // No title tooltip: a native one hangs under the chip over the search
          // box. The blurb is the fleet heading's subtitle when the shelf is open.
          return `<button type="button" class="hs-tab${on ? ' is-on' : ''}${isHere ? ' is-here' : ''}" role="tab" aria-selected="${on}"${isHere ? ' aria-current="true"' : ''} data-hs-tab="${esc(g.def.id)}" style="${catStyle(g.def)}" aria-label="${esc(g.def.label)}: ${mine} of ${g.items.length} yours${isHere ? ' — the one on show is on this shelf' : ''}">
            <span class="hs-tab-icon">${catIcon(g.def.icon, 18)}</span><span class="hs-tab-label">${esc(g.def.label)}</span><b>${mine}/${g.items.length}</b>${fresh ? '<i class="hs-tab-new" aria-label="Has new aircraft"></i>' : ''}
          </button>`;
        })
        .join('');
    // Keep the lit chip (or, in All, the marked one) in view on a phone, where
    // the row scrolls sideways — by hand, because scrollIntoView would scroll
    // the whole screen too. Only when it changes: reading scrollWidth forces a
    // layout of the whole showroom, and paint() runs on every key typed in the
    // search box.
    const key = `${ui.shelf}|${here}`;
    if (tabsScrolledFor === key) return;
    tabsScrolledFor = key;
    const row = $('[data-hs-tabs]');
    const lit = row.querySelector('.is-on:not(.is-all)') || row.querySelector('.is-here');
    if (lit && row.scrollWidth > row.clientWidth) {
      row.scrollLeft = Math.max(0, lit.offsetLeft - (row.clientWidth - lit.offsetWidth) / 2);
    }
  };

  const paintTools = () => {
    $('[data-hs-filters]').innerHTML = FILTERS.map(
      (f) => `<button type="button" class="hs-filter${ui.filter === f.id ? ' is-on' : ''}" data-hs-filter="${f.id}" aria-pressed="${ui.filter === f.id}">${esc(f.label)}</button>`
    ).join('');
    const sel = $('[data-hs-sort]');
    if (sel.value !== ui.sort) sel.value = ui.sort;
    const box = $('[data-hs-search]');
    if (box.value !== ui.query) box.value = ui.query;
  };

  const paintDots = () => {
    const dots = $('[data-hs-dots]');
    if (ui.order.length > MAX_DOTS) {
      dots.innerHTML = '';
      return;
    }
    dots.innerHTML = ui.order
      .map((id) => {
        const a = typeOf(id);
        return a ? `<button type="button" class="hs-dot${a.id === ui.id ? ' is-on' : ''}${owned(a.id) ? '' : ' is-locked'}" data-hs-dot="${a.id}" aria-label="${esc(a.name)}"></button>` : '';
      })
      .join('');
  };

  const bar = (label, s) => `
    <div class="hs-stat">
      <span class="hs-stat-label">${label}</span>
      <span class="hs-stat-track"><span class="hs-stat-fill" style="width:${Math.round(s.v * 100)}%"></span></span>
      <span class="hs-stat-text">${esc(s.text)}</span>
    </div>`;

  const swatch = (type, l, fixed = false) => {
    const sch = schemeFor(type, l.id);
    const tail = sch.tail != null ? `#${sch.tail.toString(16).padStart(6, '0')}` : sch.upper || sch.accent;
    const on = fixed || livery() === l.id;
    // A fixed scheme's one swatch is shown chosen and carries no livery id, so a tap changes nothing.
    const what = fixed ? 'data-hs-fixed aria-disabled="true"' : `data-hs-livery="${l.id}"`;
    return `<button type="button" class="hs-swatch${on ? ' is-on' : ''}" role="radio" aria-checked="${on}" ${what} aria-label="${esc(l.name)} — ${esc(l.blurb)}" data-hs-swname="${esc(l.name)}"
      style="--sw-a:${sch.base};--sw-b:${sch.accent};--sw-c:${tail}"><span></span></button>`;
  };

  const paintStar = () => {
    const btn = $('[data-hs-fav]');
    const on = !!ui.id && favs.has(ui.id);
    btn.classList.toggle('is-on', on);
    btn.setAttribute('aria-pressed', String(on));
    btn.innerHTML = STAR_SVG(on);
    btn.setAttribute('aria-label', on ? 'A favourite — press to take it out of the row' : 'Favourite — keep it in the row above the fleet');
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
    $('[data-hs-count]').textContent = idx >= 0 ? `${idx + 1} of ${ui.order.length}` : '';
    $('[data-hs-name]').textContent = type.name;
    $('[data-hs-line]').textContent = oneLine(type.blurb);
    const chosen = menus.chosenAircraft === type.id;
    $('[data-hs-pills]').innerHTML =
      (mine
        ? `<span class="hs-pill is-yours">${icon('check', 14)} Yours</span>`
        : `<span class="hs-pill is-locked">${LOCK_SVG} Locked</span>`) +
      (isNew(type.id) ? '<span class="hs-pill is-new">New</span>' : '') +
      (chosen && mine ? '<span class="hs-pill is-chosen">Your pick</span>' : '') +
      `<span class="hs-pill">${esc(s.ease.text)}</span>`;
    $('[data-hs-stats]').innerHTML =
      bar('Speed', s.speed) + bar('Agility', s.agility) + bar('Size', s.size) + bar('Range', s.range);
    paintStar();

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
    // A type with a scheme of its own (Marine One) shows that one paint,
    // chosen and not choosable: the game's livery setting never touches it.
    const fixed = !!type.fixedLivery;
    const paints = liveriesFor(type);
    $('[data-hs-swatches]').innerHTML = paints.map((l) => swatch(type, l, fixed)).join('');
    const cur = fixed ? paints[0] : LIVERIES.find((l) => l.id === livery()) || LIVERIES[0];
    const pn = $('[data-hs-paint-name]');
    delete pn.dataset.chosen;
    pn.classList.remove('is-preview');
    pn.textContent = cur.name;
    letterPaintName(pn, cur.name);

    // The lock badge on the stage, over the silhouette.
    const lock = $('[data-hs-lock]');
    lock.hidden = mine;
    lock.innerHTML = mine ? '' : `${LOCK_SVG}<span>${cost ? `${cost.toLocaleString()} credits` : 'Not in the shop yet'}</span>`;
    $('[data-hs-q]').hidden = mine;

    // Arrows wrap round, so they never grey out — but say where they go.
    const n = ui.order.length;
    const prev = n ? typeOf(ui.order[(idx - 1 + n) % n]) : null;
    const next = n ? typeOf(ui.order[(idx + 1) % n]) : null;
    /*
     * Where the arrows go, said on the stage beside each arrow on hover or
     * focus (main.css .hs-arrow-tip) — not as a title tooltip, which the
     * browser hangs under the pointer, over "Make it my aeroplane".
     */
    const tip = (btn, word, t) => {
      btn.setAttribute('aria-label', t ? `${word}: ${t.name}` : `${word} aircraft`);
      const s2 = btn.querySelector('.hs-arrow-tip');
      if (s2) s2.textContent = t ? t.name : '';
    };
    tip($('[data-hs-prev]'), 'Previous', prev);
    tip($('[data-hs-next]'), 'Next', next);
    $('[data-hs-prev]').hidden = n < 2;
    $('[data-hs-next]').hidden = n < 2;
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

  /** One card in the fleet grid. */
  const fleetCard = (type) => {
    const p = prog();
    const mine = owned(type.id);
    const cost = Prog.costOf(type.id);
    const afford = !mine && !!cost && p.credits >= cost;
    const g = groupOf(type.id);
    const ks = keyStats(type, perfOf(type.id));
    const cls = ['hs-fleet-card', type.id === ui.id ? 'is-on' : '', mine ? 'is-owned' : 'is-locked', afford ? 'can-buy' : '', favs.has(type.id) ? 'is-fav' : ''].filter(Boolean).join(' ');
    const foot = mine
      ? `<span class="hs-fc-price is-yours">${icon('check', 13)} Yours</span>`
      : cost
        ? `<span class="hs-fc-price${afford ? ' can-buy' : ''}">${LOCK_SVG} ${cost.toLocaleString()} cr</span>`
        : `<span class="hs-fc-price is-soon">${LOCK_SVG} Not for sale yet</span>`;
    return `<button type="button" class="${cls}" data-hs-pick="${esc(type.id)}" style="${g ? catStyle(g.def) : ''}" aria-pressed="${type.id === ui.id}">
      <span class="hs-fc-art" data-hs-art="${esc(type.id)}"></span>
      <span class="hs-fc-badges">${isNew(type.id) ? '<span class="hs-badge is-new">New</span>' : ''}${favs.has(type.id) ? `<span class="hs-badge is-fav">${STAR_SVG(true)}</span>` : ''}</span>
      <span class="hs-fc-name">${esc(type.name)}</span>
      <span class="hs-fc-sub">${g ? `<span class="hs-fc-shelf">${catIcon(g.def.icon, 12)} ${esc(g.def.label)}</span>` : ''}<span>${esc(type.class || '')}</span></span>
      <span class="hs-fc-stats">
        <span><b>${esc(ks.speed.value)}</b><i>${ks.speed.label}</i></span>
        <span><b>${esc(ks.size.value)}</b><i>${ks.size.label}</i></span>
        <span><b>${esc(ks.fuel.value)}</b><i>${ks.fuel.label}</i></span>
      </span>
      <span class="hs-fc-foot">${foot}</span>
    </button>`;
  };

  /** One small tile in a strip (favourites, recently flown). */
  const stripTile = (type) => {
    const mine = owned(type.id);
    const g = groupOf(type.id);
    return `<button type="button" class="hs-tile${type.id === ui.id ? ' is-on' : ''}${mine ? '' : ' is-locked'}" data-hs-pick="${esc(type.id)}" style="${g ? catStyle(g.def) : ''}" aria-label="${esc(type.name)}">
      <span class="hs-fc-art" data-hs-art="${esc(type.id)}" data-hs-art-copy="1"></span>
      <span class="hs-tile-name">${esc(type.name)}</span>
    </button>`;
  };

  const paintStrips = () => {
    const shownIds = new Set(ui.shown.map((a) => a.id));
    const paintOne = (name, ids) => {
      const sec = $(`[data-hs-strip="${name}"]`);
      const row = $(`[data-hs-strip-row="${name}"]`);
      const list = ids.filter((id) => shownIds.has(id)).map(typeOf).filter(Boolean);
      sec.hidden = !list.length;
      row.innerHTML = list.map(stripTile).join('');
      return row.querySelectorAll('[data-hs-art]');
    };
    const slots = [...paintOne('favourites', favs.get()), ...paintOne('recent', recent.get())];
    return slots;
  };

  const paintGrid = () => {
    const grid = $('[data-hs-grid]');
    const list = ui.order.map(typeOf).filter(Boolean);
    const def = ui.shelf === 'all' ? null : shelfDef(ui.shelf);
    $('[data-hs-fleet-title]').textContent = def ? def.label : 'All aircraft';
    $('[data-hs-fleet-blurb]').textContent = def ? def.blurb : '';
    const filterWord = ui.filter === 'all' ? '' : ` · ${FILTERS.find((f) => f.id === ui.filter).label.toLowerCase()}`;
    $('[data-hs-fleet-count]').textContent = `${list.length} of ${ui.shown.length}${filterWord}`;
    grid.innerHTML = list.map(fleetCard).join('');
    const empty = $('[data-hs-empty]');
    empty.hidden = list.length > 0;
    if (!list.length) {
      const where = def ? ` on the ${def.label} shelf` : '';
      const what = ui.filter === 'owned' ? ' that is yours' : ui.filter === 'locked' ? ' still locked' : ui.filter === 'afford' ? ' you can afford yet' : '';
      $('[data-hs-empty-text]').textContent = ui.query.trim()
        ? `Nothing called “${ui.query.trim()}”${where}${what}.`
        : `Nothing${where}${what}.`;
    }
    return grid.querySelectorAll('[data-hs-art]');
  };

  const paint = () => {
    paintTabs();
    paintTools();
    paintDots();
    paintCard();
    fillArt([...paintStrips(), ...paintGrid()]);
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
    if (!ui.order.length && !ui.shown.length) ui.rebuildOrder();
    // Anything the passcode allows can go on the podium, even from outside the
    // current shelf or search (the full list below, a favourite, a recent).
    if (!ui.shown.some((a) => a.id === id)) id = ui.order[0] || (ui.shown[0] && ui.shown[0].id);
    if (!id) return;
    const changed = id !== ui.id;
    ui.id = id;
    paint();
    if (changed || !ui.showcase) putOnPodium(dir);
  };

  /** Next (+1) or previous (-1), round what is on show. */
  ui.step = (dir) => {
    if (!ui.order.length) return;
    const i = ui.order.indexOf(ui.id);
    const n = ui.order.length;
    ui.select(ui.order[i < 0 ? 0 : (i + dir + n) % n], dir);
  };

  /** A click in the full list below: show it, and scroll back up to it. */
  ui.view = (id) => {
    ui.select(id, 0);
    screen.scrollTo ? screen.scrollTo({ top: 0, behavior: 'smooth' }) : (screen.scrollTop = 0);
  };

  /** After the shelf, search, filter or sort changed: keep the podium on something that is shown. */
  const refilter = () => {
    ui.rebuildOrder();
    if (ui.order.length && !ui.order.includes(ui.id)) {
      // Prefer your own aeroplane on this shelf, else the first match.
      const pick = ui.order.find((id) => id === menus.chosenAircraft) || ui.order.find((id) => owned(id)) || ui.order[0];
      ui.select(pick, 0);
      return;
    }
    paint();
  };

  ui.setShelf = (id) => {
    ui.shelf = id === 'all' || ui.shelves.some((g) => g.def.id === id) ? id : 'all';
    refilter();
  };
  ui.setQuery = (q) => {
    ui.query = String(q || '');
    refilter();
  };
  ui.setFilter = (f) => {
    ui.filter = FILTER_IDS.includes(f) ? f : 'all';
    refilter();
  };
  ui.setSort = (s) => {
    ui.sort = SORT_IDS.includes(s) ? s : 'shelf';
    sortStore.set([ui.sort]);
    refilter();
  };
  ui.clearFilters = () => {
    ui.shelf = 'all';
    ui.query = '';
    ui.filter = 'all';
    refilter();
  };

  /** Star or unstar one. Answers whether it is a favourite now. */
  ui.toggleFavourite = (id = ui.id) => {
    if (!id || !typeOf(id)) return false;
    const on = favs.toggle(id);
    paint();
    return on;
  };

  /**
   * A flight started in this aircraft: main.js startMode() says so, whatever
   * screen started it — Free Flight, a mission, the story, multiplayer.
   */
  ui.noteFlown = (id) => {
    if (!id || !typeOf(id)) return;
    recent.bump(id);
    if (menus.current === 'hangar') fillArt(paintStrips());
  };
  menus.noteFlown = ui.noteFlown;

  /** Whatever changed credits, ownership or the passcode: repaint. */
  ui.sync = () => {
    const before = ui.order.join();
    ui.rebuildOrder();
    if (!ui.id) ui.id = ui.order[0] || (ui.shown[0] && ui.shown[0].id) || null;
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
      if (prev === 'hangar') {
        if (ui.showcase) ui.showcase.release();
        artCache.clear();
        artToken++;
      }
      return;
    }
    if (prev && prev !== 'hangar') ui.from = prev;
    // Every visit starts on the whole fleet; the sort you chose is kept.
    tabsScrolledFor = null;
    ui.shelf = 'all';
    ui.query = '';
    ui.filter = 'all';
    ui.rebuildOrder();
    // Open on the aeroplane you have chosen — the helicopter, from Rotors.
    // (A chosen helicopter of any type stays chosen; the Skyhook is the Rotors page's default.)
    const chosenType = AIRCRAFT.find((a) => a.id === menus.chosenAircraft);
    const want = menus.currentGame === 'heli' && !(chosenType && chosenType.shape && chosenType.shape.power && chosenType.shape.power.rotor) ? 'harrier' : menus.chosenAircraft || 'skylark';
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

  /** The stage back into view when a card further down was tapped (a phone: the podium is above the fold). */
  const showStage = () => {
    const r = stage.getBoundingClientRect();
    const H = (typeof window !== 'undefined' && window.innerHeight) || 0;
    if (H && (r.top < 0 || r.bottom > H)) {
      try {
        stage.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch (e) {
        /* an old browser: stay where we are */
      }
    }
  };

  /*
   * Typing: the grid and the chips follow every key, the podium only once the
   * typing pauses. Swapping the 3D model on each letter ("b", "bo", "boe"…)
   * cost ~190 ms a key at a 4x-throttled Chromebook and flickered the podium.
   */
  let queryTimer = 0;
  /*
   * A paint's name, on hover or focus, in the line under the swatches — where
   * the title tooltip used to hang over the card's own buttons.
   */
  const paintName = (on) => {
    const line = $('[data-hs-paint-name]');
    if (!line) return;
    if (on && on.dataset.hsSwname) {
      if (line.dataset.chosen == null) line.dataset.chosen = line.textContent;
      line.textContent = on.dataset.hsSwname;
      letterPaintName(line, line.textContent);
      line.classList.add('is-preview');
    } else if (line.dataset.chosen != null) {
      line.textContent = line.dataset.chosen;
      letterPaintName(line, line.textContent);
      delete line.dataset.chosen;
      line.classList.remove('is-preview');
    }
  };
  for (const ev of ['pointerover', 'focusin']) host.addEventListener(ev, (e) => paintName(e.target.closest && e.target.closest('[data-hs-swname]')));
  for (const ev of ['pointerout', 'focusout']) {
    host.addEventListener(ev, (e) => {
      const to = e.relatedTarget && e.relatedTarget.closest ? e.relatedTarget.closest('[data-hs-swname]') : null;
      paintName(to);
    });
  }

  host.addEventListener('input', (e) => {
    if (!e.target.closest('[data-hs-search]')) return;
    ui.query = String(e.target.value || '');
    ui.rebuildOrder();
    paint();
    clearTimeout(queryTimer);
    const q = ui.query;
    queryTimer = setTimeout(() => {
      if (menus.current === 'hangar' && ui.query === q && ui.order.length && !ui.order.includes(ui.id)) refilter();
    }, 300);
  });
  host.addEventListener('change', (e) => {
    if (e.target.closest('[data-hs-sort]')) ui.setSort(e.target.value);
  });
  host.addEventListener('keydown', (e) => {
    // Enter in the search box: the first match goes on the podium.
    if (e.key === 'Enter' && e.target.closest('[data-hs-search]') && ui.order.length) {
      e.preventDefault();
      ui.select(ui.order[0], 0);
    }
  });

  host.addEventListener('click', (e) => {
    const t = e.target;
    if (t.closest('[data-hs-prev]')) return ui.step(-1);
    if (t.closest('[data-hs-next]')) return ui.step(1);
    const tab = t.closest('[data-hs-tab]');
    if (tab) return ui.setShelf(tab.dataset.hsTab);
    const filt = t.closest('[data-hs-filter]');
    if (filt) return ui.setFilter(filt.dataset.hsFilter);
    if (t.closest('[data-hs-clear]')) return ui.clearFilters();
    if (t.closest('[data-hs-fav]')) return void ui.toggleFavourite(ui.id);
    const pick = t.closest('[data-hs-pick]');
    if (pick) {
      const a = ui.order.indexOf(ui.id);
      const b = ui.order.indexOf(pick.dataset.hsPick);
      ui.select(pick.dataset.hsPick, b > a ? 1 : b < a ? -1 : 0);
      showStage();
      return;
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
      paint();
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
    recent.bump(id);
    menus.hooks.startFree(setup);
    return true;
  };

  /* Keys: ← and → browse while the hangar is up and nothing is being typed in; / jumps to the search box. */
  window.addEventListener('keydown', (e) => {
    if (menus.current !== 'hangar' || !menus.isOpen) return;
    const el = e.target;
    if (el && /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      ui.step(e.key === 'ArrowLeft' ? -1 : 1);
    } else if (e.key === '/') {
      e.preventDefault();
      const box = $('[data-hs-search]');
      if (box) box.focus({ preventScroll: true });
    }
  });

  ui.rebuildOrder();
  return ui;
}

/**
 * The paint's name under the swatches, in that airline's own lettering
 * (aircraft/liveries.js style.titleFont, render/airline-fonts.js): the
 * hangar says "Desert Pearl Airlines" in the serif its fuselage wears.
 * The house colours, and a scheme with no face, keep the interface's font.
 */
function letterPaintName(el, name) {
  if (!el || !el.style) return;
  const l = LIVERIES.find((x) => x.name === name);
  const f = l && l.style && l.style.titleFont;
  const face = f ? faceFor(f) : null;
  el.style.fontFamily = face ? fontStack(f) : '';
  el.style.fontStyle = face && face.style === 'italic' ? 'italic' : '';
  el.style.fontWeight = face ? String(face.weight) : '';
  el.dataset.font = face ? face.family : '';
}
