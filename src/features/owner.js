/**
 * The owner, on the main page: "if i press the fan on the main page 10 times
 * and put in the code i get owner on that device for 1 hour".
 *
 *   THE FAN — the propeller in the main menu's brand mark (menus.js
 *   buildMain, `data-fan`). TAPS presses of it inside TAP_WINDOW_MS (the first
 *   and the tenth less than five seconds apart) — mouse, touch or pen
 *   (pointerdown, so a fast double tap is two taps, not a zoom),
 *   or Enter / Space with it focused — open a small, plain code box under
 *   the title. Nothing shows before that: no counter, no wobble, and the box
 *   is not in the page until it opens (and is taken out again when it shuts).
 *
 *   THE CODE — checked by ./multiplayer/owner.js, which says why no code is
 *   in any file of the game: a code makes a private number, and only the
 *   owner's makes the one whose public key ships. A wrong one is told "Not
 *   that one"; a few a minute, then "wait a minute".
 *
 *   THE HOUR — the right code makes this device the owner until an hour from
 *   now: a gold chip, "OWNER · 58 min", at the foot of the screen in the menus
 *   and in flight — at the top on a touch screen, whose foot is the rudder's
 *   — (tap it for "End owner now"). Every admin power in
 *   multiplayer (../features/multiplayer.js — the host checks the pass
 *   itself), Dev mode open for the hour, and a gold OWNER badge on the name
 *   tag and in every player list. At the end of the hour, or "End owner now",
 *   the pass and its key are wiped and Dev mode goes back to however it was
 *   before the hour started.
 */

import { registerExtension } from '../game/extensions.js';
import * as Prog from '../game/progression.js';
import { owner, OWNER_MS } from './multiplayer/owner.js';

/** Presses of the fan that open the box, and how quickly they must come. */
export const TAPS = 10;
export const TAP_WINDOW_MS = 5000;

const CSS = `
.screen-main .brand-mark[data-fan] { touch-action: manipulation; -webkit-tap-highlight-color: transparent; user-select: none; -webkit-user-select: none; border-radius: 50%; }
.screen-main .brand-mark[data-fan]:focus { outline: none; }
.screen-main .brand-mark[data-fan]:focus-visible { outline: 2px solid currentColor; outline-offset: 3px; }
.owner-box { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: -12px 0 18px; max-width: 360px; }
.owner-box input { flex: 1 1 150px; min-width: 0; padding: 8px 10px; border-radius: 9px; border: 1px solid var(--panel-line, rgba(140,180,230,.18));
  background: rgba(8, 13, 22, 0.7); color: var(--text, #eaf1fb); font: inherit; font-size: 15px; }
.owner-box button { padding: 8px 12px; border-radius: 9px; border: 1px solid var(--panel-line, rgba(140,180,230,.18)); background: rgba(255,255,255,0.08); color: var(--text, #eaf1fb); font: inherit; cursor: pointer; }
.owner-box .owner-msg { flex-basis: 100%; min-height: 1.2em; font-size: 13px; color: var(--text-dim, #9fb2cc); }
.owner-chip { position: fixed; left: 50%; bottom: max(10px, env(safe-area-inset-bottom)); transform: translateX(-50%); z-index: 60;
  display: flex; flex-direction: column; align-items: center; gap: 6px; pointer-events: none; font-family: var(--font, system-ui, sans-serif); }
.owner-chip button { pointer-events: auto; border: 0; border-radius: 99px; cursor: pointer; font: inherit; }
.owner-chip [data-owner-chip] { padding: 5px 12px; background: #ffd23f; color: #3a2a00; font-size: 12.5px; font-weight: 800; letter-spacing: 0.04em;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35); font-variant-numeric: tabular-nums; }
.owner-chip [data-owner-end] { padding: 7px 14px; background: rgba(12, 20, 34, 0.92); color: #fff; font-size: 13px; font-weight: 650;
  border: 1px solid rgba(255, 210, 63, 0.6); }
/* While the hour runs, every menu screen leaves room under its last line for the chip (and "End owner now" above it), so a
   screen scrolled to its end is read to the last word. Set once, when the chip comes and once when it goes. */
:root[data-owner-on] .menu-layer > .screen { padding-bottom: 88px; }
/* A touch screen flies with the RUDDER slider at the foot of the screen, centred (touch.js), the approach pill and the
   tower's line stacked right above it: no room there. On a touch device the chip sits at the top of the screen instead —
   between the game switcher and the credit pill in the menus, above the instrument strip in flight — and "End owner now"
   opens below it. */
:root.is-touch-device .owner-chip { top: max(8px, env(safe-area-inset-top)); bottom: auto; flex-direction: column-reverse; }
`;

