/**
 * How the passengers feel about your flying: the comfort score.
 *
 * Pure numbers — no THREE, no DOM, no game object — so the node test
 * (tests/features/passengers.mjs) flies made-up flights through it.
 *
 * WHAT THEY NOTICE, every frame, as a rate of upset per second:
 *
 *   hard banks      past 30° of bank. 45° is a mild nudge (0.06/s); 60° four
 *                   times that; a knife-edge is a scream.
 *   high g          the load factor more than 0.3 g away from 1 — a hard
 *                   pull-up, or the stomach-drop of a push-over. Smoothed
 *                   over a quarter of a second first, so one jolt from a gust
 *                   is not counted as a manoeuvre.
 *   fast descents   down at more than 2,000 ft/min. Ears pop.
 *   turbulence      the weather's own (0..1), while airborne — and it is not
 *                   your fault, so it is a ceiling, not a drain: rough air
 *                   pulls the mood down towards 5 − 1.8 × turb² (3.2 in a
 *                   storm, 4.55 in rain) and no further. Fly out of it and
 *                   they settle again. The jolts it causes count as g too.
 *   the landing     on touchdown, by how hard it was (rough landings knock
 *                   the mood down on the spot as well as scoring the landing).
 *
 * THE MOOD is 0..5 and starts at 5. Upset takes it down at the rate above;
 * smooth flying brings it back, slowly (0.012 a second: people remember). The
 * RATING at the end is the mood averaged over the time airborne, blended with
 * the landing once there has been one — 65% the flight, 35% the landing —
 * rounded to one decimal. "Passengers: 4.6/5 — smooth landing!".
 *
 * Kind words throughout. It is a game for a class: the worst it says is that
 * someone would like a word with the captain.
 */

export const COMFORT = {
  start: 5,
  /** Mood regained per second of smooth flying. */
  recover: 0.012,
  /** Below this rate of upset (per second) the flight counts as smooth. */
  smooth: 0.004,
  bank: { from: 30, span: 15, k: 0.06 },
  g: { from: 0.3, span: 0.3, k: 0.1, tau: 0.25 },
  descent: { from: 2000, span: 1000, k: 0.05 },
  /** Rough air: the mood's ceiling is 5 - depth × turb²; above it, pulled down at `pull` per second of the gap. */
  turb: { depth: 1.8, pull: 0.05 },
  /** A ceiling on the rate, so one wild second cannot zero a whole flight. */
  maxRate: 1.2,
  /** The rating's weight on the landing, once there is one. */
  landingWeight: 0.35,
};

/** Stars for a touchdown at `sink` ft/min (positive down). */
export function landingStars(sink) {
  const s = Math.abs(Number(sink) || 0);
  if (s < 200) return 5;
  if (s < 350) return 4.5;
  if (s < 500) return 3.8;
  if (s < 700) return 3;
  if (s < 900) return 2;
  return 1;
}

/** A fresh comfort state for one flight. */
export function createComfort() {
  return {
    mood: COMFORT.start,
    /** The smoothed load factor. */
    g: 1,
    /** Seconds counted towards the rating, and the mood integrated over them. */
    time: 0,
    moodTime: 0,
    lowest: COMFORT.start,
    /** Upset by cause, integrated (rate × seconds): what the summary talks about. */
    upsets: { bank: 0, g: 0, descent: 0, turbulence: 0, landing: 0 },
    /** What is upsetting them right now, or ''. */
    now: '',
    rate: 0,
    landings: 0,
    landing: null, // { stars, sink, quality }
    lastTouchT: -99,
    bounced: false,
    crashed: false,
    clock: 0,
  };
}

const sq = (x) => x * x;

/**
 * The rates of upset for one moment of flight, by cause. Pure; exported so the
 * test can ask "how much does a 45° bank bother them" without flying one.
 *   s = { bankDeg, g, vsFpm, turb, airborne }
 */
