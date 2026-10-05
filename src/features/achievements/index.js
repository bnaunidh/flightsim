/**
 * ACHIEVEMENTS — what replaced the sticker book.
 *
 * "dude i still see all the goofy sticker stuff etc (add achivements tho)"
 * — the owner. v57 removes the last of the sticker book (fun.js); this is
 * what came in its place: 30-odd achievements, named and iconned like a
 * console or Steam game's, a calm small toast when one unlocks, and an
 * Achievements page off the main menu with progress bars for the ones that
 * count towards something.
 *
 * Everything here reads events the game ALREADY fires — a touchdown, a
 * lift-off, the carrier's wire, a mission finishing, the top of the sky
 * (aircraft/physics.js's own new event), a flight or a drive starting
 * (game/extensions.js's own `startMode` hook) — plus a couple of accessors
 * other features already export for exactly this kind of reading
 * (features/race.js's raceState(), the multiplayer singleton's own roster).
 * Nothing here changes what flying, a mission or a race actually do; it only
 * watches, and it is fenced off from the game the same way every other
 * plug-in is: a throw in here is logged once and swallowed, never thrown on.
 *
 * rules.js is the pure logic (tests/features/achievements.mjs runs it with
 * no game at all); this file is the wiring — the plug-in registration, the
 * note*() functions main.js's existing event handlers call, and the toast +
 * page UI (ui.js).
 */

import { registerExtension } from '../../game/extensions.js';
import * as Store from './store.js';
import { applyEvent } from './rules.js';
import { ACHIEVEMENTS, ACHIEVEMENTS_BY_ID } from './data.js';
import { addMenuButton, buildAchievementsScreen, showUnlockToast } from './ui.js';
import * as PROG from '../../game/progression.js';
import { raceState } from '../race.js';
import { results as raceResults } from '../race/rules.js';
import { multiplayer } from '../multiplayer.js';

const FT = 3.28084;
// The owner's own teleport for trying this out stays well under the sky's
// real top (70,000 ft, aircraft/physics.js) — on purpose, so even a
// shortcut never lets the one checking it skip past what the ceiling does.
const OWNER_TEST_CAP_FT = 50000;

const A = {
  store: null,
  screen: null,
  pollT: 0,
};

function ensure() {
  if (!A.store) A.store = Store.load();
  return A.store;
}

/**
 * One event in; whatever newly unlocked gets a toast and a save. Never
 * throws — an achievements bug must never be the reason a flight, a mission
 * or a race stops working.
 */
function note(sim, type, payload) {
  try {
    const store = ensure();
    const unlocked = applyEvent(store, type, payload || {});
    if (!unlocked.length) return;
    Store.save(store);
    for (const id of unlocked) {
      const def = ACHIEVEMENTS_BY_ID.get(id);
      if (def && sim && sim.hud) showUnlockToast(sim.hud, def);
    }
    if (A.screen && typeof A.screen.render === 'function') A.screen.render();
  } catch (e) {
    console.error('[achievements] a check threw and was switched off for this one event:', e);
  }
}

function openScreen(sim) {
  if (!A.screen) return;
  try {
    A.screen.render();
  } catch (e) {
    console.warn('[achievements] the page could not draw:', e);
  }
  sim.menus.show('achievements');
  if (sim.audio && sim.audio.available && sim.audio.alerts && sim.audio.alerts.uiClick) sim.audio.alerts.uiClick();
}

/* ------------------------------------------------------------------ *
 * Called from main.js's own existing event handlers. Each one is a single
 * extra line dropped into a handler that was already there — see the
 * header for exactly which ones.
 * ------------------------------------------------------------------ */

/** main.js's EVENTS.LIFTOFF handler. */
export function noteLiftoff(sim, d) {
  note(sim, 'liftoff', {
    aircraft: sim.aircraftType && sim.aircraftType.id,
    speedKts: d && d.speedKts,
  });
}

/**
 * main.js's EVENTS.TOUCHDOWN handler, non-crash path only (the caller
 * already returns before this on a crashed landing — see `if (g.crashed)
 * return;` there — but this checks again, because rules.js's own node test
 * calls it the same way with no caller to rely on).
 *
 * `extra` carries what main.js already has in scope and this file should not
 * have to re-derive: the crosswind component (weather.windDescription(), the
 * same reading the "Wind on the nose" panel uses), and whether it is night
 * or rough weather.
 */
