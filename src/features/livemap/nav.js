/**
 * DIRECT TO and the flight plan: the live map's waypoints, flown by the
 * autopilot in NAV.
 *
 * The owner, 2026-10-26: "on autopilot u should be able to choose where u
 * wanna go (coords wise)" — and asked if that is how it is done for real. It
 * is, and it is labelled like the real thing:
 *
 *   DIRECT TO   Garmin's D→, the Airbus MCDU's DIR: from where you are now
 *               straight to the waypoint (geo.js FlightPlan.directTo).
 *   NAV         the autopilot's lateral mode while it follows the route
 *               (Boeing LNAV, Airbus managed NAV); HDG otherwise. The height
 *               it holds is not touched. Dialling a heading is selecting HDG:
 *               the route waits until DIRECT TO is pressed again.
 *   + ROUTE     a flight plan, leg by leg — FROM → fixes → TO, each leg's
 *               distance and time — the next leg when one is reached.
 *   GO TO       a position typed as a real one: N12°34.5' W045°12.3', or the
 *               km grid, or a fix (HERON), an airport code or a place.
 *   ARRIVAL     "Waypoint reached" (a toast, no chime), then a hold: an orbit
 *               round the last waypoint (a helicopter hovers over it). At an
 *               airport, the offer of the approach (the autopilot's own).
 *
 * The terrain and the warnings keep priority: in NAV the autopilot looks a
 * minute ahead along the route and climbs over high ground in the way
 * (flight/autopilot.js NAV_TERRAIN_LOOK_S), its 500 ft floor stays, the
 * stick still takes it back, and a PULL UP still shuts the map.
 */

import * as THREE from '../../vendor/three.module.js';
import { registerExtension } from '../../game/extensions.js';
import { heightAt } from '../../world/terrain.js';
import { SPEC } from '../../aircraft/physics.js';
import { icon } from '../../ui/icons.js';
import { findPlace } from './places.js';
import * as G from './geo.js';
import {
  addMapPanel, addSelectionAction, addMapState, addPickSource,
  meOf, placesOf, select, pinAt, centreOn, findById, refresh, kindWord,
} from './livemap.js';

const S = {
  sim: null,
  plan: new G.FlightPlan(),
  armed: true,
  offer: null,
  guide: { pos: new THREE.Vector3(), label: '', nav: true },
};

/* ------------------------------------------------------------------ */
/* What the autopilot follows                                          */
/* ------------------------------------------------------------------ */

/** flight/autopilot.js reads this as its `nav`. */
export const NAV = {
  /** Where to steer now, or null (no route, or the pilot dialled a heading). */
  steer(ac) {
    if (!S.armed || S.plan.state === 'idle' || !ac) return null;
    return S.plan.steer(ac.pos.x, ac.pos.z, ac.groundSpeed || 0, !!SPEC.rotor);
  },
  /** What the mode line calls it: the next waypoint's name. */
  label() {
    const w = S.plan.to;
    if (!w) return '';
    return S.plan.state === 'holding' ? `HOLD ${w.name}` : w.name;
  },
  /** Dialling a heading takes it out of NAV (a real autopilot's HDG): the route stays, waiting. */
  onHeadingSelected() {
    if (!S.armed || S.plan.state === 'idle') return;
    S.armed = false;
    const sim = S.sim;
    if (sim && sim.hud) sim.hud.notify('HDG — the autopilot leaves the route; DIRECT TO on the map flies it again', 'info', 3.2);
    refresh(sim, true);
  },
  get active() {
    return S.armed && S.plan.state !== 'idle';
  },
};

/** The guidance (the heading tape's marker, the minimap's target, the beacon) while the route is armed. */
export function guideTarget() {
  if (!NAV.active) return null;
  const w = S.plan.to;
  if (!w) return null;
  S.guide.pos.set(w.x, Math.max(0, heightAt(w.x, w.z)), w.z);
  S.guide.label = S.plan.state === 'holding' ? `${w.name} (hold)` : w.name;
  return S.guide;
}

