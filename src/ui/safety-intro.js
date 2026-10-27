/**
 * The first-run intro and the photosensitive seizure warning.
 *
 * The owner, 2026-10-26: "when u login for the first time it should have a
 * cool loading screen and say at the end 'Possible Seizure Warning'". So, once
 * the boot loader is done, on the FIRST launch only (and again from Settings →
 * Accessibility → Show the seizure warning):
 *
 *   1. THE INTRO. The game's name over a slow, calm picture of Kestrel at
 *      golden hour: one long drift (none with Reduce motion) and plain fades
 *      of 0.7 s or longer. No strobes, no cuts, nothing that flashes — it is
 *      the screen that warns about flashing. About three and a half seconds;
 *      a key or a tap goes straight on to the warning (never past it).
 *   2. THE WARNING. The standard wording, the two switches that matter
 *      (Reduce flashing, on by default; Reduce motion) and Continue. Enter
 *      continues, Space flips a focused switch, Tab stays inside the card.
 *      A phone gets the same card, scrolling if it has to, with big targets.
 *
 * Continue remembers it (STORE_KEY in localStorage, which may be refused: a
 * private window just sees it again next time). Automated browsers (the test
 * suites: navigator.webdriver) never see it at boot; `?intro=1` shows it
 * anyway and `?intro=0` never. Timers only, never requestAnimationFrame: the
 * harnesses freeze it and a hidden tab stops it.
 *
 * Pure DOM and timers: main.js passes in the settings and how to apply one.
 */

export const STORE_KEY = 'islandsim.seizurewarning.v1';

/** Milliseconds. Every fade is at least 0.7 s, so nothing on it can flash. */
export const INTRO_TIMING = Object.freeze({
  fadeInMs: 900,
  titleHoldMs: 2600,
  cardFadeMs: 700,
  fadeOutMs: 700,
  skipAfterMs: 350,
});

export const WARNING_TITLE = 'Photosensitive seizure warning';
export const WARNING_KICKER = 'Possible seizure warning';

/** The warning, paragraph by paragraph (the standard wording games carry). */
export const WARNING_TEXT = Object.freeze([
  'A very small percentage of people may experience a seizure when exposed to certain visual images, '
    + 'including flashing lights or patterns that may appear in video games. Even people who have no history '
    + 'of seizures or epilepsy may have an undiagnosed condition that can cause these photosensitive epileptic '
    + 'seizures while playing.',
  'Stop playing immediately and consult a doctor if you experience any of these symptoms: dizziness, '
    + 'altered vision, eye or muscle twitches, loss of awareness, disorientation, or any involuntary movement '
    + 'or convulsions.',
  'Parents should watch their children play and ask them about these symptoms: children and teenagers are '
    + 'more likely than adults to experience these seizures.',
  'To lower the risk: sit farther from the screen, play in a well-lit room, and do not play when you are '
    + 'drowsy or tired.',
]);

function storage(s) {
  if (s) return s;
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch (e) {
    return null;
  }
}

/** Has this browser already been shown it? */
export function wasShown(store) {
  try {
    const st = storage(store);
    return !!(st && st.getItem(STORE_KEY));
  } catch (e) {
    return false;
  }
}

/** Remember it was shown. False if the browser will not keep it. */
export function markShown(store) {
  try {
    const st = storage(store);
    if (!st) return false;
    st.setItem(STORE_KEY, JSON.stringify({ at: Date.now() }));
    return true;
  } catch (e) {
    return false;
  }
}

/** `?intro=1` (or `seizure=1`) forces it, `?intro=0` never: true, false, or null for no say. */
export function urlSwitch(search) {
  try {
    const p = new URLSearchParams(search == null ? (typeof location !== 'undefined' ? location.search : '') : search);
    const v = p.has('intro') ? p.get('intro') : p.get('seizure');
    if (v === '1' || v === 'on') return true;
    if (v === '0' || v === 'off') return false;
  } catch (e) {
    /* no URL to read */
  }
  return null;
}

/** Is a robot driving this page? (The suites are; players are not.) */
export function isAutomated(nav) {
  try {
    const n = nav || (typeof navigator !== 'undefined' ? navigator : null);
    if (!n) return false;
    if (n.webdriver) return true;
    if (/HeadlessChrome/.test(n.userAgent || '')) return true;
  } catch (e) {
    /* a browser that will not say is a player's */
  }
  return false;
}

/** Should the boot show it? First launch only, never for the test robots unless the URL asks. */
export function shouldShowAtBoot({ search = null, store = null, automated = null } = {}) {
  const u = urlSwitch(search);
  if (u !== null) return u;
  if (automated == null ? isAutomated() : automated) return false;
  return !wasShown(store);
}

