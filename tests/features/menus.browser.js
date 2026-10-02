/**
 * Browser checks for the categories — "Add categorys for missions and planes".
 *
 * What has to be true, in the page, with whatever aircraft and missions the
 * other teams have landed by the time this runs:
 *
 *   - every aeroplane is on the Free Flight picker once, under exactly one
 *     heading, and that heading is the one aircraftCategory() says;
 *   - every aeroplane you are allowed to see is in the hangar once, under the
 *     same heading as on the picker;
 *   - every mission is on the board once, under exactly one heading;
 *   - in each of the four games, every heading that shows has a title and a
 *     count that matches the cards under it, and no card is visible outside a
 *     visible heading or under a hidden one;
 *   - the passcode still hides the military missions, whatever the chips,
 *     the search box and the game switcher have been doing;
 *   - a chip shows one heading and All brings them back; a search that
 *     matches nothing says so, and clearing it restores the board;
 *   - nothing on the three screens scrolls sideways;
 *   - a wildfire mission registered after boot goes under Firefighting;
 *   - every Free Flight tab has a height a finger can press, and "Take off"
 *     is at the bottom of a screen that scrolls.
 *
 * Every import is dynamic and wrapped, as in selftest-three-games.js: a
 * static import of a name that is missing takes down the page, not the test.
 */

export const id = 'menus';

/**
 * "move hangar to the main area, not in other, and make it so you can select
 * planes in a cool fashion, the planes are on a podium spinning etc."
 *
 *   - a Hangar card on the front page of the aeroplane game and of Rotors,
 *     and a door to it from Free Flight's picker;
 *   - the showroom opens on the podium, and browsing round the whole fleet
 *     twice puts every aeroplane you may see on it, each the one the card
 *     names, locked ones as silhouettes;
 *   - the model cache stays small and everything is let go when it closes;
 *   - unlocking from the podium spends the credits and lights it up — the
 *     profile is put back exactly as it was afterwards;
 *   - the code box is still on the hangar screen.
 */