function engage(sim, why) {
  const ac = sim.aircraft;
  const ap = sim.autopilot;
  if (!ac || !ap || sim.mode === 'drive') return;
  S.armed = true;
  if (ap.engaged && (ap.mode === 'field' || ap.mode === 'approach')) ap.setMode('hold');
  if (!ap.engaged && !ac.onGround && !ac.crashed && sim.state === 'flying' && typeof sim.toggleAutopilot === 'function') sim.toggleAutopilot(true);
  const w = S.plan.to;
  if (sim.hud && w) {
    const me = meOf(sim);
    const d = me ? G.distM(me.x, me.z, w.x, w.z) : 0;
    const brg = me ? G.fmtBrg(G.bearingDeg(me.x, me.z, w.x, w.z)) : '';
    const tail = ac.onGround ? ' — engage the autopilot in the air to fly it' : ap.engaged ? ' · NAV' : '';
    sim.hud.notify(`${why} ${w.name} — ${brg} ${G.fmtKm(d)}${tail}`, 'good', 4);
  }
}

/** DIRECT TO a waypoint ({ name, x, z, kind, ref? }): one already on the route keeps the legs after it. */
export function directTo(sim, wp) {
  const me = meOf(sim);
  if (!me || !wp || me.drive) return null;
  const i = S.plan.legs.findIndex((l) => Math.hypot(l.x - wp.x, l.z - wp.z) < 30);
  if (i >= S.plan.active && i >= 0) S.plan.directToIndex(i, me.x, me.z);
  else S.plan.directTo(wp, me.x, me.z);
  closeOffer(sim);
  engage(sim, 'DIRECT TO');
  refresh(sim, true);
  return S.plan.to;
}

/** Add a waypoint to the end of the flight plan. */
export function addToRoute(sim, wp) {
  const me = meOf(sim);
  if (!me || !wp || me.drive) return null;
  const first = S.plan.empty;
  S.plan.add(wp, me.x, me.z);
  if (first) engage(sim, 'Route:');
  else if (sim.hud) sim.hud.notify(`${wp.name} added to the route (${S.plan.legs.length} waypoints)`, 'info', 2.6);
  refresh(sim, true);
  return S.plan.legs[S.plan.legs.length - 1];
}

export function clearRoute(sim) {
  const was = !S.plan.empty;
  S.plan.clear();
  S.armed = true;
  closeOffer(sim);
  if (was && sim && sim.hud) sim.hud.notify('Route cleared — the autopilot holds the heading (HDG)', 'info', 2.6);
  refresh(sim, true);
}

/** Has a waypoint been reached? Every flying frame, map open or not. */
function tick(sim, dt) {
  if (S.offer) {
    S.offer.t -= dt;
    if (S.offer.t <= 0) closeOffer(sim);
  }
  if (S.plan.state !== 'active' || sim.mode === 'drive') return;
  const ac = sim.aircraft;
  if (!ac || ac.crashed) return;
  const ev = S.plan.update(ac.pos.x, ac.pos.z, ac.groundSpeed || 0);
  if (!ev) return;
  if (ev.type === 'sequenced') {
    const n = ev.next;
    const d = G.distM(ac.pos.x, ac.pos.z, n.x, n.z);
    if (sim.hud) sim.hud.notify(`${ev.wp.name} reached — next ${n.name} ${G.fmtBrg(G.bearingDeg(ac.pos.x, ac.pos.z, n.x, n.z))} ${G.fmtKm(d)}`, 'good', 4);
  } else if (ev.type === 'arrived') {
    const w = ev.wp;
    const heli = !!SPEC.rotor;
    if (sim.hud) sim.hud.notify(`Waypoint reached — ${w.name}. ${heli ? 'Hovering over it' : 'Holding: circling it'}`, 'good', 4.5);
    if (w.kind === 'airport' && !heli) offerApproach(sim, w);
  }
  refresh(sim, true);
}