const CSS = `
.safety-intro {
  position: fixed; inset: 0; z-index: 170; overflow: hidden;
  display: grid; place-items: center;
  background: #060a12; color: #eaf1fb;
  font-family: var(--font, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif);
  -webkit-font-smoothing: antialiased;
  opacity: 0; transition: opacity var(--si-in, 900ms) ease;
  padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);
}
.safety-intro.is-in { opacity: 1; }
.safety-intro.is-out { opacity: 0; transition-duration: var(--si-out, 700ms); pointer-events: none; }
.safety-intro:focus { outline: none; }
.si-art { position: absolute; inset: 0; background: linear-gradient(180deg, #2a3a58 0%, #8a6a5a 46%, #1b3550 70%, #060a12 100%); }
.si-art img {
  position: absolute; inset: -3%; width: 106%; height: 106%; object-fit: cover; object-position: 30% 40%;
  opacity: 0; transition: opacity 1400ms ease; transform-origin: 40% 45%;
}
.si-art img.is-loaded { opacity: 1; }
.safety-intro.is-drifting .si-art img { animation: si-drift 26s ease-out forwards; }
@keyframes si-drift { from { transform: scale(1); } to { transform: scale(1.06) translate3d(-0.8%, -0.5%, 0); } }
.si-shade {
  position: absolute; inset: 0; pointer-events: none;
  background: linear-gradient(180deg, rgba(6, 10, 18, 0.35) 0%, rgba(6, 10, 18, 0.15) 40%, rgba(6, 10, 18, 0.7) 78%, rgba(6, 10, 18, 0.92) 100%);
  transition: background-color 900ms ease;
}
.safety-intro.is-card .si-shade { background-color: rgba(6, 10, 18, 0.62); }

.si-title-block { position: relative; text-align: center; padding: 0 24px; transition: opacity 900ms ease; }
.safety-intro.is-card .si-title-block { opacity: 0; pointer-events: none; }
.si-eyebrow {
  margin: 0; font-size: clamp(11px, 1.4vw, 14px); font-weight: 700; letter-spacing: 0.32em; text-transform: uppercase;
  color: rgba(234, 241, 251, 0.78); text-shadow: 0 1px 14px rgba(0, 0, 0, 0.5);
}
.si-name {
  margin: 14px 0 0; font-weight: 800; letter-spacing: -0.03em; line-height: 0.98;
  font-size: clamp(2.4rem, 8.6vw, 6rem); text-wrap: balance;
  text-shadow: 0 2px 34px rgba(0, 0, 0, 0.5), 0 1px 2px rgba(0, 0, 0, 0.4);
}
.si-tag { margin: 16px 0 0; font-size: clamp(14px, 1.9vw, 20px); color: rgba(234, 241, 251, 0.86); text-shadow: 0 1px 14px rgba(0, 0, 0, 0.55); }
.si-rule { width: 64px; height: 2px; margin: 22px auto 0; border-radius: 2px; background: var(--accent, #58c6ff); opacity: 0.85; }

.si-card {
  position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);
  width: min(640px, calc(100vw - 32px)); max-height: calc(100dvh - 32px); overflow-y: auto; overscroll-behavior: contain;
  box-sizing: border-box; padding: clamp(20px, 3.4vw, 34px);
  background: rgba(10, 16, 28, 0.86); border: 1px solid rgba(150, 185, 230, 0.22); border-radius: 18px;
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.45);
  -webkit-backdrop-filter: blur(14px); backdrop-filter: blur(14px);
  opacity: 0; visibility: hidden; transition: opacity var(--si-card, 700ms) ease, visibility 0s linear var(--si-card, 700ms);
}
.safety-intro.is-card .si-card { opacity: 1; visibility: visible; transition: opacity var(--si-card, 700ms) ease, visibility 0s; }
.si-kick {
  display: inline-flex; align-items: center; gap: 8px; margin: 0;
  font-size: 12px; font-weight: 800; letter-spacing: 0.16em; text-transform: uppercase; color: var(--amber, #ffc247);
}
.si-kick svg { width: 16px; height: 16px; fill: currentColor; }
.si-card h2 { margin: 8px 0 12px; font-size: clamp(20px, 3vw, 27px); line-height: 1.15; letter-spacing: 0.01em; text-transform: uppercase; }
.si-card p.si-p { margin: 0 0 10px; font-size: clamp(14px, 1.7vw, 15.5px); line-height: 1.5; color: rgba(234, 241, 251, 0.9); }
.si-card p.si-p.si-soft { color: var(--text-dim, #9fb2cc); }
.si-opts { display: grid; gap: 8px; margin: 16px 0 18px; }
.si-opt {
  display: flex; align-items: flex-start; gap: 12px; min-height: 48px; box-sizing: border-box;
  padding: 11px 14px; border-radius: 12px; cursor: pointer;
  background: rgba(255, 255, 255, 0.04); border: 1px solid rgba(150, 185, 230, 0.16);
}
.si-opt:focus-within { border-color: var(--accent, #58c6ff); }
.si-opt input { width: 22px; height: 22px; margin: 1px 0 0; flex: none; accent-color: var(--accent, #58c6ff); }
.si-opt b { display: block; font-size: 15px; }
.si-opt small { display: block; margin-top: 2px; font-size: 13px; line-height: 1.4; color: var(--text-dim, #9fb2cc); }
.si-go {
  display: block; width: 100%; min-height: 50px; border: 0; border-radius: 12px; cursor: pointer;
  font: inherit; font-size: 16px; font-weight: 700; letter-spacing: 0.02em;
  color: #06101c; background: var(--accent, #58c6ff);
}
.si-go:focus-visible { outline: 3px solid #eaf1fb; outline-offset: 3px; }
.si-foot { margin: 12px 0 0; text-align: center; font-size: 12.5px; color: var(--text-dim, #9fb2cc); }
@media (max-width: 560px) {
  .si-card { top: auto; bottom: 16px; transform: translate(-50%, 0); max-height: calc(100dvh - 32px - env(safe-area-inset-top)); }
}
@media (prefers-reduced-motion: reduce) {
  .safety-intro.is-drifting .si-art img { animation: none; }
}
`;

