/**
 * Paddles: the landing signal officer, as rules.
 *
 * Pure — the feature hands it a reading of the jet against the glideslope a
 * few times a second and plays whatever it says. tests/features/carrier.mjs
 * flies passes through it in node.
 *
 * WHAT IT SAYS is what LSOs say, and no more: the pilot calls the ball at
 * three-quarters of a mile ("Three hundred, Hornet ball, four point two"),
 * Paddles answers "Roger ball", and after that it is quiet unless something
 * needs fixing — "You're low", "Power", "You're high", "Right for lineup",
 * "Come left", "Check your hook" — and "Wave off, wave off" when the pass
 * cannot be saved. Calm, short, never a joke. The calls stop in close except
 * for power and the wave-off, because in the last seconds there is no time
 * for anything else.
 *
 * THE GRADE is the real scale, kept simple: OK (underlined when it is a
 * perfect 3-wire), Fair, No grade, Bolter, Wave-off — the greenie board's
 * colours — with the wire and one plain-words reason.
 */

/** When the LSO talks, in metres to go to the touchdown point. */
export const LSO_TUNE = {
  ballCallAt: 1300, // three-quarter mile
  quietFrom: 1900, // past this he is not looking at you yet
  resetFrom: 2600, // further out than this a new pass begins
  gap: 1.7, // seconds between any two calls
  repeat: 4.5, // seconds before the same call is made again
  // Glideslope thresholds, degrees off the 3.5° path.
  low: -0.4,
  power: -0.75,
  powerPower: -1.0,
  high: 0.55,
  // Lineup, metres off the landing centreline.
  lineup: 7,
  // Wave-off: what cannot be saved, and from how close.
  woLowDeg: -1.15,
  woLowRange: 600,
  woLineup: 22,
  woLineupRange: 450,
  woConfigRange: 700, // gear or hook still up this close
  woBank: 25,
  woBankRange: 300,
  closeIn: 220, // inside this only "Power" and the wave-off are said
};

/** Ranges that split a pass the way an LSO writes it down. */
export function zoneOf(range) {
  if (range > 1000) return 'X';
  if (range > 500) return 'IM';
  if (range > 150) return 'IC';
  return 'AR';
}

export function createLso() {
  return {
    t: 0,
    lastAny: -99,
    last: {},
    ballCalled: false,
    rogered: false,
    rogerAt: null,
    clara: false,
    waveoff: false,
    waveoffReason: '',
    waveoffAt: null,
    checked: {},
  };
}

/** Everything the LSO has to notice in one pass, for the grade. */
export function createPass() {
  return {
    maxLow: { X: 0, IM: 0, IC: 0, AR: 0 },
    maxHigh: { X: 0, IM: 0, IC: 0, AR: 0 },
    maxLat: { X: 0, IM: 0, IC: 0, AR: 0 },
    samples: 0,
    waveoff: false,
    waveoffReason: '',
    ballCalled: false,
  };
}

/** Note how far off the jet is, in the zone it is in. */
export function recordSample(pass, r) {
  if (!(r.range > 0)) return;
  const z = zoneOf(r.range);
  if (r.devDeg < 0) pass.maxLow[z] = Math.max(pass.maxLow[z], -r.devDeg);
  else pass.maxHigh[z] = Math.max(pass.maxHigh[z], r.devDeg);
  pass.maxLat[z] = Math.max(pass.maxLat[z], Math.abs(r.lat));
  pass.samples++;
}

function say(L, out, id, who, text, kind = 'call', force = false) {
  const T = LSO_TUNE;
  if (!force && L.t - L.lastAny < T.gap) return false;
  if (!force && L.last[id] != null && L.t - L.last[id] < T.repeat) return false;
  L.last[id] = L.t;
  L.lastAny = L.t;
  out.push({ id, who, text, kind });
  return true;
}

