/**
 * The "Start at" picker on the Free Flight screen.
 *
 * Put in the bottom bar beside Take off, the way carrier/ui.js puts its
 * Carrier / Airbase choice there — and it REPLACES that choice: the carrier
 * is one of the entries here now, for a military aeroplane. A select rather
 * than a row of buttons, because a helicopter map can offer six places and
 * the bar is one line on a phone.
 *
 *   picker(menusRoot, { entries, get, set, visible })
 *     entries()  → [{ id, label }]   what this map and aircraft offer
 *     get()      → the saved id (or 'auto')
 *     set(id)    saves a choice
 *     visible()  → whether to show it at all
 *   Returns the box, with box.paint() to refresh it.
 */

const CSS = `
.sp-start { display: none; align-items: center; gap: 8px; margin-right: 10px; font: 700 12px/1 var(--font, system-ui); color: #c9d6e6; }
.sp-start.is-on { display: inline-flex; }
.sp-start select { height: 34px; padding: 0 10px; border-radius: 10px; border: 1px solid rgba(160,190,230,.35); background: rgba(255,255,255,.06);
  color: #e6eef8; font: 700 12px/1 var(--font, system-ui); max-width: 46vw; }
.sp-start select:focus { outline: 2px solid rgba(124,199,255,.8); outline-offset: 1px; }
`;

let styled = false;
function style() {
  if (styled || typeof document === 'undefined') return;
  styled = true;
  const s = document.createElement('style');
  s.textContent = CSS;
  document.head.appendChild(s);
}

const UI = { box: null, select: null };

export function picker(menusRoot, { entries, get, set, visible }) {
  if (!menusRoot) return null;
  const fly = menusRoot.querySelector('[data-fly]');
  if (!fly || !fly.parentElement) return null;
  style();
  if (!UI.box || !UI.box.isConnected) {
    const box = document.createElement('div');
    box.className = 'sp-start';
    box.dataset.spStart = '';
    const label = document.createElement('span');
    label.textContent = 'Start at';
    const select = document.createElement('select');
    select.dataset.spStart = 'select';
    select.setAttribute('aria-label', 'Where to start');
    select.addEventListener('change', (e) => {
      e.stopPropagation();
      set(select.value);
      paint();
    });
    // A click on the select must not be read as a click on the bar.
    select.addEventListener('click', (e) => e.stopPropagation());
    box.appendChild(label);
    box.appendChild(select);
    // Before the carrier's own box if it is there, so the order reads left to right.
    const co = fly.parentElement.querySelector('.co-start');
    fly.parentElement.insertBefore(box, co || fly);
    UI.box = box;
    UI.select = select;
  }
  const paint = () => {
    let list = [];
    try {
      list = entries() || [];
    } catch (e) {
      list = [];
    }
    const show = !!visible() && list.length > 1;
    UI.box.classList.toggle('is-on', show);
    if (!show) return;
    const want = get() || 'auto';
    const key = list.map((e) => e.id).join('|');
    if (UI.select.dataset.key !== key) {
      UI.select.dataset.key = key;
      UI.select.textContent = '';
      for (const e of list) {
        const o = document.createElement('option');
        o.value = e.id;
        o.textContent = e.label;
        UI.select.appendChild(o);
      }
    }
    const has = list.some((e) => e.id === want);
    UI.select.value = has ? want : 'auto';
  };
  paint();
  UI.box.paint = paint;
  return UI.box;
}

export function pickerState() {
  return {
    shown: !!(UI.box && UI.box.isConnected && UI.box.classList.contains('is-on')),
    value: UI.select ? UI.select.value : null,
    options: UI.select ? Array.from(UI.select.options).map((o) => o.value) : [],
  };
}

export { UI };
