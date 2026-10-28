/**
 * Settings → Controls → Controllers: the sim gear's own page.
 *
 * Every connected device by name, with live meters for its axes and buttons;
 * the profile it is using (built in, matched by its id — or the player's
 * choice); and, for sim gear, the assignments: "Assign" and move the lever
 * you want for that job, invert, deadzone, curve, the Airbus detents on a
 * thrust lever (and setting each one where the lever clicks), calibration,
 * and the buttons — pick an action, "Press the button". Everything is saved
 * per device (flight/controllers.js) and "Reset to defaults" puts the
 * profile back.
 *
 * The meters run on a timer while the page is on screen, reading the devices
 * themselves (Controllers.scan(), which never presses an action), so they
 * move in the pause menu as well as from the main menu.
 */

import {
  AXIS_ROLES, ROLE, PROFILES, STANDARD_PROFILE, CUSTOM_PROFILE, NONE_PROFILE, matchProfile, shapeAxis, airbusThrust,
  bindableActions, actionLabel,
} from '../flight/controllers.js';
import { isKey } from '../flight/input.js';

const PANEL_CSS = `
.ctl { border: 1px solid var(--panel-line); border-radius: 12px; padding: 12px 14px; margin: 0 0 16px; background: rgba(255,255,255,.03); }
.ctl h3 { margin: 0 0 4px; font-size: 13px; letter-spacing: .08em; text-transform: uppercase; color: var(--accent); display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.ctl h3 small { font-size: 11px; letter-spacing: .02em; text-transform: none; color: var(--text-dim); font-weight: 600; }
.ctl-hint { margin: 4px 0 8px; font-size: 12.5px; color: var(--text-dim); }
.ctl-hint b { color: var(--text); }
.ctl-status { margin: 6px 0; padding: 8px 10px; border-radius: 9px; background: rgba(88,198,255,.12); border: 1px solid rgba(88,198,255,.45); font-size: 13px; display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.ctl-status[hidden] { display: none; }
.ctl-dev { border-top: 1px solid var(--panel-line); padding: 10px 0 6px; }
.ctl-dev-head { display: flex; flex-wrap: wrap; gap: 6px 14px; align-items: center; justify-content: space-between; }
.ctl-dev-head b { font-size: 14px; }
.ctl-dev-head small { color: var(--text-dim); font-size: 11px; display: block; }
.ctl-active { font-size: 11px; color: var(--accent-2); border: 1px solid currentColor; border-radius: 999px; padding: 1px 8px; }
.ctl-dev select, .ctl-buttons select { max-width: 100%; font-size: 12px; }
.ctl-raw { display: flex; flex-wrap: wrap; gap: 4px 6px; margin: 8px 0 4px; align-items: center; }
.ctl-ax { position: relative; width: 74px; height: 16px; border-radius: 5px; background: rgba(255,255,255,.07); overflow: hidden; font: 600 9.5px/16px var(--mono, monospace); color: var(--text-dim); }
.ctl-ax i { position: absolute; top: 0; bottom: 0; left: 50%; width: 2px; background: var(--accent); }
.ctl-ax em { position: relative; font-style: normal; padding-left: 4px; }
.ctl-b { min-width: 18px; height: 16px; border-radius: 5px; background: rgba(255,255,255,.07); font: 600 9.5px/16px var(--mono, monospace); text-align: center; color: var(--text-dim); padding: 0 3px; }
.ctl-b.is-on { background: var(--accent-2); color: #08131f; }
.ctl-note { font-size: 11.5px; color: var(--text-dim); margin: 4px 0 6px; }
.ctl-roles { width: 100%; border-collapse: collapse; font-size: 12px; }
.ctl-roles td { padding: 3px 4px; vertical-align: middle; border-top: 1px solid rgba(255,255,255,.04); }
.ctl-roles td:first-child { width: 34%; }
.ctl-roles .ctl-axname { font-family: var(--mono, monospace); color: var(--text-dim); white-space: nowrap; }
.ctl-roles button, .ctl-dev button, .ctl-buttons button { font-size: 11.5px; padding: 3px 9px; }
.ctl-opts { display: flex; flex-wrap: wrap; gap: 4px 10px; align-items: center; }
.ctl-opts label { display: inline-flex; gap: 4px; align-items: center; font-size: 11px; color: var(--text-dim); }
.ctl-opts input[type=range] { width: 64px; }
.ctl-meter { display: inline-block; width: 70px; height: 8px; border-radius: 4px; background: rgba(255,255,255,.08); position: relative; overflow: hidden; vertical-align: middle; }
.ctl-meter i { position: absolute; top: 0; bottom: 0; left: 0; width: 0; background: var(--accent); }
.ctl-meter.is-centre i { left: 50%; }
.ctl-val { font: 600 10.5px var(--mono, monospace); margin-left: 4px; display: inline-block; min-width: 54px; }
.ctl-det { font-size: 11px; display: flex; gap: 4px 8px; flex-wrap: wrap; align-items: center; color: var(--text-dim); }
.ctl-buttons { margin: 8px 0 4px; font-size: 12px; }
.ctl-buttons ul { list-style: none; padding: 0; margin: 4px 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 2px 12px; }
.ctl-buttons li { display: flex; justify-content: space-between; gap: 6px; align-items: center; }
.ctl-buttons .ctl-new { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
.ctl-tools { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 6px; }
@media (max-width: 640px) {
  .ctl-roles, .ctl-roles tbody, .ctl-roles tr, .ctl-roles td { display: block; width: 100% !important; }
  .ctl-roles tr { padding: 4px 0; border-top: 1px solid rgba(255,255,255,.06); }
  .ctl-roles td { border: 0; padding: 1px 0; }
}
`;

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const pct = (v) => `${Math.round(v * 100)}%`;