/* ------------------------------------------------------------------ */
/* The approach, at an airport                                          */
/* ------------------------------------------------------------------ */

/** Can the autopilot fly this field's approach? (every World Map field, and each map's own runway) */
export function approachable(sim, ref) {
  const P = placesOf(sim);
  if (!ref) return false;
  if (P.isPreview) return !!(sim.worldPreview && P.airports.some((a) => a.id === ref));
  return ref === 'main';
}

export function flyApproach(sim, ref) {
  if (!approachable(sim, ref)) return false;
  const P = placesOf(sim);
  if (P.isPreview && sim.worldPreview) sim.worldPreview.setDestination(ref);
  S.plan.clear();
  S.armed = true;
  closeOffer(sim);
  const hooks = sim.menus && sim.menus.hooks;
  if (hooks && typeof hooks.onAutopilotMode === 'function') hooks.onAutopilotMode('approach');
  else if (sim.autopilot) sim.autopilot.setMode('approach');
  refresh(sim, true);
  return true;
}

function offerApproach(sim, w) {
  if (!approachable(sim, w.ref) || typeof document === 'undefined') return;
  closeOffer(sim);
  injectStyle();
  const el = document.createElement('div');
  el.className = 'lm-offer';
  el.innerHTML = `<span><b>${w.name}</b> overhead — fly the approach?</span><button type="button" data-lm-offer="yes">APPROACH</button><button type="button" class="lm-x" data-lm-offer="no" aria-label="No thanks">${icon('close', 14)}</button>`;
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-lm-offer]');
    if (!b) return;
    e.preventDefault();
    if (b.dataset.lmOffer === 'yes') flyApproach(sim, w.ref);
    else closeOffer(sim);
  });
  const stack = sim.hud && sim.hud.stack;
  if (stack && typeof stack.add === 'function') stack.add(el, { prio: 1.35, id: 'lm-offer', chip: false, keep: true });
  S.offer = { el, t: 40, ref: w.ref };
}

function closeOffer(sim) {
  if (!S.offer) return;
  const stack = sim && sim.hud && sim.hud.stack;
  if (stack && typeof stack.remove === 'function') stack.remove(S.offer.el);
  if (S.offer.el.parentNode) S.offer.el.parentNode.removeChild(S.offer.el);
  S.offer = null;
}

/* ------------------------------------------------------------------ */
/* GO TO: a typed position                                             */
/* ------------------------------------------------------------------ */

/** A fix, a code, a place or a position → selected (and centred). Returns the waypoint, or null. */
export function goTo(sim, text, hint = null) {
  const P = placesOf(sim);
  const t = String(text || '').trim();
  const say = (msg, bad) => {
    if (!hint) return;
    hint.textContent = msg;
    hint.classList.toggle('is-bad', !!bad);
  };
  const named = findPlace(P, t);
  if (named) {
    const w = findById(sim, named.id) || { ...named };
    select(sim, w, true);
    say(`${w.name}${w.long && w.long !== w.name ? ` · ${w.long}` : ''} — DIRECT TO flies it`);
    return w;
  }
  const p = G.parsePosition(t, P.origin);
  if (!p) {
    say("Not a position I can read: try N12°34.5' W045°12.3', 12.3 km E 4.5 km N, a fix (HERON) or an airport code", true);
    return null;
  }
  const w = pinAt(sim, p.x, p.z);
  centreOn(p.x, p.z);
  say(`Pinned ${w.long} — DIRECT TO flies it`);
  return w;
}

/* ------------------------------------------------------------------ */
/* The side panel: the flight plan, GO TO                               */
/* ------------------------------------------------------------------ */

