/**
 * The on-screen bits the flight events and the goofy missions share: a story
 * card on the right (who is talking and what they said, with a transponder
 * readout, a big button or a choice of answers when there is something to
 * press), a meter underneath it for the missions that have one — toast, ice
 * cream, the cow's mood, how angry the hijacker is — and a small arrow that
 * says which way to turn when there is no mission to put one on the HUD.
 *
 * It lives in the extension layer, which sits ABOVE the menus (z-index 30
 * against their 10), and the game only calls a feature's update() while it is
 * flying. So nothing here can rely on being told to hide when a debrief or the
 * pause menu comes up. A quarter-second watcher does it instead: the whole
 * panel is hidden unless the game is actually flying. It never allocates, and
 * it only writes to the DOM when something changed.
 *
 * The buttons are the only pieces of this that take clicks. Everything else
 * is pointer-events: none, like the layer it sits in — a card must never be
 * the reason a tap meant for the touch stick went nowhere.
 */

import { extLayer } from '../../game/extensions.js';
import { isKey, keyName, rekey, bindingsVersion } from '../../flight/input.js';

const CSS = `
#fx-ev { position: absolute; right: 16px; top: 110px; width: min(310px, 80vw); display: flex; flex-direction: column; gap: 8px;
  font-family: var(--font, -apple-system, 'Segoe UI', Roboto, sans-serif); color: var(--text, #eaf1fb); pointer-events: none; }
#fx-ev[hidden], #fx-ev [hidden] { display: none !important; }
#fx-ev .fx-card, #fx-ev .fx-meter, #fx-ev .fx-guide { background: var(--panel, rgba(12, 20, 34, 0.8)); border: 1px solid var(--panel-line, rgba(140, 180, 230, 0.2));
  border-radius: 14px; padding: 11px 14px; box-shadow: 0 12px 34px rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); }
#fx-ev .fx-card { animation: fxIn 0.35s ease; }
#fx-ev .fx-card.is-warn { border-color: rgba(255, 194, 71, 0.6); }
#fx-ev .fx-card.is-good { border-color: rgba(79, 214, 132, 0.6); }
#fx-ev .fx-card.is-bad { border-color: rgba(255, 106, 90, 0.75); background: rgba(38, 12, 14, 0.86); }
#fx-ev .fx-who { font-size: 11px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--accent, #58c6ff); margin-bottom: 4px; }
#fx-ev .is-warn .fx-who { color: var(--amber, #ffc247); }
#fx-ev .is-good .fx-who { color: var(--good, #4fd684); }
#fx-ev .is-bad .fx-who { color: #ff8a7a; }
#fx-ev .fx-head { display: flex; gap: 10px; align-items: flex-start; }
#fx-ev .fx-icon { flex: 0 0 52px; width: 52px; height: 40px; color: #ffc247; }
#fx-ev .fx-icon svg { width: 100%; height: 100%; display: block; }
#fx-ev .fx-text { font-size: 14px; line-height: 1.4; }
#fx-ev .fx-row { display: flex; align-items: center; gap: 10px; margin-top: 10px; flex-wrap: wrap; }
#fx-ev .fx-code { font-family: var(--mono, ui-monospace, Menlo, monospace); font-size: 21px; letter-spacing: 0.16em; padding: 3px 10px;
  border-radius: 8px; background: #050a12; color: #7ee8b2; border: 1px solid rgba(126, 232, 178, 0.35); }
#fx-ev .fx-code.is-alert { color: #ffc247; border-color: rgba(255, 194, 71, 0.6); }
#fx-ev .fx-code-label { font-size: 10px; letter-spacing: 0.14em; color: var(--text-dim, #9fb2cc); text-transform: uppercase; }
#fx-ev .fx-btn { pointer-events: auto; font: inherit; font-size: 14px; font-weight: 700; min-height: 44px; padding: 9px 14px; border: 0;
  border-radius: 10px; background: var(--amber, #ffc247); color: #1c1400; cursor: pointer; touch-action: manipulation; text-align: left; }
#fx-ev .fx-btn:active { transform: scale(0.97); }
#fx-ev .fx-btn kbd { font-family: var(--mono, monospace); font-size: 12px; background: rgba(0, 0, 0, 0.18); border-radius: 5px; padding: 1px 6px; margin-left: 6px; }
#fx-ev .fx-choices { display: flex; flex-direction: column; gap: 6px; margin-top: 10px; }
#fx-ev .fx-choice { pointer-events: auto; font: inherit; font-size: 13.5px; font-weight: 600; min-height: 44px; padding: 8px 12px; border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.18); background: rgba(255, 255, 255, 0.08); color: inherit; cursor: pointer; touch-action: manipulation;
  display: flex; gap: 10px; align-items: center; text-align: left; }
#fx-ev .fx-choice:hover { background: rgba(255, 255, 255, 0.14); }
#fx-ev .fx-choice:active { transform: scale(0.98); }
#fx-ev .fx-choice kbd { flex: 0 0 auto; font-family: var(--mono, monospace); font-size: 13px; font-weight: 700; min-width: 24px; text-align: center;
  background: var(--amber, #ffc247); color: #1c1400; border-radius: 6px; padding: 2px 6px; }
#fx-ev .fx-meter-label { display: flex; justify-content: space-between; font-size: 12px; font-weight: 600; margin-bottom: 6px; color: var(--text-dim, #9fb2cc); }
#fx-ev .fx-meter-track { height: 10px; border-radius: 99px; background: rgba(255, 255, 255, 0.1); overflow: hidden; }
#fx-ev .fx-meter-fill { height: 100%; width: 100%; border-radius: 99px; transform-origin: left center; transform: scaleX(0);
  background: var(--accent, #58c6ff); transition: transform 0.2s linear; }
#fx-ev .fx-meter-fill.is-good { background: var(--good, #4fd684); }
#fx-ev .fx-meter-fill.is-warn { background: var(--amber, #ffc247); }
#fx-ev .fx-meter-fill.is-bad { background: var(--red, #ff6a5a); }
#fx-ev .fx-guide { display: flex; align-items: center; gap: 12px; padding: 8px 12px; }
#fx-ev .fx-arrow { flex: 0 0 34px; width: 34px; height: 34px; border-radius: 50%; background: rgba(88, 198, 255, 0.16);
  display: grid; place-items: center; }
#fx-ev .fx-arrow svg { width: 22px; height: 22px; color: var(--accent, #58c6ff); transition: transform 0.25s linear; }
#fx-ev .fx-guide-text { font-size: 12.5px; line-height: 1.3; }
#fx-ev .fx-guide-text b { display: block; font-size: 13.5px; }
@keyframes fxIn { from { opacity: 0; transform: translateX(12px); } }
/* The card sits under the wind panel (which ends near 96 px), not at 34%:
   at 34% of an 800 px screen a hijack card with its code and its button ran
   down over the minimap. Up here there is room for three answers above it. */
/* Narrow and portrait screens: the game's centre banner reaches across to
   the right edge there, and at 34% the card sat on top of it (seen at
   768 x 1024). Just under the wind panel is clear of the banner, the
   objective and the subtitles. */
@media (max-width: 900px) {
  #fx-ev { top: 128px; right: 10px; width: min(280px, 64vw); }
  #fx-ev .fx-text { font-size: 13px; }
  #fx-ev .fx-icon { flex-basis: 40px; width: 40px; height: 30px; }
}
@media (prefers-reduced-motion: reduce) { #fx-ev .fx-card { animation: none; } #fx-ev .fx-meter-fill, #fx-ev .fx-arrow svg { transition: none; } }
`;

