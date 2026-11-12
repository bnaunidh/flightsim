/**
 * The controller behind the RADIO card's extra requests (features/atc-plus.js).
 *
 *   requests      clearance delivery (IFR for the jets, VFR for the light
 *                 aeroplanes and helicopters, with a squawk to read back),
 *                 climb / descent, direct to the field, flight following,
 *                 the ILS (flown on vectors) or a visual approach, going
 *                 around, MAYDAY / PAN-PAN (and cancelling it), a frequency
 *                 change and a position report — offered by phase (menu()).
 *   instructions  heading / altitude / speed to fly, hold short, line up and
 *                 wait, hand-offs (contact ... on ...). Each wants a readback;
 *                 the flown ones are checked gently against the flight
 *                 ("check altitude, maintain 3,000") after a grace period.
 *   the frequency ground → tower → departure / approach → centre, by where you
 *                 are (the control zones of features/livemap/airspace.js).
 *   the traffic   sequencing behind the AI on final ("number two, follow the
 *                 Meridian 220"), traffic advisories by clock position, and
 *                 a hold short while an arrival is on final.
 *   the score     readbacks on time and instructions flown, at the end of a flight.
 *
 * Pure: no DOM, no three.js. A snapshot of the flight goes in (SNAP below),
 * radio lines come out as events { text, voice, urgency, instr, fx } and the
 * feature says them through the game's own ATC director (its subtitles, its
 * radio voice). `fx` is what the feature does besides talking: the director's
 * once() keys to block or release, the emergency flag the AI traffic reads.
 *
 * SNAP = { t, cs, field: { name, x, z, elev (m), crs (deg), rw (spoken) },
 *   wind (spoken) , onGround, onRunway, nearRunway, lined, gs (m/s),
 *   airborneTime, x, z, altFt, aglFt, hdg, kts, vsFpm, cls ('jet'|'light'|'heli'),
 *   zone: { name, freq } | null, dest (a name, for the clearance), directTo: { name, x, z } | null,
 *   runwayBusy, crashed,
 *   traffic: [{ id, cs, type, x, z, altFt, hdg, vsFpm, kts, phase, onGround }] }
 */

const FT = 3.28084;
const NM = 1852;
/** Seconds: "please read back", then it counts as missed. */
export const READBACK_DUE = 15;
export const READBACK_LATE = 35;
/** Seconds after an instruction before it is checked, how far off counts, and how long off before a word. */
export const GRACE = { alt: 25, hdg: 20, kts: 30 };
export const TOL = { alt: 300, hdg: 20, kts: 25, direct: 25 };
export const HOLD_OFF = 8;
const REMIND_GAP = 40;
/** The tower's airspace: this close to the field and this low (ft above it). */
export const TOWER_R = 8000;
export const TOWER_AGL = 2500;

const DIG = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
const CLOCK = ['twelve', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven'];
const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];

export const altWords = (ft) => Math.round(ft).toLocaleString('en-GB');
export const hdgWords = (h) => String(((Math.round(h / 10) * 10) % 360 + 360) % 360 || 360).padStart(3, '0');
export const angDiff = (a, b) => ((a - b + 540) % 360) - 180;
export const bearing = (x1, z1, x2, z2) => ((Math.atan2(x2 - x1, -(z2 - z1)) * 180) / Math.PI + 360) % 360;
const r500 = (ft) => Math.round(ft / 500) * 500;

/** The clock position of (x, z) from an aeroplane at (px, pz) pointing hdg: 'two'. */
export function clockOf(px, pz, hdg, x, z) {
  const rel = (bearing(px, pz, x, z) - hdg + 360) % 360;
  return CLOCK[Math.round(rel / 30) % 12];
}

/** Where (x, z) is from the field, in a position report's words: '8 miles west'. */
export function fromField(s) {
  const d = Math.hypot(s.x - s.field.x, s.z - s.field.z);
  const b = bearing(s.field.x, s.field.z, s.x, s.z);
  return `${Math.max(1, Math.round(d / NM))} miles ${COMPASS[Math.round(b / 45) % 8]}`;
}

/** The field's approach frame: `along` metres before the threshold (on the way in), `cross` right of the centreline. */
export function frameOf(s, x = s.x, z = s.z) {
  const c = (s.field.crs * Math.PI) / 180;
  const ux = Math.sin(c);
  const uz = -Math.cos(c);
  const dx = x - s.field.x;
  const dz = z - s.field.z;
  return { along: -(dx * ux + dz * uz), cross: dx * Math.cos(c) + dz * Math.sin(c), ux, uz };
}

