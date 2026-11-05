/**
 * The secret planes in the Hangar: a silhouette with a hint until you have
 * one, then the real card with "Found at …".
 *
 * The menus build every roster type as a card (menus.js, hangar-showcase-ui.js)
 * and progression.js says which are yours. A secret plane is in no shop row,
 * so left alone it would show its real name and "Not in the shop yet" — the
 * secret given away on the menu. This file decorates those cards after the
 * menus paint them, without editing either file:
 *
 *   Free Flight's aircraft cards   syncFleetLocks() is wrapped
 *   the Hangar's full list         a MutationObserver on [data-unlocks]
 *   the Hangar's podium card       showcaseUi.select / sync are wrapped
 *
 * An unfound secret: "Secret aircraft", its blurb replaced by the hint, its
 * art a silhouette, and its lock tag "Hidden — explore to find it" (Air
 * Force One: "Score 80+ on Air Force One — Under Attack to unlock"). A click
 * on it says the hint rather than "unlock it for 0 credits".
 */

import { AIRCRAFT } from '../../aircraft/types.js';
import * as Prog from '../../game/progression.js';

const CSS = `
.fleet-card.is-secret .fleet-art-slot canvas, .fleet-card.is-secret .fleet-art-slot img { filter: brightness(0) saturate(0); opacity: 0.85; }
.fleet-card.is-secret .fleet-bars, .fleet-card.is-secret .fleet-numbers { visibility: hidden; }
.fleet-card.is-secret .fleet-lock { background: rgba(120, 140, 170, 0.16); border-color: rgba(160, 182, 214, 0.5); color: #cfdcf0; }
.fleet-found { display: block; margin-top: 6px; font-size: 10.5px; font-weight: 640; color: #9fe3b8; letter-spacing: 0.01em; }
.unlock.is-secret strong { letter-spacing: 0.04em; }
.unlock.is-secret em { color: #cfdcf0; }
`;

const M = { sim: null, info: null, installed: false, css: false, busy: false };

function ensureCss() {
  if (M.css || typeof document === 'undefined') return;
  M.css = true;
  const st = document.createElement('style');
  st.textContent = CSS;
  document.head.appendChild(st);
}

const secretTypes = () => AIRCRAFT.filter((a) => a && a.secret);

function prog() {
  const s = M.sim;
  return (s && (s.prog || (s.menus && s.menus.prog))) || Prog.load();
}

function owned(t) {
  return Prog.isUnlocked(prog(), t.id);
}

/** { hint, where, lock } for a secret type, from secrets.js. */
function infoOf(t) {
  try {
    return (M.info && M.info(t)) || {};
  } catch (e) {
    return {};
  }
}

function setText(el, text) {
  if (el && el.textContent !== text) el.textContent = text;
}

/* ---- Free Flight's cards ---- */

function decorateFleet() {
  const s = M.sim && M.sim.menus && M.sim.menus.screens && M.sim.menus.screens.free;
  if (!s) return;
  ensureCss();
  for (const t of secretTypes()) {
    const card = s.querySelector(`[data-aircraft="${t.id}"]`);
    if (!card) continue;
    const name = card.querySelector('.fleet-name');
    const cls = card.querySelector('.fleet-class');
    const blurb = card.querySelector('.fleet-blurb');
    if (name && card.dataset.realName == null) {
      card.dataset.realName = name.textContent;
      card.dataset.realClass = cls ? cls.textContent : '';
      card.dataset.realBlurb = blurb ? blurb.textContent : '';
    }
    const mine = owned(t);
    const inf = infoOf(t);
    card.classList.toggle('is-secret', !mine);
    if (!mine) {
      setText(name, 'Secret aircraft');
      setText(cls, 'Secret');
      setText(blurb, inf.hint || 'Hidden somewhere on the islands.');
      let tag = card.querySelector('.fleet-lock');
      if (!tag) {
        tag = document.createElement('span');
        tag.className = 'fleet-lock';
        card.appendChild(tag);
      }
      setText(tag, inf.lock || 'Hidden — explore to find it');
      const f = card.querySelector('.fleet-found');
      if (f) f.remove();
    } else {
      setText(name, card.dataset.realName || t.name);
      setText(cls, card.dataset.realClass || t.class || '');
      setText(blurb, card.dataset.realBlurb || t.blurb || '');
      if (inf.where) {
        let f = card.querySelector('.fleet-found');
        if (!f) {
          f = document.createElement('span');
          f.className = 'fleet-found';
          card.appendChild(f);
        }
        setText(f, `Found at ${inf.where}`);
      }
    }
  }
}

/* ---- The Hangar's full list ---- */

function decorateShop() {
  const h = M.sim && M.sim.menus && M.sim.menus.screens && M.sim.menus.screens.hangar;
  const box = h && h.querySelector('[data-unlocks]');
  if (!box) return;
  ensureCss();
  for (const t of secretTypes()) {
    const b = box.querySelector(`[data-buy="${t.id}"]`);
    if (!b) continue;
    const mine = owned(t);
    const inf = infoOf(t);
    b.classList.toggle('is-secret', !mine);
    setText(b.querySelector('strong'), mine ? t.name : 'Secret aircraft');
    setText(b.querySelector('em'), mine ? (inf.where ? `Yours · found at ${inf.where}` : 'Yours') : inf.lock || 'Hidden — explore to find it');
  }
}