/*
 * Pictures for the intercept signals, because a ten-year-old reads a
 * picture of an aeroplane rocking its wings faster than the words for it.
 * Line drawings in currentColor; no images.
 */
const PLANE = '<path d="M26 8 L28 17 L44 21 L44 24 L28 22 L27 30 L31 33 L31 35 L26 34 L21 35 L21 33 L25 30 L24 22 L8 24 L8 21 L24 17 Z" fill="currentColor"/>';
const ICONS = {
  rock: `<svg viewBox="0 0 52 40" aria-hidden="true"><g transform="rotate(-14 26 21)">${PLANE}</g>`
    + '<path d="M4 12 q-3 5 0 10 M48 18 q3 5 0 10" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>'
    + '<path d="M2 20 l2 3 l2 -3 M46 26 l2 3 l2 -3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  breakaway: `<svg viewBox="0 0 52 40" aria-hidden="true"><g transform="translate(-6 6) scale(0.8)">${PLANE}</g>`
    + '<path d="M26 18 q10 -2 16 -12" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-dasharray="3 3"/>'
    + '<path d="M38 5 l5 0 l-1 5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
  // The leader's wheels down: "land at this aerodrome".
  gear: `<svg viewBox="0 0 52 40" aria-hidden="true"><g transform="translate(0 -4)">${PLANE}</g>`
    + '<path d="M20 29 v6 M32 29 v6 M26 26 v7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'
    + '<circle cx="20" cy="36.5" r="2" fill="currentColor"/><circle cx="32" cy="36.5" r="2" fill="currentColor"/><circle cx="26" cy="34.5" r="2" fill="currentColor"/></svg>',
  xpdr: '<svg viewBox="0 0 52 40" aria-hidden="true"><rect x="3" y="9" width="46" height="22" rx="4" fill="none" stroke="currentColor" stroke-width="2"/>'
    + '<text x="26" y="25" text-anchor="middle" font-family="monospace" font-size="12" font-weight="700" fill="currentColor">7500</text></svg>',
  door: '<svg viewBox="0 0 52 40" aria-hidden="true"><rect x="15" y="4" width="22" height="33" rx="2" fill="none" stroke="currentColor" stroke-width="2.2"/>'
    + '<rect x="21" y="18" width="10" height="8" rx="1.5" fill="currentColor"/><path d="M23 18 v-3 a3 3 0 0 1 6 0 v3" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>',
  phone: '<svg viewBox="0 0 52 40" aria-hidden="true"><path d="M14 8 q-6 12 6 24 l5 -4 l-5 -6 l-3 2 q-4 -5 -2 -11 l4 0 l1 -7 z" fill="currentColor"/>'
    + '<path d="M30 12 q5 4 0 10 M35 8 q9 8 0 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
};
const ARROW = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 L19 20 L12 16 L5 20 Z" fill="currentColor"/></svg>';

