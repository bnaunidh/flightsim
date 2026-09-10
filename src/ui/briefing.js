/**
 * The two screens that wrap a campaign flight: the pre-flight briefing and the
 * post-flight results.
 *
 * Both are built the same way as everything in menus.js — a template string
 * turned into one element, event delegation on the section, and the shared
 * `.screen` / `.ghost` / `.primary` classes from main.css. Anything genuinely
 * new here is prefixed `brief-` or `res-` and lives in BRIEFING_CSS, which the
 * integrator appends to the stylesheet.
 *
 * The mission and career objects come from other modules, so every field is
 * read through a small reader that accepts the shapes those modules are likely
 * to use and falls back to something true rather than to a blank. A briefing
 * that quietly says nothing is worse than one built from the mission blurb.
 *
 * Mission fields used, all optional except name:
 *   name, icon, difficulty, short, blurb, reward, weather, parTime,
 *   briefing / briefingFrom, objectives, optionals, pay, xp, starScores
 * Career fields used:
 *   rank, nextRank, xp, money, rankProgress, missions[id]
 * Awards (whatever Career.addResult returned):
 *   xp, money, rankUp, newAchievements
 */

import { TIMES, CONDITIONS } from '../world/weather.js';
import { RUNWAY } from '../world/airport.js';

function h(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

/** Mission text is authored data, but it still passes through innerHTML. */
function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

const num = (v) => (typeof v === 'number' && isFinite(v) ? v : null);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Fires on the next frame where one exists, and immediately where it does not. */
function nextFrame(fn) {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => requestAnimationFrame(fn));
  else setTimeout(fn, 16);
}

