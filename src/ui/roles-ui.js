/**
 * "Fly as: ( The 747 captain | The lead fighter )" — one calm control on the
 * card of each mission that has seats.
 *
 * A decorator, the way game-ui.js changes the menus: it finds the mission
 * cards menus.js already built and adds one small block above each card's
 * foot. Nothing in menus.js is edited, so the menus declutter pass can
 * rebuild the cards however it likes; if a card it looks for is not there,
 * nothing is added and that mission simply plays its default seat.
 *
 * One tap picks a seat (setRole, in memory: a reload is back to the default).
 * "Fly this mission" then starts it from that seat — main.js reads the
 * choice in startMode — and "Fly again" and "Try again" keep it.
 *
 * mountRoleChooser(el, mission, sim) is exported for whatever hosts it next
 * (a briefing panel), so the same control can live there.
 */

import { MISSIONS } from '../game/missions.js';
import { rolesOf, roleLabel, currentRole, setRole, defaultRoleId, roleRecord } from '../game/roles/roles.js';

const CSS = `
.role-pick { display: flex; flex-direction: column; gap: 6px; margin-top: 2px; }
.role-pick-head { font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-dim, #9fb2cc); }
.role-seg {
  display: flex; gap: 3px; padding: 3px; border-radius: 11px;
  background: rgba(255, 255, 255, 0.05); border: 1px solid var(--panel-line, rgba(140, 180, 230, 0.18));
}
.role-seg button {
  flex: 1 1 0; min-width: 0; min-height: 36px; padding: 6px 8px; border: 0; border-radius: 8px;
  background: transparent; color: var(--text-dim, #9fb2cc); font: inherit; font-size: 13px; line-height: 1.2;
  cursor: pointer; transition: background 0.15s, color 0.15s;
}
.role-seg button:hover { color: var(--text, #eaf1fb); }
.role-seg button.is-on {
  background: rgba(88, 198, 255, 0.16); color: var(--text, #eaf1fb);
  box-shadow: inset 0 0 0 1px rgba(88, 198, 255, 0.45);
}
.role-seg button:focus-visible { outline: 2px solid var(--accent, #58c6ff); outline-offset: 1px; }
.role-line { margin: 0 !important; font-size: 12.5px !important; line-height: 1.4; color: var(--text-dim, #9fb2cc) !important; }
.role-line b { color: var(--text, #eaf1fb); font-weight: 600; }
`;

function addCss() {
  if (typeof document === 'undefined' || document.getElementById('roles-ui-css')) return;
  const s = document.createElement('style');
  s.id = 'roles-ui-css';
  s.textContent = CSS;
  document.head.appendChild(s);
}

function lineFor(mission, seat, sim) {
  const rec = sim && sim.progress ? roleRecord(sim.progress, mission, seat.id) : null;
  const best = rec && rec.complete ? ` <b>Best ${rec.bestScore}/100.</b>` : '';
  const esc = (t) => String(t || '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  return `${esc(seat.line)}${best}`;
}

/** Build the control into `el` (replacing what is there). Returns a refresh function. */
export function mountRoleChooser(el, mission, sim) {
  const seats = rolesOf(mission);
  if (!el || !seats.length) return () => {};
  el.classList.add('role-pick');
  el.dataset.rolePick = mission.id;
  el.innerHTML = '';
  const head = document.createElement('span');
  head.className = 'role-pick-head';
  head.id = `role-head-${mission.id}`;
  head.textContent = 'Fly as';
  const seg = document.createElement('div');
  seg.className = 'role-seg';
  seg.setAttribute('role', 'radiogroup');
  seg.setAttribute('aria-labelledby', head.id);
  const line = document.createElement('p');
  line.className = 'role-line';
  line.setAttribute('data-role-line', '');
  const buttons = seats.map((seat) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.dataset.role = seat.id;
    b.textContent = roleLabel(seat);
    seg.appendChild(b);
    return b;
  });
  el.append(head, seg, line);

  const refresh = () => {
    const pick = currentRole(mission.id) || defaultRoleId(mission);
    let on = seats.find((s) => s.id === pick) || seats[0];
    for (let i = 0; i < seats.length; i++) {
      const sel = seats[i] === on;
      buttons[i].classList.toggle('is-on', sel);
      buttons[i].setAttribute('aria-checked', sel ? 'true' : 'false');
      buttons[i].tabIndex = sel ? 0 : -1;
      // Labels can depend on what loaded (which airliner), so they are read again.
      buttons[i].textContent = roleLabel(seats[i]);
    }
    line.innerHTML = lineFor(mission, on, sim);
    on = null;
  };

  const choose = (seatId) => {
    setRole(mission.id, seatId === defaultRoleId(mission) ? null : seatId);
    refresh();
  };
  seg.addEventListener('click', (e) => {
    const b = e.target && e.target.closest ? e.target.closest('[data-role]') : null;
    if (!b) return;
    e.stopPropagation();
    choose(b.dataset.role);
    if (sim && sim.audio && sim.audio.available && sim.audio.alerts && sim.audio.alerts.uiClick) {
      try {
        sim.audio.alerts.uiClick();
      } catch (err) {
        /* a click sound is not worth a failure */
      }
    }
  });
  // Arrow keys move along the group, the way a radio group does.
  seg.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const i = Math.max(0, seats.findIndex((s) => s.id === (currentRole(mission.id) || defaultRoleId(mission))));
    const j = (i + (e.key === 'ArrowRight' ? 1 : seats.length - 1)) % seats.length;
    choose(seats[j].id);
    buttons[j].focus();
    e.preventDefault();
    e.stopPropagation();
  });
  refresh();
  return refresh;
}

/** Decorate every mission card that has seats. Safe to call twice. */
export function installRolesUi(sim) {
  const menus = sim && sim.menus;
  const screen = menus && menus.screens && menus.screens.missions;
  if (!screen || typeof document === 'undefined' || menus._rolesUi) return;
  menus._rolesUi = true;
  addCss();
  const refreshers = [];
  for (const m of MISSIONS) {
    if (!rolesOf(m).length) continue;
    const card = screen.querySelector(`[data-mission="${m.id}"]`);
    if (!card) continue;
    const el = document.createElement('div');
    const foot = card.querySelector('.mission-foot');
    if (foot && foot.parentNode === card) card.insertBefore(el, foot);
    else card.appendChild(el);
    refreshers.push(mountRoleChooser(el, m, sim));
  }
  const refreshAll = () => {
    for (const f of refreshers) f();
  };
  // Records change when a seat is finished; the choice can change from the
  // console or a test. Both are shown again whenever the board is.
  const innerProgress = menus.syncProgress;
  if (typeof innerProgress === 'function') {
    menus.syncProgress = function (...args) {
      const out = innerProgress.apply(this, args);
      try {
        refreshAll();
      } catch (e) {
        console.warn('[roles] could not refresh the seat choosers', e);
      }
      return out;
    };
  }
  const innerShow = menus.show;
  if (typeof innerShow === 'function') {
    menus.show = function (name, ...rest) {
      const out = innerShow.call(this, name, ...rest);
      if (name === 'missions') {
        try {
          refreshAll();
        } catch (e) {
          console.warn('[roles] could not refresh the seat choosers', e);
        }
      }
      return out;
    };
  }
  menus.refreshRoles = refreshAll;
}
