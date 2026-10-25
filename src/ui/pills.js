/**
 * State pills: one lane, bottom centre, at most two.
 *
 * "What is happening to me right now, and how do I undo it." The parking
 * brake holding you on the runway at full power, the tug pushing you back,
 * the gear still up on short final — each was told somewhere (a chip in the
 * engine strip, a notice, nothing at all on a phone) and none of them in the
 * same place or in the same words. This is the one place: an icon, the state
 * in two or three words, and the way out, coloured by how much it matters.
 * On a touchscreen every pill is a button that does the undoing itself.
 *
 * `pillsFor()` is pure, so the rules are tested in node without a page.
 */

import { icon } from './icons.js';

const LEVEL_RANK = { bad: 0, warn: 1, info: 2 };
export const MAX_PILLS = 2;
/** Once up, a pill stays this long even if its state flickers off (set()). */
export const MIN_SHOW_MS = 1500;

/**
 * @param {object} s
 *   onGround, parkingBrake, pushing, engineOn, gearPos (0 up … 1 down),
 *   aglFt, speedKts, vsFpm, touch (true on a touchscreen),
 *   keys: { power, services, gear } — the player's key names for the hints
 * @returns {Array<{id, level, icon, text, how, action}>} at most MAX_PILLS, worst first
 */
export function pillsFor(s = {}) {
  const k = s.keys || {};
  const out = [];
  const touch = !!s.touch;

  if (!s.onGround && Number(s.gearPos) < 0.05 && Number(s.aglFt) < 500 && Number(s.vsFpm) < -50 && Number(s.speedKts) < 140) {
    out.push({
      id: 'gear',
      level: 'bad',
      icon: 'gear',
      text: 'Gear up — low and slow?',
      how: touch ? 'tap for gear down' : `${k.gear || 'G'} drops the gear`,
      action: 'gear',
    });
  }
  if (s.pushing) {
    out.push({
      id: 'pushback',
      level: 'info',
      icon: 'car',
      text: 'Pushing back',
      how: touch ? 'tap to stop' : `${k.services || 'P'} stops the tug`,
      action: 'stopPush',
    });
  } else if (s.onGround && s.parkingBrake) {
    out.push({
      id: 'parking',
      level: s.engineOn ? 'warn' : 'info',
      icon: 'brake',
      text: 'Parking brake on',
      how: touch ? 'tap to release' : `${k.power || 'Shift'} (power) releases it`,
      action: 'releaseBrake',
    });
  }
  out.sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level]);
  return out.slice(0, MAX_PILLS);
}

export class PillLane {
  /**
   * @param {HTMLElement} host    the HUD wrapper (.hud)
   * @param {(action: string) => void} onAction  the HUD's action handler
   */
  constructor(host, onAction) {
    this.onAction = onAction || (() => {});
    this.shown = new Map(); // id -> { el, text, how, level }
    if (typeof document === 'undefined') return;
    const el = document.createElement('div');
    el.className = 'hud-pills';
    el.setAttribute('role', 'status');
    this.el = el;
    if (host && host.appendChild) host.appendChild(el);
  }

  /**
   * Make the lane match `list` (from pillsFor), touching the DOM only where
   * something changed. A pill stays at least MIN_SHOW_MS once it is up: the
   * gear rule sits on thresholds (500 ft, -50 ft/min, 140 kt) that a wobbly
   * approach crosses every few frames, and a red pill popping in and out at
   * that rate is a flashing light. `now` is for tests.
   */
  set(list, now) {
    if (!this.el) return;
    const t = Number.isFinite(now) ? now : typeof performance !== 'undefined' ? performance.now() : Date.now();
    const ids = new Set(list.map((p) => p.id));
    const keep = [];
    for (const [id, cur] of this.shown) {
      if (!ids.has(id) && cur.p && t - cur.at < MIN_SHOW_MS) keep.push(cur.p);
    }
    if (keep.length) {
      list = [...list, ...keep].sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level]).slice(0, MAX_PILLS);
    }
    const want = new Map(list.map((p) => [p.id, p]));
    for (const [id, cur] of this.shown) {
      if (!want.has(id)) {
        cur.el.remove();
        this.shown.delete(id);
      }
    }
    let i = 0;
    for (const p of list) {
      let cur = this.shown.get(p.id);
      if (!cur) {
        const b = document.createElement('button');
        b.type = 'button';
        b.dataset.pill = p.id;
        b.innerHTML = `<span class="hud-pill-ic">${icon(p.icon, 16)}</span><span class="hud-pill-text"></span><span class="hud-pill-how"></span>`;
        b.addEventListener('click', (e) => {
          e.preventDefault();
          b.blur();
          // Undone by hand: no minimum time, it goes as soon as the state does.
          const mine = this.shown.get(p.id);
          if (mine) mine.at = -Infinity;
          this.onAction(p.action);
        });
        cur = { el: b, text: null, how: null, level: null, at: t, p };
        this.shown.set(p.id, cur);
      } else {
        // `at` stays the moment it went up: a minimum time on screen, not a
        // delay on going — a pill whose state really ended after that goes
        // at once.
        cur.p = p;
      }
      if (cur.level !== p.level) {
        cur.el.className = `hud-pill is-${p.level}`;
        cur.level = p.level;
      }
      if (cur.text !== p.text) {
        cur.el.querySelector('.hud-pill-text').textContent = p.text;
        cur.text = p.text;
      }
      if (cur.how !== p.how) {
        cur.el.querySelector('.hud-pill-how').textContent = p.how ? `— ${p.how}` : '';
        cur.how = p.how;
      }
      cur.el.title = p.how || '';
      // Worst first, left to right: insert in order.
      if (this.el.children[i] !== cur.el) this.el.insertBefore(cur.el, this.el.children[i] || null);
      i++;
    }
  }

  /** Take every pill down at once (a reset, the HUD hidden, out of the aeroplane). */
  clear() {
    for (const cur of this.shown.values()) cur.el.remove();
    this.shown.clear();
  }

  /** The pills on screen right now, by id. */
  ids() {
    return [...this.shown.keys()];
  }
}