function prefersReducedMotion() {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/* ------------------------------- numbers -------------------------------- */

function fmtClock(seconds) {
  const s = Math.max(0, Math.round(num(seconds) || 0));
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}

/** A gap in words a child reads without decoding: "1 minute 12 seconds". */
function fmtGap(seconds) {
  const s = Math.abs(Math.round(seconds));
  if (s < 60) return `${s} second${s === 1 ? '' : 's'}`;
  const m = Math.floor(s / 60);
  const rest = s % 60;
  const mins = `${m} minute${m === 1 ? '' : 's'}`;
  return rest ? `${mins} ${rest} second${rest === 1 ? '' : 's'}` : mins;
}

function fmtMoney(value, symbol = '$') {
  const v = Math.round(num(value) || 0);
  return `${v < 0 ? '−' : ''}${symbol}${Math.abs(v).toLocaleString('en-GB')}`;
}

const STAR_SCORES = [45, 68, 88];

function starScores(mission) {
  const custom = mission && mission.starScores;
  if (Array.isArray(custom) && custom.length === 3 && custom.every((n) => num(n) !== null)) return custom;
  return STAR_SCORES;
}

function starsFor(score, mission) {
  const t = starScores(mission);
  const s = num(score) || 0;
  return s >= t[2] ? 3 : s >= t[1] ? 2 : s >= t[0] ? 1 : 0;
}

function starRow(count, size = '') {
  const glyphs = [0, 1, 2]
    .map((i) => `<span class="res-star${i < count ? ' is-on' : ''}" style="--d:${0.12 + i * 0.14}s">★</span>`)
    .join('');
  return `<div class="res-stars${size}" role="img" aria-label="${count} out of 3 stars">${glyphs}</div>`;
}

/* ------------------------------- weather -------------------------------- */

const TIME_WORDS = {
  day: 'Bright daylight — you will spot the island from a long way off.',
  sunset: 'Low sun and long shadows. Beautiful, but it can dazzle you when you turn west.',
  night: 'Night flying. The runway lights and the lighthouse are your best friends.',
};

const SKY_WORDS = {
  clear: 'Clear sky and smooth air.',
  cloudy: 'Cloud overhead and a few bumps on the way up.',
  rainy: 'Rain on the windscreen makes the runway hard to see, so line up early.',
  stormy: 'A thunderstorm: heavy rain, big gusts and rough air. Small, gentle movements only.',
};

function weatherOf(mission) {
  const w = (mission && mission.weather) || {};
  return {
    time: TIMES[w.time] ? w.time : 'day',
    condition: CONDITIONS[w.condition] ? w.condition : 'clear',
    windSpeedKts: num(w.windSpeedKts) || 0,
    windDirDeg: num(w.windDirDeg) || 0,
  };
}

/**
 * The wind is reported the way the game stores it — the direction it blows FROM
 * — which means nothing to a beginner, so it is turned into "it pushes you this
 * way" relative to runway 09.
 */
function windReport(w) {
  const rel = ((w.windDirDeg - RUNWAY.headingDeg + 540) % 360) - 180;
  const rad = (rel * Math.PI) / 180;
  const cross = Math.abs(Math.sin(rad)) * w.windSpeedKts;
  const along = Math.cos(rad) * w.windSpeedKts;
  const side = rel > 0 ? 'right' : 'left';
  const push = rel > 0 ? 'left' : 'right';

  let text;
  if (w.windSpeedKts < 2) text = 'The air is calm — the easiest conditions there are.';
  else if (cross < 4) text = 'It blows almost straight down runway 09, so it will barely push you sideways.';
  else if (cross < 12)
    text = `A gentle ${Math.round(cross)} knots across the runway from the ${side}, pushing you ${push}. Aim the nose slightly ${side} of the runway to stay on the centre line.`;
  else
    text = `A strong ${Math.round(cross)} knots across the runway from the ${side}. Point the nose into the wind on the way down, then straighten it just before the wheels touch.`;

  if (along < -3) text += ' The wind is behind you as you land, so you will arrive faster than usual — start slowing down early.';
  return {
    label: w.windSpeedKts < 1 ? 'Calm' : `${Math.round(w.windSpeedKts)} kt from ${String(Math.round(w.windDirDeg)).padStart(3, '0')}°`,
    text,
  };
}

/* ------------------------ mission and career readers -------------------- */

function briefingLines(mission) {
  const from = (mission && mission.briefingFrom) || 'Kestrel Operations';
  const raw = mission && mission.briefing;
  const lines = [];
  const push = (item) => {
    if (!item) return;
    if (typeof item === 'string') lines.push({ who: from, text: item });
    else if (typeof item === 'object') {
      const text = item.text || item.line || item.say;
      if (text) lines.push({ who: item.who || item.from || item.speaker || from, text });
    }
  };

  if (Array.isArray(raw)) raw.forEach(push);
  else if (typeof raw === 'string') push(raw);
  else if (raw && typeof raw === 'object') {
    const who = raw.who || raw.from || from;
    const inner = Array.isArray(raw.lines) ? raw.lines : [raw.text];
    inner.forEach((l) => push(typeof l === 'string' ? { who, text: l } : l));
  }

  // No written briefing? The mission still has a blurb and a "what you learn"
  // line, and both read perfectly well in the dispatcher's voice.
  if (!lines.length && mission) {
    if (mission.blurb) lines.push({ who: from, text: mission.blurb });
    if (mission.reward) lines.push({ who: from, text: mission.reward });
  }
  return lines;
}

function objectiveList(source, fallbackSteps) {
  const out = [];
  const push = (item) => {
    if (!item) return;
    if (typeof item === 'string') out.push({ text: item });
    else if (typeof item === 'object') {
      const text = item.text || item.label || item.name || item.title;
      if (text) out.push({ text, id: item.id, xp: num(item.xp), pay: num(item.pay != null ? item.pay : item.money) });
    }
  };
  if (Array.isArray(source)) source.forEach(push);
  if (!out.length && Array.isArray(fallbackSteps)) {
    for (const step of fallbackSteps) if (step && step.text) out.push({ text: step.text, id: step.id });
  }
  return out;
}

function optionalList(mission) {
  const src = (mission && (mission.optionals || mission.bonusObjectives || mission.bonus)) || null;
  return objectiveList(src, null);
}

function payOf(mission) {
  if (!mission) return null;
  return num(mission.pay) ?? num(mission.payout) ?? num(mission.money);
}

function xpOf(mission) {
  if (!mission) return null;
  return num(mission.xp) ?? num(mission.xpReward);
}

function missionRecord(career, id) {
  if (!career || !id) return null;
  if (typeof career.recordFor === 'function') return career.recordFor(id);
  if (typeof career.missionRecord === 'function') return career.missionRecord(id);
  const table = career.missions || (career.progress && career.progress.missions);
  return (table && table[id]) || null;
}

/** Everything the rank strip needs, whichever way the career module exposes it. */
function rankView(career) {
  const symbol = (career && career.currencySymbol) || '$';
  if (!career) return { name: 'Trainee pilot', next: null, pct: 0, into: null, span: null, xp: 0, money: 0, symbol };

  const rank = career.rank || career.currentRank;
  const name = typeof rank === 'string' ? rank : (rank && (rank.name || rank.title)) || 'Trainee pilot';
  const nextRaw = career.nextRank || (rank && rank.next) || null;
  const next = typeof nextRaw === 'string' ? nextRaw : (nextRaw && (nextRaw.name || nextRaw.title)) || null;

  const rp = career.rankProgress;
  const prog = typeof rp === 'function' ? rp.call(career) : rp;
  let pct = typeof prog === 'number' ? prog : num(prog && prog.pct);
  const into = num(career.xpIntoRank) ?? num(prog && (prog.into ?? prog.xp));
  const span = num(career.xpForNextRank) ?? num(prog && (prog.span ?? prog.need)) ?? num(nextRaw && nextRaw.xp);

  if (pct === null && into !== null && span) pct = into / span;
  // Some modules count in percent rather than a fraction.
  if (pct !== null && pct > 1) pct /= 100;

  return {
    name,
    next,
    pct: next ? clamp01(pct === null ? 0 : pct) : 1,
    into,
    span,
    xp: num(career.xp) || 0,
    money: num(career.money) ?? num(career.cash) ?? num(career.funds) ?? 0,
    symbol,
  };
}

function achievementsOf(awards) {
  const list = (awards && (awards.newAchievements || awards.achievements)) || [];
  return Array.isArray(list) ? list.filter(Boolean) : [];
}

/* ---------------------------- flight analysis --------------------------- */

const SINK_WORDS = [
  [150, 'as smooth as landings get'],
  [320, 'a tidy, normal landing'],
  [560, 'firm — everyone on board felt that'],
  [Infinity, 'a real thump'],
];

function sinkWords(sink) {
  for (const [limit, words] of SINK_WORDS) if (sink < limit) return words;
  return 'a real thump';
}

function fuelUsed(result) {
  if (!result) return null;
  const litres = num(result.fuelUsedL) ?? num(result.fuelUsedLitres);
  let pct = num(result.fuelUsedPct);
  if (pct === null && num(result.fuelRemainingPct) !== null) {
    const left = num(result.fuelRemainingPct);
    pct = (left > 1 ? 100 - left : 1 - left);
  }
  // A value above 1 can only be a percentage, so read it as one.
  if (pct !== null && pct > 1) pct /= 100;
  if (litres === null && pct === null) return null;
  return { litres, pct };
}

/**
 * The breakdown rows. Each one names the real number and then says, in plain
 * words, what that number means — a bare "14.2 m" teaches nobody anything.
 */
function breakdownRows(mission, result) {
  const rows = [];
  const landing = result && result.landing;

  if (landing) {
    const sink = Math.abs(num(landing.vsFpm) || 0);
    rows.push({
      label: 'Touchdown',
      value: `${sink} ft/min`,
      note: `You were coming down ${sink} feet every minute as the wheels met the ground — ${sinkWords(sink)}. Under 150 is a greaser.`,
    });
    if (num(landing.centreline) !== null) {
      const c = landing.centreline;
      rows.push({
        label: 'Off the centre line',
        value: `${c} m`,
        note:
          c < 3
            ? 'Right down the white line. That is exactly where the wheels belong.'
            : c < 8
              ? 'A little to one side. The rudder keys Q and E slide you back to the middle without tipping the wings.'
              : 'A long way to one side — the runway is only 30 m wide, so keep nudging back with Q and E all the way down.',
      });
    }
    if (num(landing.bank) !== null) {
      const b = Math.abs(landing.bank);
      rows.push({
        label: 'Wings',
        value: `${b}° tilted`,
        note:
          b < 4
            ? 'Beautifully level — both wheels touched together.'
            : `Tilted ${b} degrees at touchdown. Level the wings with A and D just before you land so one wheel does not take the whole aeroplane.`,
      });
    }
    if (num(landing.speedKts) !== null) {
      const v = landing.speedKts;
      rows.push({
        label: 'Speed over the fence',
        value: `${v} kt`,
        note:
          v > 75
            ? `${v} knots is fast for landing. Pull the power off with Ctrl earlier and aim to cross the runway edge at about 65.`
            : v < 52
              ? `${v} knots is slow — much slower and the wing stops flying. Add a touch of power with Shift on the way down.`
              : `${v} knots is right in the slot. About 65 knots over the runway edge is the target.`,
      });
    }
  }

  const time = num(result && result.time);
  if (time !== null) {
    const par = num(mission && mission.parTime);
    let note = 'That is the time from the moment you started rolling to the moment you stopped.';
    if (par) {
      const gap = par - time;
      note =
        Math.abs(gap) < 1
          ? `The target time was ${fmtClock(par)} and you hit it exactly. That is uncanny.`
          : gap > 0
            ? `The target time was ${fmtClock(par)}, so you were ${fmtGap(gap)} inside it. Nicely flown.`
            : `The target time was ${fmtClock(par)}, so you were ${fmtGap(gap)} over. Straighter tracks and fewer big turns are where the seconds are.`;
    }
    rows.push({ label: 'Time taken', value: fmtClock(time), note });
  }

  const drop = num(result && (result.dropDistance != null ? result.dropDistance : result.dropDistanceM));
  if (drop !== null) {
    rows.push({
      label: 'Crate accuracy',
      value: `${Math.round(drop)} m`,
      note:
        drop < 15
          ? 'Almost dead centre on the target. Superb aim.'
          : `The crate landed ${Math.round(drop)} m from the middle. Fly slower and lower over the pad and press X a moment before you are on top of it — the crate keeps moving forwards as it falls.`,
    });
  }

  const fuel = fuelUsed(result);
  if (fuel) {
    const value = fuel.litres !== null ? `${Math.round(fuel.litres)} L` : `${Math.round(fuel.pct * 100)}%`;
    const share = fuel.pct !== null ? Math.round(fuel.pct * 100) : null;
    rows.push({
      label: 'Fuel used',
      value,
      note:
        share !== null && share > 55
          ? `That is ${share}% of the tank. Full power is thirsty — once you are at cruising height, pull the power back to about three quarters with Ctrl.`
          : `${share !== null ? `${share}% of the tank. ` : ''}Plenty left in the tanks. Steady cruise power is the reason.`,
    });
  }

  const optionals = optionalList(mission);
  if (optionals.length) {
    const met = new Set(Array.isArray(result && result.optionals) ? result.optionals : []);
    const done = optionals.filter((o, i) => met.has(o.id) || met.has(i));
    rows.push({
      label: 'Bonus jobs',
      value: `${done.length} of ${optionals.length}`,
      note: done.length
        ? `You did: ${done.map((o) => o.text).join('; ')}.`
        : `None this time. They are worth extra money and experience, and you can go back for them on any re-flight.`,
    });
  }

  return rows;
}

function praiseSentence(mission, result, stars) {
  const landing = result && result.landing;
  const sink = landing ? Math.abs(num(landing.vsFpm) || 0) : null;
  const time = num(result && result.time);
  const par = num(mission && mission.parTime);

  if (result && result.failed) {
    const reached = num(result.stepIndex);
    const total = num(result.steps) ?? (mission && Array.isArray(mission.steps) ? mission.steps.length : null);
    if (reached !== null && total)
      return `You got through ${reached} of the ${total} objectives before it went wrong, and that is real flying — nobody starts at the end.`;
    return 'You took the aeroplane up and had a proper go at it, which is more than most people manage on their first attempt.';
  }
  if (sink !== null && sink < 150) return `Your wheels kissed the runway at just ${sink} feet per minute — passengers would not have spilled their drinks.`;
  if (stars === 3) return `${result.score} out of 100 is a three-star flight. That is as well as this mission can be flown.`;
  if (landing && num(landing.centreline) !== null && landing.centreline < 3)
    return `You touched down ${landing.centreline} m from the centre line, which is the sort of accuracy instructors point at.`;
  if (time !== null && par && time < par) return `You finished in ${fmtClock(time)}, ${fmtGap(par - time)} inside the target time.`;
  return 'You flew the whole mission and brought the aeroplane home in one piece — that is the part that counts.';
}

const FAIL_ADVICE = [
  [/sea|water|ditch|ocean/i, 'The sea has no runway. Watch the altitude number on the left: if it is falling below 500 feet and you are not over the airfield, hold Shift for power and gently pull back with S.'],
  [/hill|terrain|ground|mountain|tree/i, 'Kestrel\'s hills reach about 1,000 feet, so stay at 1,500 feet or higher until you are lined up with the valley on the runway centre line.'],
  [/stall/i, 'A stall means the wing has run out of air. Push the nose down with W and add power with Shift — the wing starts flying again within a second or two.'],
  [/fast/i, 'You arrived far too quickly. Start pulling the power off with Ctrl while you are still a long way out, so you cross the runway edge at about 65 knots.'],
  [/wing|bank|roll/i, 'A wing touched first. In the last few seconds, level the wings with A and D and let the aeroplane settle flat.'],
  [/fuel/i, 'You ran the tanks dry. Cruise at about three quarters power rather than full, and check the fuel bar at the bottom left every few minutes.'],
  [/time|late/i, 'The clock beat you. Point the nose straight at the next target rather than wandering, and climb while you are already heading the right way.'],
  [/down far too fast|hard|sink/i, 'You came down too hard. When the runway fills the windscreen, ease back on S and hold it — that flare turns a heavy arrival into a gentle one.'],
];

function adviceSentence(mission, result) {
  if (result && result.failed) {
    const why = String(result.failReason || '');
    for (const [pattern, advice] of FAIL_ADVICE) if (pattern.test(why)) return advice;
    return 'Fly the same run again and change one thing only: be slower and lower earlier than feels necessary. Everything is easier with time in hand.';
  }

  const landing = result && result.landing;
  const sink = landing ? Math.abs(num(landing.vsFpm) || 0) : null;
  const centre = landing ? num(landing.centreline) : null;
  const bank = landing ? Math.abs(num(landing.bank) || 0) : null;
  const time = num(result && result.time);
  const par = num(mission && mission.parTime);

  if (sink !== null && sink > 400)
    return `Your biggest gain is the flare: at about 20 feet, ease back on S and hold the nose just above the horizon until the wheels find the ground. That alone would turn ${sink} feet per minute into something near 150.`;
  if (centre !== null && centre > 8)
    return `Work on the centre line next: pick the white stripes early on final and use small taps of Q and E to keep them running under the nose, instead of steering with the wings.`;
  if (bank !== null && bank > 6)
    return `Try to land with the wings flat. In the last few seconds glance at the horizon rather than the runway and hold it level with A and D.`;
  if (time !== null && par && time > par)
    return `You have the flying — now go for the clock. Turn straight onto each target as soon as you see it, and stay at full power in the climb.`;
  const optionals = optionalList(mission);
  if (optionals.length) {
    const met = new Set(Array.isArray(result && result.optionals) ? result.optionals : []);
    const missed = optionals.filter((o, i) => !met.has(o.id) && !met.has(i));
    if (missed.length) return `Next time, go for the bonus job: ${missed[0].text}. It pays extra and it is a good excuse to fly the route again.`;
  }
  return 'Fly it once more and try to beat your own touchdown figure — the smoothest landing you can manage is always the next thing to chase.';
}

/* ============================== Briefing ================================ */

export class BriefingScreen {
  /** @param {HTMLElement} root the same UI root the menus are appended to */
  constructor(root) {
    this.root = root;
    this.hooks = {};
    this.layer = h('<div class="menu-layer brief-layer" hidden></div>');
    this.root.appendChild(this.layer);
    // Capture phase, because Escape is also the game's pause key and the
    // briefing must swallow it while it is the thing on screen.
    this.onKey = (e) => this.handleKey(e);
  }

  get isOpen() {
    return !this.layer.hidden;
  }

  show(mission, career, { onStart, onBack } = {}) {
    this.hooks = { onStart, onBack };
    this.layer.innerHTML = '';
    const section = this.build(mission || {}, career);
    this.layer.appendChild(section);
    this.layer.hidden = false;
    document.addEventListener('keydown', this.onKey, true);

    if (prefersReducedMotion()) section.classList.add('is-in', 'no-anim');
    else nextFrame(() => section.classList.add('is-in'));

    const start = section.querySelector('[data-start]');
    if (start) setTimeout(() => start.focus({ preventScroll: true }), 30);
  }

  hide() {
    this.layer.hidden = true;
    this.layer.innerHTML = '';
    document.removeEventListener('keydown', this.onKey, true);
  }

  handleKey(e) {
    if (this.layer.hidden) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (this.hooks.onBack) this.hooks.onBack();
    } else if (e.key === 'Enter') {
      // A real button already handles its own Enter; do not fire twice.
      if (e.target && e.target.tagName === 'BUTTON') return;
      e.preventDefault();
      e.stopPropagation();
      if (this.hooks.onStart) this.hooks.onStart();
    }
  }

  build(mission, career) {
    const w = weatherOf(mission);
    const wind = windReport(w);
    const lines = briefingLines(mission);
    const objectives = objectiveList(mission.objectives, mission.steps);
    const optionals = optionalList(mission);
    const rank = rankView(career);
    const record = missionRecord(career, mission.id);
    const pay = payOf(mission);
    const xp = xpOf(mission);
    const diff = String(mission.difficulty || 'Easy');

    let delay = 0;
    const step = () => `style="--d:${(delay += 0.07).toFixed(2)}s"`;

    const dialogue = lines
      .map(
        (l) => `
        <p class="brief-line reveal" ${step()}>
          <span class="brief-who">${esc(l.who)}</span>
          <span class="brief-said">${esc(l.text)}</span>
        </p>`
      )
      .join('');

    const objectiveItems = objectives
      .map(
        (o, i) => `
        <li class="reveal" ${step()}>
          <span class="brief-num">${i + 1}</span>
          <span>${esc(o.text)}</span>
        </li>`
      )
      .join('');

    const optionalItems = optionals
      .map(
        (o) => `
        <li class="reveal" ${step()}>
          <span class="brief-num is-bonus">★</span>
          <span>${esc(o.text)}${
            o.pay || o.xp
              ? ` <em class="brief-bonus">${[o.pay ? `+${fmtMoney(o.pay, rank.symbol)}` : '', o.xp ? `+${o.xp} XP` : '']
                  .filter(Boolean)
                  .join(' · ')}</em>`
              : ''
          }</span>
        </li>`
      )
      .join('');

    const flownBefore = !!record && (record.complete || num(record.bestScore) !== null);
    // The career module may already store the stars it awarded; if not, they
    // fall out of the best score exactly as they do on the results screen.
    const bestStars = flownBefore
      ? (num(record.stars) !== null ? num(record.stars) : starsFor(record.bestScore, mission))
      : 0;
    const bestBlock = flownBefore
      ? `
        <div class="brief-best-row">
          ${starRow(bestStars, ' is-small')}
          <span><b>${Math.round(num(record.bestScore) || 0)}</b>/100</span>
        </div>
        ${num(record.bestTime) !== null ? `<p class="tiny">Your quickest run: ${fmtClock(record.bestTime)}</p>` : ''}`
      : '<p class="brief-none">You have not flown this one yet. Everything below is new ground.</p>';

    const section = h(`
      <section class="screen screen-brief" data-screen="briefing">
        <header class="screen-head">
          <button class="ghost" data-back>← Back</button>
          <h2>Mission briefing</h2>
          <span class="brief-pilot">${esc(rank.name)} · ${fmtMoney(rank.money, rank.symbol)}</span>
        </header>

        <div class="brief-grid">
          <div class="brief-main">
            <div class="brief-title reveal" ${step()}>
              <span class="brief-icon">${esc(mission.icon || '✈')}</span>
              <div>
                <h3>${esc(mission.name || 'Mission')}</h3>
                <span class="brief-diff" data-diff="${esc(diff.toLowerCase())}">${esc(diff)}</span>
                <span class="brief-short">${esc(mission.short || 'Campaign flight')}</span>
              </div>
            </div>

            <div class="brief-dialogue">${dialogue}</div>

            ${objectiveItems
              ? `<h4 class="brief-h reveal" ${step()}>What you have to do</h4>
                 <ol class="brief-objectives">${objectiveItems}</ol>`
              : ''}
            ${optionalItems
              ? `<h4 class="brief-h reveal" ${step()}>Bonus jobs — worth extra, and you can skip them</h4>
                 <ul class="brief-objectives is-optional">${optionalItems}</ul>`
              : ''}
          </div>

          <aside class="brief-side">
            <div class="brief-card reveal" ${step()}>
              <h4 class="brief-h">Conditions</h4>
              <div class="brief-facts">
                <span>Time of day<b>${esc(TIMES[w.time].label)}</b></span>
                <span>Sky<b>${esc(CONDITIONS[w.condition].label)}</b></span>
                <span>Wind<b>${esc(wind.label)}</b></span>
              </div>
              <p class="brief-note">${esc(TIME_WORDS[w.time])}</p>
              <p class="brief-note">${esc(SKY_WORDS[w.condition])}</p>
              <p class="brief-note">${esc(wind.text)}</p>
            </div>

            <div class="brief-card reveal" ${step()}>
              <h4 class="brief-h">What you earn</h4>
              <div class="brief-facts">
                ${pay !== null ? `<span>Pay<b class="is-money">${fmtMoney(pay, rank.symbol)}</b></span>` : ''}
                ${xp !== null ? `<span>Experience<b class="is-xp">+${Math.round(xp)} XP</b></span>` : ''}
                ${num(mission.parTime) !== null ? `<span>Target time<b>${fmtClock(mission.parTime)}</b></span>` : ''}
              </div>
              <p class="brief-note">Finish faster and land more smoothly and you keep more of the bonus.</p>
            </div>

            <div class="brief-card reveal" ${step()}>
              <h4 class="brief-h">Your best so far</h4>
              ${bestBlock}
            </div>

            <button class="primary big reveal" data-start ${step()}>Start flight</button>
            <p class="tiny">Press <kbd>Enter</kbd> to start · <kbd>Esc</kbd> to go back</p>
          </aside>
        </div>
      </section>
    `);

    section.addEventListener('click', (e) => {
      if (e.target.closest('[data-back]')) {
        if (this.hooks.onBack) this.hooks.onBack();
      } else if (e.target.closest('[data-start]')) {
        if (this.hooks.onStart) this.hooks.onStart();
      }
    });

    return section;
  }
}