export function upsetRates(s, smoothG = s.g) {
  const C = COMFORT;
  const out = { bank: 0, g: 0, descent: 0, turbulence: 0 };
  const bank = Math.abs(Number(s.bankDeg) || 0);
  if (bank > C.bank.from) out.bank = C.bank.k * sq((Math.min(bank, 120) - C.bank.from) / C.bank.span);
  const dg = Math.abs((Number.isFinite(smoothG) ? smoothG : 1) - 1);
  if (dg > C.g.from) out.g = C.g.k * sq((Math.min(dg, 3) - C.g.from) / C.g.span);
  const down = -(Number(s.vsFpm) || 0);
  if (down > C.descent.from) out.descent = C.descent.k * sq((Math.min(down, 12000) - C.descent.from) / C.descent.span);
  return out;
}

/** How happy anyone can be in this air: 5 in smooth air, 3.2 in a storm. On the ground, 5. */
export function turbulenceCeiling(turb, airborne = true) {
  if (!airborne) return COMFORT.start;
  const t = Math.max(0, Math.min(1, Number(turb) || 0));
  return COMFORT.start - COMFORT.turb.depth * t * t;
}

/**
 * One step of flight. `s` = { bankDeg, g, vsFpm, turb, airborne, onGround }.
 * On the ground and stopped nothing counts (they are boarding, or getting
 * off); taxiing counts, airborne counts.
 */
export function stepComfort(c, dt, s) {
  if (!c || !(dt > 0)) return c;
  dt = Math.min(dt, 0.25);
  c.clock += dt;
  const C = COMFORT;
  const k = Math.min(1, dt / C.g.tau);
  c.g += ((Number.isFinite(s.g) ? s.g : 1) - c.g) * k;
  const r = upsetRates(s, c.g);
  let rate = r.bank + r.g + r.descent;
  if (rate > C.maxRate) {
    const f = C.maxRate / rate;
    r.bank *= f;
    r.g *= f;
    r.descent *= f;
    rate = C.maxRate;
  }
  // The weather's ceiling: above it, rough air pulls the mood down to it.
  const ceiling = turbulenceCeiling(s.turb, !!s.airborne);
  r.turbulence = c.mood > ceiling ? C.turb.pull * (c.mood - ceiling) : 0;
  c.rate = rate;
  for (const key of ['bank', 'g', 'descent', 'turbulence']) c.upsets[key] += r[key] * dt;
  if (rate > C.smooth) c.mood = Math.max(0, c.mood - rate * dt);
  else if (c.mood < ceiling) c.mood = Math.min(ceiling, c.mood + C.recover * dt);
  if (r.turbulence > 0) c.mood = Math.max(ceiling, c.mood - r.turbulence * dt);
  c.lowest = Math.min(c.lowest, c.mood);
  // Bumpy air is worth a word on the meter when it is really bumpy, whatever it does to the score.
  if (s.airborne && (Number(s.turb) || 0) > 0.45) r.turbulence = Math.max(r.turbulence, 0.021);
  // What the meter says is bothering them: the biggest cause, if it matters.
  let worst = '';
  let most = 0.02;
  for (const key of ['bank', 'g', 'descent', 'turbulence']) {
    if (r[key] > most) {
      most = r[key];
      worst = key;
    }
  }
  c.now = worst;
  if (s.airborne || !s.stopped) {
    c.time += dt;
    c.moodTime += c.mood * dt;
  }
  return c;
}