/**
 * One look at the jet. `r`:
 *   range, devDeg, lat            against the glideslope (deck.js glide())
 *   gearDown, hookDown, hasHook   configuration
 *   bankDeg                        wings
 *   airborne                       false once it has touched down
 *   foul                           something on the landing area
 *   callsign, typeName, fuelK      for the ball call
 * Returns the calls to make now: [{ id, who: 'lso'|'pilot', text, kind }].
 */
export function lsoTick(L, r, dt) {
  const T = LSO_TUNE;
  L.t += dt;
  const out = [];
  if (!r || !r.airborne) return out;
  if (r.range > T.resetFrom || r.range < -50) return out;
  if (r.range > T.quietFrom) return out;

  // The roger, a beat after the pilot's call.
  if (L.rogerAt != null && L.t >= L.rogerAt) {
    L.rogerAt = null;
    if (L.clara) {
      say(L, out, 'clara', 'lso', r.devDeg < 0 ? "You're low. Power." : "You're high.", 'call', true);
    } else {
      say(L, out, 'roger', 'lso', 'Roger ball.', 'roger', true);
    }
    L.rogered = true;
    return out;
  }

  /* ---- Wave-off: once said, it stands ---- */
  if (!L.waveoff) {
    let why = '';
    if (r.foul && r.range < 900) why = 'foul deck';
    else if (!r.gearDown && r.range < T.woConfigRange) why = 'gear';
    else if (r.hasHook && !r.hookDown && r.range < T.woConfigRange) why = 'hook';
    else if (r.devDeg < T.woLowDeg && r.range < T.woLowRange) why = 'low';
    else if (Math.abs(r.lat) > T.woLineup && r.range < T.woLineupRange) why = 'lineup';
    else if (Math.abs(r.bankDeg || 0) > T.woBank && r.range < T.woBankRange) why = 'wings';
    if (why) {
      L.waveoff = true;
      L.waveoffReason = why;
      L.waveoffAt = L.t;
      out.push({ id: 'waveoff', who: 'lso', text: why === 'foul deck' ? 'Wave off, wave off. Foul deck.' : 'Wave off, wave off.', kind: 'waveoff' });
      L.lastAny = L.t;
      return out;
    }
  } else {
    // Repeated once if the jet keeps coming down.
    if (L.t - L.waveoffAt > 2.2 && r.range < 400 && !L.last.waveoff2) {
      L.last.waveoff2 = L.t;
      out.push({ id: 'waveoff2', who: 'lso', text: 'Wave off!', kind: 'waveoff' });
      L.lastAny = L.t;
    }
    return out;
  }

  /* ---- The ball call ---- */
  if (!L.ballCalled && r.range <= T.ballCallAt) {
    L.ballCalled = true;
    const visible = Math.abs(r.devDeg) <= 0.94;
    L.clara = !visible;
    const cs = r.callsign || 'Three hundred';
    out.push(visible
      ? { id: 'ball', who: 'pilot', text: `${cs}, ${r.typeName || 'Hornet'} ball, ${r.fuelK || '4.0'}.`, kind: 'pilot' }
      : { id: 'ball', who: 'pilot', text: `${cs}, Clara.`, kind: 'pilot' });
    L.lastAny = L.t;
    L.rogerAt = L.t + 1.1;
    return out;
  }
  if (!L.ballCalled) return out;

  /* ---- Corrections ---- */
  const close = r.range < T.closeIn;
  if (r.devDeg < T.powerPower) {
    say(L, out, 'powerpower', 'lso', 'Power! Power!', 'urgent');
    return out;
  }
  if (r.devDeg < T.power) {
    say(L, out, 'power', 'lso', 'Power.', 'urgent');
    return out;
  }
  if (close) return out;
  if (!r.gearDown && !L.checked.gear) {
    if (say(L, out, 'gear', 'lso', 'Check your gear.')) L.checked.gear = true;
    return out;
  }
  if (r.hasHook && !r.hookDown && !L.checked.hook) {
    if (say(L, out, 'hook', 'lso', 'Check your hook.')) L.checked.hook = true;
    return out;
  }
  if (r.devDeg < T.low) {
    say(L, out, 'low', 'lso', "You're low.");
    return out;
  }
  if (r.devDeg > T.high) {
    say(L, out, 'high', 'lso', "You're high.");
    return out;
  }
  if (r.lat < -T.lineup) {
    say(L, out, 'right', 'lso', 'Right for lineup.');
    return out;
  }
  if (r.lat > T.lineup) {
    say(L, out, 'left', 'lso', 'Come left.');
    return out;
  }
  return out;
}