/* ============================== Results ================================= */

export class ResultsScreen {
  /** @param {HTMLElement} root the same UI root the menus are appended to */
  constructor(root) {
    this.root = root;
    this.hooks = {};
    this.layer = h('<div class="menu-layer res-layer" hidden></div>');
    this.root.appendChild(this.layer);
    this.onKey = (e) => this.handleKey(e);
  }

  get isOpen() {
    return !this.layer.hidden;
  }

  show(mission, result, career, awards, { onRetry, onNext, onMenu } = {}) {
    this.hooks = { onRetry, onNext, onMenu };
    this.layer.innerHTML = '';
    const section = this.build(mission || {}, result || {}, career, awards || {});
    this.layer.appendChild(section);
    this.layer.hidden = false;
    document.addEventListener('keydown', this.onKey, true);

    if (prefersReducedMotion()) section.classList.add('is-in', 'no-anim');
    else nextFrame(() => section.classList.add('is-in'));

    const first = section.querySelector('.primary') || section.querySelector('button');
    if (first) setTimeout(() => first.focus({ preventScroll: true }), 30);
  }

  hide() {
    this.layer.hidden = true;
    this.layer.innerHTML = '';
    document.removeEventListener('keydown', this.onKey, true);
  }

  handleKey(e) {
    if (this.layer.hidden) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (this.hooks.onMenu) this.hooks.onMenu();
    } else if (e.key === 'Enter') {
      if (e.target && e.target.tagName === 'BUTTON') return;
      e.preventDefault();
      e.stopPropagation();
      const go = this.hooks.onNext || this.hooks.onRetry || this.hooks.onMenu;
      if (go) go();
    }
  }

  build(mission, result, career, awards) {
    const passed = !result.failed;
    const score = Math.round(num(result.score) || 0);
    const stars = passed ? starsFor(score, mission) : 0;
    const rows = breakdownRows(mission, result);
    const rank = rankView(career);
    const gainedXp = num(awards.xp);
    const gainedMoney = num(awards.money);
    const rankUpRaw = awards.rankUp;
    const rankUp = typeof rankUpRaw === 'string' ? rankUpRaw : rankUpRaw && (rankUpRaw.name || rankUpRaw.title);
    const achievements = achievementsOf(awards);
    const record = missionRecord(career, mission.id);
    const previousBest = num(record && record.bestScore);
    const beatenBest = passed && previousBest !== null && score > previousBest;

    let delay = 0.2;
    const step = () => `style="--d:${(delay += 0.08).toFixed(2)}s"`;

    const rowItems = rows
      .map(
        (r) => `
        <li class="res-row reveal" ${step()}>
          <span class="res-row-label">${esc(r.label)}</span>
          <span class="res-row-value">${esc(r.value)}</span>
          <span class="res-row-note">${esc(r.note)}</span>
        </li>`
      )
      .join('');

    const earnChips = [
      gainedMoney !== null ? `<span class="res-chip is-money">+${fmtMoney(gainedMoney, rank.symbol)}</span>` : '',
      gainedXp !== null ? `<span class="res-chip is-xp">+${Math.round(gainedXp)} XP</span>` : '',
    ]
      .filter(Boolean)
      .join('');

    const rankLine = rank.next
      ? `${rank.into !== null && rank.span ? `${Math.round(rank.into)} of ${Math.round(rank.span)} XP` : `${Math.round(rank.pct * 100)}%`} towards ${esc(rank.next)}`
      : 'Top rank reached — there is nothing left to promote you to.';

    const achievementItems = achievements
      .map(
        (a) => `
        <li class="res-badge reveal" ${step()}>
          <span class="res-badge-icon">${esc(a.icon || '🏅')}</span>
          <span>
            <b>${esc(a.name || a.title || 'Achievement')}</b>
            <em>${esc(a.description || a.desc || 'Unlocked for something you did on this flight.')}</em>
          </span>
        </li>`
      )
      .join('');

    const actions = [
      this.hooks.onNext ? '<button class="primary" data-act="next">Next mission →</button>' : '',
      this.hooks.onRetry ? `<button ${this.hooks.onNext ? '' : 'class="primary" '}data-act="retry">${passed ? 'Fly it again' : 'Try again'}</button>` : '',
      this.hooks.onMenu ? '<button data-act="menu">Back to missions</button>' : '',
    ]
      .filter(Boolean)
      .join('');

    const section = h(`
      <section class="screen screen-results" data-screen="results">
        <div class="res-card">
          <p class="res-kicker reveal" ${step()}>${esc(mission.name || 'Mission')}</p>
          <h2 class="res-title ${passed ? 'is-good' : 'is-bad'} reveal" ${step()}>
            ${passed ? 'Mission complete' : 'Mission not completed'}
          </h2>
          ${passed
            ? `${starRow(stars)}
               <div class="res-score reveal" ${step()}>${score}<span>/100</span></div>
               ${beatenBest ? `<p class="res-pb reveal" ${step()}>New personal best — your old score was ${Math.round(previousBest)}.</p>` : ''}`
            : `<p class="res-reason reveal" ${step()}>${esc(result.failReason || 'The flight ended early.')}</p>
               <p class="res-safe reveal" ${step()}>Everybody walks away in this simulator. Nothing is lost except the trip.</p>`}

          ${rowItems ? `<ul class="res-rows">${rowItems}</ul>` : ''}

          <div class="res-words">
            <p class="res-praise reveal" ${step()}><span class="res-tag is-good">Well flown</span>${esc(praiseSentence(mission, result, stars))}</p>
            <p class="res-advice reveal" ${step()}><span class="res-tag">Next time</span>${esc(adviceSentence(mission, result))}</p>
          </div>

          <div class="res-earn reveal" ${step()}>
            ${earnChips ? `<div class="res-chips">${earnChips}</div>` : ''}
            ${rankUp ? `<p class="res-promo">Promoted — you are now ${esc(rankUp)}!</p>` : ''}
            <div class="res-rank">
              <div class="res-rank-top"><b>${esc(rank.name)}</b><span>${rankLine}</span></div>
              <div class="res-rank-track"><div class="res-rank-fill" style="--w:${Math.round(rank.pct * 100)}%"></div></div>
              <p class="tiny">Total: ${Math.round(rank.xp)} XP · ${fmtMoney(rank.money, rank.symbol)} in the bank</p>
            </div>
          </div>

          ${achievementItems
            ? `<h4 class="res-h reveal" ${step()}>Unlocked</h4><ul class="res-badges">${achievementItems}</ul>`
            : ''}

          <div class="pause-actions res-actions reveal" ${step()}>${actions}</div>
          <p class="tiny">Press <kbd>Enter</kbd> for ${this.hooks.onNext ? 'the next mission' : 'another go'} · <kbd>Esc</kbd> for the mission list</p>
        </div>
      </section>
    `);

    section.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const act = btn.dataset.act;
      if (act === 'next' && this.hooks.onNext) this.hooks.onNext();
      else if (act === 'retry' && this.hooks.onRetry) this.hooks.onRetry();
      else if (act === 'menu' && this.hooks.onMenu) this.hooks.onMenu();
    });

    return section;
  }
}