export function noteTouchdown(sim, g, extra = {}) {
  if (!g || g.crashed) return;
  note(sim, 'touchdown', {
    vsFpm: g.vsFpm,
    onRunway: g.onRunway,
    aircraft: sim.aircraftType && sim.aircraftType.id,
    map: sim.settings && sim.settings.map,
    crosswindKts: extra.crosswindKts || 0,
    night: !!extra.night,
    stormy: !!extra.stormy,
  });
}

/** main.js's EVENTS.ARRESTED handler: the carrier's wire. */
export function noteArrested(sim) {
  note(sim, 'arrested', {});
}

/** main.js's new EVENTS.CEILING handler: the top of the sky. */
export function noteCeiling(sim) {
  note(sim, 'ceiling', {});
}

/**
 * main.js's onMissionComplete(result). `payload.afo` is 'captain' |
 * 'president' | null — main.js works that out from the flown mission's own
 * roleId, which it already reads for the payout.
 */
export function noteMissionComplete(sim, payload) {
  note(sim, 'missionComplete', payload || {});
}

/** features/rocket.js's start(): the one place a rocket flight begins. */
export function noteRocketStart(sim) {
  note(sim, 'rocketStart', {});
}

/* ------------------------------------------------------------------ *
 * The plug-in
 * ------------------------------------------------------------------ */

registerExtension({
  id: 'achievements',

  install(sim) {
    A.store = Store.load();
    addMenuButton(sim.menus, () => openScreen(sim));
    A.screen = buildAchievementsScreen(sim.menus, {
      list: ACHIEVEMENTS,
      model: () => ({ store: ensure() }),
    });
  },

  /** A flight or a drive has just started: the helicopter, the boat, the car. */
  startMode(sim, mode, opts) {
    try {
      if (mode === 'drive') {
        const kind = opts && opts.kind;
        if (kind === 'car' || kind === 'boat') note(sim, 'startMode', { game: kind });
      } else {
        const t = sim.aircraftType;
        const isHeli = !!(t && t.shape && t.shape.power && t.shape.power.rotor);
        if (isHeli) note(sim, 'startMode', { game: 'heli' });
      }
    } catch (e) {
      console.error('[achievements] startMode threw and was ignored:', e);
    }
  },

  /**
   * Once a second, not every frame: a rank read, the multiplayer roster's
   * size, and whether this flight just won a race. Three cheap reads of
   * state the game already keeps — nothing here touches the DOM unless one
   * of them actually unlocks, and that is the toast, not a per-frame cost.
   */
  update(sim, dt) {
    A.pollT -= dt;
    if (A.pollT > 0) return;
    A.pollT = 1;
    try {
      if (sim.prog) note(sim, 'rank', { rank: PROG.rankFor(sim.prog).id });
      const roster = multiplayer && multiplayer.remotes && multiplayer.remotes.players;
      if (roster) note(sim, 'friends', { count: roster.size });
      if (roster && roster.size > 0) {
        const st = raceState();
        if (st) {
          const rows = raceResults(st);
          if (rows.length > 1) {
            const mine = multiplayer.meId != null ? multiplayer.meId : 0;
            const me = rows.find((r) => r.id === mine);
            if (me && me.place === 1) note(sim, 'raceWin', {});
          }
        }
      }
    } catch (e) {
      console.error('[achievements] the once-a-second check threw and was ignored:', e);
    }
  },

  devActions: [
    {
      label: `Climb to ${OWNER_TEST_CAP_FT.toLocaleString()} ft (test)`,
      hint: "A quick jump to see how the top of the sky feels — capped well under the real 70,000 ft ceiling on purpose.",
      run(sim) {
        const ac = sim.aircraft;
        if (!ac) return;
        ac.pos.y = OWNER_TEST_CAP_FT / FT;
        if (ac.vel.y < 0) ac.vel.y = 0;
        if (sim.hud) sim.hud.notify(`Jumped to ${OWNER_TEST_CAP_FT.toLocaleString()} ft.`, 'info', 3);
      },
    },
  ],
});

/** For the tests and the console. */
export const __test = { note, ensure, A, openScreen };
