/**
 * "NOW ENTERING" — where you are, said once, at the top of the screen.
 *
 * The owner, 2026-10-26: "if you go on the island, on the top of the screen
 * it should have text saying 'welcome to blah blah blah'". Crossing onto an
 * island (every island on the World Map preview, each map's own islands —
 * not the hill ranges on them) puts a title under the heading tape:
 *
 *     NOW ENTERING
 *     Haven Island
 *     Haven Sound · Haven International 4 km
 *
 * and a full stop at a field after a flight: WELCOME TO / Haven International
 * / XHVN · Haven Island. Realistic area titles (Forza Horizon's, Project
 * Flight's), not a cartoon: small caps, a soft fade in and out over about four
 * seconds, nothing that flashes.
 *
 *   HYSTERESIS  in at 0.9 of an island's radius, out at 1.15, and it must be
 *               true for 2 s; the same island is not announced again for two
 *               minutes. A coastline does not spam it.
 *   ONCE        the island you start on is known, not announced.
 *   NOT NOW     never in the Photo HUD or with the interface hidden; held
 *               (up to 8 s, then dropped) while a warning is lit or while
 *               you are low on an approach; the welcome waits for the
 *               aeroplane to have slowed to a taxi.
 *
 * `Banner` is the element; airspace.js puts its own, quieter line in it too.
 */

import { registerExtension } from '../../game/extensions.js';
import { placesOf } from './livemap.js';
import { fmtKm } from './geo.js';

export const ENTER_K = 0.9;
export const EXIT_K = 1.15;
export const CONFIRM_S = 2;
export const REPEAT_S = 120;
/** Islands smaller than this are rocks, not places to announce. */
export const MIN_RADIUS_M = 500;

/**
 * The logic, without a DOM (tests/features/where.mjs drives it).
 *   islands  [{ id, name, x, z, r, region }]   (places.js: islands, not hills)
 *   fields   [{ id, code, name, place, x, z, runways }]
 *   regions  [{ id, name }]
 */
export class LocationWatch {
  constructor({ islands = [], fields = [], regions = [] } = {}) {
    this.islands = islands.filter((i) => i && i.r >= MIN_RADIUS_M);
    this.fields = fields;
    this.regions = regions;
    this.reset();
  }

  reset() {
    this.cur = null;
    this.cand = null;
    this.candT = 0;
    this.t = 0;
    this.lastShown = new Map();
    this.airborneT = 0;
    this.welcomed = false;
  }

  /** Where the flight starts: known, not announced. */
  prime(x, z) {
    this.cur = this.inside(x, z, ENTER_K);
    if (this.cur) this.lastShown.set(this.cur.id, this.t);
    this.cand = null;
    this.candT = 0;
    this.welcomed = true;
    this.airborneT = 0;
  }

  /** The island (x, z) is inside, at `k` of its radius (the most inside one), or null. */
  inside(x, z, k) {
    let best = null;
    let bk = k;
    for (const i of this.islands) {
      const q = Math.hypot(x - i.x, z - i.z) / i.r;
      if (q < bk) {
        bk = q;
        best = i;
      }
    }
    return best;
  }

  nearestField(x, z) {
    let best = null;
    let bd = Infinity;
    for (const f of this.fields) {
      const d = Math.hypot(x - f.x, z - f.z);
      if (d < bd) {
        bd = d;
        best = f;
      }
    }
    return best ? { field: best, d: bd } : null;
  }

  /** The words under an island's name: its region, the nearest field (within 40 km). */
  subFor(isl) {
    const parts = [];
    const reg = isl.region && this.regions.find((r) => r.id === isl.region);
    if (reg) parts.push(reg.name);
    const nf = this.nearestField(isl.x, isl.z);
    // The field on it by name; one off it, by name and how far.
    if (nf && nf.d < 40000) parts.push(nf.d < 2500 + isl.r * 0.5 ? nf.field.name : `${nf.field.name} ${fmtKm(nf.d)}`);
    return parts.join(' · ');
  }