const CSS = `
.lm-side h4 .lm-mode { padding: 2px 7px; border-radius: 6px; background: rgba(255,255,255,0.12); opacity: 1; letter-spacing: 0.08em; }
.lm-side h4 .lm-mode.is-nav { background: #e83ee6; color: #fff; }
.lm-plan { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; font-variant-numeric: tabular-nums; }
.lm-plan li { display: grid; grid-template-columns: 1fr auto auto; gap: 8px; align-items: center; padding: 6px 8px; border-radius: 9px; background: rgba(255,255,255,0.05); }
.lm-plan li.is-active { background: rgba(232, 62, 230, 0.22); box-shadow: 0 0 0 1px rgba(232, 62, 230, 0.6) inset; }
.lm-plan li.is-done { opacity: 0.45; }
.lm-plan li.lm-empty { display: block; font-size: 12.5px; opacity: 0.75; line-height: 1.4; }
.lm-plan li b { font-family: ui-monospace, Menlo, monospace; }
.lm-plan li small { opacity: 0.75; }
.lm-plan li button { min-height: 30px; min-width: 30px; padding: 0 6px; }
.lm-total { font-size: 12px; opacity: 0.8; margin-top: 4px; font-variant-numeric: tabular-nums; }
.lm-form { display: flex; gap: 6px; }
.lm-form input { flex: 1; min-width: 0; min-height: 40px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.22); background: rgba(0,0,0,0.25); color: #fff;
  padding: 0 10px; font: 600 13px ui-monospace, Menlo, monospace; }
.lm-hint { font-size: 11.5px; opacity: 0.72; margin-top: 4px; line-height: 1.35; }
.lm-hint.is-bad { color: #ffb4a8; opacity: 1; }
.lm-offer { display: flex; align-items: center; gap: 8px; pointer-events: auto; padding: 8px 10px; border-radius: 12px; background: rgba(12, 20, 32, 0.84);
  border: 1px solid rgba(232, 62, 230, 0.55); color: #fff; font: 600 13px system-ui, sans-serif; }
.lm-offer button { min-height: 40px; padding: 6px 12px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.22); background: rgba(255,255,255,0.08);
  color: #fff; font: 700 12.5px system-ui, sans-serif; cursor: pointer; }
.lm-offer button[data-lm-offer="yes"] { background: #e83ee6; border-color: #f07af0; }
.lm-offer .lm-x { min-width: 40px; display: inline-flex; align-items: center; justify-content: center; }
`;

function injectStyle() {
  if (typeof document === 'undefined' || document.getElementById('lm-nav-style')) return;
  const st = document.createElement('style');
  st.id = 'lm-nav-style';
  st.textContent = CSS;
  document.head.appendChild(st);
}

const last = { plan: null, mode: null, total: null };