let cssIn = false;
function ensureCss(doc) {
  if (cssIn && doc.getElementById('safety-intro-css')) return;
  const el = doc.createElement('style');
  el.id = 'safety-intro-css';
  el.textContent = CSS;
  doc.head.appendChild(el);
  cssIn = true;
}

const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const WARN_GLYPH = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5 1.6 20.5h20.8zm-1 6.5h2v6h-2zm0 7.6h2v2h-2z"/></svg>';

/** The one on screen, if any. */
let current = null;

/** Is it up? */
export function isOpen() {
  return !!current;
}

/**
 * Put it up. Resolves with { reduceFlashing, reducedMotion } once the player
 * presses Continue (or close() is called).
 *
 * opts = {
 *   settings     the game's settings (read: reduceFlashing, reducedMotion)
 *   apply(p, v)  apply and save one setting (main.js applySetting)
 *   skipIntro    straight to the warning (Settings' "show it again")
 *   art          the picture (default Kestrel's loading picture)
 *   doc, store, timing
 * }
 */
export function showSafetyIntro(opts = {}) {
  if (current) return current.done;
  const doc = opts.doc || document;
  const T = { ...INTRO_TIMING, ...(opts.timing || {}) };
  const settings = opts.settings || {};
  const apply = typeof opts.apply === 'function' ? opts.apply : () => {};
  ensureCss(doc);

  const flashOn = settings.reduceFlashing !== false;
  const motionOn = !!settings.reducedMotion;
  const el = doc.createElement('div');
  el.className = 'safety-intro';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-labelledby', 'si-title');
  el.tabIndex = -1;
  el.style.setProperty('--si-in', `${T.fadeInMs}ms`);
  el.style.setProperty('--si-out', `${T.fadeOutMs}ms`);
  el.style.setProperty('--si-card', `${T.cardFadeMs}ms`);
  el.innerHTML = `
    <div class="si-art"><img alt="" decoding="async"></div>
    <div class="si-shade"></div>
    <div class="si-title-block" aria-hidden="true">
      <p class="si-eyebrow">Welcome aboard</p>
      <h1 class="si-name">Island Flight Simulator</h1>
      <p class="si-tag">Take off, explore the islands, and land anywhere.</p>
      <div class="si-rule"></div>
    </div>
    <section class="si-card" data-si-card>
      <p class="si-kick">${WARN_GLYPH}<span>${esc(WARNING_KICKER)}</span></p>
      <h2 id="si-title">${esc(WARNING_TITLE)}</h2>
      ${WARNING_TEXT.map((t, i) => `<p class="si-p${i === WARNING_TEXT.length - 1 ? ' si-soft' : ''}">${esc(t)}</p>`).join('')}
      <div class="si-opts">
        <label class="si-opt"><input type="checkbox" data-si="reduceFlashing"${flashOn ? ' checked' : ''}>
          <span><b>Reduce flashing</b><small>On by default. Lightning, explosions and strobe lights stay dim and soft, never more than three flashes a second.</small></span></label>
        <label class="si-opt"><input type="checkbox" data-si="reducedMotion"${motionOn ? ' checked' : ''}>
          <span><b>Reduce motion</b><small>Much less camera shake and no drifting pictures.</small></span></label>
      </div>
      <button type="button" class="si-go" data-si-continue>Continue</button>
      <p class="si-foot">Enter continues · Change these any time in Settings → Accessibility</p>
    </section>`;
  const host = doc.body || doc.documentElement;
  host.appendChild(el);

  const img = el.querySelector('.si-art img');
  img.addEventListener('load', () => img.classList.add('is-loaded'));
  img.addEventListener('error', () => img.remove());
  img.src = opts.art || 'assets/loading/kestrel.jpg';

  const timers = [];
  const later = (fn, ms) => timers.push(setTimeout(fn, ms));
  const t0 = Date.now();
  let phase = 'intro';
  let resolveDone;
  const done = new Promise((r) => (resolveDone = r));
  const prevFocus = doc.activeElement;

  const drift = (on) => el.classList.toggle('is-drifting', !!on);
  drift(!motionOn);

  const toCard = () => {
    if (phase !== 'intro') return;
    phase = 'card';
    el.classList.add('is-card');
    const go = el.querySelector('[data-si-continue]');
    try {
      go.focus({ preventScroll: true });
    } catch (e) {
      go.focus();
    }
  };

  const values = () => ({
    reduceFlashing: !!el.querySelector('[data-si="reduceFlashing"]').checked,
    reducedMotion: !!el.querySelector('[data-si="reducedMotion"]').checked,
  });

  const finish = () => {
    if (phase === 'out') return;
    phase = 'out';
    const v = values();
    markShown(opts.store);
    for (const id of timers) clearTimeout(id);
    window.removeEventListener('keydown', onKey, true);
    el.classList.add('is-out');
    el.classList.remove('is-in');
    const gone = () => {
      el.remove();
      if (current && current.el === el) current = null;
      try {
        if (prevFocus && prevFocus.focus && prevFocus !== doc.body) prevFocus.focus({ preventScroll: true });
      } catch (e) {
        /* nothing to give focus back to */
      }
    };
    setTimeout(gone, T.fadeOutMs + 40);
    resolveDone(v);
  };

  el.addEventListener('change', (e) => {
    const box = e.target.closest('[data-si]');
    if (!box) return;
    const path = box.dataset.si;
    try {
      apply(path, !!box.checked);
    } catch (err) {
      console.warn('[safety-intro] could not apply', path, err);
    }
    if (path === 'reducedMotion') drift(!box.checked);
  });
  el.addEventListener('click', (e) => {
    if (e.target.closest('[data-si-continue]')) {
      e.preventDefault();
      if (phase === 'card') finish();
      return;
    }
    if (phase === 'intro' && Date.now() - t0 >= T.skipAfterMs) toCard();
  });

  function trapTab(e) {
    const f = [...el.querySelectorAll('[data-si-card] input, [data-si-card] button')];
    if (!f.length) return;
    const i = f.indexOf(doc.activeElement);
    const n = e.shiftKey ? (i <= 0 ? f.length - 1 : i - 1) : (i < 0 || i >= f.length - 1 ? 0 : i + 1);
    e.preventDefault();
    f[n].focus();
  }

  // Capture, and kept to itself: nothing behind the card (the main menu's own keys) hears a key while it is up.
  function onKey(e) {
    if (phase === 'out') return;
    e.stopPropagation();
    if (phase === 'intro') {
      e.preventDefault();
      if (Date.now() - t0 >= T.skipAfterMs) toCard();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      finish();
    } else if (e.key === 'Tab') {
      trapTab(e);
    } else if (e.key === ' ') {
      // A focused switch flips (its own default); anywhere else Space does nothing.
      if (!(doc.activeElement && doc.activeElement.matches && doc.activeElement.matches('[data-si-card] input, [data-si-card] button'))) e.preventDefault();
    } else {
      e.preventDefault();
    }
  }
  window.addEventListener('keydown', onKey, true);

  try {
    el.focus({ preventScroll: true });
  } catch (e) {
    /* focus is a nicety */
  }
  // Fade in on the next tick (timers, not rAF), then the title, then the card.
  later(() => el.classList.add('is-in'), 20);
  if (opts.skipIntro) later(toCard, 20);
  else later(toCard, T.fadeInMs + T.titleHoldMs);

  current = {
    el,
    done,
    phase: () => phase,
    toCard,
    continue: () => {
      if (phase === 'intro') toCard();
      finish();
    },
    values,
  };
  return done;
}

/** The one on screen, for tests and Settings: { el, phase(), toCard(), continue(), values() } or null. */
export function currentIntro() {
  return current;
}