/* ---- The podium ---- */

function decorateShowcase() {
  const menus = M.sim && M.sim.menus;
  const ui = menus && menus.showcaseUi;
  const h = menus && menus.screens && menus.screens.hangar;
  if (!ui || !h) return;
  const $ = (q) => h.querySelector(q);
  // Names of unfound secrets out of every title and dot.
  for (const t of secretTypes()) {
    if (owned(t)) continue;
    const dot = h.querySelector(`[data-hs-dot="${t.id}"]`);
    if (dot) dot.setAttribute('aria-label', 'Secret aircraft');
  }
  for (const q of ['[data-hs-prev]', '[data-hs-next]']) {
    const el = $(q);
    if (!el || !el.title) continue;
    for (const t of secretTypes()) {
      if (!owned(t) && el.title.endsWith(t.name)) el.title = el.title.replace(t.name, 'Secret aircraft');
    }
  }
  const t = AIRCRAFT.find((a) => a.id === ui.id);
  if (!t || !t.secret) return;
  const mine = owned(t);
  const inf = infoOf(t);
  if (!mine) {
    setText($('[data-hs-name]'), 'Secret aircraft');
    setText($('[data-hs-class]'), 'Secret');
    setText($('[data-hs-line]'), inf.hint || 'Hidden somewhere on the islands.');
    const actions = $('[data-hs-actions]');
    if (actions) {
      const html = `<button type="button" class="primary big hs-buy" disabled>${inf.lock || 'Hidden — explore to find it'}</button>`;
      if (actions.innerHTML !== html) actions.innerHTML = html;
    }
    setText($('[data-hs-msg]'), t.secret.how === 'earned' ? '' : 'Find it and it is yours for good — it will be here, in your Hangar.');
    const lock = $('[data-hs-lock]');
    if (lock) {
      const span = lock.querySelector('span');
      setText(span, 'Secret');
    }
  } else if (inf.where) {
    const msg = $('[data-hs-msg]');
    if (msg && !msg.textContent) msg.textContent = `Found at ${inf.where}.`;
  }
}

function decorateAll() {
  if (M.busy) return;
  M.busy = true;
  try {
    decorateFleet();
    decorateShop();
    decorateShowcase();
  } catch (e) {
    console.warn('[secrets] could not decorate the hangar', e);
  } finally {
    M.busy = false;
  }
}

/** Wire it in. `info(type)` answers { hint, lock, where }. Safe to call again. */
export function installMenu(sim, info) {
  M.sim = sim;
  M.info = info;
  const menus = sim && sim.menus;
  if (!menus || M.installed) {
    decorateAll();
    return;
  }
  M.installed = true;
  if (typeof menus.syncFleetLocks === 'function' && !menus.syncFleetLocks._secrets) {
    const orig = menus.syncFleetLocks;
    const wrapped = (...a) => {
      const r = orig.apply(menus, a);
      decorateFleet();
      return r;
    };
    wrapped._secrets = true;
    menus.syncFleetLocks = wrapped;
  }
  const ui = menus.showcaseUi;
  if (ui) {
    for (const k of ['select', 'sync']) {
      if (typeof ui[k] !== 'function' || ui[k]._secrets) continue;
      const orig = ui[k];
      const w = (...a) => {
        const r = orig.apply(ui, a);
        try {
          decorateShowcase();
        } catch (e) {
          /* the podium is a nicety */
        }
        return r;
      };
      w._secrets = true;
      ui[k] = w;
    }
  }
  const h = menus.screens && menus.screens.hangar;
  const box = h && h.querySelector && h.querySelector('[data-unlocks]');
  if (box && typeof MutationObserver !== 'undefined') {
    const mo = new MutationObserver(() => decorateShop());
    mo.observe(box, { childList: true });
  }
  // A click on an unfound secret says where to look, not "0 credits".
  const free = menus.screens && menus.screens.free;
  if (free && free.addEventListener) {
    free.addEventListener('click', (e) => {
      const card = e.target && e.target.closest && e.target.closest('[data-aircraft]');
      if (!card) return;
      const t = AIRCRAFT.find((a) => a.id === card.dataset.aircraft);
      if (!t || !t.secret || owned(t)) return;
      e.stopPropagation();
      e.preventDefault();
      const inf = infoOf(t);
      if (menus.hooks && menus.hooks.onLocked) menus.hooks.onLocked(inf.lock && t.secret.how === 'earned' ? inf.lock : `A secret plane. ${inf.hint || 'Explore to find it.'}`);
    }, true);
  }
  decorateAll();
}

/** Repaint after a find (the menus are not on screen, but they will be). */
export function refreshMenu() {
  const menus = M.sim && M.sim.menus;
  if (!menus) return;
  try {
    if (menus.syncProgression) menus.syncProgression(M.sim.prog);
    if (menus.syncFleetLocks) menus.syncFleetLocks();
  } catch (e) {
    console.warn('[secrets] the hangar could not repaint', e);
  }
  decorateAll();
}
