/**
 * Airspace: every field's control zone, and the hand-off when you fly into it.
 *
 * The owner, 2026-10-26: "new airspace". Each field has a zone round it
 * (places.js: 6 km for a strip, 10 for a regional field, 14-16 for an
 * international one; faint dashed rings on the live map). Crossing in:
 *
 *   the banner     a quieter line than the island's (where.js's, under the
 *                  heading tape): ENTERING AIRSPACE / HAVEN APPROACH · 119.20
 *   the radio      your check-in as a note — You: "Haven Approach, Skylark
 *                  172, level 5,000" — and the controller's answer on the
 *                  approach voice, whose subtitle now says HAVEN APPROACH
 *   the radio card says which frequency you are on (pilot-systems.js)
 *
 * Leaving: LEAVING AIRSPACE, and "frequency change approved". In, out at
 * 1.08 of the radius, after 1.5 s; the zone you start in is known, not
 * announced; between two zones, the nearer middle wins (and must be clearly
 * nearer to take over). Not on the ground, not in the Photo HUD (the radio
 * still talks), and it waits its turn behind a warning like the banner.
 */

import { registerExtension } from '../../game/extensions.js';
import { setApproachField } from '../../audio/atc.js';
import { placesOf, addMapState } from './livemap.js';
import { BANNER, bannerBlocked } from './where.js';

export const OUT_K = 1.08;
export const CONFIRM_S = 1.5;

/** The logic, without a DOM. zones: [{ id, field, name, freq, x, z, r }] */
export class AirspaceWatch {
  constructor(zones = []) {
    this.zones = zones;
    this.cur = null;
    this.cand = undefined;
    this.candT = 0;
  }

  /** The zone (x, z) belongs to: the one whose middle is nearest of those it is inside (`k` of the radius). */
  zoneAt(x, z, k = 1) {
    let best = null;
    let bq = Infinity;
    for (const zo of this.zones) {
      const d = Math.hypot(x - zo.x, z - zo.z);
      if (d > zo.r * k) continue;
      const q = d / zo.r;
      if (q < bq) {
        bq = q;
        best = zo;
      }
    }
    return best;
  }

  prime(x, z) {
    this.cur = this.zoneAt(x, z);
    this.cand = undefined;
    this.candT = 0;
  }

  /** One frame → null | { type: 'enter', zone, from } | { type: 'leave', zone } */
  update(dt, x, z) {
    let want = this.cur;
    if (this.cur) {
      const d = Math.hypot(x - this.cur.x, z - this.cur.z);
      if (d > this.cur.r * OUT_K) want = this.zoneAt(x, z);
      else {
        // Inside two: a clearly nearer middle takes over.
        const other = this.zoneAt(x, z);
        if (other && other !== this.cur && Math.hypot(x - other.x, z - other.z) / other.r < (d / this.cur.r) * 0.75) want = other;
      }
    } else want = this.zoneAt(x, z);
    if (want === this.cur) {
      this.cand = undefined;
      this.candT = 0;
      return null;
    }
    if (this.cand !== want) {
      this.cand = want;
      this.candT = 0;
    }
    this.candT += dt;
    if (this.candT < CONFIRM_S) return null;
    const from = this.cur;
    this.cur = want;
    this.cand = undefined;
    this.candT = 0;
    if (want) return { type: 'enter', zone: want, from };
    return { type: 'leave', zone: from };
  }
}

/** "Haven" from "HAVEN APPROACH". */
function fieldWord(zone) {
  const w = String(zone.name || '').split(' ')[0] || 'Island';
  return w.charAt(0) + w.slice(1).toLowerCase();
}

/** The call you make checking in: "level 5,000", or climbing / descending through. */
export function levelWords(altFt, vsFpm) {
  const a = Math.round(altFt / 100) * 100;
  const n = a.toLocaleString('en-GB');
  if (vsFpm > 300) return `climbing through ${n}`;
  if (vsFpm < -300) return `descending through ${n}`;
  return `level ${n}`;
}

const A = { watch: null, key: null, pending: null, cur: null };

function watchFor(sim) {
  const P = placesOf(sim);
  const key = `${P.mapId}|${P.zones.length}`;
  if (!A.watch || A.key !== key) {
    A.watch = new AirspaceWatch(P.zones);
    A.key = key;
  }
  return A.watch;
}

function onEvent(sim, ev) {
  const ac = sim.aircraft;
  const r = ac.readouts();
  const cs = (sim.atc && sim.atc.callsign) || 'Skylark 172';
  const blocked = bannerBlocked(sim);
  if (ev.type === 'enter') {
    const z = ev.zone;
    const word = fieldWord(z);
    A.cur = z;
    setApproachField(word);
    if (!blocked) BANNER.push({ id: `as:${z.id}`, title: 'ENTERING AIRSPACE', name: `${z.name} · ${z.freq}`, sub: '', quiet: true, prio: 1 });
    const check = `${word} Approach, ${cs}, ${levelWords(r.altFt, r.vsFpm)}`;
    if (sim.hud) sim.hud.notify(`You: "${check}."`, 'info', 3.4);
    A.pending = { t: 2.2, text: `${cs}, ${word} Approach, radar contact. Continue as you are, report the field in sight.`, tries: 0 };
  } else {
    const z = ev.zone;
    const word = fieldWord(z);
    if (!blocked) BANNER.push({ id: `asl:${z.id}`, title: 'LEAVING AIRSPACE', name: `${z.name}`, sub: '', quiet: true, prio: 0 });
    A.pending = { t: 0.8, text: `${cs}, leaving ${word} airspace, frequency change approved. Good day.`, tries: 0, then: () => setApproachField(null) };
    A.cur = null;
  }
}

function sayPending(sim, dt) {
  const p = A.pending;
  if (!p) return;
  p.t -= dt;
  if (p.t > 0) return;
  const d = sim.atc;
  // The frequency is busy (the tower's own call): try again a moment later, give up after 8 s.
  const said = d && typeof d.say === 'function' ? d.say(p.text, 'approach') : (sim.speak(p.text, 'approach'), true);
  if (said || ++p.tries > 16) {
    A.pending = null;
    if (p.then) p.then();
  } else p.t = 0.5;
}

// The live map draws the zone you are in a little brighter.
addMapState((sim, st) => {
  st.zone = A.cur;
});

registerExtension({
  id: 'airspace',
  install(sim) {
    sim.airspace = {
      current: () => A.cur,
      /** The radio card's line: "HAVEN APPROACH 119.20", or ''. */
      label: () => (A.cur ? `${A.cur.name} ${A.cur.freq}` : ''),
      watch: () => watchFor(sim),
    };
  },
  buildWorld() {
    A.watch = null;
    A.cur = null;
    A.pending = null;
    setApproachField(null);
  },
  startMode(sim) {
    A.pending = null;
    const ac = sim.aircraft;
    const w = watchFor(sim);
    if (ac && sim.mode !== 'drive') {
      w.prime(ac.pos.x, ac.pos.z);
      A.cur = w.cur;
      setApproachField(A.cur ? fieldWord(A.cur) : null);
    }
  },
  update(sim, dt) {
    const ac = sim.aircraft;
    if (!ac || sim.mode === 'drive' || ac.crashed) return;
    sayPending(sim, dt);
    const w = watchFor(sim);
    const ev = w.update(dt, ac.pos.x, ac.pos.z);
    // On the ground (taxiing past a boundary, a stand start) the zone changes quietly.
    if (ev && !ac.onGround) onEvent(sim, ev);
    else if (ev) {
      A.cur = w.cur;
      setApproachField(A.cur ? fieldWord(A.cur) : null);
    }
  },
});
