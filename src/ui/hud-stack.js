/**
 * The right-hand column of the HUD: ONE stack, laid out by CSS.
 *
 * The owner's screenshot (Meteor "Photo run", stormy, at night, low): four
 * cards on top of each other down the right — the wind, the mission panel,
 * a red PULL UP row half under it and an amber light peeking out behind.
 * Nine features each put their own card at about `right: 16px; top: 110px`
 * and each ran its own measuring loop that knew about some of the others and
 * not the rest, so two of them worked out the same pixel and sat on it. That
 * is a class of bug, not a case: every card that lives down the right now
 * registers here, and a flex column puts it under the one above it. Nothing
 * measures where to put anything; nothing CAN land on anything else.
 *
 *   add(el, { prio, id, info, chip })   join the stack
 *     prio   0 warnings · 1 the mission's own panels · 2 notices (toasts) ·
 *            3 information (wind, damage, the Races button). Decimals order
 *            cards inside a group. Lower is higher up the screen.
 *     info   an informational card: in the Clean HUD (the default) it shows
 *            for a few seconds when it changes, then folds to a chip.
 *     chip   false for a card that must never fold (the warnings, a card
 *            with buttons to answer).
 *   poke(el, s)    it changed: open it again for `s` seconds.
 *   openAll(s)     H (help), or a tap: every chip opens for a while.
 *
 * Only about three cards are open at once, by priority; the rest fold to a
 * one-line chip, and if even that will not fit above the minimap the lowest
 * chips wait off screen. Warnings are never folded and never waited.
 *
 * What JavaScript does here is decide classes (which card is a chip), a few
 * times a second and whenever a card changes size. It never positions a
 * card. The one thing it measures, on a touchscreen only, is where the
 * instrument band ends, because the helicopter's card hangs under it — and
 * that from a ResizeObserver, when it changes, never on a timer.
 *
 * Motion: a card that arrives slides in from the right edge; when one goes
 * or folds, the cards under it glide to their new places (FLIP, transform
 * only). None of it under Reduce motion / prefers-reduced-motion, and none
 * while a test owns the clock (window.requestAnimationFrame swapped out by
 * tests/ and .claude/devtools/cdp.mjs): a 200 ms glide would only mislead
 * whatever the test measures next.
 */

const OPEN_INFO = 6; // seconds an informational card stays open after it changes
const MAX_OPEN = 3; // full cards at once; the rest fold
const TICK = 0.25; // seconds between chip decisions (and only classes change)
const GLIDE = 'transform 0.22s cubic-bezier(0.2, 0.7, 0.2, 1)';

const NATIVE_RAF = typeof window !== 'undefined' ? window.requestAnimationFrame : null;

function live() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;
  if (window.requestAnimationFrame !== NATIVE_RAF) return false;
  const root = document.documentElement;
  if (root && root.classList && root.classList.contains('reduce-motion')) return false;
  try {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
  } catch (e) {
    /* no media queries: no motion either */
  }
  return true;
}

