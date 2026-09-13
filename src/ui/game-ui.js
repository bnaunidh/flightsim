/**
 * One menu, four games.
 *
 * WHAT WAS WRONG
 * The bar at the top of the menu switched games by starting them. Press Car and
 * main.js:switchGame() called startDrive('car') and you were in the world, on
 * the apron, with the aeroplane's menu still describing take-off and landing
 * behind you. That is why the boat and the car had no screens of their own:
 * there was nowhere for a screen to live, because the button that should have
 * opened one drove past it.
 *
 * WHAT THIS DOES
 * Pressing a game in the bar changes which game the MENU is about. Starting is
 * what the game's own screens are for. So `setGame(id)`:
 *   - stamps `data-game` on the menu root, so the whole menu can be themed off
 *     one attribute in CSS without a single extra class in JavaScript;
 *   - repaints the start screen's title and cards from a per-game table;
 *   - hides the mission cards and map cards that do not belong to this game.
 *
 * WHY IT IS A FILE RATHER THAN AN EDIT TO menus.js
 * menus.js is 2,139 lines and is being worked on by the flight, boat and car
 * leads in the same week. This overwrites three methods on the live Menus
 * instance and adds four, from outside. One import line in main.js applies all
 * of it; nothing here can half-merge into somebody else's screen.
 *
 * HIDDEN, NEVER FILTERED
 * Cards are built once and then hidden, exactly as the passcode locks already
 * do it (the comment at menus.js:560 explains why: build() runs once from the
 * constructor, so a card filtered out at build time can never come back). The
 * game filter follows the same rule, and it wraps the existing lock syncs
 * instead of replacing them, so a card needs BOTH its passcode and its game.
 */

import { MAPS } from '../world/maps.js';
import { icon } from './icons.js';

/**
 * What each game's start screen says it is.
 *
 * `to` is the data-act the card fires, which is the same vocabulary the
 * existing delegated handler in buildMain() already understands — except
 * 'drive', which is new and is handled here, because "Island Roads" has to put
 * you on the road rather than open the aeroplane's weather setup.
 */
export const GAME_UI = {
  flight: {
    hero: 'Island Flight Simulator',
    line: 'Learn to fly a real aeroplane',
    cards: [
      { to: 'tutorial', icon: 'learn', title: 'Tutorial', sub: 'Start here — learn take-off, turning and landing' },
      { to: 'missions', icon: 'target', title: 'Missions', sub: 'Eight challenges — a delivery, a storm landing, a landing with no engine' },
      { to: 'free', icon: 'cloud', title: 'Free Flight', sub: 'Any weather, any time of day, no rules' },
      { to: 'maps', icon: 'map', title: 'Choose Map', sub: 'Six places to fly, from flat grassland to a volcano' },
      { to: 'more', icon: 'more', title: 'More', sub: 'Your rank and leaderboard, the hangar, and settings' },
    ],
  },
  heli: {
    hero: 'Island Rotors',
    line: 'The Skyhook H-3 — the one that hovers',
    cards: [
      { to: 'tutorial', icon: 'learn', title: 'Tutorial', sub: 'Start here — the aeroplane lessons still apply' },
      { to: 'missions', icon: 'target', title: 'Missions', sub: 'Winch work, mountain pads and places with no runway' },
      { to: 'free', icon: 'cloud', title: 'Free Flight', sub: 'Any weather, any time of day, no rules' },
      { to: 'maps', icon: 'map', title: 'Choose Map', sub: 'Anywhere with somewhere flat to set down' },
      { to: 'more', icon: 'more', title: 'More', sub: 'Your rank and leaderboard, the hangar, and settings' },
    ],
  },
  boat: {
    hero: 'Kestrel Launch',
    line: 'Out of the bay and round the headland',
    cards: [
      { to: 'missions', icon: 'target', title: 'Runs', sub: 'Jobs on the water, on whichever island you pick' },
      { to: 'drive', icon: 'boat', title: 'Open Water', sub: 'No clock. Just take her out' },
      { to: 'maps', icon: 'map', title: 'Choose your water', sub: 'Every island has a different coast' },
      { to: 'more', icon: 'more', title: 'More', sub: 'Your rank and leaderboard, the hangar, and settings' },
    ],
  },
  car: {
    /*
     * Island Courier. Not "the car" — a game with a job in it.
     *
     * Every line here is the fantasy stated once and then never explained
     * again: you drive the island's deliveries, and the three things that
     * matter are the clock, the road and the state of what is in the back.
     */
    hero: 'Island Courier',
    line: 'You drive the island’s deliveries. On time, and in one piece',
    cards: [
      { to: 'missions', icon: 'target', title: 'Jobs', sub: 'Six runs, on whichever island you pick' },
      { to: 'drive', icon: 'car', title: 'Island Roads', sub: 'No clock. Take a job at the depot, or just drive' },
      { to: 'maps', icon: 'map', title: 'Choose your island', sub: 'Every one has a different road network' },
      { to: 'more', icon: 'more', title: 'More', sub: 'Your rank and leaderboard, the hangar, and settings' },
    ],
  },
};

