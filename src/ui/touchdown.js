/**
 * The touchdown card.
 *
 * Every landing gets a card in the centre lane: the rate of descent at the
 * moment the wheels touched, in feet per minute, a one-word grade for it, up
 * to three stars, and your best ever in this aeroplane, kept in localStorage.
 * Players chase these numbers — the research brief found the creator talking
 * about "butters" for a whole video — and the number is the only honest
 * feedback a landing gives, because a heavy arrival feels fine from the
 * cockpit until you see it written down.
 *
 * Words, not cartoons: a grade word, a number and stars. The physics' own
 * grade (perfect / good / firm / rough, physics.js gradeTouchdown) still
 * drives the score, the tower's line and the achievements; these bands are
 * the player-facing ones from the brief and are a little stricter at the top.
 */

/**
 * Under this many ft/min the card says "Butter" — and the Butter achievement
 * unlocks on exactly that (achievements/rules.js isButter; its description
 * names this number). They used to disagree: the card said Butter under 120
 * and the achievement wanted under 60.
 */
export const BUTTER_FPM = 120;

export const GRADES = [
  { id: 'butter', word: 'Butter', max: BUTTER_FPM, stars: 3, note: 'You barely felt that.' },
  { id: 'smooth', word: 'Smooth', max: 240, stars: 2, note: 'Easy and controlled.' },
  { id: 'firm', word: 'Firm', max: 400, stars: 1, note: 'A bump, but perfectly safe.' },
  { id: 'hard', word: 'Hard', max: 600, stars: 0, note: 'Arrive more slowly next time.' },
  { id: 'ouch', word: 'Ouch', max: Infinity, stars: 0, note: 'That was heavy. Flare a little earlier.' },
];

/** The grade for a descent rate (either sign) in ft/min. */
export function landingGrade(vsFpm) {
  const rate = Math.abs(Math.round(Number(vsFpm) || 0));
  const g = GRADES.find((k) => rate < k.max) || GRADES[GRADES.length - 1];
  return { ...g, rate };
}

/** Would the touchdown card call this landing a Butter? (The achievement asks the same.) */
export function isButter(vsFpm) {
  return landingGrade(vsFpm).id === 'butter';
}

/** Three stars as text: lit ones first, the rest dim. */
export function starsHtml(n) {
  let out = '';
  for (let i = 0; i < 3; i++) out += `<span class="${i < n ? 'is-lit' : 'is-dim'}">★</span>`;
  return out;
}

const KEY = 'islandsim.touchdowns.v1';

function storage(store) {
  if (store) return store;
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch (e) {
    return null;
  }
}

/** { aircraftId: { rate, grade, date } } — every aeroplane's best, or {} if nothing is saved. */
export function loadBests(store) {
  const s = storage(store);
  if (!s) return {};
  try {
    const raw = s.getItem(KEY);
    const v = raw ? JSON.parse(raw) : {};
    return v && typeof v === 'object' ? v : {};
  } catch (e) {
    return {};
  }
}

/**
 * Note a landing against the aeroplane's best. Returns what the card says:
 * `best` (the best after this landing), `isNew` (this landing set it), and
 * `previous` (the best before it, or null for the first landing).
 */
export function noteBest(aircraftId, vsFpm, store) {
  const id = String(aircraftId || 'plane');
  const rate = Math.abs(Math.round(Number(vsFpm) || 0));
  const all = loadBests(store);
  const prev = all[id] && Number.isFinite(all[id].rate) ? all[id].rate : null;
  const isNew = prev === null || rate < prev;
  if (isNew) {
    all[id] = { rate, grade: landingGrade(rate).id, date: new Date().toISOString().slice(0, 10) };
    const s = storage(store);
    if (s) {
      try {
        s.setItem(KEY, JSON.stringify(all));
      } catch (e) {
        /* private mode, full: the card still shows this landing */
      }
    }
  }
  return { best: isNew ? rate : prev, isNew, previous: prev };
}

/** The last line of the card. */
export function bestLine({ isNew, previous, best }, aircraftName) {
  const who = aircraftName ? ` in the ${aircraftName}` : '';
  if (previous === null) return `Your first landing${who} — this is the one to beat`;
  if (isNew) return `New personal best${who} · was ${previous.toLocaleString('en-GB')} ft/min`;
  return `Your best${who}: ${best.toLocaleString('en-GB')} ft/min`;
}

const SHOW_FOR = 6.5; // seconds on screen

export class TouchdownCard {
  constructor() {
    this.timer = 0;
    this.last = null;
    if (typeof document === 'undefined') return;
    const el = document.createElement('div');
    el.className = 'hud-touchdown';
    el.style.display = 'none';
    el.setAttribute('role', 'status');
    this.el = el;
  }

  /**
   * @param {object} g         the physics' touchdown grade (vsFpm, score, onRunway, crashed)
   * @param {object} aircraft  { id, name } — the aeroplane you are in
   * @param {object} store     a localStorage stand-in for tests
   */
  show(g, aircraft = {}, store) {
    if (!g || g.crashed || !this.el) return null;
    const grade = landingGrade(g.vsFpm);
    const best = noteBest(aircraft.id, grade.rate, store);
    const tone = grade.stars >= 2 ? 'good' : grade.stars === 1 ? 'ok' : grade.id === 'hard' ? 'warn' : 'bad';
    const extra = [];
    if (Number.isFinite(g.score)) extra.push(`${g.score}/100`);
    if (g.onRunway === false) extra.push('not on the runway');
    this.el.className = `hud-touchdown is-${tone}`;
    this.el.innerHTML =
      `<div class="hud-td-grade">${grade.word}</div>` +
      `<div class="hud-td-rate"><b>${grade.rate.toLocaleString('en-GB')}</b> ft/min at touchdown` +
      `${extra.length ? ` · ${extra.join(' · ')}` : ''}</div>` +
      `<div class="hud-td-stars" aria-label="${grade.stars} of 3 stars">${starsHtml(grade.stars)}</div>` +
      `<div class="hud-td-line">${bestLine(best, aircraft.name)}</div>`;
    this.el.style.display = '';
    this.timer = SHOW_FOR;
    this.last = { grade, best, tone };
    return this.last;
  }

  hide() {
    if (this.el) this.el.style.display = 'none';
    this.timer = 0;
  }

  /**
   * `held`: PULL UP or TERRAIN has the middle of the screen. The card steps
   * out of sight and keeps its time, and comes back when the command goes
   * (as the banner does), rather than being thrown away.
   */
  update(dt, held = false) {
    if (this.timer <= 0 || !this.el) return;
    if (held) {
      if (this.el.style.display !== 'none') this.el.style.display = 'none';
      return;
    }
    if (this.el.style.display === 'none') this.el.style.display = '';
    this.timer -= dt;
    if (this.timer <= 0) this.hide();
  }
}