async function hangarShowroom(sim, menus, r, Prog) {
  const ui = menus.showcaseUi;
  if (!ui) {
    r.ok('menus: the hangar has its showroom', false, 'menus.showcaseUi missing');
    return;
  }
  const cards = {};
  for (const g of ['flight', 'heli']) {
    menus.setGame(g);
    menus.show('main');
    cards[g] = !!menus.screens.main.querySelector('.main-nav [data-act="hangar"]');
  }
  const door = !!menus.screens.free.querySelector('[data-open-hangar]');
  r.ok('menus: a Hangar card on the aeroplane and Rotors front pages, and a door from Free Flight',
    cards.flight && cards.heli && door, JSON.stringify({ ...cards, freeFlightDoor: door }));

  menus.setGame('flight');
  menus.show('hangar');
  if (ui.loading) await ui.loading.catch(() => {});
  for (let i = 0; i < 100 && !ui.showcase && !ui.failed; i++) await new Promise((res) => setTimeout(res, 50));
  const sc = ui.showcase;
  if (!sc) {
    r.ok('menus: the showroom loads its podium', false, ui.failed ? 'fell back to the plan view' : 'never loaded');
    return;
  }
  const pump = (n) => {
    for (let i = 0; i < n; i++) menus.drawView(sim.renderer, 1 / 30);
  };
  pump(4);
  const p = menus.prog;
  const seen = new Set();
  const wrong = [];
  let maxCache = 0;
  const n = ui.order.length;
  for (let i = 0; i < n * 2; i++) {
    ui.step(1);
    pump(24);
    const st = sc.stats();
    seen.add(ui.id);
    maxCache = Math.max(maxCache, st.cached.length);
    if (st.current !== ui.id) wrong.push(`${ui.id}: podium has ${st.current}`);
    else if (st.locked !== !Prog.isUnlocked(p, ui.id)) wrong.push(`${ui.id}: ${st.locked ? 'silhouette but yours' : 'lit but locked'}`);
    const name = menus.screens.hangar.querySelector('[data-hs-name]');
    const type = (await import('../../src/aircraft/types.js')).getAircraft(ui.id);
    if (!name || name.textContent !== type.name) wrong.push(`${ui.id}: card says ${name && name.textContent}`);
  }
  const visible = ui.order.filter((id) => seen.has(id)).length;
  r.ok('menus: browsing the fleet twice puts every aeroplane on the podium, locked ones as silhouettes',
    visible === n && wrong.length === 0 && maxCache <= 5,
    wrong.slice(0, 3).join('; ') || `${visible}/${n} shown, cache at most ${maxCache}, built ${sc.stats().built}`);

  // Unlock one from the podium, then put the profile back exactly.
  const target = ui.order.find((id) => !Prog.isUnlocked(p, id) && Prog.costOf(id) > 0);
  if (target) {
    const keep = { credits: p.credits, unlocked: [...p.unlocked] };
    try {
      p.credits = Prog.costOf(target);
      ui.select(target, 0);
      pump(30);
      const btn = menus.screens.hangar.querySelector(`[data-hs-buy="${target}"]`);
      if (btn) btn.click();
      pump(30);
      const got = Prog.isUnlocked(p, target);
      const st = sc.stats();
      r.ok('menus: Unlock on the podium spends the credits and lights the silhouette up',
        !!btn && got && p.credits === 0 && st.current === target && st.locked === false
          && !!menus.screens.hangar.querySelector('[data-hs-fly]'),
        `${target}: button ${!!btn}, owned ${got}, credits left ${p.credits}, silhouette ${st.locked}`);
    } finally {
      p.credits = keep.credits;
      p.unlocked = keep.unlocked;
      Prog.save(p);
      menus.syncProgression && menus.syncProgression();
      menus.syncFleetLocks && menus.syncFleetLocks();
    }
  }

  const box = menus.screens.hangar.querySelector('[data-code]');
  const redeem = menus.screens.hangar.querySelector('[data-redeem]');
  menus.show('main');
  pump(1);
  const after = sc.stats();
  r.ok('menus: the code box is still in the hangar, and closing it lets every model go',
    !!box && !!redeem && after.cached.length === 0 && after.built === after.disposed,
    `code box ${!!box}, cached ${after.cached.length}, built ${after.built}, disposed ${after.disposed}`);
}

const GAMES = ['flight', 'heli', 'boat', 'car'];