export class HudStack {
  /** @param {HTMLElement} host  the HUD wrapper (.hud) */
  constructor(host) {
    this.host = host;
    this.cards = [];
    this.density = 'clean';
    this.t = 0;
    this.roomPx = 0;
    this.rects = new Map();
    this.dirty = true;
    if (typeof document === 'undefined' || !document.createElement) return;
    const el = document.createElement('div');
    el.className = 'hud-rstack';
    this.el = el;
    if (host && host.appendChild) host.appendChild(el);
    if (typeof ResizeObserver !== 'undefined') {
      this.ro = new ResizeObserver(() => this.onResize());
      this.ro.observe(el);
    }
    // The touch band: where the column starts (see touchTop()). On the next
    // task, not in the callback: the column's own size follows from it, and
    // a size changed inside a ResizeObserver callback at the same depth is
    // the "loop completed with undelivered notifications" console error.
    this.bandRo = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => {
        clearTimeout(this._bandT);
        this._bandT = setTimeout(() => this.touchTop(), 0);
      })
      : null;
    if (typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('resize', () => {
        this.roomPx = 0;
        this.touchTop();
        this.dirty = true;
      });
    }
  }

  /**
   * Join the stack. Inserted in priority order, so the DOM order IS the
   * reading order (and the order of the cards on screen).
   */
  add(el, { prio = 2, id = '', info = false, chip = true, open = OPEN_INFO } = {}) {
    if (!el || !this.el) return el;
    let c = this.cards.find((k) => k.el === el);
    if (!c) {
      c = { el, prio, id, info, chip, openFor: open, openT: open, wasOn: false, chipped: false };
      this.cards.push(c);
    } else Object.assign(c, { prio, id, info, chip });
    this.cards.sort((a, b) => a.prio - b.prio);
    const i = this.cards.indexOf(c);
    const next = this.cards.slice(i + 1).find((k) => k.el.parentNode === this.el);
    if (el.parentNode !== this.el || el.nextSibling !== (next ? next.el : null)) {
      this.el.insertBefore(el, next ? next.el : null);
    }
    el.classList.add('rs-card');
    if (el.dataset) el.dataset.rsPrio = String(Math.floor(prio));
    if (this.ro) this.ro.observe(el);
    this.dirty = true;
    return el;
  }

  remove(el) {
    const i = this.cards.findIndex((k) => k.el === el);
    if (i < 0) return;
    if (this.ro) this.ro.unobserve(el);
    this.cards.splice(i, 1);
    el.classList.remove('rs-card', 'rs-chip', 'rs-wait');
    this.dirty = true;
  }

  card(el) {
    return this.cards.find((k) => k.el === el) || null;
  }

  /** It changed: show it open again for a while (informational cards only fold on a timer). */
  poke(el, seconds = OPEN_INFO) {
    const c = this.card(el);
    if (!c) return;
    c.openT = Math.max(c.openT, seconds);
    this.dirty = true;
    this.refresh();
  }

  /** H (help) or a tap on a chip: everything opens for `seconds`. */
  openAll(seconds = OPEN_INFO) {
    for (const c of this.cards) c.openT = Math.max(c.openT, seconds);
    this.dirty = true;
    this.refresh();
  }

  /** 'clean' (the default: information folds away) or 'full' (everything open). */
  setDensity(d) {
    this.density = d === 'full' ? 'full' : 'clean';
    if (this.el) this.el.classList.toggle('is-full', this.density === 'full');
    this.dirty = true;
    this.refresh();
  }

  /** Every frame from Hud.updateOverlays(); decides something four times a second. */
  tick(dt) {
    if (!this.el) return;
    for (const c of this.cards) if (c.openT > 0) {
      const before = c.openT;
      c.openT -= dt;
      if (before > 0 && c.openT <= 0 && c.info) this.dirty = true;
    }
    this.t -= dt;
    if (this.t > 0 && !this.dirty) return;
    this.t = TICK;
    this.refresh();
  }

  /** Is the card showing at all (its own hidden/display, or a CSS rule)? */
  shown(c) {
    const el = c.el;
    if (!el || el.parentNode !== this.el || el.hidden || (el.style && el.style.display === 'none')) return false;
    // A stylesheet rule (`.hud.is-vehicle .hud-damage`, the touch layout's
    // `.hud-right`) hides some cards without touching the element itself.
    return !el.getClientRects || el.getClientRects().length > 0;
  }

  /** The column's height in px: from its top down to the minimap or the controls. */
  room() {
    if (!this.roomPx && this.el && typeof getComputedStyle === 'function') {
      const v = parseFloat(getComputedStyle(this.el).maxHeight);
      this.roomPx = Number.isFinite(v) && v > 0 ? v : (typeof window !== 'undefined' ? window.innerHeight * 0.5 : 400);
    }
    return this.roomPx || 400;
  }

  /**
   * Which cards are chips. Classes only; CSS does the rest.
   *
   * Open, by priority, until three are open: warnings and cards that must
   * not fold always open (and count). An informational card in the Clean
   * HUD folds once its few seconds are up. Then, if the column still runs
   * past its floor, the lowest open cards fold, and then the lowest chips
   * wait (hidden) until there is room.
   */
  refresh() {
    if (!this.el) return;
    this.dirty = false;
    if (this.el.classList.contains('rs-anim') !== live()) this.el.classList.toggle('rs-anim');
    // A card held back last time is measured as if it were not: the column
    // is re-decided from scratch (in one task, so nothing is painted between).
    for (const c of this.cards) this.setWait(c, false);
    const on = [];
    for (const c of this.cards) {
      const s = this.shown(c);
      if (s && !c.wasOn) {
        // Arrived (or came back): an informational card opens for a while.
        c.openT = Math.max(c.openT, c.openFor);
      }
      c.wasOn = s;
      if (s) on.push(c);
    }
    let open = 0;
    const canChip = (c) => (typeof c.chip === 'function' ? !!c.chip() : !!c.chip);
    for (const c of on) {
      let chip = false;
      if (canChip(c)) {
        if (c.info && this.density === 'clean' && c.openT <= 0) chip = true;
        else if (open >= MAX_OPEN) chip = true;
      }
      if (!chip) open++;
      this.setChip(c, chip);
    }
    // Still too tall for the column: fold, then hold back, from the bottom.
    const room = this.room();
    for (let k = 0; k < on.length * 2 && this.el.scrollHeight > room + 1; k++) {
      const fold = [...on].reverse().find((c) => canChip(c) && !c.chipped);
      if (fold) {
        this.setChip(fold, true);
        continue;
      }
      const wait = [...on].reverse().find((c) => c.prio >= 1 && canChip(c) && !c.waiting);
      if (!wait) break;
      this.setWait(wait, true);
    }
  }

  setChip(c, on) {
    if (c.chipped === on) return;
    c.chipped = on;
    c.el.classList.toggle('rs-chip', on);
  }

  setWait(c, on) {
    if (!!c.waiting === on) return;
    c.waiting = on;
    c.el.classList.toggle('rs-wait', on);
  }

  /**
   * A card changed size (arrived, went, folded, grew a line). The layout is
   * already new; the cards that moved are put back where they were with a
   * transform and let go, so they glide (FLIP). Transform only, so this can
   * never resize anything and never loops.
   */
  onResize() {
    this.roomPx = 0;
    this.dirty = true;
    if (!this.el) return;
    const anim = live() && this.el.classList.contains('rs-anim');
    const next = new Map();
    // Measured from the column's own top, so the column moving as a whole
    // (the touch band growing, --rs-dy) is not mistaken for a card moving.
    const top = this.el.getBoundingClientRect().top;
    for (const c of this.cards) {
      const el = c.el;
      if (!el.getClientRects || !el.getClientRects().length) continue;
      const r = el.getBoundingClientRect();
      // The card's own place, without a glide still running on it.
      const t = el.style.transform;
      const dyNow = t && t.startsWith('translateY(') ? parseFloat(t.slice(11)) || 0 : 0;
      const y = r.top - top - dyNow;
      next.set(el, y);
      const was = this.rects.get(el);
      if (!anim || was == null) continue;
      const dy = was - y;
      if (Math.abs(dy) < 1 || Math.abs(dy) > 600) continue;
      el.style.transition = 'none';
      el.style.transform = `translateY(${dy.toFixed(1)}px)`;
      void el.offsetHeight;
      el.style.transition = GLIDE;
      el.style.transform = '';
      // Hand the card's own transitions back once the glide is done.
      clearTimeout(c.glideT);
      c.glideT = setTimeout(() => {
        if (el.style.transition === GLIDE) el.style.transition = '';
      }, 300);
    }
    this.rects = next;
    // Decide chips on the next task, not inside the observer: changing a
    // size from a ResizeObserver callback is how "loop completed with
    // undelivered notifications" ends up in the console.
    if (!this._soon) {
      this._soon = setTimeout(() => {
        this._soon = null;
        this.refresh();
      }, 0);
    }
  }

  /**
   * On a touchscreen the instruments are a band across the top, and the
   * column starts under whatever of it (and of the helicopter's card, the
   * boat's panel, the button dock) reaches over to the right-hand side.
   * Measured when those change size; written as one custom property.
   */
  watchBand(els) {
    if (!this.bandRo) return;
    for (const e of els) if (e) this.bandRo.observe(e);
    this.touchTop();
  }

  touchTop() {
    const host = this.host;
    if (!this.el || !host || !host.classList || typeof window === 'undefined') return;
    if (!host.classList.contains('is-touch')) {
      if (this._dy) {
        this._dy = 0;
        this.el.style.removeProperty('--rs-dy');
      }
      return;
    }
    const W = window.innerWidth;
    const cs = typeof getComputedStyle === 'function' ? getComputedStyle(this.el) : null;
    const right = cs ? parseFloat(cs.right) || 12 : 12;
    const width = cs ? parseFloat(cs.width) || 216 : 216;
    const top0 = cs ? parseFloat(cs.top) || 0 : 0;
    const x0 = W - right - width;
    const x1 = W - right;
    let bottom = top0;
    const sel = ':scope > .hud-left, :scope > .hud-left .hud-heli, :scope > .hud-buttons, :scope > .hud-top > *, :scope > .hud-ribbon, :scope > .hud-boatarrow';
    for (const n of host.querySelectorAll(sel)) {
      if (!n.getClientRects().length) continue;
      const r = n.getBoundingClientRect();
      if (r.width < 2 || r.height < 2 || r.right <= x0 || r.left >= x1) continue;
      if (r.top > window.innerHeight * 0.5) continue;
      bottom = Math.max(bottom, r.bottom + 8);
    }
    const dy = Math.max(0, Math.round(bottom - top0));
    if (dy !== this._dy) {
      this._dy = dy;
      this.el.style.setProperty('--rs-dy', `${dy}px`);
      this.roomPx = 0;
      this.dirty = true;
    }
  }
}