/** What a role reads now, as words for its meter: "CL 88%", "REV 40%", "-0.25". */
export function roleReadout(role, value, cfg) {
  if (value === null || value === undefined) return '—';
  if (ROLE[role].kind === 'centre') return (value >= 0 ? '+' : '') + value.toFixed(2);
  if (cfg && cfg.detents) {
    const r = airbusThrust(value, cfg.detents);
    if (r.detent === 'REV') return `REV ${pct(r.reverse)}`;
    if (r.detent === 'MAN') return pct(r.thrust);
    return `${r.detent} ${pct(r.thrust)}`;
  }
  return pct(value);
}

/**
 * Mount the page in `host` (Settings' [data-controllers]). Returns
 * { render, tick, destroy, el } — tick() is what the timer calls, exposed
 * for the browser check.
 */
export function mountControllersPanel(host, controllers) {
  if (!host || !controllers || typeof document === 'undefined') return null;
  if (!document.getElementById('ctl-css')) {
    const st = document.createElement('style');
    st.id = 'ctl-css';
    st.textContent = PANEL_CSS;
    document.head.appendChild(st);
  }
  const C = controllers;
  const supported = typeof navigator !== 'undefined' && !!navigator.getGamepads;
  host.innerHTML = `
    <section class="ctl" data-ctl>
      <h3>Controllers <small data-ctl-count></small></h3>
      <p class="ctl-hint" data-ctl-hint>${supported
        ? '<b>Press any button on your controls</b> — the browser (Chrome, Safari and Firefox on a Mac, and every other) only shows a controller after a button on it has been pressed. Sidesticks, yokes, throttle quadrants and rudder pedals each show up here on their own.'
        : 'This browser cannot read game controllers. Chrome, Edge, Safari and Firefox can.'}</p>
      <div class="ctl-status" data-ctl-status hidden><span data-ctl-status-text></span><button class="ghost" type="button" data-ctl-cancel>Cancel</button></div>
      <div data-ctl-devices></div>
      <div class="ctl-tools"><button class="ghost" type="button" data-ctl-reset-all>Reset all controllers</button></div>
    </section>`;
  const root = host.querySelector('[data-ctl]');
  const list = host.querySelector('[data-ctl-devices]');
  const statusEl = host.querySelector('[data-ctl-status]');
  const statusText = host.querySelector('[data-ctl-status-text]');
  const countEl = host.querySelector('[data-ctl-count]');
  const ACTION_OPTIONS = () => bindableActions();
  let shownKeys = '';
  let shownVer = -1;
  let statusMode = null; // 'detect' | 'calib' | 'note'
  let noteT = 0;

  const say = (text, mode = 'note') => {
    statusMode = text ? mode : null;
    statusEl.hidden = !text;
    statusText.textContent = text || '';
    const cancel = statusEl.querySelector('[data-ctl-cancel]');
    cancel.textContent = mode === 'calib' ? 'Done' : mode === 'note' ? 'OK' : 'Cancel';
    noteT = mode === 'note' ? 6 : 0;
  };

  const profileOptions = (d) => {
    const auto = matchProfile(d.id, d.mapping, d.buttons.length);
    const cur = C.saved[d.key] && C.saved[d.key].profile && C.saved[d.key].profile !== 'auto' ? C.saved[d.key].profile : 'auto';
    const opts = [['auto', `Automatic — ${auto.name}`], ...PROFILES.map((p) => [p.id, p.name]), [STANDARD_PROFILE.id, STANDARD_PROFILE.name], [CUSTOM_PROFILE.id, CUSTOM_PROFILE.name], [NONE_PROFILE.id, NONE_PROFILE.name]];
    return opts.map(([v, l]) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(l)}</option>`).join('');
  };

  const roleRow = (d, r) => {
    const a = d.cfg.axes[r.id];
    const has = !!a;
    const missing = has && !(a.axis < d.axes.length);
    const opts = has
      ? `<div class="ctl-opts">
          <label><input type="checkbox" data-ctl-opt="invert"${a.invert ? ' checked' : ''}> Invert</label>
          <label>Deadzone <input type="range" min="0" max="0.3" step="0.01" value="${a.deadzone || 0}" data-ctl-opt="deadzone"></label>
          <label>Curve <input type="range" min="0" max="1" step="0.05" value="${a.curve || 0}" data-ctl-opt="curve"></label>
        </div>`
      : '';
    const det = has && r.detents
      ? `<div class="ctl-det">
          <label><input type="checkbox" data-ctl-opt="detents"${a.detents ? ' checked' : ''}> Airbus detents</label>
          ${a.detents ? `<label><input type="checkbox" data-ctl-opt="reverse"${a.detents.rev !== false ? ' checked' : ''}> Reverse below idle</label>
          <span>Set where the lever clicks:</span>
          ${['idle', 'cl', 'flx', 'toga'].map((w) => `<button class="ghost" type="button" data-ctl-detent="${w}">${w === 'flx' ? 'FLX/MCT' : w.toUpperCase()}</button>`).join('')}` : ''}
        </div>`
      : '';
    return `<tr data-role="${r.id}">
      <td>${esc(r.label)}</td>
      <td class="ctl-axname">${has ? `Axis ${a.axis}${missing ? ' (not on this device)' : ''}` : '—'}</td>
      <td><button class="ghost" type="button" data-ctl-assign="${r.id}">Assign</button>${has ? ` <button class="ghost" type="button" data-ctl-clear="${r.id}" aria-label="Clear ${esc(r.label)}">✕</button>` : ''}</td>
      <td>${opts}${det}</td>
      <td><span class="ctl-meter${r.kind === 'centre' ? ' is-centre' : ''}"><i data-ctl-meter="${r.id}"></i></span><span class="ctl-val" data-ctl-val="${r.id}">—</span></td>
    </tr>`;
  };

  const deviceCard = (d) => {
    const cfg = d.cfg;
    const changed = !!(C.saved[d.key] && (C.saved[d.key].axes || C.saved[d.key].buttons));
    const ids = d.vendor ? `${d.vendor}:${d.product}` : 'no USB id';
    let body = '';
    if (cfg.mode === 'standard') {
      body = `<p class="ctl-note">${esc(STANDARD_PROFILE.notes)} To set its axes and buttons yourself, choose <b>${esc(CUSTOM_PROFILE.name)}</b> or one of the profiles above.</p>`;
    } else if (cfg.mode === 'off') {
      body = '<p class="ctl-note">The game is ignoring this device.</p>';
    } else {
      const buttons = Object.keys(cfg.buttons).sort((a, b) => a - b);
      body = `<p class="ctl-note">${esc(cfg.profile.notes || '')}</p>
        <table class="ctl-roles"><tbody>${AXIS_ROLES.map((r) => roleRow(d, r)).join('')}</tbody></table>
        <div class="ctl-buttons"><b>Buttons</b>
          <ul>${buttons.length ? buttons.map((i) => `<li data-ctl-button="${i}"><span>Button ${Number(i) + 1} → ${esc(actionLabel(cfg.buttons[i]))}</span><button class="ghost" type="button" data-ctl-unbind="${i}" aria-label="Clear button ${Number(i) + 1}">✕</button></li>`).join('') : '<li>No buttons bound yet.</li>'}</ul>
          <div class="ctl-new"><select data-ctl-action>${ACTION_OPTIONS().map((o) => `<option value="${esc(o.id)}">${esc(o.label)}</option>`).join('')}</select>
          <button class="ghost" type="button" data-ctl-bind>Press the button…</button></div>
        </div>`;
    }
    return `<div class="ctl-dev" data-dev="${esc(d.key)}">
      <div class="ctl-dev-head">
        <div><b>${esc(d.name)}</b><small>${esc(ids)} · ${d.axes.length} axes · ${d.buttons.length} buttons</small></div>
        <span class="ctl-active" data-ctl-active>Profile: ${esc(cfg.profile.name)}${cfg.auto ? ' (automatic)' : ''}${changed ? ' · changed by you' : ''}</span>
      </div>
      <div class="ctl-raw">${d.axes.map((v, i) => `<span class="ctl-ax" data-ax="${i}"><i></i><em>A${i}</em></span>`).join('')}
        ${d.buttons.map((b, i) => `<span class="ctl-b" data-b="${i}">${i + 1}</span>`).join('')}</div>
      <div class="ctl-opts"><label>Profile <select data-ctl-profile>${profileOptions(d)}</select></label>
        ${cfg.mode === 'mapped' ? '<button class="ghost" type="button" data-ctl-calibrate>Calibrate</button>' : ''}
        <button class="ghost" type="button" data-ctl-reset>Reset to defaults</button></div>
      ${body}
    </div>`;
  };

  function render() {
    const devs = C.devices;
    shownKeys = devs.map((d) => d.key).join('|');
    shownVer = C.version || 0;
    countEl.textContent = devs.length ? `${devs.length} connected` : 'none connected yet';
    list.innerHTML = devs.map(deviceCard).join('');
    meters();
  }

  function meters() {
    for (const d of C.devices) {
      const card = list.querySelector(`[data-dev="${typeof CSS !== "undefined" && CSS.escape ? CSS.escape(d.key) : d.key}"]`);
      if (!card) continue;
      d.axes.forEach((v, i) => {
        const el = card.querySelector(`[data-ax="${i}"] i`);
        if (el) el.style.left = `${Math.max(0, Math.min(100, (v + 1) * 50))}%`;
      });
      d.buttons.forEach((b, i) => {
        const el = card.querySelector(`[data-b="${i}"]`);
        if (el) el.classList.toggle('is-on', !!b.pressed);
      });
      if (d.cfg.mode !== 'mapped') continue;
      for (const r of AXIS_ROLES) {
        const m = card.querySelector(`[data-ctl-meter="${r.id}"]`);
        const t = card.querySelector(`[data-ctl-val="${r.id}"]`);
        if (!m || !t) continue;
        const v = C.roleValue(d, r.id);
        t.textContent = roleReadout(r.id, v, d.cfg.axes[r.id]);
        if (v === null) {
          m.style.width = '0';
          continue;
        }
        if (r.kind === 'centre') {
          m.style.left = v >= 0 ? '50%' : `${50 + v * 50}%`;
          m.style.width = `${Math.abs(v) * 50}%`;
        } else m.style.width = `${v * 100}%`;
      }
    }
  }

  /** The timer's step: read the devices, re-draw if they or their setup changed, else move the meters. */
  function tick(dt = 0.15) {
    if (!host.isConnected) return;
    // Hidden by a `hidden` attribute up the tree (every screen that is not
    // the one shown, Settings' other tabs): nothing to do, and no layout.
    // This used to ask getClientRects() seven times a second, which forces
    // a layout of the whole document whenever the menus have changed it —
    // 560 ms in one tick while the hangar opened, in the Tomm1z profile.
    const hiddenAbove = typeof host.closest === 'function' && host.closest('[hidden]');
    const visible = !hiddenAbove && (typeof document === 'undefined' || document.visibilityState !== 'hidden');
    if (!visible && !C.detecting && !C.calibrating) return;
    C.scan();
    const keys = C.devices.map((d) => d.key).join('|');
    if (keys !== shownKeys || (C.version || 0) !== shownVer) render();
    else meters();
    if (statusMode === 'detect' && !C.detecting) say(null);
    if (noteT > 0) {
      noteT -= dt;
      if (noteT <= 0 && statusMode === 'note') say(null);
    }
  }

  const devOf = (el) => {
    const card = el.closest('[data-dev]');
    return card ? C.devices.find((d) => d.key === card.dataset.dev) : null;
  };

  root.addEventListener('click', (e) => {
    const t = e.target;
    if (t.closest('[data-ctl-cancel]')) {
      if (statusMode === 'calib') {
        const n = C.finishCalibration();
        say(n ? `Calibrated ${n} axis${n === 1 ? '' : 'es'} — the ends and the centre are where you left them.` : 'Nothing moved far enough to calibrate. Move each axis end to end, then press Done.');
      } else if (statusMode === 'detect') {
        C.cancelDetect();
        say(null);
      } else say(null);
      return;
    }
    if (t.closest('[data-ctl-reset-all]')) {
      C.resetAll();
      say('Every controller is back on its built-in profile.');
      render();
      return;
    }
    const d = devOf(t);
    if (!d) return;
    const roleEl = t.closest('[data-role]');
    const role = roleEl ? roleEl.dataset.role : null;
    const assign = t.closest('[data-ctl-assign]');
    if (assign) {
      const r = assign.dataset.ctlAssign;
      say(`Move the lever or axis you want for "${ROLE[r].label}" — all the way, on any device.`, 'detect');
      C.detect('axis', (hit) => {
        if (hit) {
          C.assignAxis(hit.key, r, hit.index, hit.mapping);
          const dev = C.devices.find((x) => x.key === hit.key);
          say(`${ROLE[r].label}: axis ${hit.index} on ${dev ? dev.name : 'that device'}.`);
        } else say('Nothing moved — try Assign again and move it end to end.');
        render();
      });
      return;
    }
    if (t.closest('[data-ctl-clear]')) {
      C.assignAxis(d.key, t.closest('[data-ctl-clear]').dataset.ctlClear, null, d.mapping);
      render();
      return;
    }
    const det = t.closest('[data-ctl-detent]');
    if (det && role) {
      C.setDetentHere(d.key, role, det.dataset.ctlDetent, d.mapping);
      say(`${det.textContent} set where the lever is now.`);
      render();
      return;
    }
    if (t.closest('[data-ctl-bind]')) {
      const sel = t.closest('.ctl-dev').querySelector('[data-ctl-action]');
      const action = sel && sel.value;
      if (!action) return;
      say(`Press the button you want for "${actionLabel(action)}".`, 'detect');
      C.detect('button', (hit) => {
        if (hit) {
          C.bindButton(hit.key, hit.index, action, hit.mapping);
          say(`Button ${hit.index + 1} → ${actionLabel(action)}.`);
        } else say('No button was pressed — try again.');
        render();
      });
      return;
    }
    const unbind = t.closest('[data-ctl-unbind]');
    if (unbind) {
      C.bindButton(d.key, unbind.dataset.ctlUnbind, null, d.mapping);
      render();
      return;
    }
    if (t.closest('[data-ctl-calibrate]')) {
      C.startCalibration(d.key);
      say(`Calibrating ${d.name}: move every axis and lever all the way to both ends, let the stick spring back to the centre, then press Done.`, 'calib');
      return;
    }
    if (t.closest('[data-ctl-reset]')) {
      C.resetDevice(d.key);
      say(`${d.name} is back on its built-in profile.`);
      render();
    }
  });

  root.addEventListener('change', (e) => {
    const t = e.target;
    const d = devOf(t);
    if (!d) return;
    if (t.matches('[data-ctl-profile]')) {
      C.setProfile(d.key, t.value);
      render();
      return;
    }
    const opt = t.dataset.ctlOpt;
    const roleEl = t.closest('[data-role]');
    if (opt && roleEl) {
      const v = t.type === 'checkbox' ? t.checked : Number(t.value);
      C.setAxisOption(d.key, roleEl.dataset.role, opt, v, d.mapping);
      render();
    }
  });

  // The pause key (Esc) while waiting for a lever or a button cancels that, and only that.
  const onKey = (e) => {
    if (!C.detecting || !host.isConnected || !isKey(null, 'pause', e.code)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    C.cancelDetect();
    say(null);
  };
  window.addEventListener('keydown', onKey, true);

  const timer = setInterval(() => {
    try {
      tick(0.15);
    } catch (err) {
      console.warn('[controllers] panel', err);
    }
  }, 150);
  render();
  return {
    el: root,
    render,
    tick,
    say,
    destroy() {
      clearInterval(timer);
      window.removeEventListener('keydown', onKey, true);
    },
  };
}

/** For the browser check: the shape of a device's assignments, by role. */
export function describe(controllers) {
  return controllers.devices.map((d) => ({
    key: d.key, name: d.name, profile: d.cfg.profile.id, mode: d.cfg.mode,
    axes: Object.fromEntries(Object.entries(d.cfg.axes).map(([r, a]) => [r, a.axis])),
    buttons: { ...d.cfg.buttons },
    values: Object.fromEntries(AXIS_ROLES.map((r) => [r.id, d.cfg.mode === 'mapped' ? controllers.roleValue(d, r.id) : null])),
    readouts: Object.fromEntries(AXIS_ROLES.map((r) => [r.id, d.cfg.mode === 'mapped' ? roleReadout(r.id, controllers.roleValue(d, r.id), d.cfg.axes[r.id]) : null])),
  }));
}

export { shapeAxis };