/** "58 min", "1 min" — whole minutes left, rounded up, so the chip never says 0 while it is still on. */
export function minutesLeft(ms) {
  return Math.max(1, Math.ceil(ms / 60000));
}

class OwnerFeature {
  constructor() {
    this.sim = null;
    this.taps = [];
    this.box = null;
    this.chip = null;
    this._tick = null;
    this.installed = false;
  }

  install(sim) {
    if (this.installed) return;
    this.installed = true;
    this.sim = sim;
    if (typeof document !== 'undefined' && !document.getElementById('owner-style')) {
      const st = document.createElement('style');
      st.id = 'owner-style';
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    owner.on((e) => this.changed(e));
    // What this device kept, checked: an hour that ran out while the game was shut puts Dev mode back now.
    const r = owner.load();
    if (r.ended) this.devBack(r.devBefore);
    this.wireFan();
    this.paintChip();
    if (typeof window !== 'undefined') window.__owner = this;
  }

  /* ---- the fan ---------------------------------------------------------- */

  get fan() {
    const m = this.sim && this.sim.menus;
    const main = m && m.screens && m.screens.main;
    return main ? main.querySelector('[data-fan]') : null;
  }

  wireFan() {
    const fan = this.fan;
    if (!fan || fan._ownerWired) return;
    fan._ownerWired = true;
    /*
     * When the press really happened, not when it was handled: the first
     * press anywhere starts the game's sound, which can hold the page for a
     * moment on a slow laptop, and the presses queued behind it must still
     * count as the quick ones they were.
     */
    const at = (e) => (e && e.isTrusted && e.timeStamp > 0 ? e.timeStamp : performance.now());
    fan.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      this.tap(at(e));
    });
    fan.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) {
        e.preventDefault();
        this.tap(at(e));
      }
    });
  }

  /**
   * One press of the fan. The tenth inside the window opens the box; nothing
   * else happens, ever. Inside: the first and the tenth are LESS than the
   * window apart (strictly — ten spread over exactly the window are not
   * quick presses, and a check that put them exactly there passed or failed
   * on floating-point rounding of the clock).
   */
  tap(t = performance.now()) {
    if (this.box) return false;
    this.taps.push(t);
    this.taps = this.taps.filter((x) => t - x < TAP_WINDOW_MS);
    if (this.taps.length < TAPS) return false;
    this.taps = [];
    this.openBox();
    return true;
  }

  /* ---- the box ---------------------------------------------------------- */

  openBox() {
    const fan = this.fan;
    const brand = fan && fan.closest('.brand');
    if (!brand || this.box) return;
    const box = document.createElement('form');
    box.className = 'owner-box';
    box.dataset.ownerBox = '';
    box.setAttribute('autocomplete', 'off');
    box.innerHTML = `
      <input type="password" data-owner-code maxlength="200" placeholder="Code" aria-label="Code"
        autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" data-1p-ignore data-lpignore="true">
      <button type="submit" data-owner-go>OK</button>
      <button type="button" data-owner-x aria-label="Close">✕</button>
      <span class="owner-msg" data-owner-msg role="status" aria-live="polite"></span>`;
    box.addEventListener('submit', (e) => {
      e.preventDefault();
      this.submit();
    });
    box.addEventListener('click', (e) => {
      if (e.target.closest('[data-owner-x]')) this.closeBox();
    });
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        this.closeBox();
      }
    });
    brand.insertAdjacentElement('afterend', box);
    this.box = box;
    const input = box.querySelector('[data-owner-code]');
    setTimeout(() => input.focus({ preventScroll: true }), 0);
  }

  /** Shut, and out of the page: what was typed goes with it. */
  closeBox() {
    if (!this.box) return;
    const input = this.box.querySelector('[data-owner-code]');
    if (input) input.value = '';
    this.box.remove();
    this.box = null;
    const fan = this.fan;
    if (fan && document.activeElement === document.body) fan.focus({ preventScroll: true });
  }

  /** The code in the box, tried. What it says is all anybody learns: right, "Not that one", or wait. */
  submit() {
    if (!this.box) return null;
    const input = this.box.querySelector('[data-owner-code]');
    const msg = this.box.querySelector('[data-owner-msg]');
    const typed = input.value;
    input.value = '';
    const r = owner.tryCode(typed, Prog.isDev(this.prog()));
    if (r.ok) {
      this.closeBox();
      return r;
    }
    msg.textContent = r.why === 'wait' ? 'Too many tries — wait a minute.' : 'Not that one';
    input.focus({ preventScroll: true });
    return r;
  }

  /* ---- the hour ------------------------------------------------------------ */

  prog() {
    const s = this.sim;
    return (s && s.menus && s.menus.prog) || (s && s.prog) || Prog.load();
  }

  /** Dev mode, set and saved on the one progression object the game shares (menus.js / main.js), and repainted. */
  setDev(on) {
    const p = this.prog();
    if (!!p.devUnlocked === !!on) return;
    p.devUnlocked = !!on;
    Prog.save(p);
    const m = this.sim && this.sim.menus;
    if (m && m.syncProgression) m.syncProgression(p);
  }

  devBack(before) {
    this.setDev(!!before);
  }

  changed(e) {
    if (e.on) this.setDev(true);
    else this.devBack(e.devBefore);
    this.paintChip();
  }

  /* ---- the chip ------------------------------------------------------------ */

  paintChip() {
    if (typeof document === 'undefined') return;
    const pass = owner.current();
    if (!pass) {
      if (this.chip) {
        this.chip.remove();
        this.chip = null;
        delete document.documentElement.dataset.ownerOn;
      }
      clearInterval(this._tick);
      this._tick = null;
      return;
    }
    if (!this.chip) {
      const chip = document.createElement('div');
      chip.className = 'owner-chip';
      chip.dataset.ownerChipBox = '';
      chip.innerHTML = '<button type="button" data-owner-end hidden>End owner now</button><button type="button" data-owner-chip aria-expanded="false"></button>';
      chip.addEventListener('click', (e) => {
        if (e.target.closest('[data-owner-end]')) {
          owner.end('ended');
          return;
        }
        if (e.target.closest('[data-owner-chip]')) {
          const end = chip.querySelector('[data-owner-end]');
          end.hidden = !end.hidden;
          chip.querySelector('[data-owner-chip]').setAttribute('aria-expanded', String(!end.hidden));
        }
      });
      document.body.appendChild(chip);
      this.chip = chip;
      document.documentElement.dataset.ownerOn = '';
    }
    const text = `OWNER · ${minutesLeft(pass.left())} min`;
    const btn = this.chip.querySelector('[data-owner-chip]');
    if (btn.textContent !== text) {
      btn.textContent = text;
      btn.title = `Owner on this device until ${new Date(pass.exp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} — tap to end it now`;
    }
    // Once a second while the hour runs: the chip's minutes, and the end of the hour if the timer was asleep (a laptop lid).
    if (!this._tick) {
      this._tick = setInterval(() => {
        owner.check();
        this.paintChip();
      }, 1000);
    }
  }
}

export const ownerFeature = new OwnerFeature();
export { OWNER_MS };

registerExtension({
  id: 'owner',
  install(sim) {
    ownerFeature.install(sim);
  },
});
