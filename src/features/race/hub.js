/**
 * The Races card — every race in the game, which vehicle each is for and
 * which island it is on, and the one for YOUR vehicle on THIS island first.
 *
 * Two places show it:
 *   - in free play, alone (flying, the helicopter, the car or the boat): the
 *     🏁 button over the controls. On an island with a race for what you are
 *     in it says so ("🏁 Race the streets") and starts it; the "All races"
 *     button next to it — or, anywhere else, "🏁 Races" — opens this card;
 *   - the Multiplayer screen: the card that was the Ring Rally's lists all
 *     four, each with "Race alone" and "Pick <island> for a private match"
 *     (which picks the ride for it too — a car race needs the car).
 *
 * No free text anywhere: every word here is the game's own.
 */

import * as RR from './rules.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const HUB_CSS = `
.race-hub { position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%); z-index: 34; pointer-events: auto; width: min(460px, calc(100vw - 32px));
  max-height: calc(100vh - 40px); overflow-y: auto; padding: 16px 18px; border-radius: 16px; background: rgba(10, 17, 30, 0.95); border: 1px solid var(--panel-line);
  box-shadow: var(--shadow); color: #fff; font-family: var(--font), sans-serif; box-sizing: border-box; }
.race-hub[hidden] { display: none !important; }
.race-hub h3 { margin: 0 0 6px; font-size: 20px; }
.race-hub .race-hub-here { margin: 0 0 12px; padding: 10px 12px; border-radius: 12px; background: rgba(255, 210, 63, 0.12); border: 1px solid rgba(255, 210, 63, 0.45); }
.race-hub .race-hub-here p { margin: 0 0 8px; font-size: 14px; line-height: 1.35; }
.race-hub ul, .mp-racecard ul.race-list { list-style: none; margin: 0 0 12px; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.race-hub li, .mp-racecard .race-list li { display: grid; grid-template-columns: 30px minmax(0, 1fr) auto; gap: 4px 10px; align-items: center; padding: 8px 10px; border-radius: 12px; background: rgba(255,255,255,0.05); }
.race-hub li.is-mine, .mp-racecard .race-list li.is-mine { background: rgba(88, 198, 255, 0.16); box-shadow: inset 0 0 0 1px rgba(88, 198, 255, 0.45); }
.race-hub li > span, .mp-racecard .race-list li > span { font-size: 22px; text-align: center; }
.race-hub li b, .mp-racecard .race-list li b { display: block; font-weight: 700; font-size: 14.5px; }
.race-hub li small, .mp-racecard .race-list li small { display: block; font-size: 12px; color: var(--text-dim); line-height: 1.3; }
.race-hub li small em, .mp-racecard .race-list li small em { font-style: normal; color: #ffd23f; font-weight: 700; }
.race-hub button, .race-solobar button { font: 650 14px var(--font), sans-serif; padding: 8px 14px; border-radius: 10px; cursor: pointer; border: 1px solid var(--panel-line);
  background: rgba(255,255,255,0.08); color: #fff; min-height: 40px; }
.race-hub button.primary { background: var(--accent); color: #0b1220; border-color: var(--accent); }
.race-hub .race-btns { display: flex; gap: 8px; justify-content: flex-end; }
.mp-racecard .race-list .race-list-btns { grid-column: 2 / 4; display: flex; gap: 6px; flex-wrap: wrap; }
/* Top right, under the wind: bottom centre is the van's turn arrow's ("nothing else is allowed to live there", main.css). */
.race-solobar { position: fixed; right: 16px; top: 112px; z-index: 30; pointer-events: auto; display: flex; flex-direction: column; align-items: flex-end; gap: 6px; }
.race-solobar[hidden] { display: none !important; }
.race-solobar button { background: rgba(10, 17, 30, 0.82); white-space: nowrap; }
.race-solobar button.race-solo-main { background: rgba(255, 210, 63, 0.9); color: #1b1030; border-color: #ffd23f; }
.race-solobar button[hidden] { display: none; }
.race-solobar button.race-solo-leave { font-size: 12.5px; min-height: 34px; padding: 5px 12px; opacity: 0.85; }
`;

const GAME_NAME = { flight: 'an aeroplane', heli: 'the Skyhook', car: 'the car', boat: 'the boat' };

/** A course's one-line description: who it is for, where, how long. */
function aboutLine(c) {
  const w = RR.VEHICLE_WORDS[c.vehicle];
  const gates = c.rings.length;
  const word = c.style === 'buoys' ? 'pairs of buoys' : c.style === 'road' ? 'gates' : c.style === 'hoops' ? 'hoops' : 'rings';
  return `For ${w.for} · on ${c.island} · ${RR.lapsWord(c)}, ${gates} ${word}`;
}

/**
 * What the in-game card says about THIS island and THIS vehicle, and the one
 * button for it: { line, button, courseId }.
 */
export function hereLine(api) {
  const here = api.here();
  const game = api.game();
  const island = api.islandName();
  if (here && RR.rideFits(here, game)) {
    return { line: `You’re on ${esc(island)} in ${GAME_NAME[game] || 'your ride'} — the <b>${esc(here.name)}</b> is right here.`, button: '🏁 Race now', courseId: here.id, now: true };
  }
  if (here) {
    return { line: `<b>${esc(RR.switchLine(here))}.</b> The ${esc(here.name)} on ${esc(island)} is for ${esc(RR.VEHICLE_WORDS[here.vehicle].for)}.`, button: `Switch to ${RR.VEHICLE_WORDS[here.vehicle].switchTo} and race`, courseId: here.id };
  }
  const mine = RR.courseForGame(game);
  if (mine) return { line: `No race on ${esc(island)}. The race for ${GAME_NAME[game] || 'your ride'} is the <b>${esc(mine.name)}</b>, on ${esc(mine.island)}.`, button: `Go to ${mine.island} and race`, courseId: mine.id };
  return { line: `No race on ${esc(island)} — pick one below.`, button: null, courseId: null };
}

/** The four rows: yours first. `buttons(c)` gives each row's buttons' HTML. */
function rows(api, buttons) {
  const game = api.game();
  const mine = RR.courseForGame(game);
  const list = RR.COURSES.slice().sort((a, b) => (b === mine) - (a === mine));
  return list.map((c) => {
    const best = api.best(c);
    const isMine = c === mine;
    return `<li class="${isMine ? 'is-mine' : ''}" data-race-row="${esc(c.id)}"><span aria-hidden="true">${c.emoji}</span>`
      + `<div><b>${esc(c.name)}</b><small>${esc(aboutLine(c))}${isMine ? ' · <em>your ride</em>' : ''}</small>${best ? `<small>Your best on this device: ${RR.fmtTime(best)}</small>` : ''}</div>`
      + `${buttons(c)}</li>`;
  }).join('');
}

/* ---- in free play ---------------------------------------------------------------------------------- */

export function buildHub(layer, api) {
  const el = document.createElement('div');
  el.className = 'race-hub';
  el.hidden = true;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Races');
  el.addEventListener('click', (e) => {
    const t = e.target;
    if (t.closest('[data-race-hub-close]')) {
      el.hidden = true;
      return;
    }
    const go = t.closest('[data-race-go]');
    if (go) {
      el.hidden = true;
      api.go(go.dataset.raceGo);
    }
  });
  layer.appendChild(el);
  return {
    el,
    open() {
      const h = hereLine(api);
      const here = api.here();
      el.innerHTML = `<h3>🏁 Races — one for every ride</h3>`
        + `<div class="race-hub-here" data-race-here><p>${h.line}</p>${h.button ? `<button type="button" class="primary" data-race-go="${esc(h.courseId)}">${esc(h.button)}</button>` : ''}</div>`
        + `<ul>${rows(api, (c) => (here === c && RR.rideFits(c, api.game()) ? '' : `<button type="button" data-race-go="${esc(c.id)}" title="${esc(`Go to ${c.island} in ${RR.VEHICLE_WORDS[c.vehicle].one} and race`)}">Race it</button>`))}</ul>`
        + '<div class="race-btns"><button type="button" data-race-hub-close>Close</button></div>';
      el.hidden = false;
    },
    close() {
      el.hidden = true;
    },
  };
}

/* ---- the Multiplayer screen ------------------------------------------------------------------------ */

const RIDE_FOR = { plane: null, car: 'car:car', boat: 'boat:boat', heli: 'heli:harrier' };

/**
 * The Multiplayer screen's race card, made into the Races card. The Ring
 * Rally's two buttons keep the attributes the screen already answers
 * (data-mp-race-alone, data-mp-race-pick); the other three are ours.
 */
export function mountLobbyCard(section, api) {
  const card = section.querySelector('.mp-racecard');
  if (!card || card.dataset.races) return null;
  card.dataset.races = '1';
  const head = card.previousElementSibling;
  if (head && /Ring Rally/.test(head.textContent)) head.textContent = 'Races — one for every ride';
  const paint = () => {
    card.innerHTML = '<p class="hint">Every ride has a race, on its own island. In any lobby or private match on that island, tap <b>🏁 Race</b> on the badge and everybody in that ride goes on the grid — 3, 2, 1, GO! Or race alone against the clock.</p>'
      + `<ul class="race-list">${rows(api, (c) => {
        const ring = c.id === RR.COURSE.id;
        return `<div class="race-list-btns"><button type="button" class="primary" ${ring ? 'data-mp-race-alone' : `data-race-alone="${esc(c.id)}"`}>🏁 Race alone</button>`
          + `<button type="button" class="ghost" ${ring ? 'data-mp-race-pick' : `data-race-pick="${esc(c.id)}"`}>Pick ${esc(c.island)} for a private match</button></div>`;
      })}</ul>`;
  };
  paint();
  card.addEventListener('click', (e) => {
    const t = e.target;
    // The Ring Rally's pick is the screen's own (it picks Coral Atoll), and it wants a plane or the
    // helicopter as the ride: somebody whose ride is the car or the boat gets their plane picked first,
    // rather than "races are in the air" — they are not, all of them, any more.
    if (t.closest('[data-mp-race-pick]')) {
      const game = api.game();
      if (game !== 'flight' && game !== 'heli') {
        const plane = section.querySelector('[data-mp-ride^="flight:"]');
        if (plane) plane.click();
      }
      setTimeout(paint, 0);
      return;
    }
    const alone = t.closest('[data-race-alone]');
    if (alone) {
      e.stopPropagation();
      api.go(alone.dataset.raceAlone);
      return;
    }
    const pick = t.closest('[data-race-pick]');
    if (pick) {
      e.stopPropagation();
      const c = RR.courseById(pick.dataset.racePick);
      const want = RIDE_FOR[c.vehicle];
      const rideBtn = want && section.querySelector(`[data-mp-ride="${want}"]`);
      if (rideBtn) rideBtn.click();
      const tile = section.querySelector(`[data-mp-private-map="${c.map}"]`);
      if (tile) tile.click();
      const make = section.querySelector('[data-mp-private]');
      if (make && make.scrollIntoView) make.scrollIntoView({ block: 'center' });
      api.status(tile ? `${c.island} is picked, and ${RR.VEHICLE_WORDS[c.vehicle].one} is your ride — make your private match, and tell your friends the code.` : `Pick ${RR.VEHICLE_WORDS[c.vehicle].one} as your ride first — the ${c.name} is for ${RR.VEHICLE_WORDS[c.vehicle].for}.`, tile ? 'good' : 'warn');
      paint();
    }
  });
  // A different ride picked on the screen moves "your ride" to its race.
  section.addEventListener('click', (e) => {
    if (e.target.closest('[data-mp-ride]')) setTimeout(paint, 0);
  });
  return { card, paint };
}
