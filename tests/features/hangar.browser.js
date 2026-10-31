/**
 * Browser checks for the organised hangar (v71 wishlist: "organize hangar A
 * LOT more"). The podium and the buying are covered by
 * menus.browser.js; this is the shelves, the tools and the fleet around them.
 *
 *   1. The chip row: an All chip plus one per shelf with something on it,
 *      their counts adding up to the whole roster, every chip a 44px
 *      target, the row scrolling sideways rather than wrapping.
 *   2. No gate: on a fresh profile every military type is on a chip, a card
 *      or strip.
 *   3. A shelf chip narrows the podium's order and the grid to that shelf.
 *   4. Search, filters and sort narrow and reorder the same list, and the
 *      sort is remembered.
 *   5. The star puts an aircraft in the Favourites row and remembers it; a
 *      flight puts one in Recently flown (main.js startMode → menus.noteFlown).
 *   6. Tapping a card puts that aircraft on the podium.
 *   7. "New" badges on the aircraft added since v70, and nowhere else.
 *   8. Phone layout rules are in the stylesheet (two columns, wrapping tools).
 *
 * The profile is put back exactly as it was found.
 */

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

export async function check(sim, r, say) {
  say && say('hangar: shelves and tools');
  const menus = sim && sim.menus;
  const ui = menus && menus.showcaseUi;
  if (!ui) {
    r.ok('hangar: the showroom is installed', false, 'menus.showcaseUi missing');
    return;
  }
  const [{ AIRCRAFT }, Prog, Menus, Shelves] = await Promise.all([
    import('../../src/aircraft/types.js'),
    import('../../src/game/progression.js'),
    import('../../src/ui/menus.js'),
    import('../../src/ui/hangar-shelves.js'),
  ]);
  const { aircraftCategory } = Menus;
  const { shelfOf, isNew, NEW_SINCE_V70, STORE_KEYS } = Shelves;
  const screen = menus.screens.hangar;
  const $ = (sel) => screen.querySelector(sel);
  const $$ = (sel) => [...screen.querySelectorAll(sel)];
  const typeOf = (id) => AIRCRAFT.find((a) => a.id === id);
  const p = menus.prog || Prog.load();
  const keep = { credits: p.credits, unlocked: [...p.unlocked] };
  const store = (k) => {
    try {
      return localStorage.getItem(k);
    } catch (e) {
      return null;
    }
  };
  const keepStore = { favs: store(STORE_KEYS.favourites), recent: store(STORE_KEYS.recent), sort: store(STORE_KEYS.sort) };
  const restoreStore = () => {
    try {
      for (const [k, v] of [[STORE_KEYS.favourites, keepStore.favs], [STORE_KEYS.recent, keepStore.recent], [STORE_KEYS.sort, keepStore.sort]]) {
        if (v == null) localStorage.removeItem(k);
        else localStorage.setItem(k, v);
      }
    } catch (e) {
      /* no storage: nothing to put back */
    }
  };
  const pump = (n) => {
    for (let i = 0; i < n; i++) menus.drawView(sim.renderer, 1 / 30);
  };
  const tall = (el) => el.getBoundingClientRect().height >= 44;
  const fire = (el, type) => el.dispatchEvent(new Event(type, { bubbles: true }));
  const sc = () => ui.showcase;

  const wasGame = menus.currentGame;
  try {
    // A known starting point: a modest purse, the free three.
    p.credits = 700;
    p.unlocked = ['skylark', 'courier', 'harrier'];
    try {
      localStorage.removeItem(STORE_KEYS.favourites);
      localStorage.removeItem(STORE_KEYS.recent);
      localStorage.removeItem(STORE_KEYS.sort);
    } catch (e) {
      /* fine */
    }
    menus.syncProgression && menus.syncProgression(p);
    menus.setGame('flight');
    menus.show('hangar');
    if (ui.loading) await ui.loading.catch(() => {});
    for (let i = 0; i < 100 && !ui.showcase && !ui.failed; i++) await sleep(50);
    pump(4);

    /* ---- 1. The chip row ------------------------------------------- */
    {
      const chips = $$('[data-hs-tab]');
      const all = chips.find((c) => c.dataset.hsTab === 'all');
      const shelves = chips.filter((c) => c.dataset.hsTab !== 'all');
      const shownIds = new Set(ui.shown.map((a) => a.id));
      const wantShelves = [...new Set(ui.shown.map((a) => shelfOf(a, aircraftCategory)))];
      const totals = shelves.map((c) => Number((c.querySelector('b').textContent.split('/')[1] || '0')));
      const sum = totals.reduce((a, b) => a + b, 0);
      const row = $('[data-hs-tabs]');
      const ov = getComputedStyle(row).overflowX;
      r.ok('hangar: an All chip plus one chip per shelf with something on it, counts adding up to the fleet',
        !!all && all.classList.contains('is-on') && shelves.length === wantShelves.length
          && shelves.every((c) => wantShelves.includes(c.dataset.hsTab)) && sum === shownIds.size
          && Number(all.querySelector('b').textContent) === shownIds.size,
        `${shelves.map((c) => c.dataset.hsTab).join(' ')} → ${sum} of ${shownIds.size}`);
      r.ok('hangar: every chip is a 44px target and the row scrolls sideways instead of wrapping',
        chips.every(tall) && (ov === 'auto' || ov === 'scroll') && getComputedStyle(row).flexWrap !== 'wrap',
        `heights ${chips.map((c) => Math.round(c.getBoundingClientRect().height)).join(',')} overflow-x ${ov}`);
      // The search box's target is the whole labelled box, not the bare input inside it.
      const tools = ['[data-hs-search-wrap]', '[data-hs-filter]', '[data-hs-sort]', '[data-hs-fav]', '[data-hs-pick]'].map((s) => $$(s)).flat();
      const small = tools.filter((el) => !tall(el));
      r.ok('hangar: the search box, filters, sort, star and every card are 44px targets', small.length === 0,
        small.slice(0, 3).map((el) => `${el.className || el.tagName} ${Math.round(el.getBoundingClientRect().height)}px`).join('; ') || `${tools.length} controls`);
    }

    /* ---- 2. The gate ------------------------------------------------ */
    {
      // The military passcode is gone (owner, 2026-10-30): on a fresh profile
      // every military type has a card and a place in the podium order, and
      // the Military chip counts the whole shelf.
      const missing = [];
      for (const a of AIRCRAFT) {
        if (!a.military) continue;
        if (!$(`[data-hs-pick="${a.id}"]`)) missing.push(`${a.id} card`);
        if (!ui.order.includes(a.id)) missing.push(`${a.id} order`);
      }
      const milChip = $('[data-hs-tab="military"]');
      const onShelf = ui.shown.filter((a) => shelfOf(a, aircraftCategory) === 'military').length;
      const chipTotal = milChip ? Number(milChip.querySelector('b').textContent.split('/')[1]) : 0;
      r.ok('hangar: on a fresh profile every military type is on a card and in the podium order, and the Military chip counts them all',
        missing.length === 0 && !!milChip && chipTotal === onShelf && onShelf >= AIRCRAFT.filter((a) => a.military && shelfOf(a, aircraftCategory) === 'military').length,
        missing.slice(0, 4).join('; ') || `Military chip ${milChip ? chipTotal : 'absent'}, on shelf ${onShelf}`);
      r.ok('hangar: no passcode box anywhere on the screen', !$('[data-mil-code]') && !$('[data-mil-enter]') && !/Military access/.test(screen.textContent) && !!$('[data-code]') && !!$('[data-redeem]'),
        `mil box ${!!$('[data-mil-code]')}, redeem box ${!!$('[data-code]')}`);
    }

    /* ---- 3. A shelf chip --------------------------------------------- */
    {
      const chip = $('[data-hs-tab="helicopters"]');
      if (chip) chip.click();
      pump(20);
      const want = ui.shown.filter((a) => shelfOf(a, aircraftCategory) === 'helicopters').map((a) => a.id);
      const cards = $$('[data-hs-grid] [data-hs-pick]').map((c) => c.dataset.hsPick);
      const st = sc() && sc().stats();
      r.ok('hangar: the Helicopters chip narrows the order and the grid to the helicopters, and the podium follows',
        !!chip && ui.shelf === 'helicopters' && ui.order.join() === want.join() && cards.join() === want.join()
          && want.includes(ui.id) && (!st || st.current === ui.id) && $('[data-hs-tab="helicopters"]').classList.contains('is-on'),
        `${cards.join(' ')} | podium ${st && st.current} | card ${ui.id}`);
      // Browsing wraps within the shelf.
      const before = ui.id;
      for (let i = 0; i < want.length; i++) ui.step(1);
      pump(4);
      r.ok('hangar: the arrows go round the shelf, not the whole fleet', ui.id === before && ui.order.length === want.length, `${before} → ${ui.id}`);
    }

    /* ---- 4. Search, filter, sort ----------------------------------------- */
    {
      $('[data-hs-tab="all"]').click();
      pump(4);
      const box = $('[data-hs-search]');
      box.value = '747';
      fire(box, 'input');
      // The grid follows at once; the podium once the typing pauses (300 ms).
      const gridAtOnce = $$('[data-hs-grid] [data-hs-pick]').every((c) => /747/.test(typeOf(c.dataset.hsPick).name));
      await sleep(450);
      pump(4);
      const got = ui.order.slice();
      const cards = $$('[data-hs-grid] [data-hs-pick]').map((c) => c.dataset.hsPick);
      r.ok('hangar: typing "747" leaves the 747s on the podium order and the grid, and the first goes on the podium',
        gridAtOnce && got.length >= 1 && got.every((id) => /747/.test(typeOf(id).name)) && cards.join() === got.join() && got.includes(ui.id)
          && Number($('[data-hs-count]').textContent.split(' of ')[1]) === got.length,
        `${got.join(' ')} | ${$('[data-hs-count]').textContent}`);
      box.value = 'xyzzyq';
      fire(box, 'input');
      pump(2);
      const empty = $('[data-hs-empty]');
      const clear = $('[data-hs-clear]');
      const emptyShown = !empty.hidden && ui.order.length === 0 && !!$('[data-hs-name]').textContent;
      clear.click();
      pump(2);
      r.ok('hangar: nonsense shows the empty note with "Show them all", which brings the whole fleet back and keeps the card',
        emptyShown && empty.hidden && ui.query === '' && ui.order.length === ui.shown.length, `${ui.order.length} of ${ui.shown.length} after clear`);

      $('[data-hs-filter="owned"]').click();
      pump(2);
      const owned = ui.order.slice();
      $('[data-hs-filter="afford"]').click();
      pump(2);
      const afford = ui.order.slice();
      $('[data-hs-filter="locked"]').click();
      pump(2);
      const locked = ui.order.slice();
      $('[data-hs-filter="all"]').click();
      pump(2);
      r.ok('hangar: Yours, Can afford and Locked each show exactly what they say',
        owned.length === 3 && owned.every((id) => p.unlocked.includes(id))
          && afford.length > 0 && afford.every((id) => !p.unlocked.includes(id) && Prog.costOf(id) > 0 && Prog.costOf(id) <= 700)
          && locked.length === ui.shown.length - 3 && locked.every((id) => !p.unlocked.includes(id))
          && ui.order.length === ui.shown.length,
        `yours ${owned.length}, can afford ${afford.join(' ')}, locked ${locked.length}`);

      const sel = $('[data-hs-sort]');
      sel.value = 'speed';
      fire(sel, 'change');
      pump(2);
      const { performanceFor } = await import('../../src/aircraft/types.js');
      const v = ui.order.map((id) => (performanceFor(id) || {}).vne || 0);
      const fastFirst = v.every((x, i) => i === 0 || v[i - 1] >= x);
      sel.value = 'price';
      fire(sel, 'change');
      pump(2);
      const pr = ui.order.map((id) => (p.unlocked.includes(id) ? -1 : Prog.costOf(id) || Infinity));
      const cheapFirst = pr.every((x, i) => i === 0 || pr[i - 1] <= x);
      const remembered = store(STORE_KEYS.sort);
      sel.value = 'shelf';
      fire(sel, 'change');
      pump(2);
      r.ok('hangar: Fastest first and Cheapest first reorder the fleet, and the sort is remembered',
        fastFirst && cheapFirst && remembered && remembered.includes('price') && ui.sort === 'shelf',
        `fastest ${fastFirst}, cheapest ${cheapFirst}, stored ${remembered}`);
    }

    /* ---- 5. Favourites and recently flown ------------------------------- */
    {
      ui.select('courier', 0);
      pump(4);
      const star = $('[data-hs-fav]');
      star.click();
      pump(2);
      const strip = $('[data-hs-strip="favourites"]');
      const tile = $('[data-hs-strip-row="favourites"] [data-hs-pick="courier"]');
      const badge = $('[data-hs-grid] [data-hs-pick="courier"] .hs-badge.is-fav');
      const stored = store(STORE_KEYS.favourites) || '';
      const stripShown = !strip.hidden;
      const on = star.classList.contains('is-on') && star.getAttribute('aria-pressed') === 'true';
      star.click();
      pump(2);
      const off = !star.classList.contains('is-on') && strip.hidden && !(store(STORE_KEYS.favourites) || '').includes('courier');
      r.ok('hangar: the star puts the Courier in the Favourites row, badges its card and remembers it; again takes it out',
        on && stripShown && !!tile && !!badge && stored.includes('courier') && off,
        `on ${on} strip ${stripShown} tile ${!!tile} badge ${!!badge} stored ${stored} | off ${off}`);

      menus.noteFlown('skylark');
      menus.noteFlown('courier');
      await sleep(60);
      const recent = $$('[data-hs-strip-row="recent"] [data-hs-pick]').map((t) => t.dataset.hsPick);
      r.ok('hangar: noteFlown (main.js startMode) fills Recently flown, latest first',
        !$('[data-hs-strip="recent"]').hidden && recent[0] === 'courier' && recent[1] === 'skylark', recent.join(' '));
      r.ok('hangar: startMode tells the hangar what was flown', typeof menus.noteFlown === 'function' && typeof sim.startMode === 'function');
    }

    /* ---- 6. Tapping a card ---------------------------------------------- */
    {
      const target = ui.order.find((id) => id !== ui.id && !p.unlocked.includes(id));
      const card = target && $(`[data-hs-grid] [data-hs-pick="${target}"]`);
      if (card) card.click();
      pump(30);
      const st = sc() && sc().stats();
      const lit = $(`[data-hs-grid] [data-hs-pick="${target}"]`);
      r.ok('hangar: tapping a locked card puts that aircraft on the podium as a silhouette and lights the card',
        !!card && ui.id === target && (!st || (st.current === target && st.locked === true)) && !!lit && lit.classList.contains('is-on')
          && $('[data-hs-name]').textContent === typeOf(target).name && !!$(`[data-hs-buy="${target}"]`) === (Prog.costOf(target) > 0 && Prog.costOf(target) <= 700),
        `${target}: podium ${st && st.current} locked ${st && st.locked}, card ${$('[data-hs-name]').textContent}`);
    }

    /* ---- 7. New badges ---------------------------------------------------- */
    {
      const bad = [];
      for (const c of $$('[data-hs-grid] [data-hs-pick]')) {
        const has = !!c.querySelector('.hs-badge.is-new');
        if (has !== isNew(c.dataset.hsPick)) bad.push(`${c.dataset.hsPick} ${has ? 'badged' : 'not badged'}`);
      }
      const shownNew = NEW_SINCE_V70.filter((id) => ui.shown.some((a) => a.id === id));
      r.ok('hangar: "New" sits on every aircraft added since v70 that is shown, and on nothing else',
        bad.length === 0 && shownNew.length > 0, bad.slice(0, 4).join('; ') || `${shownNew.length} new`);
    }

    /* ---- 8. Phone layout, as rules -------------------------------------- */
    {
      const rules = [];
      for (const sheet of document.styleSheets) {
        let list;
        try {
          list = sheet.cssRules;
        } catch (e) {
          continue;
        }
        for (const rule of list) {
          if (rule.media && /max-width:\s*760px/.test(rule.media.mediaText)) {
            for (const inner of rule.cssRules) rules.push(`${inner.selectorText} {${inner.style.cssText}}`);
          }
        }
      }
      const twoCol = rules.some((t) => t.startsWith('.hs-grid') && /repeat\(2,/.test(t));
      const wrap = rules.some((t) => t.startsWith('.hs-tools') && /flex-wrap:\s*wrap/.test(t));
      const stack = rules.some((t) => t.startsWith('.hs-main') && /grid-template-columns:\s*minmax\(0(px)?,\s*1fr\)/.test(t));
      // …and the tools move under the podium, so Fly is on the first screen of a 390x844 phone.
      const below = rules.some((t) => t.startsWith('.hs-tools') && /order:\s*1/.test(t));
      r.ok('hangar: on a phone the grid is two columns, the tools wrap and sit under the podium, which stacks over the card',
        twoCol && wrap && stack && below, `two columns ${twoCol}, tools wrap ${wrap}, stacked ${stack}, tools below ${below} (${rules.length} narrow rules)`);
    }
  } catch (err) {
    r.ok('hangar: the checks ran without throwing', false, String(err && err.stack || err).slice(0, 300));
  } finally {
    p.credits = keep.credits;
    p.unlocked = keep.unlocked;
    Prog.save(p);
    restoreStore();
    menus.syncProgression && menus.syncProgression(p);
    menus.syncFleetLocks && menus.syncFleetLocks();
    menus.setGame(wasGame || 'flight');
    menus.show('main');
    pump(1);
  }
}