/* ================================ Styles ================================ */

/**
 * Appended to the stylesheet by the integrator. It only adds; nothing here
 * changes a class that main.css already owns.
 */
export const BRIEFING_CSS = `
/* ===================== Briefing & results screens ======================= */

.brief-layer, .res-layer { z-index: 12; }

.screen-brief .brief-grid {
  display: grid;
  grid-template-columns: 1.5fr 1fr;
  gap: 18px;
  align-items: start;
}

.brief-main, .brief-card {
  background: linear-gradient(165deg, rgba(20, 32, 52, 0.92), rgba(11, 18, 32, 0.92));
  border: 1px solid var(--panel-line);
  border-radius: var(--radius);
  padding: 22px;
}
.brief-side { display: flex; flex-direction: column; gap: 14px; }
.brief-card { padding: 16px 18px; }

.brief-pilot { font-size: 13px; color: var(--text-dim); text-shadow: 0 1px 8px rgba(0, 0, 0, 0.8); }

.brief-title { display: flex; gap: 14px; align-items: flex-start; margin-bottom: 18px; }
.brief-title h3 { margin: 0 0 6px; font-size: 22px; font-weight: 650; letter-spacing: -0.01em; }
.brief-icon {
  font-size: 22px;
  width: 46px;
  height: 46px;
  display: grid;
  place-items: center;
  border-radius: 12px;
  background: rgba(126, 232, 178, 0.14);
  color: var(--accent-2);
  flex: none;
}
.brief-diff {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  padding: 2px 8px;
  border-radius: 99px;
  margin-right: 8px;
  background: rgba(88, 198, 255, 0.18);
  color: #bfe6ff;
}
.brief-diff[data-diff='easy'] { background: rgba(79, 214, 132, 0.2); color: #9df3bd; }
.brief-diff[data-diff='medium'] { background: rgba(255, 194, 71, 0.2); color: #ffdc9b; }
.brief-diff[data-diff='hard'] { background: rgba(255, 106, 90, 0.2); color: #ffb7ac; }
.brief-diff[data-diff='expert'], .brief-diff[data-diff='extreme'] {
  background: rgba(255, 106, 90, 0.32);
  color: #ffd7d0;
  border: 1px solid rgba(255, 106, 90, 0.6);
}
.brief-short { font-size: 12px; color: var(--text-dim); }

.brief-dialogue { border-left: 2px solid rgba(88, 198, 255, 0.45); padding-left: 16px; margin-bottom: 20px; }
.brief-line { margin: 0 0 12px; }
.brief-who {
  display: block;
  font-size: 10px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--accent-2);
  margin-bottom: 3px;
}
.brief-said { font-size: 15px; line-height: 1.5; color: #dce8f7; }

.brief-h {
  margin: 0 0 10px;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--accent);
}
.brief-objectives { list-style: none; margin: 0 0 18px; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.brief-objectives li { display: flex; gap: 11px; align-items: flex-start; font-size: 14px; line-height: 1.45; color: #d3dfef; }
.brief-num {
  flex: none;
  width: 22px;
  height: 22px;
  border-radius: 7px;
  display: grid;
  place-items: center;
  font-size: 11px;
  font-family: var(--mono);
  background: rgba(88, 198, 255, 0.16);
  color: var(--accent);
}
.brief-num.is-bonus { background: rgba(255, 194, 71, 0.18); color: var(--amber); }
.brief-bonus { font-style: normal; font-size: 12px; color: var(--amber); }

.brief-facts { display: flex; flex-wrap: wrap; gap: 14px; margin-bottom: 10px; }
.brief-facts span { display: flex; flex-direction: column; gap: 2px; font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.07em; color: var(--text-dim); }
.brief-facts b { font-size: 15px; color: var(--text); text-transform: none; letter-spacing: 0; }
.brief-facts b.is-money { color: var(--good); }
.brief-facts b.is-xp { color: var(--accent); }
.brief-note { font-size: 12.5px; line-height: 1.5; color: var(--text-dim); margin: 6px 0 0; }
.brief-none { font-size: 13px; color: var(--text-dim); margin: 0; }
.brief-best-row { display: flex; align-items: center; gap: 12px; font-size: 14px; color: var(--text-dim); }
.brief-best-row b { color: var(--text); font-size: 19px; }
.screen-brief .tiny { text-align: center; }

/* ------------------------------ results -------------------------------- */

.screen-results { display: grid; place-items: center; }
.res-card {
  width: min(720px, 94vw);
  background: rgba(10, 17, 29, 0.95);
  border: 1px solid var(--panel-line);
  border-radius: 20px;
  padding: 26px;
  text-align: center;
  box-shadow: var(--shadow);
}
.res-kicker { margin: 0; font-size: 11px; text-transform: uppercase; letter-spacing: 0.14em; color: var(--text-dim); }
.res-title { margin: 4px 0 12px; font-size: 27px; font-weight: 680; letter-spacing: -0.02em; }
.res-title.is-good { color: var(--good); }
.res-title.is-bad { color: var(--red); }

.res-stars { display: flex; justify-content: center; gap: 8px; margin-bottom: 8px; }
.res-star {
  font-size: 34px;
  line-height: 1;
  color: rgba(255, 255, 255, 0.16);
  transform: scale(0.7);
  opacity: 0;
  transition: transform 0.45s cubic-bezier(0.2, 1.5, 0.4, 1), opacity 0.35s ease, color 0.35s ease;
  transition-delay: var(--d, 0s);
}
.res-star.is-on { color: var(--amber); text-shadow: 0 0 18px rgba(255, 194, 71, 0.55); }
.is-in .res-star { transform: scale(1); opacity: 1; }
.res-stars.is-small { gap: 3px; margin: 0; }
.res-stars.is-small .res-star { font-size: 15px; transform: none; opacity: 1; text-shadow: none; }

.res-score { font-size: 52px; font-weight: 700; color: var(--accent); line-height: 1; margin-bottom: 8px; }
.res-score span { font-size: 19px; color: var(--text-dim); }
.res-pb { margin: 0 0 8px; font-size: 13px; color: var(--accent-2); }
.res-reason { margin: 0 0 6px; font-size: 16px; font-weight: 600; color: var(--amber); }
.res-safe { margin: 0 0 8px; font-size: 13px; color: var(--text-dim); }

.res-rows { list-style: none; padding: 0; margin: 18px 0 0; display: flex; flex-direction: column; gap: 8px; text-align: left; }
.res-row {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 2px 12px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid transparent;
  border-radius: 12px;
  padding: 10px 14px;
}
.res-row-label { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-dim); align-self: center; }
.res-row-value { font-family: var(--mono); font-size: 17px; color: var(--text); align-self: center; }
.res-row-note { grid-column: 1 / -1; font-size: 12.5px; line-height: 1.5; color: #b9c8dc; }

.res-words { margin-top: 16px; text-align: left; display: flex; flex-direction: column; gap: 8px; }
.res-praise, .res-advice { margin: 0; font-size: 13.5px; line-height: 1.55; color: #d8e4f3; }
.res-tag {
  display: inline-block;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  padding: 2px 8px;
  border-radius: 99px;
  margin-right: 8px;
  background: rgba(88, 198, 255, 0.16);
  color: var(--accent);
}
.res-tag.is-good { background: rgba(79, 214, 132, 0.18); color: var(--good); }

.res-earn { margin-top: 18px; }
.res-chips { display: flex; justify-content: center; gap: 8px; margin-bottom: 10px; }
.res-chip { font-size: 14px; font-weight: 620; padding: 5px 14px; border-radius: 99px; }
.res-chip.is-money { background: rgba(79, 214, 132, 0.16); color: var(--good); }
.res-chip.is-xp { background: rgba(88, 198, 255, 0.16); color: var(--accent); }
.res-promo { margin: 0 0 10px; font-size: 15px; font-weight: 640; color: var(--amber); }
.res-rank-top { display: flex; justify-content: space-between; gap: 10px; font-size: 12.5px; color: var(--text-dim); margin-bottom: 6px; }
.res-rank-top b { color: var(--text); font-size: 14px; }
.res-rank-track { height: 8px; border-radius: 99px; background: rgba(255, 255, 255, 0.1); overflow: hidden; }
.res-rank-fill {
  height: 100%;
  width: 0;
  border-radius: 99px;
  background: linear-gradient(90deg, var(--accent), var(--accent-2));
  transition: width 0.9s cubic-bezier(0.2, 0.8, 0.2, 1) 0.4s;
}
.is-in .res-rank-fill { width: var(--w, 0%); }
.res-rank .tiny { text-align: left; }

.res-h { margin: 18px 0 8px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.1em; color: var(--accent); text-align: left; }
.res-badges { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; text-align: left; }
.res-badge {
  display: flex;
  gap: 12px;
  align-items: center;
  padding: 10px 14px;
  border-radius: 12px;
  background: rgba(255, 194, 71, 0.1);
  border: 1px solid rgba(255, 194, 71, 0.35);
}
.res-badge-icon { font-size: 22px; flex: none; }
.res-badge b { display: block; font-size: 14px; }
.res-badge em { font-style: normal; font-size: 12.5px; color: var(--text-dim); }
.res-actions { margin-top: 20px; }

/* --------------------------- staggered reveal --------------------------- */

.reveal {
  opacity: 0;
  transform: translateY(10px);
  transition: opacity 0.45s ease, transform 0.45s cubic-bezier(0.2, 0.9, 0.2, 1);
  transition-delay: var(--d, 0s);
}
.is-in .reveal { opacity: 1; transform: none; }
.no-anim .reveal, .no-anim .res-star { transition: none; opacity: 1; transform: none; }
.no-anim .res-rank-fill { transition: none; }

@media (prefers-reduced-motion: reduce) {
  .reveal, .res-star, .res-rank-fill { transition: none !important; }
  .reveal { opacity: 1; transform: none; }
  .res-star { opacity: 1; transform: none; }
  .res-rank-fill { width: var(--w, 0%); }
}

@media (max-width: 900px) {
  .screen-brief .brief-grid { grid-template-columns: 1fr; }
  .res-card { padding: 20px 16px; }
  .res-score { font-size: 42px; }
}
`;