addMapPanel({
  id: 'plan',
  order: 30,
  html: () => {
    injectStyle();
    return `<h4>FLIGHT PLAN <span class="lm-mode" data-lm-mode>HDG</span><button type="button" class="lm-small" data-lm-clear>CLEAR</button></h4>
      <ol class="lm-plan" data-lm-plan></ol>
      <div class="lm-total" data-lm-total></div>`;
  },
  bind(el, sim) {
    last.plan = null;
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-lm-clear]')) return clearRoute(sim);
      const b = e.target.closest('[data-lm-leg]');
      if (!b) return;
      const i = Number(b.dataset.lmLeg);
      if (b.dataset.lmDo === 'remove') {
        S.plan.remove(i);
        if (S.plan.empty) clearRoute(sim);
      } else if (b.dataset.lmDo === 'direct') {
        const me = meOf(sim);
        if (me) S.plan.directToIndex(i, me.x, me.z);
        engage(sim, 'DIRECT TO');
      }
      refresh(sim, true);
    });
  },
  sync(sim, el, structure, me) {
    const ap = sim.autopilot;
    const navOn = NAV.active && !!ap && ap.engaged && (ap.mode === 'hold' || ap.mode === 'level');
    const word = navOn ? `NAV ${NAV.label()}` : ap && ap.engaged ? (ap.mode === 'approach' ? 'APPR' : 'HDG') : 'AP OFF';
    const mode = el.querySelector('[data-lm-mode]');
    if (last.mode !== word || structure) {
      mode.textContent = word;
      mode.classList.toggle('is-nav', navOn);
      last.mode = word;
    }
    const list = el.querySelector('[data-lm-plan]');
    const sum = S.plan.summary(me.x, me.z, me.gsKts);
    const key = `${S.plan.rev}|${S.armed}`;
    if (structure || last.plan !== key) {
      last.plan = key;
      if (!S.plan.legs.length) {
        list.innerHTML = '<li class="lm-empty">No route. Tap the chart (a place, or anywhere for a pin), then DIRECT TO — or + ROUTE for several legs.</li>';
      } else {
        const from = S.plan.origin;
        list.innerHTML = `<li class="is-done"><span><b>FROM</b> <small>${from && from.kind !== 'ppos' ? from.name : 'where you were'}</small></span><span></span><span></span></li>`
          + sum.rows.map((r) => `<li class="${r.done ? 'is-done' : r.active ? 'is-active' : ''}" data-lm-row="${r.i}">
            <span><b>${r.wp.name}</b> <small>${r.wp.kind === 'pin' ? r.wp.long : kindWord(r.wp)}</small></span>
            <small data-lm-legfacts="${r.i}">${r.done ? 'passed' : `${G.fmtKm(r.dist)} · ${G.fmtEta(r.cumEta)}`}</small>
            <span>${r.done || r.active ? '' : `<button type="button" class="lm-small" data-lm-leg="${r.i}" data-lm-do="direct" aria-label="DIRECT TO ${r.wp.name}">D→</button>`}<button type="button" class="lm-small" data-lm-leg="${r.i}" data-lm-do="remove" aria-label="Remove ${r.wp.name}">${icon('close', 12)}</button></span>
          </li>`).join('');
      }
    } else {
      for (const r of sum.rows) {
        const f = list.querySelector(`[data-lm-legfacts="${r.i}"]`);
        if (f && !r.done) f.textContent = `${G.fmtKm(r.dist)} · ${G.fmtEta(r.cumEta)}`;
      }
    }
    const tot = S.plan.legs.length
      ? `${S.plan.state === 'holding' ? 'Holding at the last waypoint · ' : ''}Total ${G.fmtKm(sum.total)} · ${G.fmtEta(sum.totalEta)}${!S.armed ? ' · HDG selected: DIRECT TO to fly it again' : ''}`
      : '';
    const t = el.querySelector('[data-lm-total]');
    if (last.total !== tot) {
      t.textContent = tot;
      last.total = tot;
    }
    el.querySelector('[data-lm-clear]').hidden = !S.plan.legs.length;
  },
});

addMapPanel({
  id: 'goto',
  order: 40,
  html: () => `<h4>GO TO</h4>
    <form class="lm-form" data-lm-form autocomplete="off">
      <input type="text" data-lm-input spellcheck="false" aria-label="A position, fix or airport" placeholder="N12°34.5' W045°12.3' · fix · code">
      <button type="submit">GO</button>
    </form>
    <div class="lm-hint" data-lm-hint></div>`,
  bind(el, sim) {
    const form = el.querySelector('[data-lm-form]');
    const input = el.querySelector('[data-lm-input]');
    const hint = el.querySelector('[data-lm-hint]');
    // Typed into the box, keys are the box's (input.js skips text fields; so do the features). GO hands them back.
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (goTo(sim, input.value, hint)) input.blur();
    });
  },
  sync(sim, el, structure) {
    if (!structure) return;
    const hint = el.querySelector('[data-lm-hint]');
    if (!hint.textContent) {
      const P = placesOf(sim);
      const f = P.fixes[0];
      hint.textContent = `Latitude and longitude, the km grid, a fix${f ? ` (${f.name})` : ''} or an airport code.`;
    }
  },
});