/*
 * A card's answers are written with the number they were given ('8', '9',
 * '0') and the squawk button with '7'; the keys are actions in the one
 * registry (flight-events.js declares them: Settings → Controls → Missions
 * & events), so the card shows — and listens for — wherever they are now.
 */
const KEY_ACTION = { 7: 'eventSquawk', 8: 'eventChoice1', 9: 'eventChoice2', 0: 'eventChoice3' };
const keyFor = (k) => (KEY_ACTION[k] ? keyName(KEY_ACTION[k], simRef) : String(k));

let root = null;
let simRef = null;
let watcher = null;
const el = {};
const state = {
  card: false, meter: false, guide: false, cardLeft: 0, onPress: null, onChoice: null, choiceKeys: [],
  cardKey: '', meterKey: '', meterValue: -1, meterTone: '', guideKey: '', guideRot: 999,
};

function ensure(sim) {
  if (sim) simRef = sim;
  if (root) return root;
  if (typeof document === 'undefined' || !document.head) return null;
  const style = document.createElement('style');
  style.id = 'fx-ev-style';
  style.textContent = CSS;
  document.head.appendChild(style);

  root = document.createElement('div');
  root.id = 'fx-ev';
  root.hidden = true;
  root.innerHTML = `
    <div class="fx-card" data-fx-card hidden role="status" aria-live="polite">
      <div class="fx-head">
        <div class="fx-icon" data-fx-icon hidden></div>
        <div>
          <div class="fx-who" data-fx-who></div>
          <div class="fx-text" data-fx-text></div>
        </div>
      </div>
      <div class="fx-row" data-fx-row hidden>
        <div data-fx-xpdr hidden><div class="fx-code-label">Transponder</div><div class="fx-code" data-fx-code>2000</div></div>
        <button class="fx-btn" type="button" data-fx-btn hidden></button>
      </div>
      <div class="fx-choices" data-fx-choices hidden>
        <button class="fx-choice" type="button" data-fx-c0 hidden></button>
        <button class="fx-choice" type="button" data-fx-c1 hidden></button>
        <button class="fx-choice" type="button" data-fx-c2 hidden></button>
      </div>
    </div>
    <div class="fx-meter" data-fx-meter hidden>
      <div class="fx-meter-label"><span data-fx-mlabel></span><span data-fx-mvalue></span></div>
      <div class="fx-meter-track"><div class="fx-meter-fill" data-fx-mfill></div></div>
    </div>
    <div class="fx-guide" data-fx-guide hidden>
      <div class="fx-arrow"><span data-fx-arrow>${ARROW}</span></div>
      <div class="fx-guide-text"><b data-fx-glabel></b><span data-fx-gsub></span></div>
    </div>`;
  extLayer().appendChild(root);
  for (const k of ['card', 'icon', 'who', 'text', 'row', 'xpdr', 'code', 'btn', 'choices', 'c0', 'c1', 'c2', 'meter', 'mlabel', 'mvalue', 'mfill', 'guide', 'arrow', 'glabel', 'gsub']) {
    el[k] = root.querySelector(`[data-fx-${k}]`);
  }
  el.arrowSvg = el.arrow.querySelector('svg');
  const fire = (fn, arg) => {
    if (!fn) return;
    try { fn(arg); } catch (err) { console.error('[events] button failed', err); }
  };
  el.btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    fire(state.onPress);
  });
  // Touch: act on the touch itself, so a thumb that is also on the stick
  // does not have to wait for a synthetic click that may never come.
  el.btn.addEventListener('touchend', (e) => {
    e.preventDefault();
    fire(state.onPress);
  }, { passive: false });
  [el.c0, el.c1, el.c2].forEach((b, i) => {
    b.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      fire(state.onChoice, i);
    });
    b.addEventListener('touchend', (e) => {
      e.preventDefault();
      fire(state.onChoice, i);
    }, { passive: false });
  });

  watcher = setInterval(tick, 250);
  if (watcher && watcher.unref) watcher.unref();
  return root;
}