/**
 * Fit it to a live Menus instance.
 *
 * @param {object} menus  the Menus instance from main.js
 * @param {object} hooks
 * @param {(gameId:string)=>void} hooks.onFreeDrive  put the player in the world
 *        with no clock — this is what "Island Roads" and "Open Water" do
 * @param {(gameId:string, mapDef:object)=>boolean} [hooks.mapQualifies]
 *        whether a map is worth offering for this game. The car's answer is
 *        "does it have more than six kilometres of road", which only the road
 *        generator can know, so it is injected rather than guessed here.
 */
export function installGameUi(menus, hooks = {}) {
  menus.gameHooks = hooks;

  /*
   * Wrap the two lock syncs rather than editing them.
   *
   * They are closures created inside buildMissions() and buildMaps() and called
   * from show(), and they set `card.hidden` from the passcode alone. Without
   * this wrap, opening the missions screen would put every aeroplane mission
   * back on the car's job board. Wrapped, the last word on a card is always
   * "passcode AND game".
   */
  if (!menus._gameLocksWrapped) {
    menus._gameLocksWrapped = true;
    const missionLocks = menus.syncMissionLocks;
    if (missionLocks) {
      menus.syncMissionLocks = function () {
        missionLocks.call(menus);
        menus.applyGameToCards();
      };
    }
    const mapLocks = menus.syncMapLocks;
    if (mapLocks) {
      menus.syncMapLocks = function () {
        mapLocks.call(menus);
        menus.applyGameToCards();
      };
    }
  }

  /**
   * Which maps this game is offered. Called by whoever knows — the road
   * generator for the car, the harbour list for the boat — and it is a list of
   * ids plus an optional line of true, measured text for the card.
   *
   * @param {string} gameId
   * @param {Array<string|{id:string,note:string}>} list
   */
  menus.setGameMaps = function (gameId, list) {
    menus._gameMaps = menus._gameMaps || {};
    menus._gameMaps[gameId] = (list || []).map((m) => (typeof m === 'string' ? { id: m, note: '' } : m));
    if (menus.currentGame === gameId) menus.applyGameToCards();
  };

  /**
   * Add this game's missions to the board.
   *
   * Appended to the grid that is already there, tagged with the game they
   * belong to, and never removed — the same build-once-hide-later rule as the
   * passcode. Safe to call before or after setGame().
   *
   * Each def needs: id, name, short, difficulty, icon, blurb, reward.
   * Clicking one calls hooks.startMission(id), which is the same door the
   * aeroplane missions go through; routing a car job to the car is main.js's
   * job, not the menu's.
   */
  menus.registerMissions = function (gameId, defs) {
    const grid = menus.screens.missions && menus.screens.missions.querySelector('.mission-grid');
    if (!grid || !defs || !defs.length) return;
    for (const m of defs) {
      if (grid.querySelector(`[data-mission="${m.id}"]`)) continue;
      const card = document.createElement('article');
      card.className = 'mission-card';
      card.dataset.mission = m.id;
      card.dataset.game = gameId;
      card.innerHTML = `
        <div class="mission-top">
          <span class="mission-icon">${m.icon || '▣'}</span>
          <div>
            <h3>${m.name}</h3>
            <span class="mission-diff diff-${String(m.difficulty || 'easy').toLowerCase()}">${m.difficulty || 'Easy'}</span>
            <span class="mission-sub">${m.short || ''}</span>
          </div>
        </div>
        <p>${m.blurb || ''}</p>
        <p class="mission-learn">${m.reward || ''}</p>
        <div class="mission-foot">
          <span class="mission-best" data-best="${m.id}"></span>
          <button class="primary" data-start="${m.id}">${gameId === 'car' ? 'Take this job' : 'Start'}</button>
        </div>`;
      grid.appendChild(card);
    }
    menus.applyGameToCards();
  };

  /** Show only the cards that belong to the game the menu is currently about. */
  menus.applyGameToCards = function () {
    const game = menus.currentGame || 'flight';
    const missions = menus.screens.missions;
    if (missions) {
      for (const card of missions.querySelectorAll('[data-mission]')) {
        // A card with no data-game is an aeroplane mission: they were all built
        // before games existed and there are twelve of them to not re-tag.
        const belongs = (card.dataset.game || 'flight') === game
          || (game === 'heli' && (card.dataset.game || 'flight') === 'flight');
        // Never un-hide something the passcode hid. The lock sync has already
        // run by the time this does, so hidden-true is respected and only
        // hidden-false is narrowed.
        if (!card.hidden && !belongs) card.hidden = true;
        else if (belongs && card.dataset.gameHidden === '1') card.hidden = false;
        card.dataset.gameHidden = !belongs ? '1' : '0';
      }
      const head = missions.querySelector('.screen-head h2');
      if (head) head.textContent = game === 'car' ? 'Jobs' : game === 'boat' ? 'Runs' : 'Missions';
    }

    const maps = menus.screens.maps;
    if (maps) {
      const allowed = menus._gameMaps && menus._gameMaps[game];
      for (const m of MAPS) {
        const card = maps.querySelector(`[data-map-card="${m.id}"]`);
        if (!card) continue;
        let ok = true;
        if (allowed) ok = allowed.some((a) => a.id === m.id);
        else if (hooks.mapQualifies) ok = hooks.mapQualifies(game, m);
        if (!card.hidden && !ok) card.hidden = true;
        else if (ok && card.dataset.gameHidden === '1') card.hidden = false;
        card.dataset.gameHidden = !ok ? '1' : '0';
        // The measured line — "31 km of road, a coast loop, a 240 m climb".
        // Written by whoever measured it; empty means say nothing rather than
        // invent something.
        const note = allowed && (allowed.find((a) => a.id === m.id) || {}).note;
        let noteEl = card.querySelector('[data-map-note]');
        if (note) {
          if (!noteEl) {
            noteEl = document.createElement('p');
            noteEl.className = 'map-note';
            noteEl.setAttribute('data-map-note', '');
            const text = card.querySelector('.map-text');
            if (text) text.appendChild(noteEl);
          }
          noteEl.textContent = note;
          noteEl.hidden = false;
        } else if (noteEl) {
          noteEl.hidden = true;
        }
      }
      const btnWord = game === 'car' ? 'Drive here' : game === 'boat' ? 'Sail here' : 'Fly here';
      for (const b of maps.querySelectorAll('[data-choose-map]')) b.textContent = btnWord;
      const hint = maps.querySelector('.hint');
      if (hint) {
        hint.textContent = game === 'car'
          ? 'Every island has its own road network, generated from its own land. A place with no road worth driving is not offered.'
          : game === 'boat'
            ? 'Every island has its own coast. What changes is how much shelter it gives you.'
            : 'Every map has the same runway, so everything you have learned still works. What changes is the land around it — and how much room it leaves you.';
      }
    }
  };

  /** Repaint the start screen for this game. */
  menus.applyGameUi = function () {
    const game = menus.currentGame || 'flight';
    const def = GAME_UI[game] || GAME_UI.flight;
    const main = menus.screens.main;
    if (!main) return;

    const h1 = main.querySelector('.brand h1');
    if (h1) h1.textContent = def.hero;
    const tag = main.querySelector('.tagline');
    if (tag) {
      /*
       * The island's name stays in the tagline, in the element syncMap() writes
       * into. Rebuild the line without that span and the name of the place you
       * are about to drive on quietly stops updating — the kind of break that
       * nothing throws on and nobody notices for a week.
       */
      tag.innerHTML = `${def.line} — <span data-map-name></span>`;
      menus.syncMap && menus.syncMap((menus.settingsRef && menus.settingsRef.map) || 'kestrel');
    }

    const nav = main.querySelector('.main-nav');
    if (nav) {
      /*
       * innerHTML is safe here: the click handler is delegated on the <section>,
       * not bound to the buttons, so replacing them keeps every card working.
       * That is worth knowing before anyone "fixes" this into buttons built one
       * at a time with their own listeners.
       */
      nav.innerHTML = def.cards
        .map(
          (c) => `<button class="card-btn" data-act="${c.to}">
            <span class="card-icon">${icon(c.icon, 24)}</span>
            <span class="card-body"><strong>${c.title}</strong><em>${c.sub}</em></span>
          </button>`
        )
        .join('');
    }
  };

  /*
   * The new act. 'drive' is free mode: no clock, no job, just the island.
   * Added as a second delegated listener on the same screen so that the
   * original handler in buildMain() is untouched — it has no branch for
   * 'drive', so it does nothing but play the click.
   */
  if (menus.screens.main && !menus._driveActBound) {
    menus._driveActBound = true;
    menus.screens.main.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act="drive"]');
      if (!btn) return;
      const go = menus.gameHooks.onFreeDrive;
      if (go) go(menus.currentGame);
    });
  }

  /**
   * Tell the bar which game the menu is about, and repaint everything that
   * says so. This replaces the old two-line version, which lit a button and
   * nothing else — the reason the boat and the car had no interface at all.
   */
  menus.setGame = function (id) {
    if (!GAME_UI[id]) id = 'flight';
    menus.currentGame = id;
    // One attribute, off which the whole menu can be themed in CSS.
    if (menus.root) menus.root.dataset.game = id;
    menus.applyGameUi();
    menus.applyGameToCards();
    menus.syncBar && menus.syncBar();
  };

  menus.setGame(menus.currentGame || 'flight');
  return menus;
}