export async function check(sim, r, say) {
  say && say('menus: categories');
  const menus = sim && sim.menus;
  if (!menus || !menus.screens) {
    r.ok('menus: the menus exist to be checked', false, 'sim.menus missing');
    return;
  }

  let Menus;
  let Types;
  let Missions;
  let Prog;
  try {
    [Menus, Types, Missions, Prog] = await Promise.all([
      import('../../src/ui/menus.js'),
      import('../../src/aircraft/types.js'),
      import('../../src/game/missions.js'),
      import('../../src/game/progression.js'),
    ]);
  } catch (err) {
    r.ok('menus: category modules load', false, String(err && err.message));
    return;
  }
  const { aircraftCategory, missionCategory, AIRCRAFT_CATEGORIES, MISSION_CATEGORIES } = Menus;
  if (typeof aircraftCategory !== 'function' || typeof missionCategory !== 'function') {
    r.ok('menus: category functions exported', false, 'aircraftCategory / missionCategory missing from menus.js');
    return;
  }
  const AIRCRAFT = Types.AIRCRAFT || [];
  const MISSIONS = Missions.MISSIONS || [];
  const gameOf = Missions.gameOf || ((m) => m.game || 'flight');
  const prog = menus.prog || Prog.load();
  const gated = (x) => Prog.needsPasscode(prog, x);

  // What to put back afterwards.
  const was = {
    game: menus.currentGame,
    open: menus.isOpen,
    screen: menus.current,
    missions: { ...menus.catState('missions') },
    fleet: { ...menus.catState('fleet') },
  };

  const free = menus.screens.free;
  const board = menus.screens.missions;
  const hangar = menus.screens.hangar;
  const groupsAround = (el, stop) => {
    let n = 0;
    for (let p = el && el.parentElement; p && p !== stop; p = p.parentElement) {
      if (p.hasAttribute && p.hasAttribute('data-cat-group')) n++;
    }
    return n;
  };
  const shown = (el) => !el.hidden && !el.classList.contains('is-filtered');

  try {
    /* ---- 1. The Free Flight picker -------------------------------- */
    const aircraftIds = AIRCRAFT_CATEGORIES.map((c) => c.id);
    {
      const bad = [];
      for (const a of AIRCRAFT) {
        const cat = aircraftCategory(a);
        const cards = free.querySelectorAll(`[data-aircraft="${a.id}"]`);
        if (!aircraftIds.includes(cat)) bad.push(`${a.id}: "${cat}" is not one of the five`);
        else if (cards.length !== 1) bad.push(`${a.id}: ${cards.length} cards`);
        else if (groupsAround(cards[0], free) !== 1) bad.push(`${a.id}: under ${groupsAround(cards[0], free)} headings`);
        else if (cards[0].closest('[data-cat-group]').dataset.catGroup !== cat) {
          bad.push(`${a.id}: under ${cards[0].closest('[data-cat-group]').dataset.catGroup}, expected ${cat}`);
        }
      }
      r.ok(
        'menus: every aeroplane is on the picker once, under exactly one of the five headings',
        bad.length === 0,
        bad.slice(0, 4).join('; ') || `${AIRCRAFT.length} aircraft`
      );
    }

    /* ---- 2. The hangar -------------------------------------------- */
    {
      menus.syncProgression && menus.syncProgression();
      const bad = [];
      for (const a of AIRCRAFT) {
        const btns = hangar.querySelectorAll(`[data-unlocks] [data-buy="${a.id}"]`);
        const hide = !!a.military && !prog.militaryUnlocked;
        if (hide) {
          if (btns.length) bad.push(`${a.id} shows before the passcode`);
          continue;
        }
        if (btns.length !== 1) bad.push(`${a.id}: ${btns.length} buttons`);
        else if (groupsAround(btns[0], hangar) !== 1) bad.push(`${a.id}: under ${groupsAround(btns[0], hangar)} headings`);
        else if (btns[0].closest('[data-cat-group]').dataset.catGroup !== aircraftCategory(a)) {
          bad.push(`${a.id}: hangar and picker disagree`);
        }
      }
      const heads = [...hangar.querySelectorAll('[data-unlocks] [data-cat-group]')];
      const emptyHead = heads.find((g) => !g.querySelector('[data-buy]') || !g.querySelector('.unlock-title').textContent.trim());
      r.ok(
        'menus: the hangar puts each aeroplane under the same heading as the picker',
        bad.length === 0 && !emptyHead,
        bad.slice(0, 4).join('; ') || (emptyHead ? `empty heading ${emptyHead.dataset.catGroup}` : `${heads.length} headings`)
      );
    }

    /* ---- 3. The missions board ------------------------------------ */
    {
      const bad = [];
      for (const m of MISSIONS) {
        const cat = missionCategory(m);
        const cards = board.querySelectorAll(`[data-mission="${m.id}"]`);
        if (!cat || typeof cat !== 'string') bad.push(`${m.id}: no category`);
        else if (cards.length !== 1) bad.push(`${m.id}: ${cards.length} cards`);
        else if (groupsAround(cards[0], board) !== 1) bad.push(`${m.id}: under ${groupsAround(cards[0], board)} headings`);
        else if (cards[0].closest('[data-cat-group]').dataset.catGroup !== cat) {
          bad.push(`${m.id}: under ${cards[0].closest('[data-cat-group]').dataset.catGroup}, expected ${cat}`);
        }
      }
      // Missions nobody categorised must still land on one of the listed headings.
      const listed = MISSION_CATEGORIES.map((c) => c.id);
      const stray = MISSIONS.filter((m) => !m.category && !listed.includes(missionCategory(m))).map((m) => m.id);
      r.ok(
        'menus: every mission is on the board once, under exactly one heading',
        bad.length === 0 && stray.length === 0,
        bad.slice(0, 4).join('; ') || (stray.length ? `unlisted heading for ${stray.join(', ')}` : `${MISSIONS.length} missions`)
      );
    }

    /* ---- 4. Headings render, per game ----------------------------- */
    {
      const bad = [];
      const seen = [];
      for (const g of GAMES) {
        menus.setGame(g);
        menus.resetCategoryFilter('missions');
        menus.show('missions');
        const want = new Set(MISSIONS.filter((m) => gameOf(m) === g && !gated(m)).map((m) => m.id));
        const got = new Set();
        const heads = [];
        for (const group of board.querySelectorAll('[data-cat-list="missions"] > [data-cat-group]')) {
          const cards = [...group.querySelectorAll('[data-mission]')].filter(shown);
          if (group.hidden) {
            if (cards.length) bad.push(`${g}: ${group.dataset.catGroup} hidden with ${cards.length} cards in it`);
            continue;
          }
          const title = group.querySelector('.cat-title');
          const count = group.querySelector('[data-cat-count]');
          if (!title || !title.textContent.trim() || getComputedStyle(title).display === 'none') {
            bad.push(`${g}: ${group.dataset.catGroup} has no visible title`);
          }
          if (!cards.length) bad.push(`${g}: ${group.dataset.catGroup} shows with nothing under it`);
          if (!count || Number(count.textContent) !== cards.length) {
            bad.push(`${g}: ${group.dataset.catGroup} says ${count && count.textContent}, shows ${cards.length}`);
          }
          for (const c of cards) got.add(c.dataset.mission);
          heads.push(`${title ? title.textContent.trim() : '?'} ${cards.length}`);
        }
        const missing = [...want].filter((x) => !got.has(x));
        const extra = [...got].filter((x) => !want.has(x));
        if (missing.length) bad.push(`${g}: missing ${missing.slice(0, 3).join(', ')}`);
        if (extra.length) bad.push(`${g}: shows ${extra.slice(0, 3).join(', ')} which is not its own or is locked`);
        seen.push(`${g}: ${heads.join(', ')}`);
      }
      r.ok(
        'menus: each game\'s missions sit under titled headings whose counts match',
        bad.length === 0,
        bad.slice(0, 4).join('; ') || seen.join(' | ')
      );
    }

    /* ---- 5. The passcode survives chips, search and switching ----- */
    {
      menus.setGame('car');
      menus.setGame('flight');
      menus.show('missions');
      const inp = board.querySelector('[data-cat-search]');
      if (inp) {
        inp.value = 'zzzz';
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        inp.value = '';
        inp.dispatchEvent(new Event('input', { bubbles: true }));
      }
      const leaked = MISSIONS.filter((m) => gated(m))
        .filter((m) => {
          const c = board.querySelector(`[data-mission="${m.id}"]`);
          return c && !c.hidden;
        })
        .map((m) => m.id);
      r.ok(
        'menus: military missions stay hidden without the passcode, after switching games and searching',
        leaked.length === 0,
        leaked.join(', ') || (prog.militaryUnlocked ? 'passcode already entered on this profile' : 'none leaked')
      );
    }

    /* ---- 6. Chips -------------------------------------------------- */
    {
      menus.setGame('flight');
      menus.resetCategoryFilter('missions');
      const visibleGroups = () =>
        [...board.querySelectorAll('[data-cat-list="missions"] > [data-cat-group]')].filter((x) => !x.hidden).map((x) => x.dataset.catGroup);
      const all = visibleGroups();
      const pick = all[all.length - 1];
      const chip = pick && board.querySelector(`[data-cat-chip="${pick}"]`);
      let ok = false;
      let detail = 'fewer than two headings in flight, nothing to filter';
      if (chip && all.length > 1) {
        chip.click();
        const one = visibleGroups();
        const pressed = chip.isConnected ? chip : board.querySelector(`[data-cat-chip="${pick}"]`);
        const allChip = board.querySelector('[data-cat-chip="all"]');
        allChip && allChip.click();
        const back = visibleGroups();
        ok = one.length === 1 && one[0] === pick && back.join() === all.join()
          && !!pressed && pressed.getAttribute('aria-pressed') === 'true';
        detail = `${pick}: ${one.join(',')} then All: ${back.length}/${all.length}`;
      } else if (all.length === 1) {
        ok = true;
      }
      r.ok('menus: a chip shows one heading and All brings them back', ok, detail);
    }

    /* ---- 7. Search -------------------------------------------------- */
    {
      menus.resetCategoryFilter('missions');
      const inp = board.querySelector('[data-cat-search]');
      const empty = board.querySelector('[data-cat-empty="missions"]');
      let ok = false;
      let detail = 'no search box';
      if (inp && empty) {
        const before = [...board.querySelectorAll('[data-mission]')].filter(shown).length;
        inp.value = 'qqqxxz';
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        const during = [...board.querySelectorAll('[data-mission]')].filter(shown).length;
        const said = !empty.hidden && /qqqxxz/.test(empty.textContent);
        board.querySelector('[data-cat-clear]').click();
        const after = [...board.querySelectorAll('[data-mission]')].filter(shown).length;
        ok = during === 0 && said && after === before && inp.value === '' && empty.hidden;
        detail = `${before} → ${during} (message ${said ? 'shown' : 'missing'}) → ${after}`;
      }
      r.ok('menus: a search with no match says so, and clearing it restores the board', ok, detail);
    }

    /* ---- 8. The counted line on the start screen ------------------- */
    {
      menus.setGame('flight');
      menus.show('main');
      const line = menus.screens.main.querySelector('[data-missions-line]');
      const n = MISSIONS.filter((m) => gameOf(m) === 'flight' && !gated(m)).length;
      const words = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
        'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen', 'Twenty'];
      const want = n < words.length ? words[n] : String(n);
      r.ok(
        'menus: the Missions card counts the missions you can actually fly',
        !!line && line.textContent.startsWith(`${want} mission`),
        line ? line.textContent : 'no counted line'
      );
    }

    /* ---- 9. Nothing scrolls sideways ------------------------------- */
    {
      const bad = [];
      for (const name of ['missions', 'free', 'hangar']) {
        menus.show(name);
        const s = menus.screens[name];
        if (s.scrollWidth > s.clientWidth + 1) bad.push(`${name} ${s.scrollWidth} > ${s.clientWidth}`);
      }
      r.ok(
        'menus: the grouped screens do not scroll sideways at this window size',
        bad.length === 0,
        bad.join('; ') || `${window.innerWidth} px wide`
      );
    }

    /* ---- 10. A wildfire mission registered late gets Firefighting --- */
    {
      /*
       * The fire missions are being written in parallel (game/extra/fire.js),
       * so this feeds one in the way game-ui.js would, under one of the words
       * a team might use, and takes it out again afterwards.
       */
      const id = '__menus_probe_fire';
      let ok = false;
      let detail = 'registerMissions missing';
      if (menus.registerMissions) {
        menus.registerMissions('heli', [{ id, name: 'Probe fire', short: '', blurb: '', reward: '', difficulty: 'Easy', category: 'firefighting' }]);
        menus.setGame('heli');
        menus.resetCategoryFilter('missions');
        menus.show('missions');
        const card = board.querySelector(`[data-mission="${id}"]`);
        const group = card && card.closest('[data-cat-group]');
        const title = group && group.querySelector('.cat-title');
        ok = !!card && !card.hidden && !!group && group.dataset.catGroup === 'fire' && !group.hidden
          && !!title && title.textContent.trim() === 'Firefighting';
        detail = card ? `under ${group && group.dataset.catGroup} "${title && title.textContent.trim()}"` : 'no card';
        // Out again, heading and all if the probe made it.
        if (card) card.remove();
        if (group && !group.querySelector('[data-cat-item]')) group.remove();
        if (menus._extraMissions) delete menus._extraMissions[id];
        menus.syncCategories('missions');
      }
      r.ok('menus: a wildfire mission registered later goes under Firefighting', ok, detail);
    }

    /* ---- 11. Free Flight: the tabs and "Take off" are where a finger is */
    {
      /*
       * On every touch screen the tab row was squeezed to 0 px by the flex
       * column it sits in, once the Aircraft panel outgrew the window; and on
       * a phone "Take off" floated 84 px above the bottom. Neither is visible
       * at a desktop size, where both were always fine — so this is a check
       * that it stays fixed where it can be seen, and it passes trivially on
       * a laptop.
       */
      menus.show('free');
      const tabs = [...free.querySelectorAll('[data-ftab]')];
      // The buttons keep their own height when the row is squeezed — the row
      // clips them — so what counts is how much of each shows inside the row.
      const row = (free.querySelector('.tabs') || free).getBoundingClientRect();
      const flat = tabs.filter((t) => {
        const b = t.getBoundingClientRect();
        return Math.min(b.bottom, row.bottom) - Math.max(b.top, row.top) < 20;
      }).map((t) => t.dataset.ftab);
      const bar = free.querySelector('.free-bar');
      const acTab = free.querySelector('[data-ftab="aircraft"]');
      if (acTab) acTab.click();
      free.scrollTop = 0;
      // Only a screen that scrolls has a bar that has to stick; one that fits
      // puts the bar straight after its content, which is right too.
      const scrolls = free.scrollHeight > free.clientHeight + 20;
      const gap = bar ? Math.round(free.getBoundingClientRect().bottom - bar.getBoundingClientRect().bottom) : -1;
      const barOk = !!bar && (!scrolls || (gap >= 0 && gap <= 20));
      r.ok(
        'menus: every Free Flight tab can be pressed and Take off sits at the bottom',
        tabs.length === 4 && flat.length === 0 && barOk,
        flat.length
          ? `tabs with no height: ${flat.join(', ')}`
          : `4 tabs; bar ${scrolls ? `${gap} px off the bottom` : 'after the content (screen fits)'} at ${window.innerWidth}x${window.innerHeight}`
      );
    }

    /* ---- 12. The hangar showroom ------------------------------------ */
    await hangarShowroom(sim, menus, r, Prog);
  } catch (err) {
    r.ok('menus: category checks ran to the end', false, String(err && err.stack || err));
  } finally {
    // Put the menu back the way the rest of the suite left it.
    try {
      // setGame first: changing game clears the missions filter, which is
      // right for a player and wrong for putting the old one back.
      menus.setGame(was.game || 'flight');
      for (const kind of ['missions', 'fleet']) {
        const st = menus.catState(kind);
        st.cat = was[kind].cat;
        st.q = was[kind].q;
        const host = kind === 'fleet' ? free : board;
        const inp = host && host.querySelector(`[data-cat-bar="${kind}"] [data-cat-search]`);
        if (inp) inp.value = st.q;
        menus.syncCategories(kind);
      }
      if (was.open && was.screen) menus.show(was.screen);
      else menus.hide();
    } catch {
      /* restoring must never be the thing that fails */
    }
  }
}