/** Show or hide the whole panel. */
function tick() {
  if (!root) return;
  const flying = !!simRef && simRef.state === 'flying';
  const want = flying && (state.card || state.meter || state.guide);
  if (root.hidden === want) root.hidden = !want;
}

/**
 * The story card.
 *
 * @param {object} o
 * @param {string} o.who     the speaker, e.g. 'Cabin crew'
 * @param {string} o.text    what they said (plain text, not HTML)
 * @param {'info'|'warn'|'good'|'bad'} [o.tone]
 * @param {string|null} [o.code]   a transponder code to show, or null
 * @param {boolean} [o.alert]      show the code in amber
 * @param {object|null} [o.button] { label, key, onPress }
 * @param {Array<{key:string,label:string}>|null} [o.choices]  up to three answers, keyed 8, 9, 0
 * @param {function(number):void} [o.onChoice]  called with the index picked
 * @param {string|null} [o.icon]   'rock' | 'breakaway' | 'gear' | 'xpdr' | 'door' | 'phone'
 * @param {number} [o.ttl]   seconds before it hides itself; 0 keeps it up
 */
export function showCard(sim, { who = '', text = '', tone = 'info', code = null, alert = false, button = null, choices = null, onChoice = null, icon = null, ttl = 0 } = {}) {
  if (!ensure(sim)) return;
  const list = Array.isArray(choices) ? choices.slice(0, 3) : null;
  const key = `${who}|${text}|${tone}|${code}|${alert}|${button ? button.label : ''}|${list ? list.map((c) => c.label).join('/') : ''}|${icon}|${bindingsVersion()}`;
  state.card = true;
  state.cardLeft = ttl > 0 ? ttl : 0;
  state.onPress = button && button.onPress ? button.onPress : null;
  state.onChoice = list && onChoice ? onChoice : null;
  state.choiceKeys.length = 0;
  if (list) for (const c of list) state.choiceKeys.push(String(c.key));
  if (key !== state.cardKey) {
    state.cardKey = key;
    el.card.className = `fx-card is-${tone}`;
    el.who.textContent = who;
    el.text.textContent = rekey(text, 'plane');
    el.icon.hidden = !(icon && ICONS[icon]);
    if (icon && ICONS[icon]) el.icon.innerHTML = ICONS[icon];
    el.xpdr.hidden = code == null;
    if (code != null) {
      el.code.textContent = code;
      el.code.classList.toggle('is-alert', !!alert);
    }
    el.btn.hidden = !button;
    if (button) {
      el.btn.textContent = button.label;
      if (button.key) {
        const k = document.createElement('kbd');
        k.textContent = keyFor(button.key);
        el.btn.appendChild(k);
      }
      el.btn.setAttribute('aria-label', button.label);
    }
    el.row.hidden = code == null && !button;
    const btns = [el.c0, el.c1, el.c2];
    for (let i = 0; i < 3; i++) {
      const c = list && list[i];
      btns[i].hidden = !c;
      if (c) {
        btns[i].textContent = '';
        const k = document.createElement('kbd');
        k.textContent = keyFor(c.key);
        const span = document.createElement('span');
        span.textContent = c.label;
        btns[i].append(k, span);
        btns[i].setAttribute('aria-label', `${c.label} (key ${keyFor(c.key)})`);
      }
    }
    el.choices.hidden = !list || !list.length;
  }
  el.card.hidden = false;
  tick();
}