  /**
   * One frame. s = { x, z, onGround, gsKts }. Returns an event or null:
   *   { kind: 'island', title, name, sub, id }   crossed onto an island
   *   { kind: 'welcome', title, name, sub, id }  stopped at a field after a flight
   */
  update(dt, s) {
    this.t += dt;
    if (!s.onGround) {
      this.airborneT += dt;
      if (this.airborneT > 20) this.welcomed = false;
    } else if (!this.welcomed && this.airborneT > 20 && s.gsKts < 25) {
      const nf = this.nearestField(s.x, s.z);
      const half = nf && nf.field.runways && nf.field.runways.length ? Math.max(...nf.field.runways.map((r) => r.length)) / 2 : 800;
      if (nf && nf.d < half + 900) {
        this.welcomed = true;
        this.airborneT = 0;
        const f = nf.field;
        return { kind: 'welcome', title: 'WELCOME TO', name: f.name, sub: [f.code, f.place].filter(Boolean).join(' · '), id: `welcome:${f.id}` };
      }
    }
    if (s.onGround) this.airborneT = Math.min(this.airborneT, 30);
    // Still on the one you are on?
    if (this.cur) {
      const q = Math.hypot(s.x - this.cur.x, s.z - this.cur.z) / this.cur.r;
      if (q > EXIT_K) this.cur = null;
    }
    const now = this.inside(s.x, s.z, ENTER_K);
    if (!now || now === this.cur) {
      this.cand = null;
      this.candT = 0;
      return null;
    }
    // A bigger island you are still on keeps you: only an island you are clearly onto takes over.
    if (this.cur && now !== this.cur) {
      const qc = Math.hypot(s.x - this.cur.x, s.z - this.cur.z) / this.cur.r;
      if (qc < ENTER_K) return null;
    }
    if (this.cand !== now) {
      this.cand = now;
      this.candT = 0;
    }
    this.candT += dt;
    if (this.candT < CONFIRM_S) return null;
    this.cur = now;
    this.cand = null;
    const last = this.lastShown.get(now.id);
    if (last != null && this.t - last < REPEAT_S) return null;
    this.lastShown.set(now.id, this.t);
    return { kind: 'island', title: 'NOW ENTERING', name: now.name, sub: this.subFor(now), id: now.id };
  }
}

/* ------------------------------------------------------------------ */
/* The banner                                                          */
/* ------------------------------------------------------------------ */

const CSS = `
.loc-banner { display: flex; flex-direction: column; align-items: center; text-align: center; pointer-events: none; overflow: hidden;
  max-height: 0; opacity: 0; transition: opacity 0.6s ease, max-height 0.5s ease, margin 0.5s ease; margin: 0; }
.loc-banner.is-on { opacity: 1; max-height: 96px; margin: 2px 0 2px; }
.loc-banner .loc-title { font: 800 10.5px/1.2 var(--font, system-ui), sans-serif; letter-spacing: 0.22em; color: #bfe3ff; text-shadow: 0 1px 4px rgba(0,0,0,0.85); }
.loc-banner .loc-name { font: 650 25px/1.12 var(--font, system-ui), sans-serif; color: #fff; letter-spacing: 0.01em; text-shadow: 0 2px 10px rgba(0,0,0,0.7), 0 0 2px rgba(0,0,0,0.6); }
.loc-banner .loc-rule { width: 64px; height: 1px; margin: 3px 0 2px; background: linear-gradient(90deg, transparent, rgba(255,255,255,0.75), transparent); }
.loc-banner .loc-sub { font: 500 12.5px/1.25 var(--font, system-ui), sans-serif; color: rgba(232, 240, 248, 0.9); text-shadow: 0 1px 4px rgba(0,0,0,0.85); }
.loc-banner.is-quiet .loc-name { font-size: 15px; font-weight: 700; letter-spacing: 0.06em; }
.loc-banner.is-quiet .loc-title { color: #9fc8ff; }
.loc-banner.is-quiet .loc-rule { display: none; }
.hud.is-photo .loc-banner, html.lm-open .loc-banner { display: none !important; }
html.reduce-motion .loc-banner { transition: none; }
@media (prefers-reduced-motion: reduce) { .loc-banner { transition: none; } }
@media (max-width: 560px) { .loc-banner .loc-name { font-size: 19px; } .loc-banner.is-on { max-height: 80px; } }
`;

function injectStyle() {
  if (typeof document === 'undefined' || document.getElementById('loc-style')) return;
  const st = document.createElement('style');
  st.id = 'loc-style';
  st.textContent = CSS;
  document.head.appendChild(st);
}

/** Seconds each banner stays: the island's title 4.2, a quiet line 3.4. */
export const SHOW_S = { loud: 4.2, quiet: 3.4 };
/** How long a banner waits for a warning or an approach to pass before it is dropped. */
export const HOLD_S = 8;

/**
 * The element under the heading tape, and its queue: one at a time, the
 * louder first; held while the moment is wrong (`quietNow`), dropped if held
 * too long.
 */
export class Banner {
  constructor() {
    this.queue = [];
    this.cur = null;
    this.t = 0;
    this.shown = [];
    this.el = null;
  }

  mount(sim) {
    if (this.el || typeof document === 'undefined') return this.el;
    const lane = sim && sim.hud && sim.hud.topLane;
    if (!lane) return null;
    injectStyle();
    const el = document.createElement('div');
    el.className = 'loc-banner';
    el.setAttribute('role', 'status');
    el.innerHTML = '<div class="loc-title"></div><div class="loc-name"></div><div class="loc-rule"></div><div class="loc-sub"></div>';
    // Under the tape, over the objective: the lane is a column, so they stack and never overlap.
    const tape = sim.hud.dest && sim.hud.dest.el;
    if (tape && tape.parentNode === lane) lane.insertBefore(el, tape.nextSibling);
    else lane.insertBefore(el, lane.firstChild);
    this.el = el;
    this.parts = { title: el.children[0], name: el.children[1], sub: el.children[3] };
    return el;
  }

  /** e: { title, name, sub, quiet?, prio } (higher prio first). */
  push(e) {
    if (!e) return;
    if (this.queue.some((q) => q.id && q.id === e.id) || (this.cur && this.cur.id && this.cur.id === e.id)) return;
    this.queue.push({ ...e, waited: 0 });
    this.queue.sort((a, b) => (b.prio || 0) - (a.prio || 0));
    if (this.queue.length > 3) this.queue.length = 3;
  }