function hash(str) {
  let h = 2166136261;
  for (const ch of String(str)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h;
}

/** Every frequency a field has (the approach is its control zone's when it has one). */
export function freqsFor(field, zoneFreq) {
  const h = hash(field || 'Kestrel');
  const f = (v) => v.toFixed(2);
  return {
    delivery: f(121.1 + ((h >>> 6) % 8) * 0.05),
    ground: f(121.6 + ((h >>> 3) % 8) * 0.05),
    tower: f(118.1 + (h % 18) * 0.05),
    approach: zoneFreq || f(119.2 + ((h >>> 9) % 12) * 0.1),
    departure: f(124.05 + ((h >>> 12) % 10) * 0.1),
    centre: '127.85',
  };
}

/** Who answers on each frequency (audio/atc.js VOICES). */
export const VOICE_OF = { delivery: 'delivery', ground: 'ground', tower: 'tower', departure: 'departure', approach: 'approach', centre: 'centre' };

/** "Haven" from a zone named "HAVEN APPROACH". */
const zoneWord = (z) => {
  const w = String((z && z.name) || '').split(' ')[0];
  return w ? w.charAt(0) + w.slice(1).toLowerCase() : '';
};

export function unitName(unit, s) {
  const f = s.field.name;
  const zw = zoneWord(s.zone) || f;
  switch (unit) {
    case 'delivery': return `${f} Delivery`;
    case 'ground': return `${f} Ground`;
    case 'tower': return `${f} Tower`;
    case 'departure': return `${zw} Departure`;
    case 'approach': return `${zw} Approach`;
    default: return 'Island Centre';
  }
}

/** The extra requests, in the order the card lists them. `sub` is filled by menu(). */
export const PLUS_REQUESTS = Object.freeze([
  { id: 'readback', label: 'Readback', words: 'read back' },
  { id: 'clearance', label: 'Clearance', words: 'request clearance' },
  { id: 'climb', label: 'Climb', words: 'request climb' },
  { id: 'descend', label: 'Descend', words: 'request descent' },
  { id: 'direct', label: 'Direct', words: 'request direct' },
  { id: 'ils', label: 'ILS approach', words: 'request the ILS' },
  { id: 'visual', label: 'Visual approach', words: 'request a visual approach' },
  { id: 'goaround', label: 'Go around', words: 'going around' },
  { id: 'following', label: 'Flight following', words: 'request flight following' },
  { id: 'freq', label: 'Freq change', words: 'request frequency change' },
  { id: 'position', label: 'Position', words: 'position report' },
  { id: 'mayday', label: 'MAYDAY', words: 'MAYDAY MAYDAY MAYDAY', warn: true },
  { id: 'panpan', label: 'PAN-PAN', words: 'PAN-PAN PAN-PAN PAN-PAN', warn: true },
  { id: 'cancel', label: 'Cancel emergency', words: 'cancel the emergency', warn: true },
]);

const ceilingFor = (cls) => (cls === 'jet' ? 39000 : cls === 'heli' ? 8000 : 12000);

/** The altitudes a climb / descent request asks for, or null. */
export function stepAlts(s) {
  const up = Math.ceil((s.altFt + 1500) / 1000) * 1000;
  const down = Math.floor((s.altFt - 1500) / 1000) * 1000;
  const floor = Math.max(1000, s.field.elev * FT + 1500);
  return { up: up <= ceilingFor(s.cls) ? up : null, down: down >= floor ? down : null };
}

/** Is an AI arrival on final, or anything on the runway: the runway is not yours to line up on. */
export function runwayConflict(s) {
  if (s.runwayBusy) return { busy: true };
  for (const o of s.traffic || []) {
    if (o.onGround || (o.phase !== 'approach' && o.phase !== 'landing')) continue;
    const f = frameOf(s, o.x, o.z);
    if (f.along > -200 && f.along < 7000 && Math.abs(f.cross) < 1500) return { busy: false, o };
  }
  return null;
}

function squawkFrom(rand) {
  for (;;) {
    let c = '';
    for (let i = 0; i < 4; i++) c += Math.floor(rand() * 8);
    if (!['7500', '7600', '7700', '7000', '1200', '0000'].includes(c)) return c;
  }
}

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class AtcController {
  constructor({ seed = 1 } = {}) {
    this.rand = mulberry(seed);
    this.reset();
  }

  reset() {
    this.st = {
      t: 0, unit: null, busy: 0, wasAir: null, departed: false, departing: false, departT: 0,
      depHand: false, depCallAt: -1, lastGround: null, clearance: null, squawk: null, radarOff: false,
      tg: { alt: null, hdg: null, kts: null, direct: null }, lastRemind: -99,
      approach: null, seq: null, holdShort: false, lineup: null, conflictSaid: false,
      emergency: null, emgStill: 0, still: 0, scoreShown: false, gaSaid: false,
      adv: {}, advNext: 0, zoneGone: 0, chaseNext: 0, vs: 0, altWas: NaN, lastTraffic: null,
    };
    this.instr = [];
    this.reminders = 0;
    this.nextId = 1;
  }

  /* ---------------- the words ---------------- */

  voice(unit = this.st.unit) {
    return VOICE_OF[unit] || 'tower';
  }

  /** A line from the controller. Unsolicited ones wait while the frequency is busy (busy()). */
  line(text, { unit = this.st.unit, urgency = 0, instr = null, fx = null } = {}) {
    this.st.busy = this.st.t + 3 + text.length * 0.035;
    return { text, voice: this.voice(unit), urgency, instr, fx };
  }

  busy() {
    return this.st.t < this.st.busy;
  }

  /** A new instruction. `comply`: what it asks you to fly ({ alt } | { hdg } | { kts }). */
  issue(kind, words, rb, comply = null) {
    const i = { id: this.nextId++, kind, words, rb, t: this.st.t, read: false, late: false, missed: false, chased: false, comply, warned: false };
    this.instr.push(i);
    return i;
  }

  setAlt(v, s, i) {
    this.st.tg.alt = { v, t0: this.st.t, from: s.altFt, cap: Math.abs(s.altFt - v) < 200, off: 0, i };
  }

  setHdg(v, i) {
    this.st.tg.hdg = { v, t0: this.st.t, off: 0, i };
    this.st.tg.direct = null;
  }

  setKts(v, i) {
    this.st.tg.kts = { v, t0: this.st.t, off: 0, i };
  }

  clearTargets() {
    this.st.tg = { alt: null, hdg: null, kts: null, direct: null };
  }

  pending() {
    return this.instr.filter((i) => !i.read && !i.missed);
  }

  /* ---------------- the menu ---------------- */

  /** The extra requests that fit the moment, with their sub-labels. */
  menu(s) {
    const st = this.st;
    const out = [];
    const add = (id, sub = '') => {
      const r = PLUS_REQUESTS.find((q) => q.id === id);
      if (r) out.push({ ...r, sub });
    };
    if (this.pending().length) add('readback', this.pending().map((i) => i.words).slice(-2).join(' · '));
    if (s.crashed) return out;
    if (s.onGround) {
      if (!st.clearance && !st.departed) add('clearance', s.cls === 'jet' ? 'IFR' : 'VFR departure');
      if (st.emergency) add('cancel', st.emergency === 'mayday' ? 'MAYDAY' : 'PAN-PAN');
      return out;
    }
    const d = Math.hypot(s.x - s.field.x, s.z - s.field.z);
    const fr = frameOf(s);
    const near = d < 45000;
    const low = s.aglFt < 2000 && d < 8000;
    const a = stepAlts(s);
    if (st.emergency) {
      add('cancel', st.emergency === 'mayday' ? 'MAYDAY' : 'PAN-PAN');
      add('position', s.field.name);
      if (low) add('goaround', `runway ${s.field.rw}`);
      return out;
    }
    if (low && fr.along > -500 && fr.along < 8000) add('goaround', `runway ${s.field.rw}`);
    if (near && !st.departing && !(st.approach && st.approach.kind === 'ils')) add('ils', `runway ${s.field.rw}`);
    if (near && !st.departing && !(st.approach && st.approach.kind === 'visual')) add('visual', `runway ${s.field.rw}`);
    if (a.up) add('climb', `to ${altWords(a.up)}`);
    if (a.down) add('descend', `to ${altWords(a.down)}`);
    if (!st.approach && d > 6000) add('direct', (s.directTo && s.directTo.name) || s.field.name);
    add('position', fromField(s));
    if (!st.squawk || st.radarOff) add('following', 'radar service');
    if (st.unit !== 'tower') add('freq', unitName(st.unit, s));
    add('mayday', 'distress');
    add('panpan', 'urgency');
    return out;
  }

  /* ---------------- requests ---------------- */

  request(id, s) {
    const st = this.st;
    const cs = s.cs;
    if (st.unit == null) st.unit = this.unitFor(s);
    const un = unitName(st.unit, s);
    const fq = freqsFor(s.field.name, s.zone && s.zone.freq);
    const rw = s.field.rw;
    const wind = s.wind ? `, ${s.wind}` : '';
    const ev = [];
    const say = (text, o) => ev.push(this.line(text, o));
    let you = '';
    if (id === 'readback') return this.readback(s);
    if (!s.onGround && id === 'clearance') {
      say(`${cs}, ${un}, you are airborne. Say again?`);
      return { you: `${un}, ${cs}, request clearance`, events: ev };
    }
    switch (id) {
      case 'clearance': {
        st.unit = 'ground';
        const sq = squawkFrom(this.rand);
        const ifr = s.cls === 'jet';
        const elevFt = s.field.elev * FT;
        const init = Math.max(3000, r500(elevFt + 4000) - (r500(elevFt + 4000) % 1000));
        const exp = s.cls === 'jet' ? init + 4000 : init + 2000;
        const vfrTop = Math.max(2000, r500(elevFt + 2000));
        const dest = s.dest || 'the Island Centre area';
        st.clearance = { ifr, sq, init, exp, vfrTop };
        st.squawk = sq;
        you = `${s.field.name} Delivery, ${cs}, request ${ifr ? 'IFR clearance' : 'VFR departure'}`;
        const sqw = sq.split('').map((d) => DIG[+d]).join(' ');
        if (ifr) {
          const i = this.issue('clearance', `Cleared to ${dest}, climb ${altWords(init)}, squawk ${sq}`,
            `Cleared to ${dest}, ${s.field.name} One departure, runway ${rw}, climb ${altWords(init)}, squawk ${sq}`);
          say(`${cs}, ${s.field.name} Delivery, cleared to ${dest} via the ${s.field.name} One departure, runway ${rw}. Climb and maintain ${altWords(init)}, expect ${altWords(exp)} after departure. Departure frequency ${fq.departure}, squawk ${sqw}.`, { unit: 'delivery', instr: i });
        } else {
          const i = this.issue('clearance', `VFR, at or below ${altWords(vfrTop)}, squawk ${sq}`,
            `VFR departure runway ${rw}, at or below ${altWords(vfrTop)}, squawk ${sq}`);
          say(`${cs}, ${s.field.name} Delivery, VFR departure approved, runway ${rw}. Maintain at or below ${altWords(vfrTop)} until clear of the zone. Departure frequency ${fq.departure}, squawk ${sqw}.`, { unit: 'delivery', instr: i });
        }
        break;
      }
      case 'climb':
      case 'descend': {
        const a = stepAlts(s);
        const v = id === 'climb' ? a.up : a.down;
        you = `${un}, ${cs}, request ${id === 'climb' ? 'climb' : 'descent'}${v ? ` to ${altWords(v)}` : ''}`;
        if (s.onGround || !v) {
          say(`${cs}, ${un}, unable. Maintain present altitude.`);
          break;
        }
        const w = `${id === 'climb' ? 'Climb' : 'Descend'} and maintain ${altWords(v)}`;
        const i = this.issue('alt', w, w, { alt: v });
        this.setAlt(v, s, i);
        say(`${cs}, ${un}, ${w.toLowerCase()}.`, { instr: i });
        break;
      }
      case 'direct': {
        const to = s.directTo || null;
        const name = to ? to.name : s.field.name;
        you = `${un}, ${cs}, request direct ${name}`;
        if (s.onGround) {
          say(`${cs}, ${un}, call me when airborne.`);
          break;
        }
        const tx = to ? to.x : s.field.x;
        const tz = to ? to.z : s.field.z;
        const h = bearing(s.x, s.z, tx, tz);
        const i = this.issue('direct', `Direct ${name}, heading ${hdgWords(h)}`, `Direct ${name}`, { hdg: h });
        st.tg.hdg = null;
        st.tg.direct = { name, x: tx, z: tz, t0: st.t, off: 0, i };
        say(`${cs}, ${un}, proceed direct ${name}, heading ${hdgWords(h)}.`, { instr: i });
        break;
      }
      case 'following': {
        you = `${un}, ${cs}, ${fromField(s)} of ${s.field.name}, ${altWords(Math.round(s.altFt / 100) * 100)}, request flight following`;
        const sq = squawkFrom(this.rand);
        st.squawk = sq;
        st.radarOff = false;
        const i = this.issue('squawk', `Squawk ${sq}`, `Squawk ${sq}`);
        say(`${cs}, ${un}, squawk ${sq.split('').map((d) => DIG[+d]).join(' ')}. Radar contact, ${fromField(s)} of ${s.field.name}. Traffic advisories available, maintain VFR.`, { instr: i });
        break;
      }
      case 'ils':
      case 'visual':
        you = `${un}, ${cs}, ${fromField(s)} of ${s.field.name}, request ${id === 'ils' ? 'the ILS' : 'a visual approach'} runway ${rw}`;
        st.departing = false;
        st.seq = null;
        if (id === 'ils') this.startIls(s, ev);
        else this.startVisual(s, ev);
        break;
      case 'goaround': {
        you = `${un}, ${cs}, going around`;
        const alt = Math.max(2000, r500(s.field.elev * FT + 1800));
        const w = `Fly runway heading, climb and maintain ${altWords(alt)}`;
        const i = this.issue('goaround', w, w, { alt, hdg: s.field.crs });
        this.clearTargets();
        this.setAlt(alt, s, i);
        this.setHdg(s.field.crs, i);
        st.approach = null;
        st.seq = null;
        say(`${cs}, ${un}, roger, ${w.toLowerCase()}.`, { instr: i, fx: { unblock: ['final', 'continue', 'shortfinal'] } });
        break;
      }
      case 'freq': {
        you = `${un}, ${cs}, request frequency change`;
        const contact = this.pending().find((p) => p.kind === 'contact');
        if (contact) say(`${cs}, ${contact.words.toLowerCase()}.`);
        else if (st.unit === 'tower' || st.unit === 'ground') say(`${cs}, ${un}, remain this frequency.`);
        else {
          st.radarOff = true;
          st.squawk = '7000';
          say(`${cs}, radar service terminated, squawk VFR, frequency change approved. Good day.`);
        }
        break;
      }
      case 'position': {
        const lvl = s.vsFpm > 300 ? ', climbing' : s.vsFpm < -300 ? ', descending' : '';
        you = `${un}, ${cs}, ${fromField(s)} of ${s.field.name}, ${altWords(Math.round(s.altFt / 100) * 100)} feet${lvl}`;
        const tg = st.tg.alt ? `, maintain ${altWords(st.tg.alt.v)}` : st.approach ? ', continue the approach' : ', report the field in sight';
        say(`${cs}, ${un}, roger, radar contact${tg}.`);
        break;
      }
      case 'mayday':
      case 'panpan': {
        const m = id === 'mayday';
        you = `${m ? 'MAYDAY MAYDAY MAYDAY' : 'PAN-PAN PAN-PAN PAN-PAN'}, ${un}, ${cs}, ${fromField(s)} of ${s.field.name}, ${altWords(Math.round(s.altFt / 100) * 100)} feet, request ${m ? 'immediate landing' : 'priority'}`;
        if (s.onGround) {
          say(`${cs}, ${un}, roger, emergency services are on their way to you. Stop where you are.`, { urgency: 1, fx: { emergency: id, scene: 'raise' } });
          st.emergency = id;
          break;
        }
        st.emergency = id;
        st.emgStill = 0;
        this.clearTargets();
        st.approach = null;
        st.seq = null;
        st.departing = false;
        if (m) {
          const i = this.issue('emergency', `Priority, cleared to land runway ${rw}`, `Cleared to land runway ${rw}`);
          say(`MAYDAY acknowledged. ${cs}, ${un}, you have priority. All traffic is holding and the runway is yours. Emergency services are standing by. Runway ${rw}${wind}, cleared to land.`,
            { urgency: 1, instr: i, fx: { emergency: id, scene: 'raise', block: ['final', 'continue'] } });
        } else {
          const i = this.issue('emergency', `Priority, direct ${s.field.name}, runway ${rw}`, `Priority, direct ${s.field.name}, runway ${rw}`);
          say(`PAN-PAN acknowledged. ${cs}, ${un}, you have priority. Proceed direct ${s.field.name}, runway ${rw}, emergency services have been alerted. Report on final.`,
            { urgency: 1, instr: i, fx: { emergency: id, scene: 'raise' } });
        }
        break;
      }
      case 'cancel':
        you = `${un}, ${cs}, cancel the emergency`;
        if (!st.emergency) {
          say(`${cs}, ${un}, no emergency is declared.`);
          break;
        }
        st.emergency = null;
        say(`${cs}, ${un}, roger, emergency cancelled. Normal operations resume.`, { fx: { emergency: null, scene: 'clear' } });
        break;
      default:
        return null;
    }
    return { you, events: ev };
  }

  /** The player reads back everything waiting. Returns { you, events, count } or null. */
  readback(s) {
    const p = this.pending();
    if (!p.length) return null;
    const ev = [];
    for (const i of p) {
      i.read = true;
      i.late = this.st.t - i.t > READBACK_DUE;
    }
    const you = `${p.map((i) => i.rb).join(', ')}, ${s.cs}`;
    // Most readbacks get no answer; a clearance's is checked.
    if (p.some((i) => i.kind === 'clearance')) ev.push(this.line(`${s.cs}, readback correct. Call for taxi when ready.`, { unit: 'delivery' }));
    return { you, events: ev, count: p.length };
  }

  /**
   * A line the game's director (or the airspace hand-off) said: take what it
   * instructed as an instruction to read back. Returns it, or null.
   */
  heard(text, s) {
    const t = String(text || '');
    if (!s || !t.includes(s.cs)) return null;
    const st = this.st;
    const rw = s.field.rw;
    let i = null;
    const m = t.match(/contact ([A-Z][A-Za-z]*(?: [A-Z][A-Za-z]*)?) (Tower|Approach|Departure|Centre|Ground)(?:,? (\d{3}\.\d{1,2}))?/);
    if (/cleared for take-off/i.test(t)) {
      i = this.issue('takeoff', `Cleared for take-off runway ${rw}`, `Cleared for take-off runway ${rw}`);
      st.holdShort = false;
      st.lineup = null;
    } else if (/cleared to land/i.test(t)) {
      i = this.issue('land', `Cleared to land runway ${rw}`, `Cleared to land runway ${rw}`);
      this.clearTargets();
      st.seq = null;
    } else if (/hold short/i.test(t)) {
      i = this.issue('holdShort', `Hold short runway ${rw}`, `Holding short runway ${rw}`);
      st.holdShort = true;
      st.conflictSaid = false;
    } else if (/line up (?:runway [a-z ]+ )?and wait/i.test(t)) {
      i = this.issue('lineup', `Line up and wait runway ${rw}`, `Line up and wait runway ${rw}`);
    } else if (m) {
      const unit = m[2] === 'Centre' ? 'centre' : m[2].toLowerCase();
      const fq = m[3] || freqsFor(s.field.name, s.zone && s.zone.freq)[unit];
      i = this.issue('contact', `Contact ${m[1]} ${m[2]} ${fq}`, `${m[1]} ${m[2]}, ${fq}`);
      st.unit = unit;
    }
    return i;
  }

  /* ---------------- the approaches ---------------- */

  approachAlts(s) {
    const e = s.field.elev * FT;
    return { vec: Math.max(3000, r500(e + 2800)), icpt: Math.max(2000, r500(e + 1800)) };
  }

  basePoint(s, side) {
    const c = (s.field.crs * Math.PI) / 180;
    const ux = Math.sin(c);
    const uz = -Math.cos(c);
    return { x: s.field.x - ux * 16000 + Math.cos(c) * side * 4000, z: s.field.z - uz * 16000 + Math.sin(c) * side * 4000 };
  }

  startIls(s, ev) {
    const st = this.st;
    const un = unitName(st.unit, s);
    const fr = frameOf(s);
    const A = this.approachAlts(s);
    const C = s.field.crs;
    if (fr.along > 6000 && fr.along < 30000 && Math.abs(fr.cross) < 1500 && Math.abs(angDiff(s.hdg, C)) < 35) {
      st.approach = { kind: 'ils', stage: 'intercept', side: Math.sign(fr.cross) || 1, t: st.t };
      const w = `Maintain ${altWords(A.icpt)} until established, cleared ILS runway ${s.field.rw}`;
      const i = this.issue('approach', w, w, { alt: A.icpt });
      this.clearTargets();
      this.setAlt(A.icpt, s, i);
      ev.push(this.line(`${s.cs}, ${un}, ${fromField(s)} from ${s.field.name}, maintain ${altWords(A.icpt)} until established on the localiser, cleared ILS approach runway ${s.field.rw}.`, { instr: i }));
      return;
    }
    const side = Math.sign(fr.cross) || 1;
    const B = this.basePoint(s, side);
    const h = bearing(s.x, s.z, B.x, B.z);
    const verb = s.altFt > A.vec + 200 ? 'descend and maintain' : s.altFt < A.vec - 200 ? 'climb and maintain' : 'maintain';
    st.approach = { kind: 'ils', stage: 'join', side, lastVec: st.t, t: st.t };
    const w = `Heading ${hdgWords(h)}, ${verb} ${altWords(A.vec)}`;
    const i = this.issue('vector', w, `Heading ${hdgWords(h)}, ${verb} ${altWords(A.vec)}, vectors ILS runway ${s.field.rw}`, { hdg: h, alt: A.vec });
    this.clearTargets();
    this.setHdg(Math.round(h / 10) * 10, i);
    this.setAlt(A.vec, s, i);
    ev.push(this.line(`${s.cs}, ${un}, fly heading ${hdgWords(h)}, ${verb} ${altWords(A.vec)}, vectors ILS approach runway ${s.field.rw}.`, { instr: i }));
  }

  startVisual(s, ev) {
    const st = this.st;
    const un = unitName(st.unit, s);
    const d = Math.hypot(s.x - s.field.x, s.z - s.field.z);
    const A = this.approachAlts(s);
    this.clearTargets();
    if (d < 18000) {
      st.approach = { kind: 'visual', stage: 'established', t: st.t };
      this.visualCleared(s, ev, un);
      return;
    }
    st.approach = { kind: 'visual', stage: 'direct', t: st.t };
    const h = bearing(s.x, s.z, s.field.x, s.field.z);
    const w = `Direct ${s.field.name}, descend ${altWords(A.vec)}, report the field in sight`;
    const i = this.issue('direct', w, `Direct ${s.field.name}, descend ${altWords(A.vec)}`, { hdg: h, alt: A.vec });
    st.tg.direct = { name: s.field.name, x: s.field.x, z: s.field.z, t0: st.t, off: 0, i };
    if (s.altFt > A.vec + 200) this.setAlt(A.vec, s, i);
    ev.push(this.line(`${s.cs}, ${un}, proceed direct ${s.field.name}, heading ${hdgWords(h)}, descend and maintain ${altWords(A.vec)}. Report the field in sight.`, { instr: i }));
  }

  visualCleared(s, ev, un) {
    const st = this.st;
    const fq = freqsFor(s.field.name, s.zone && s.zone.freq);
    const hand = st.unit !== 'tower';
    const where = `${s.field.name} is at your ${clockOf(s.x, s.z, s.hdg, s.field.x, s.field.z)} o'clock, ${Math.max(1, Math.round(Math.hypot(s.x - s.field.x, s.z - s.field.z) / NM))} miles`;
    const w = `Cleared visual approach runway ${s.field.rw}${hand ? `, contact Tower ${fq.tower}` : ''}`;
    const i = this.issue(hand ? 'contact' : 'approach', w, `Cleared visual runway ${s.field.rw}${hand ? `, Tower ${fq.tower}` : ''}`);
    this.clearTargets();
    ev.push(this.line(`${s.cs}, ${un}, ${where}. Cleared visual approach runway ${s.field.rw}${hand ? `, contact ${s.field.name} Tower, ${fq.tower}` : ''}.`, { instr: i }));
    if (hand) st.unit = 'tower';
  }

  approachStep(s, ev) {
    const st = this.st;
    const ap = st.approach;
    if (!ap || ev.length) return;
    const un = unitName(st.unit, s);
    const fr = frameOf(s);
    const C = s.field.crs;
    const A = this.approachAlts(s);
    if (ap.kind === 'visual') {
      if (ap.stage === 'direct' && Math.hypot(s.x - s.field.x, s.z - s.field.z) < 15000) {
        ap.stage = 'established';
        this.visualCleared(s, ev, un);
      }
      return;
    }
    if (ap.stage === 'join') {
      const B = this.basePoint(s, ap.side);
      const dB = Math.hypot(s.x - B.x, s.z - B.z);
      const towardLoc = Math.sign(angDiff(s.hdg, C)) === ap.side || Math.abs(angDiff(s.hdg, C)) < 60;
      if (dB < 2500 || (fr.along > 9000 && Math.abs(fr.cross) < 5000 && Math.abs(fr.cross) > 800 && Math.sign(fr.cross) === ap.side && towardLoc)) {
        const H = (C - ap.side * 30 + 360) % 360;
        ap.stage = 'intercept';
        ap.t = st.t;
        const lr = angDiff(H, s.hdg) >= 0 ? 'right' : 'left';
        const w = `Heading ${hdgWords(H)}, maintain ${altWords(A.icpt)} until established, cleared ILS runway ${s.field.rw}`;
        const i = this.issue('vector', w, w, { hdg: H, alt: A.icpt });
        this.setHdg(H, i);
        this.setAlt(A.icpt, s, i);
        ev.push(this.line(`${s.cs}, turn ${lr} heading ${hdgWords(H)}, maintain ${altWords(A.icpt)} until established on the localiser, cleared ILS approach runway ${s.field.rw}.`, { instr: i }));
        return;
      }
      const brg = Math.round(bearing(s.x, s.z, B.x, B.z) / 10) * 10;
      if (st.tg.hdg && Math.abs(angDiff(brg, st.tg.hdg.v)) > 35 && st.t - ap.lastVec > 40) {
        ap.lastVec = st.t;
        const lr = angDiff(brg, s.hdg) >= 0 ? 'right' : 'left';
        const i = this.issue('vector', `Heading ${hdgWords(brg)}`, `Heading ${hdgWords(brg)}`, { hdg: brg });
        this.setHdg(brg, i);
        ev.push(this.line(`${s.cs}, turn ${lr} heading ${hdgWords(brg)}, vectors ILS runway ${s.field.rw}.`, { instr: i }));
      }
      return;
    }
    if (ap.stage === 'intercept') {
      if (Math.abs(fr.cross) < 350 && Math.abs(angDiff(s.hdg, C)) <= 35 && fr.along > 1500) {
        ap.stage = 'established';
        this.clearTargets();
        if (st.unit !== 'tower') {
          const fq = freqsFor(s.field.name, s.zone && s.zone.freq);
          const i = this.issue('contact', `Contact ${s.field.name} Tower ${fq.tower}`, `${s.field.name} Tower, ${fq.tower}`);
          ev.push(this.line(`${s.cs}, established on the localiser. Contact ${s.field.name} Tower, ${fq.tower}.`, { instr: i }));
          st.unit = 'tower';
        }
        return;
      }
      if (Math.sign(fr.cross) === -ap.side && Math.abs(fr.cross) > 900 && st.t - ap.t > 20) {
        ap.side = -ap.side;
        ap.t = st.t;
        const H = (C - ap.side * 30 + 360) % 360;
        const lr = angDiff(H, s.hdg) >= 0 ? 'right' : 'left';
        const i = this.issue('vector', `Heading ${hdgWords(H)}, re-intercept`, `Heading ${hdgWords(H)}`, { hdg: H });
        this.setHdg(H, i);
        ev.push(this.line(`${s.cs}, you have gone through the localiser. Turn ${lr} heading ${hdgWords(H)} to re-intercept.`, { instr: i }));
        return;
      }
      if (fr.along < 2500 && st.t - ap.t > 20) {
        ap.stage = 'join';
        ap.side = Math.sign(fr.cross) || ap.side;
        ap.lastVec = -99;
        const B = this.basePoint(s, ap.side);
        const h = Math.round(bearing(s.x, s.z, B.x, B.z) / 10) * 10;
        const i = this.issue('vector', `Heading ${hdgWords(h)}, ${altWords(A.vec)}`, `Heading ${hdgWords(h)}, ${altWords(A.vec)}`, { hdg: h, alt: A.vec });
        this.setHdg(h, i);
        this.setAlt(A.vec, s, i);
        ev.push(this.line(`${s.cs}, too close for the approach. Fly heading ${hdgWords(h)}, climb and maintain ${altWords(A.vec)}, vectors for another go.`, { instr: i }));
      }
    }
  }

  /* ---------------- the frequency ---------------- */

  unitFor(s) {
    if (s.onGround) return s.onRunway || s.nearRunway ? 'tower' : 'ground';
    const d = Math.hypot(s.x - s.field.x, s.z - s.field.z);
    const towerR = this.st.unit === 'tower' ? TOWER_R * 1.25 : TOWER_R;
    const towerAgl = this.st.unit === 'tower' ? TOWER_AGL * 1.3 : TOWER_AGL;
    if (d < towerR && s.aglFt < towerAgl) return 'tower';
    if (s.zone) return this.st.departing ? 'departure' : 'approach';
    return 'centre';
  }

  /** The window's line: who you are talking to, on what, and what you were told. */
  current(s) {
    const st = this.st;
    const unit = st.unit || (s ? this.unitFor(s) : 'ground');
    const fq = s ? freqsFor(s.field.name, s.zone && s.zone.freq) : freqsFor('Kestrel');
    const tg = [];
    if (st.tg.alt) tg.push(`ALT ${altWords(st.tg.alt.v)}`);
    if (st.tg.hdg) tg.push(`HDG ${hdgWords(st.tg.hdg.v)}`);
    if (st.tg.direct) tg.push(`DCT ${st.tg.direct.name.toUpperCase()}`);
    if (st.tg.kts) tg.push(`SPD ${st.tg.kts.v}`);
    if (st.squawk) tg.push(`SQK ${st.squawk}`);
    const li = this.instr[this.instr.length - 1];
    const last = st.lastTraffic && (!li || st.lastTraffic.t > li.t) && st.t - st.lastTraffic.t < 20 ? st.lastTraffic : li;
    return {
      unit, name: s ? unitName(unit, s) : unit, freq: fq[unit] || '', targets: tg.join(' · '),
      now: last ? last.words : '', pending: this.pending().length, emergency: st.emergency,
    };
  }

  /* ---------------- the frame ---------------- */

  step(dt, s) {
    const st = this.st;
    st.t += dt;
    const ev = [];
    if (s.crashed) return ev;
    const air = !s.onGround;
    if (st.unit == null) st.unit = this.unitFor(s);
    if (st.wasAir === null) st.wasAir = air;
    if (air && !st.wasAir && st.lastGround && (st.lastGround.onRunway || st.lastGround.nearRunway)) {
      st.gaSaid = false;
      st.unit = 'tower';
      // An IFR departure is handed to departure soon after take-off, who takes over the
      // director's "radar contact" call; a VFR one stays with the tower until it leaves its airspace.
      if (st.clearance && st.clearance.ifr) {
        st.departing = true;
        st.departT = st.t;
        st.depHand = false;
        this.setAlt(st.clearance.init, s, this.instr.find((i) => i.kind === 'clearance') || null);
        ev.push({ text: '', fx: { block: ['airborne'] } });
      }
    }
    if (air) st.departed = true;
    // Our own climb rate from the altitudes we are given, smoothed (ft/min).
    if (Number.isFinite(st.altWas) && dt > 0) st.vs += (((s.altFt - st.altWas) / dt) * 60 - st.vs) * Math.min(1, dt / 2);
    st.altWas = s.altFt;
    if (!air) st.lastGround = { onRunway: s.onRunway, nearRunway: s.nearRunway };
    if (air !== st.wasAir) st.still = 0;
    if (air) st.scoreShown = false;
    st.wasAir = air;

    // Waiting readbacks: asked for once, then counted as missed.
    for (const i of this.pending()) {
      const age = st.t - i.t;
      if (age > READBACK_LATE) i.missed = true;
      else if (age > READBACK_DUE && !i.chased && !this.busy() && st.t >= st.chaseNext && !ev.length) {
        i.chased = true;
        st.chaseNext = st.t + 20;
        ev.push(this.line(`${s.cs}, please read back.`));
      }
    }

    if (air) this.airStep(dt, s, ev);
    else this.groundStep(dt, s, ev);
    return ev;
  }

  groundStep(dt, s, ev) {
    const st = this.st;
    st.unit = this.unitFor(s);
    if (st.departed) {
      st.departing = false;
      st.approach = null;
      st.seq = null;
      this.clearTargets();
      st.still = s.gs < 3 ? st.still + dt : 0;
      if (st.emergency && st.still > 5) {
        st.emergency = null;
        ev.push(this.line(`${s.cs}, emergency services are with you. Well done, you are down safely.`, { fx: { emergency: null, scene: 'clearLater' } }));
        return;
      }
      if (!st.scoreShown && st.still > 3 && this.instr.length) {
        st.scoreShown = true;
        ev.push({ type: 'score', score: this.score() });
      }
      return;
    }
    if (!st.holdShort && !st.lineup) return;
    const c = runwayConflict(s);
    const rw = s.field.rw;
    if (st.holdShort) {
      if (s.onRunway && c && !ev.length) {
        // Over the line with an arrival on final: stop, gently but at once.
        if (st.t - st.lastRemind > REMIND_GAP) {
          st.lastRemind = st.t;
          this.reminders++;
          const h = this.instr.slice().reverse().find((i) => i.kind === 'holdShort');
          if (h) h.warned = true;
          ev.push(this.line(`${s.cs}, stop, hold position. You were told to hold short of runway ${rw}, traffic on final.`, { unit: 'tower', urgency: 1 }));
        }
        return;
      }
      if ((s.nearRunway || s.onRunway) && s.gs < 8 && !this.busy()) {
        if (c) {
          if (!st.conflictSaid) {
            st.conflictSaid = true;
            const who = c.o ? `, traffic on final, ${c.o.cs}, a ${c.o.type}` : ', traffic on the runway';
            const i = this.issue('holdShort', `Hold short runway ${rw}`, `Holding short runway ${rw}`);
            ev.push(this.line(`${s.cs}, ${s.field.name} Tower, hold short runway ${rw}${who}.`, { unit: 'tower', instr: i }));
          }
          return;
        }
        st.holdShort = false;
        st.lineup = { t: st.t };
        const i = this.issue('lineup', `Line up and wait runway ${rw}`, `Line up and wait runway ${rw}`);
        ev.push(this.line(`${s.cs}, ${s.field.name} Tower, runway ${rw}, line up and wait.`, { unit: 'tower', instr: i, fx: { block: ['clearance'] } }));
      }
      return;
    }
    // Lined up and waiting: the take-off clearance once the runway is clear.
    if (st.lineup && s.lined && s.gs < 4 && st.t - st.lineup.t > 6 && !this.busy() && !c) {
      st.lineup = null;
      const i = this.issue('takeoff', `Cleared for take-off runway ${rw}`, `Cleared for take-off runway ${rw}`);
      ev.push(this.line(`${s.cs}, ${s.field.name} Tower${s.wind ? `, ${s.wind}` : ''}, runway ${rw}, cleared for take-off.`, { unit: 'tower', instr: i, fx: { block: ['clearance'] } }));
    } else if (st.lineup && st.t - st.lineup.t > 90) {
      st.lineup = null;
      ev.push({ text: '', fx: { unblock: ['clearance'] } });
    }
  }

  airStep(dt, s, ev) {
    const st = this.st;
    const d = Math.hypot(s.x - s.field.x, s.z - s.field.z);
    const fq = freqsFor(s.field.name, s.zone && s.zone.freq);
    // The departure: the tower hands you on soon after take-off, and departure takes you.
    if (st.departing) {
      if (!st.depHand && (s.aglFt > 500 || s.airborneTime > 15) && !st.emergency) {
        st.depHand = true;
        const to = s.zone ? 'departure' : 'centre';
        const nm = unitName(to, s);
        const i = this.issue('contact', `Contact ${nm} ${fq[to]}`, `${nm}, ${fq[to]}`);
        ev.push(this.line(`${s.cs}, contact ${nm}, ${fq[to]}. Good day.`, { unit: 'tower', instr: i }));
        st.unit = to;
        st.depCallAt = st.t + 7;
        return;
      }
      if (st.depCallAt > 0 && st.t > st.depCallAt && !this.busy()) {
        st.depCallAt = -1;
        const ifr = st.clearance && st.clearance.ifr;
        let i = null;
        if (ifr) {
          const w = `Climb and maintain ${altWords(st.clearance.exp)}`;
          i = this.issue('alt', w, w, { alt: st.clearance.exp });
          this.setAlt(st.clearance.exp, s, i);
        }
        ev.push(this.line(`${s.cs}, ${unitName(st.unit, s)}, radar contact${ifr ? `, climb and maintain ${altWords(st.clearance.exp)}` : ''}. Report your intentions.`, { instr: i, fx: { hint: 'intentions' } }));
        return;
      }
      if (d > 20000 || st.t - st.departT > 300 || s.altFt > 9000) st.departing = false;
    }
    if (!st.emergency) {
      // Hand-offs by where you are (entering a zone is airspace.js's call; leaving one is its line too).
      const want = this.unitFor(s);
      if (want !== st.unit && !st.departing && !this.busy() && !ev.length) {
        if (st.unit === 'tower') {
          const nm = unitName(want, s);
          const i = this.issue('contact', `Contact ${nm} ${fq[want]}`, `${nm}, ${fq[want]}`);
          ev.push(this.line(`${s.cs}, contact ${nm}, ${fq[want]}. Good day.`, { unit: 'tower', instr: i }));
          st.unit = want;
          return;
        }
        if (want === 'tower' && !(st.approach && st.approach.kind === 'ils' && st.approach.stage !== 'established')) {
          const i = this.issue('contact', `Contact ${s.field.name} Tower ${fq.tower}`, `${s.field.name} Tower, ${fq.tower}`);
          ev.push(this.line(`${s.cs}, contact ${s.field.name} Tower, ${fq.tower}.`, { instr: i }));
          st.unit = 'tower';
          return;
        }
        if (want === 'centre' && st.unit !== 'tower') {
          // Out of the zone: airspace.js said "frequency change approved, contact Island Centre". Allow for its line first.
          st.zoneGone += dt * 4;
          if (st.zoneGone > 3) {
            st.unit = 'centre';
            st.zoneGone = 0;
          }
        } else if (st.unit === 'centre' && (want === 'approach' || want === 'departure')) st.unit = want;
      }
    }
    if (st.emergency) return;
    if (!this.busy() && !ev.length) this.approachStep(s, ev);
    if (!ev.length) this.sequenceStep(s, ev);
    if (!this.busy() && !ev.length) this.goAroundStep(s, ev);
    if (!this.busy() && !ev.length) this.advisoryStep(s, ev);
    if (!ev.length) this.complianceStep(dt, s, ev);
  }

  /** Behind an AI arrival on final: number two, follow it; the landing clearance waits until it is down. */
  sequenceStep(s, ev) {
    const st = this.st;
    const fr = frameOf(s);
    const inbound = fr.along > 0 && fr.along < 20000 && Math.abs(fr.cross) < 6000 && s.aglFt < 5000 && !st.departing
      && (!!st.approach || st.unit === 'tower') && Math.abs(angDiff(s.hdg, s.field.crs)) < 100;
    const ahead = [];
    if (inbound) {
      for (const o of s.traffic || []) {
        if (o.onGround || (o.phase !== 'approach' && o.phase !== 'landing')) continue;
        const f = frameOf(s, o.x, o.z);
        if (f.along > 0 && f.along < fr.along - 300 && Math.abs(f.cross) < 2500) ahead.push({ o, along: f.along });
      }
    }
    if (!ahead.length || (st.seq && st.t - st.seq.t > 180)) {
      if (st.seq) {
        st.seq = null;
        if (st.tg.kts) st.tg.kts = null;
        ev.push({ text: '', fx: { unblock: ['final', 'continue'] } });
      }
      return;
    }
    if (this.busy()) return;
    ahead.sort((a, b) => b.along - a.along);
    const lead = ahead[0].o;
    const n = ahead.length + 1;
    if (!st.seq || st.seq.id !== lead.id) {
      st.seq = { id: lead.id, n, t: st.t };
      const i = this.issue('sequence', `Number ${n}, follow the ${lead.type}`, `Number ${DIG[n] || n}, traffic in sight`);
      ev.push(this.line(`${s.cs}, number ${DIG[n] || n}, follow the ${lead.type} on final, ${lead.cs}. Continue approach.`, { instr: i, fx: { block: ['final', 'continue'] } }));
      return;
    }
    const dl = Math.hypot(s.x - lead.x, s.z - lead.z);
    if (s.cls === 'jet' && !st.tg.kts && dl < 4000 && s.kts > Math.max((lead.kts || 0) + 15, 150)) {
      const v = Math.round(Math.max(lead.kts || 0, 140) / 10) * 10;
      const w = `Reduce speed to ${v} knots`;
      const i = this.issue('speed', w, w, { kts: v });
      this.setKts(v, i);
      ev.push(this.line(`${s.cs}, reduce speed to ${v} knots, traffic ahead.`, { instr: i }));
    }
  }

  /** Short final with the runway still occupied: go around. */
  goAroundStep(s, ev) {
    const st = this.st;
    const fr = frameOf(s);
    if (st.gaSaid || !s.runwayBusy || fr.along < 0 || fr.along > 1500 || s.aglFt > 350 || Math.abs(fr.cross) > 400) return;
    st.gaSaid = true;
    const alt = Math.max(2000, r500(s.field.elev * FT + 1800));
    const w = `Go around, runway heading, climb ${altWords(alt)}`;
    const i = this.issue('goaround', w, `Going around, runway heading, climb ${altWords(alt)}`, { alt, hdg: s.field.crs });
    this.clearTargets();
    this.setAlt(alt, s, i);
    this.setHdg(s.field.crs, i);
    st.approach = null;
    st.seq = null;
    ev.push(this.line(`${s.cs}, go around, traffic on the runway. Fly runway heading, climb and maintain ${altWords(alt)}.`, { unit: 'tower', urgency: 1, instr: i, fx: { unblock: ['final', 'continue', 'shortfinal'] } }));
  }

  /** "Traffic, two o'clock, 3 miles, Kanal 47, a Meridian 220, 1,000 feet below, descending." */
  advisoryStep(s, ev) {
    const st = this.st;
    if (st.t < st.advNext || (st.radarOff && !s.zone)) return;
    let best = null;
    let bd = Infinity;
    for (const o of s.traffic || []) {
      if (o.onGround || !Number.isFinite(o.x)) continue;
      const dd = Math.hypot(o.x - s.x, o.z - s.z);
      const da = (o.altFt || 0) - s.altFt;
      if (dd > 7400 || Math.abs(da) > 2500) continue;
      const seen = st.adv[o.id];
      if (seen && !(st.t - seen.t > 120 && dd < seen.d * 0.6)) continue;
      if (dd < bd) {
        bd = dd;
        best = o;
      }
    }
    if (!best) return;
    st.adv[best.id] = { t: st.t, d: bd };
    st.advNext = st.t + 25;
    const da = (best.altFt || 0) - s.altFt;
    const rel = Math.abs(da) < 400 ? 'same altitude' : `${altWords(Math.round(Math.abs(da) / 100) * 100)} feet ${da > 0 ? 'above' : 'below'}`;
    const trend = best.vsFpm > 400 ? ', climbing' : best.vsFpm < -400 ? ', descending' : '';
    const clk = clockOf(s.x, s.z, s.hdg, best.x, best.z);
    const mi = Math.max(1, Math.round(bd / NM));
    // Information, not an instruction: nothing to read back, nothing on the score.
    st.lastTraffic = { words: `Traffic ${clk} o'clock, ${mi} mi, ${best.type}`, t: st.t };
    ev.push(this.line(`${s.cs}, traffic, ${clk} o'clock, ${mi} ${mi === 1 ? 'mile' : 'miles'}, ${best.cs}, a ${best.type}, ${rel}${trend}.`));
  }

  /** The gentle check: off what you were told for a while, after a grace period, one word. */
  complianceStep(dt, s, ev) {
    const st = this.st;
    const tg = st.tg;
    let what = null;
    if (tg.alt) {
      const a = tg.alt;
      const d = s.altFt - a.v;
      if (!a.cap && Math.abs(d) < 200) a.cap = true;
      let bad = false;
      if (st.t - a.t0 > GRACE.alt) {
        if (a.cap) bad = Math.abs(d) > TOL.alt;
        else {
          const dir = Math.sign(a.v - a.from);
          bad = dir > 0 ? s.altFt < a.from - 400 || d > TOL.alt : dir < 0 ? s.altFt > a.from + 400 || d < -TOL.alt : Math.abs(d) > TOL.alt;
          // Levelled off short of it, or gone the wrong way since.
          if (!bad && Math.abs(d) > 500 && (Math.abs(st.vs) < 250 || Math.sign(st.vs) === Math.sign(d))) bad = true;
        }
      }
      a.off = bad ? a.off + dt : 0;
      if (a.off > HOLD_OFF) what = { t: a, text: `check altitude, maintain ${altWords(a.v)}` };
    }
    // Close to the localiser on the intercept heading, turning on to it is the job, not a deviation.
    const capturing = st.approach && st.approach.stage === 'intercept' && Math.abs(frameOf(s).cross) < 1500;
    if (!what && tg.hdg && !capturing) {
      const h = tg.hdg;
      h.off = st.t - h.t0 > GRACE.hdg && Math.abs(angDiff(s.hdg, h.v)) > TOL.hdg ? h.off + dt : 0;
      if (h.off > HOLD_OFF) what = { t: h, text: `check heading, fly heading ${hdgWords(h.v)}` };
    }
    if (!what && tg.direct) {
      const g = tg.direct;
      const b = bearing(s.x, s.z, g.x, g.z);
      if (Math.hypot(s.x - g.x, s.z - g.z) < 5000) tg.direct = null;
      else {
        g.off = st.t - g.t0 > GRACE.hdg + 5 && Math.abs(angDiff(s.hdg, b)) > TOL.direct ? g.off + dt : 0;
        if (g.off > HOLD_OFF) what = { t: g, text: `check heading, proceed direct ${g.name}, heading ${hdgWords(b)}` };
      }
    }
    if (!what && tg.kts) {
      const k = tg.kts;
      k.off = st.t - k.t0 > GRACE.kts && Math.abs(s.kts - k.v) > TOL.kts ? k.off + dt : 0;
      if (k.off > HOLD_OFF) what = { t: k, text: `check speed, ${k.v} knots` };
    }
    if (!what || st.t - st.lastRemind < REMIND_GAP || this.busy()) return;
    what.t.off = 0;
    st.lastRemind = st.t;
    this.reminders++;
    if (what.t.i) what.t.i.warned = true;
    ev.push(this.line(`${s.cs}, ${what.text}.`));
  }

  /* ---------------- the score ---------------- */

  score() {
    const all = this.instr;
    const read = all.filter((i) => i.read && !i.late).length;
    const late = all.filter((i) => i.read && i.late).length;
    const missed = all.filter((i) => i.missed || (!i.read && !i.missed)).length;
    const flown = all.filter((i) => i.comply);
    const kept = flown.filter((i) => !i.warned).length;
    const possible = all.length + flown.length;
    const pct = possible ? Math.round((100 * (read + late * 0.5 + kept)) / possible) : null;
    return { instructions: all.length, read, late, missed, flown: flown.length, kept, reminders: this.reminders, pct };
  }
}