/**
 * Time a card out, in game seconds: called from the game's own update (the
 * goofyprops extension, which is always loaded), so it stands still while
 * the game is paused. It used to be timed off performance.now() by the
 * panel's 250 ms watcher, and a card could vanish behind the pause screen —
 * the 20 s ending of a hijack among them.
 */
export function ageCard(dt) {
  if (!state.card || !(state.cardLeft > 0)) return;
  state.cardLeft -= dt;
  if (state.cardLeft <= 0) {
    state.cardLeft = 0;
    hideCard();
  }
}

export function hideCard() {
  state.card = false;
  state.onPress = null;
  state.onChoice = null;
  state.choiceKeys.length = 0;
  state.cardKey = '';
  if (el.card) el.card.hidden = true;
  tick();
}

/** True while the card is asking a question. */
export function choosing() {
  return state.card && !!state.onChoice;
}

/**
 * A key press, if it answers the question on the card. Returns true if it
 * did — the caller consumes the key then, and only then.
 */
export function chooseByCode(code) {
  if (!state.card || !state.onChoice) return false;
  for (let i = 0; i < state.choiceKeys.length; i++) {
    const action = KEY_ACTION[state.choiceKeys[i]];
    if (action && isKey(simRef, action, code)) {
      const fn = state.onChoice;
      try { fn(i); } catch (err) { console.error('[events] choice failed', err); }
      return true;
    }
  }
  return false;
}