/** The greenie board's points for each grade. */
export const POINTS = { 'OK*': 5, OK: 4, Fair: 3, 'No grade': 2, Bolter: 2.5, 'Wave-off': 1 };

/**
 * The grade, after the pass.
 *
 * `p` is the pass record (createPass/recordSample) plus how it ended:
 *   result  'trap' | 'bolter' | 'waveoff' | 'stopped'
 *   wire    1..4 for a trap
 *   powerTd true if the throttle was up at touchdown
 *   skip    true if the hook bounced over a wire
 *   hookUp  true if it touched down with the hook up
 *   touchedAfterWaveoff
 */
export function gradePass(p) {
  const why = [];
  if (p.result === 'waveoff') {
    const r = p.waveoffReason;
    const words = {
      'foul deck': 'the deck was foul',
      gear: 'the wheels were not down',
      hook: 'the hook was not down',
      low: 'too low in close',
      lineup: 'not lined up in close',
      wings: 'wings not level in close',
    };
    return { grade: 'Wave-off', key: 'WO', points: POINTS['Wave-off'], wire: null, comment: `Waved off — ${words[r] || r}. Go round and try again.` };
  }
  if (p.result === 'bolter' || p.result === 'stopped') {
    if (p.hookUp) why.push('the hook was up');
    else if (p.skip) why.push('the hook skipped over the wire');
    else why.push('long — the hook passed all four wires');
    if (!p.powerTd) why.push('no power on touchdown');
    if (p.result === 'stopped') why.push('a bolter is a go-around: full power and fly off the angled deck');
    return { grade: 'Bolter', key: 'B', points: POINTS.Bolter, wire: null, comment: cap(why.join('; ')) + '.' };
  }
  // A trap.
  const L = p.maxLow || {};
  const H = p.maxHigh || {};
  const S = p.maxLat || {};
  if (p.touchedAfterWaveoff) {
    return { grade: 'No grade', key: 'NG', points: POINTS['No grade'], wire: p.wire, comment: 'A wave-off is not optional — when Paddles says it, go round.' };
  }
  const major = (L.IC || 0) > 0.9 || (L.AR || 0) > 0.9 || (S.IC || 0) > 18 || (S.AR || 0) > 18 || (H.IC || 0) > 1.2;
  if ((L.IM || 0) > 0.6) why.push('low in the middle');
  if ((L.IC || 0) > 0.45 || (L.AR || 0) > 0.45) why.push('low in close');
  if ((H.IM || 0) > 0.75) why.push('high in the middle');
  if ((H.IC || 0) > 0.6) why.push('high in close');
  if ((S.IC || 0) > 9 || (S.AR || 0) > 9) why.push('off the centreline in close');
  if (!p.powerTd) why.push('no power on touchdown');
  if (p.wire === 1) why.push('1-wire — short of the target');
  if (p.wire === 4) why.push('4-wire — a little long');
  let grade;
  let key;
  if (major || why.length >= 4) {
    grade = 'No grade';
    key = 'NG';
  } else if (why.length >= 2) {
    grade = 'Fair';
    key = 'F';
  } else {
    grade = 'OK';
    key = why.length === 0 && p.wire === 3 ? 'OK*' : 'OK';
  }
  const comment = why.length ? cap(why.join(', ')) + '.' : p.wire === 3 ? 'A perfect pass: on the ball, on centreline, 3-wire.' : 'A good pass.';
  return { grade, key, points: POINTS[key] ?? POINTS[grade], wire: p.wire, comment };
}

function cap(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}