  clear() {
    this.queue.length = 0;
    this.cur = null;
    if (this.el) this.el.classList.remove('is-on');
  }

  /** quietNow: a reason not to show anything right now (a warning, an approach), or ''. */
  tick(dt, quietNow, blocked) {
    if (blocked) {
      this.clear();
      return;
    }
    if (this.cur) {
      this.t -= dt;
      // A quiet line (an airspace's) gives way at once to a louder one (an island's, a welcome).
      const louder = this.cur.quiet && this.queue.length && (this.queue[0].prio || 0) > (this.cur.prio || 0) && !this.queue[0].quiet;
      if (this.t <= 0 || quietNow === 'urgent' || louder) {
        this.cur = null;
        if (this.el) this.el.classList.remove('is-on');
        this.t = -0.7; // let it fade before the next
      }
      return;
    }
    if (this.t < 0) {
      this.t += dt;
      return;
    }
    if (!this.queue.length) return;
    if (quietNow) {
      for (const q of this.queue) q.waited += dt;
      this.queue = this.queue.filter((q) => q.waited < HOLD_S);
      return;
    }
    const e = this.queue.shift();
    this.cur = e;
    this.t = e.quiet ? SHOW_S.quiet : SHOW_S.loud;
    this.shown.push({ title: e.title, name: e.name, sub: e.sub, quiet: !!e.quiet });
    if (this.shown.length > 20) this.shown.shift();
    if (!this.el) return;
    this.parts.title.textContent = e.title || '';
    this.parts.name.textContent = e.name || '';
    this.parts.sub.textContent = e.sub || '';
    this.el.classList.toggle('is-quiet', !!e.quiet);
    this.el.classList.add('is-on');
  }
}

/** The one banner every part shares (where.js, airspace.js). */
export const BANNER = new Banner();

/** A reason the moment is wrong for a banner: 'urgent' (a red warning), 'busy' (an amber one, or low on an approach), or ''. */
export function quietReason(sim) {
  const w = sim.warnings;
  const on = w && typeof w.active === 'function' ? w.active() : [];
  if (on.some((id) => ['pullup', 'windshear', 'terrain', 'tcasRA', 'stall', 'engineFire', 'engineFail', 'overspeed', 'gear'].includes(id))) return 'urgent';
  if (on.some((id) => ['terrainAhead', 'sinkrate', 'dontsink', 'flaps', 'bankangle', 'tcasTA'].includes(id))) return 'busy';
  const ac = sim.aircraft;
  if (ac && !ac.onGround && typeof ac.readouts === 'function') {
    const r = ac.readouts();
    // Low, coming down: the approach and the landing are the job.
    if (r.aglFt < 600 && r.vsFpm < -200) return 'busy';
  }
  return '';
}

/** Should no banner show at all (the Photo HUD, the interface hidden, not flying)? */
export function bannerBlocked(sim) {
  if (sim.state !== 'flying' || sim.mode === 'drive') return true;
  const h = sim.hud;
  if (!h || h.hidden || h.enabled === false || h.density === 'photo') return true;
  return false;
}

const W = { watch: null, key: null };

function watchFor(sim) {
  const P = placesOf(sim);
  const key = `${P.mapId}|${P.islands.length}|${P.airports.length}`;
  if (!W.watch || W.key !== key) {
    W.watch = new LocationWatch({ islands: P.islands, fields: P.airports, regions: P.regions || [] });
    W.key = key;
  }
  return W.watch;
}

registerExtension({
  id: 'location-banner',
  install(sim) {
    sim.location = {
      banner: BANNER,
      watch: () => watchFor(sim),
      shown: () => BANNER.shown.slice(),
    };
  },
  buildWorld() {
    W.watch = null;
    BANNER.clear();
  },
  startMode(sim) {
    BANNER.clear();
    BANNER.mount(sim);
    const ac = sim.aircraft;
    if (ac && sim.mode !== 'drive') watchFor(sim).prime(ac.pos.x, ac.pos.z);
  },
  stop() {
    BANNER.clear();
  },
  update(sim, dt) {
    const ac = sim.aircraft;
    if (!ac || sim.mode === 'drive' || ac.crashed) return;
    BANNER.mount(sim);
    const blocked = bannerBlocked(sim);
    const ev = watchFor(sim).update(dt, { x: ac.pos.x, z: ac.pos.z, onGround: !!ac.onGround, gsKts: (ac.groundSpeed || 0) * 1.94384 });
    // In the Photo HUD it is not shown, and not saved up for later either.
    if (ev && !blocked) BANNER.push({ ...ev, prio: ev.kind === 'welcome' ? 3 : 2 });
    const q = quietReason(sim);
    // A welcome is on the ground, after the landing: an approach is not in the way of it.
    BANNER.tick(dt, q === 'busy' && BANNER.queue[0] && BANNER.queue[0].kind === 'welcome' ? '' : q, blocked);
  },
});