/** Is this key one the card is listening for? (So its key-up is eaten too.) */
export function isChoiceCode(code) {
  if (!state.card || !state.onChoice) return false;
  for (const k of state.choiceKeys) {
    const action = KEY_ACTION[k];
    if (action && isKey(simRef, action, code)) return true;
  }
  return false;
}

/**
 * The meter.
 * @param {number} value 0..1
 * @param {string} [text] shown on the right, e.g. '62%'
 */
export function showMeter(sim, { label = '', value = 0, text = null, tone = 'info' } = {}) {
  if (!ensure(sim)) return;
  const v = Math.max(0, Math.min(1, value || 0));
  const shown = text != null ? text : `${Math.round(v * 100)}%`;
  const key = `${label}|${shown}`;
  state.meter = true;
  if (key !== state.meterKey) {
    state.meterKey = key;
    el.mlabel.textContent = label;
    el.mvalue.textContent = shown;
  }
  if (Math.abs(v - state.meterValue) > 0.004) {
    state.meterValue = v;
    el.mfill.style.transform = `scaleX(${v.toFixed(3)})`;
  }
  if (tone !== state.meterTone) {
    state.meterTone = tone;
    el.mfill.className = `fx-meter-fill is-${tone}`;
  }
  el.meter.hidden = false;
  tick();
}

export function hideMeter() {
  state.meter = false;
  state.meterKey = '';
  state.meterValue = -1;
  if (el.meter) el.meter.hidden = true;
  tick();
}

/**
 * Which way to turn, for when there is no mission to put an arrow on the
 * HUD. `rel` is the bearing of the place relative to the nose, in degrees
 * (0 straight ahead, 90 off the right wing). Called every frame; it touches
 * the page only when the arrow has moved by more than a couple of degrees or
 * the words have changed.
 */
export function showGuide(sim, label, sub, rel) {
  if (!ensure(sim)) return;
  const key = `${label}|${sub}`;
  if (key !== state.guideKey) {
    state.guideKey = key;
    el.glabel.textContent = label;
    el.gsub.textContent = sub;
  }
  const r = Math.round(rel / 3) * 3;
  if (r !== state.guideRot) {
    state.guideRot = r;
    el.arrowSvg.style.transform = `rotate(${r}deg)`;
  }
  if (!state.guide) {
    state.guide = true;
    el.guide.hidden = false;
    tick();
  }
}

export function hideGuide() {
  if (!state.guide) return;
  state.guide = false;
  state.guideKey = '';
  state.guideRot = 999;
  if (el.guide) el.guide.hidden = true;
  tick();
}

export function hideAll() {
  hideCard();
  hideMeter();
  hideGuide();
}

/** For the tests: what is on screen right now. */
export function uiState() {
  const choices = [];
  if (el.c0 && el.choices && !el.choices.hidden) {
    for (const b of [el.c0, el.c1, el.c2]) if (!b.hidden) choices.push(b.textContent);
  }
  return {
    card: state.card,
    meter: state.meter,
    guide: state.guide,
    tone: el.card ? el.card.className.replace('fx-card ', '') : '',
    who: el.who ? el.who.textContent : '',
    text: el.text ? el.text.textContent : '',
    code: el.code && !el.xpdr.hidden ? el.code.textContent : null,
    button: el.btn && !el.btn.hidden ? el.btn.textContent : null,
    choices,
    meterLabel: el.mlabel ? el.mlabel.textContent : '',
    guideLabel: el.glabel ? el.glabel.textContent : '',
    guideSub: el.gsub ? el.gsub.textContent : '',
  };
}

/** For the tests: press the card's button the way a finger would. */
export function pressButton() {
  if (state.onPress) state.onPress();
  return !!state.onPress;
}

/** For the tests: tap answer `i` the way a finger would. */
export function pressChoice(i) {
  if (!state.onChoice) return false;
  state.onChoice(i);
  return true;
}
