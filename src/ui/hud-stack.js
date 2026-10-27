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
 *     keep   true for a card that must never wait off screen either (a card
 *            with buttons to answer). Warnings (prio 0) always stay.
 *   poke(el, s)    it changed: open it again for `s` seconds.
 *   openAll(s)     H (help), or a tap: every chip opens for a while.
 *
 * Only about three cards are open at once, by priority; the rest fold to a
 * one-line chip, and if even that will not fit above the minimap the lowest
 * chips wait off screen, then (last resort) the lowest cards that never
 * fold. Warnings, and cards with answers (`keep`), are never waited.
 *
 * What JavaScript does here is decide classes (which card is a chip), a few
 * times a second and whenever a card changes size. It never positions a
 * card. The one thing it measures, on a touchscreen only, is where the
 * instrument band ends, because the helicopter's card hangs under it — from
 * a ResizeObserver when it changes, and again with each chip decision (in
 * the same layout pass), so a card that moved host is not missed.
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
    /** True while the minimap has stepped aside for the warnings and the answers (yieldMap). */
    this.yielding = false;
    if (typeof document === 'undefined' || !document.createElement) return;
    const el = document.createElement('div');
    el.className = 'hud-rstack';
    this.el = el;
    if (host && host.appendChild) host.appendChild(el);
    // The column's room, as a box the browser lays out (styles/main.css
    // .rs-room-probe: the column's own top and max-height, as a height). The
    // column's max-height is calc(100% - ...), and getComputedStyle hands
    // that back as the calc() text, not pixels: parseFloat() of it is NaN,
    // so room() fell back to half the window. At 1280x713 that was 33 px
    // short of the real room; at 1280x560, 44 px MORE than the real room,
    // so the wind card never folded and sat on the minimap.
    const probe = document.createElement('div');
    probe.className = 'rs-room-probe';
    probe.setAttribute('aria-hidden', 'true');
    this.probe = probe;
    if (host && host.appendChild) host.appendChild(probe);
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
        this._noGain = null;
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
  add(el, { prio = 2, id = '', info = false, chip = true, keep = false, open = OPEN_INFO } = {}) {
    if (!el || !this.el) return el;
    let c = this.cards.find((k) => k.el === el);
    if (!c) {
      c = { el, prio, id, info, chip, keep, openFor: open, openT: open, wasOn: false, chipped: false };
      this.cards.push(c);
    } else Object.assign(c, { prio, id, info, chip, keep });
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
      const p = this.probe && this.probe.isConnected && this.probe.getBoundingClientRect ? this.probe.getBoundingClientRect().height : NaN;
      const v = Number.isFinite(p) && p > 0 ? p : parseFloat(getComputedStyle(this.el).maxHeight);
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
    // On a touchscreen, where the column starts (under the band) is checked
    // here too, not only from the ResizeObserver: a card in the band that
    // moved host or grew a line between two observer deliveries left the
    // column 7-15 px into the helicopter's card. Same layout pass as the
    // scrollHeight read below, so it costs a few rects four times a second,
    // on touch only.
    if (this.host && this.host.classList && this.host.classList.contains('is-touch')) this.touchTop();
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
    // Every chip is folded and held back and the column STILL runs into the
    // minimap: the cards that never fold (the patient's pulse, the notices,
    // a pilot-systems panel) wait too, from the bottom, so a low card never
    // lands on the minimap. Only the warnings (prio 0) and a card marked
    // `keep` (one with answers to tap) always stay. The 1280x713 "everything
    // at once" case in tests/features/hud-stack.browser.js: warnings 179 px +
    // the radio call 184 px already fill the 356 px column, and the pulse and
    // the notices used to hang 60 px over the minimap.
    for (let k = 0; k < on.length && this.el.scrollHeight > room + 1; k++) {
      const wait = [...on].reverse().find((c) => c.prio >= 1 && !c.keep && !c.waiting);
      if (!wait) break;
      this.setWait(wait, true);
    }
    this.yieldMap(on);
    this.holdBackKeeps(on);
  }

  /*
   * Two cards of answers at once and the column still too short, with the
   * map already out of the way (or with nothing to gain from it, an upright
   * phone): the warnings, an event card AND the radio card on a phone ran
   * 140 px past the column, the radio's buttons under the stick (landscape)
   * or off the bottom of the screen and under the pads (upright). The lowest
   * of them (the radio, 1.3, under the event, 1.1) waits, as it did before it
   * was a `keep` card, until there is room; one card of answers always shows.
   */
  holdBackKeeps(on) {
    for (let k = 0; k < on.length && this.el.scrollHeight > this.room() + 1; k++) {
      const keeps = on.filter((c) => c.keep && c.prio >= 1 && !c.waiting);
      if (keeps.length < 2) break;
      this.setWait(keeps[keeps.length - 1], true);
    }
  }

  /*
   * SPACE IS TIGHT: THE MINIMAP STEPS ASIDE (the owner's call, 2026-10-26).
   *
   * On a small screen (a landscape phone, a small Chromebook window) the
   * cards that never wait — the warnings (PULL UP, ENGINE FIRE) and a card
   * with answers to tap — can be taller than the column, and they hung over
   * the minimap, or off the bottom of the screen and over the throttle. While
   * one of them is showing and they do not fit, the minimap fades out and the
   * column takes its room (.hud.rs-yield, html.hud-map-yield: styles/main.css
   * lets the column run down to the dock, and on a landscape phone moves it
   * into the map's corner, top left). When the warnings and the answers have
   * gone, or they fit above the map again, the map comes back. A big screen
   * never gets here: the warnings and the answers fit in its column.
   */
  urgentHeight(on) {
    let h = 0;
    let n = 0;
    for (const c of on) {
      if (c.waiting || !(c.prio < 1 || c.keep)) continue;
      h += c.el.getBoundingClientRect().height;
      n++;
    }
    return n ? h + 6 * (n - 1) : 0;
  }

  yieldMap(on) {
    if (!this.host || !this.host.classList) return;
    const need = this.urgentHeight(on);
    if (!this.yielding) {
      const size = typeof window !== 'undefined' ? `${window.innerWidth}x${window.innerHeight}` : '';
      if (need > 0 && need > this.room() + 1 && this._noGain !== size) {
        // Only where the map's room is room the column can use: on an upright
        // phone the map is in the other corner, and hiding it gains nothing.
        const before = this.room();
        this.setYield(true);
        if (this.room() <= before + 1) {
          this.setYield(false);
          this._noGain = size;
          return;
        }
        // The column is taller now: decide the chips again for the new room, in this same task.
        if (!this._again) {
          this._again = true;
          try { this.refresh(); } finally { this._again = false; }
        }
      }
      return;
    }
    if (need <= 0) {
      this.setYield(false);
      return;
    }
    // Still something urgent up: would it fit above the map again? Measured
    // with the map's room in this same task, so nothing is painted between.
    // Staying aside is no change, so it leaves `dirty` as it found it: the
    // off-and-on again marked it dirty, and the column was laid out from
    // scratch (two forced layouts) every frame instead of four times a second.
    const wasDirty = this.dirty;
    this.setYield(false);
    // Where the band ends over the column's own place (not measured while aside).
    if (this.host.classList.contains('is-touch')) this.touchTop();
    const mapRoom = this.room();
    const fits = this.urgentHeight(on) + 8 < mapRoom;
    if (!fits) {
      this.setYield(true);
      this.dirty = wasDirty;
    } else this.dirty = true;
  }

  setYield(v) {
    v = !!v;
    if (this.yielding === v) return;
    this.yielding = v;
    this.host.classList.toggle('rs-yield', v);
    if (typeof document !== 'undefined' && document.documentElement) document.documentElement.classList.toggle('hud-map-yield', v);
    this.roomPx = 0;
    this.dirty = true;
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
        if (this.probe) this.probe.style.removeProperty('--rs-dy');
      }
      return;
    }
    // Stood aside (yieldMap) the column is in the map's corner, where the band
    // is not over it and --rs-dy is not used. Measured there, the band came
    // out as 0 px, the column went back to the right with it, ON the band
    // (667x375, PULL UP in the Photo run: warnings at y 12 over the
    // instruments), and stood aside and back every refresh. Measured only in
    // the column's own place (yieldMap re-measures before it comes back).
    if (this.yielding) return;
    const W = window.innerWidth;
    const cs = typeof getComputedStyle === 'function' ? getComputedStyle(this.el) : null;
    const right = cs ? parseFloat(cs.right) || 12 : 12;
    const width = cs ? parseFloat(cs.width) || 216 : 216;
    const top0 = cs ? parseFloat(cs.top) || 0 : 0;
    const x0 = W - right - width;
    const x1 = W - right;
    let bottom = top0;
    // The helicopter's hover strip (.hud-rotor, a band across the top on a
    // touchscreen) and its card, which hangs under the strip in a hover and
    // under the cruise rows otherwise: missing here, the column started under
    // the button tray and the Races chip sat on the strip's WIND row on an
    // iPad (tests/features/heli-touch.playtest.mjs).
    const sel = ':scope > .hud-left, :scope > .hud-left .hud-heli, :scope > .hud-rotor, :scope > .hud-rotor .hud-heli, :scope > .hud-buttons, :scope > .hud-top > *, :scope > .hud-ribbon, :scope > .hud-boatarrow';
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
      if (this.probe) this.probe.style.setProperty('--rs-dy', `${dy}px`);
      this.roomPx = 0;
      this.dirty = true;
    }
  }
}