/** A touchdown: `g` = the flight model's grade { vsFpm, crashed, quality }. */
export function touchdownComfort(c, g) {
  if (!c || !g) return c;
  if (g.crashed) {
    c.crashed = true;
    c.mood = Math.min(c.mood, 0.5);
    c.upsets.landing += 5;
    c.landing = { stars: 0.5, sink: Math.abs(g.vsFpm || 0), quality: 'crash' };
    return c;
  }
  const sink = Math.abs(Number(g.vsFpm) || 0);
  let stars = landingStars(sink);
  // A second touchdown inside three seconds is a bounce.
  const bounce = c.clock - c.lastTouchT < 3;
  if (bounce) {
    c.bounced = true;
    stars = Math.max(1, Math.min(stars, (c.landing ? c.landing.stars : stars) - 0.5));
  }
  c.lastTouchT = c.clock;
  c.landings += 1;
  // A firm one knocks the mood down there and then.
  const jolt = Math.max(0, (sink - 400) / 400);
  if (jolt > 0) {
    c.mood = Math.max(0, c.mood - jolt);
    c.upsets.landing += jolt;
  }
  if (stars < 4) c.upsets.landing += (4 - stars) * 0.4;
  c.landing = { stars, sink, quality: g.quality || '' };
  return c;
}

/** The rating so far, 0..5, one decimal. */
export function rating(c) {
  if (!c) return 0;
  const flight = c.time > 0.5 ? c.moodTime / c.time : c.mood;
  // The mood now pulls a little too, so a flight that has just gone wrong shows it.
  const live = 0.85 * flight + 0.15 * c.mood;
  const r = c.landing ? (1 - COMFORT.landingWeight) * live + COMFORT.landingWeight * c.landing.stars : live;
  return Math.round(Math.max(0, Math.min(5, r)) * 10) / 10;
}

/** A word for a mood, for the meter. */
export function moodWord(m) {
  if (m >= 4.5) return 'Happy';
  if (m >= 3.6) return 'Relaxed';
  if (m >= 2.6) return 'Uneasy';
  if (m >= 1.6) return 'Queasy';
  return 'Unhappy';
}

/** What the meter says while something is bothering them. */
export const NOW_WORDS = {
  bank: 'Easy on the bank',
  g: 'Smoother on the stick',
  descent: 'Descending fast — ears popping',
  turbulence: 'Bumpy air',
};

const COMPLAINT = {
  bank: 'the steep turns spilled a few drinks',
  g: 'a few stomach-drop moments',
  descent: 'that descent popped everyone’s ears',
  turbulence: 'the bumpy weather shook them about',
  landing: 'that landing woke everybody up',
};

/** The cause they talk about most, or ''. */
export function worstUpset(c) {
  let worst = '';
  let most = 0.15;
  for (const [k, v] of Object.entries(c.upsets)) {
    if (v > most) {
      most = v;
      worst = k;
    }
  }
  return worst;
}

/**
 * The end-of-flight words: { rating, text, line }. `line` is the one shown:
 * "Passengers: 4.6/5 — smooth landing!".
 */
export function summary(c) {
  const r = rating(c);
  const worst = worstUpset(c);
  const L = c.landing;
  let text;
  if (c.crashed) text = 'everyone is safe, but nobody enjoyed that';
  else if (r >= 4.5) text = L && L.stars >= 4.5 ? 'smooth landing!' : L ? 'a lovely smooth flight!' : 'smooth as anything so far!';
  else if (r >= 3.5) text = worst ? `a comfortable flight — though ${COMPLAINT[worst]}` : 'a comfortable flight';
  else if (r >= 2.5) text = worst ? `a bit bumpy: ${COMPLAINT[worst]}` : 'a bit bumpy';
  else text = worst ? `some of them would like a word with the captain — ${COMPLAINT[worst]}` : 'some of them would like a word with the captain';
  return { rating: r, text, worst, line: `Passengers: ${r.toFixed(1)}/5 — ${text}` };
}

/** Five stars as text for a rating: ★★★★½ style, with the halves rounded. */
export function starsText(r) {
  const halves = Math.round(Math.max(0, Math.min(5, r)) * 2);
  const full = Math.floor(halves / 2);
  return '★'.repeat(full) + (halves % 2 ? '½' : '') + '☆'.repeat(5 - full - (halves % 2));
}