addSelectionAction({
  id: 'direct', label: 'DIRECT TO', order: 1, primary: true,
  visible: (sim, w, me) => !me.drive,
  run: (sim, w) => directTo(sim, w),
});
addSelectionAction({
  id: 'add', label: '+ ROUTE', order: 2,
  visible: (sim, w, me) => !me.drive,
  run: (sim, w) => addToRoute(sim, w),
});
addSelectionAction({
  id: 'approach', label: 'APPROACH', order: 3,
  visible: (sim, w, me) => !me.drive && w.kind === 'airport' && approachable(sim, w.ref),
  run: (sim, w) => flyApproach(sim, w.ref),
});

// The World Map preview's trip, as its old world map had it: DESTINATION puts the guidance on that
// field's approach gate and runway, its radio within 60 km, "Arrived" on landing (world-preview.js).
// The checker, w18: the live map had no way left to set one but APPROACH.
const tripDest = (sim) => (sim.worldPreview && typeof sim.worldPreview.destination === 'function' ? sim.worldPreview.destination() : null);
const onPreview = (sim, w) => w.kind === 'airport' && !!w.ref && placesOf(sim).isPreview && !!sim.worldPreview && typeof sim.worldPreview.setDestination === 'function';
addSelectionAction({
  id: 'dest', label: 'DESTINATION', order: 4,
  visible: (sim, w, me) => !me.drive && onPreview(sim, w) && !(tripDest(sim) && tripDest(sim).id === w.ref),
  run: (sim, w) => sim.worldPreview.setDestination(w.ref),
});
addSelectionAction({
  id: 'nodest', label: 'NO DESTINATION', order: 4,
  visible: (sim, w, me) => !me.drive && onPreview(sim, w) && !!tripDest(sim) && tripDest(sim).id === w.ref,
  run: (sim) => {
    sim.worldPreview.setDestination(null);
    if (sim.hud) sim.hud.notify('No destination', 'info', 2);
  },
});

addMapState((sim, st) => {
  st.plan = S.plan.legs.length ? S.plan : null;
  if (st.me) st.holdR = G.orbitRadius(st.me.gsMs);
});
addPickSource(() => S.plan.legs);

/* ------------------------------------------------------------------ */
/* The extension                                                        */
/* ------------------------------------------------------------------ */

function wireGuidance(sim) {
  const R = sim.runner;
  if (!R || typeof R.activeTarget !== 'function' || R._navWrapped) return;
  const prev = R.activeTarget.bind(R);
  R._navWrapped = true;
  R.activeTarget = () => {
    const t = prev();
    // A mission's own target first; a route over the World Map's "destination" trip, and over nothing.
    if (t && !t.wp) return t;
    return guideTarget() || t;
  };
}

registerExtension({
  id: 'livemap-nav',
  install(sim) {
    S.sim = sim;
    if (sim.autopilot) sim.autopilot.nav = NAV;
    wireGuidance(sim);
    if (sim.liveMap) {
      Object.assign(sim.liveMap, {
        plan: S.plan,
        nav: NAV,
        directTo: (w) => directTo(sim, w),
        addToRoute: (w) => addToRoute(sim, w),
        clearRoute: () => clearRoute(sim),
        goTo: (text) => goTo(sim, text),
        flyApproach: (ref) => flyApproach(sim, ref),
        armed: () => S.armed,
      });
    }
  },
  buildWorld() {
    S.plan.clear();
    S.armed = true;
  },
  startMode(sim) {
    closeOffer(sim);
    S.plan.clear();
    S.armed = true;
  },
  stop(sim) {
    closeOffer(sim);
  },
  update(sim, dt) {
    tick(sim, dt);
  },
});

export const __nav = { S, NAV, guideTarget };
