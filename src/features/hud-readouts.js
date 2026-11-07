/**
 * THE CLOCK AND THE STALL SPEED. The owner: "add clock and stall speed too".
 *
 * The clock is the sim's own time of day. weather.hour is local solar time and
 * the sky is worked out from it, so a clock read from it cannot disagree with
 * the dawn; but with weather.clockRate at 0 it stood still all flight. So it
 * runs here, at one second a second: a Golden Sunset stays a sunset for the
 * length of a lesson. The sun moves in SUN_STEP_MIN whole minutes (the sky
 * re-lights once a step, not once a frame), and the seconds between steps are
 * counted here, so the digits run smoothly. Not through clockRate, which
 * forgets the preset: a map change must still find its Midday.
 *
 * On screen: a row of the instrument strip (the mission clock lives in the
 * objective, a different box), and on the panels `sim.clockText` (the PFD's
 * foot) and sim.clockSeconds (the dials in cockpit-dress.js).
 *
 * The stall speed sits under the airspeed, from stall-speed.js, four times a
 * second, and goes on `ac.stallKt` for the red band on the speed tapes
 * (displays.js). Amber within 15 per cent of it, red within 5. Not on a
 * helicopter, a boat or a van: CSS, from the classes those already set.
 *
 * Both are DOM built once, after the menu: nothing in the first load, no draw
 * calls, and no element lookups per frame (frame-budget.js).
 */

import { registerExtension } from '../game/extensions.js';
import { stallKnotsNow } from './stall-speed.js';

const SUN_STEP_MIN = 2;
const STALL_S = 0.25;

const CSS = `
.hud-left .fc-row { position: relative; }
.hud-left .fc-time { font-variant-numeric: tabular-nums; }
.hud-left .fc-time .fc-sec { font-size: 0.62em; opacity: 0.62; margin-left: 1px; }
.hud-left .fc-stall {
  font-size: 11px; line-height: 1.25; color: rgba(214, 228, 245, 0.74); white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.hud-left .fc-stall.is-near { color: var(--amber); }
.hud-left .fc-stall.is-low { color: var(--red); font-weight: 600; }
.hud.is-rotor .fc-stall, .hud.is-vehicle .fc-stall, .hud-boatpanel .fc-stall { display: none; }
.hud.is-vehicle .fc-row, .hud.is-drive .fc-row, .hud.is-boat .fc-row { display: none; }
.hud.is-touch:not(.is-vehicle):not(.is-drive) .hud-left:not(.hud-boatpanel) { grid-template-columns: repeat(5, 1fr); }
.hud.is-touch .hud-left .fc-stall { font-size: 8.5px; line-height: 1.2; margin-top: 1px; }
/* In the realistic view the instruments are in the room: the pads let them show. */
.hud.is-minimal .touch-pads { opacity: 0.74; }
/* A phone's strip is two by two and measured to the pixel (no taller than the
   map, above the objective at 96): the time is a tag on the map's free corner,
   hours and minutes, and the labels stop being too small to read. */
@media (max-width: 560px) {
  .hud.is-touch:not(.is-vehicle):not(.is-drive) .hud-left:not(.hud-boatpanel) { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
  .hud.is-touch .hud-left:not(.hud-boatpanel) .hud-label { font-size: 8px; }
  .hud.is-touch .hud-left:not(.hud-boatpanel) .hud-up { font-size: 8px; }
  .hud.is-touch .hud-left:not(.hud-boatpanel) .fc-stall { font-size: 8px; line-height: 1.1; margin-top: 0; }
  .hud.is-touch .hud-left:not(.hud-boatpanel) .fc-vs { font-size: 0; }
  .hud.is-touch .hud-left:not(.hud-boatpanel) .fc-vs::after { content: 'Climb'; font-size: 8px; }
  .hud.is-touch .hud-left:not(.hud-boatpanel) .fc-row {
    position: absolute; left: -90px; top: 62px; padding: 0 4px; overflow: visible;
    background: rgba(8, 13, 22, 0.86); border-radius: 5px;
  }
  .hud.is-touch .hud-left .fc-row .hud-label, .hud.is-touch .hud-left .fc-sec { display: none; }
  .hud.is-touch .hud-left:not(.hud-boatpanel) .fc-time { font-size: 11px; line-height: 1.35; }
}
/* A phone on its side: 375 px of height, so the strip goes up beside the map
   and the tape and the objective clear the thumbs. */
@media (max-height: 460px) and (min-width: 561px) {
  .hud.is-touch .hud-left:not(.hud-boatpanel) { top: 8px; right: 216px; left: 136px; padding: 3px 6px; }
  .hud.is-touch .hud-left:not(.hud-boatpanel) .hud-value { font-size: 15px; }
  .hud.is-touch .hud-top { top: 62px; }
}
`;

function ensureStyle() {
  if (document.getElementById('fc-style')) return;
  const s = document.createElement('style');
  s.id = 'fc-style';
  s.textContent = CSS;
  document.head.appendChild(s);
}

const pad = (n) => String(n).padStart(2, '0');

/** "HH:MM" and the seconds for an hour of the day. */
export function clockParts(hour) {
  const t = Math.floor((((hour % 24) + 24) % 24) * 3600 + 1e-6);
  return { hm: `${pad(Math.floor(t / 3600))}:${pad(Math.floor(t / 60) % 60)}`, s: t % 60, day: t };
}

const R = { built: null, time: null, sec: null, stall: null, acc: 0, stallT: 0, hm: '', s: -1, kt: -1, state: '', whole: -1 };

function build(hud) {
  ensureStyle();
  const left = hud.speedValue.closest('.hud-left');
  const line = document.createElement('div');
  line.className = 'fc-stall';
  line.textContent = '';
  hud.speedValue.parentElement.after(line);
  const row = document.createElement('div');
  row.className = 'hud-row fc-row';
  row.innerHTML = '<div class="hud-label">Local time</div><div class="hud-valuewrap"><div class="hud-value fc-time"><span></span><span class="fc-sec"></span></div></div>';
  left.appendChild(row);
  const [time, sec] = row.querySelectorAll('.fc-time > span');
  hud.vsValue.closest('.hud-row').querySelector('.hud-label').classList.add('fc-vs');
  Object.assign(R, { built: hud, time, sec, stall: line, hm: '', s: -1, kt: -1, state: '', whole: -1 });
}

function paintClock(sim) {
  // Once a second, not once a frame: strings at 60 a second are garbage for a weak machine to collect.
  const whole = Math.floor((sim.weather.hour + R.acc / 3600) * 3600 + 1e-6);
  if (whole === R.whole) return;
  R.whole = whole;
  const p = clockParts(whole / 3600);
  sim.clockSeconds = p.day;
  if (p.hm !== R.hm) {
    R.hm = p.hm;
    R.time.textContent = p.hm;
    sim.clockText = p.hm;
  }
  if (p.s !== R.s) {
    R.s = p.s;
    R.sec.textContent = `:${pad(p.s)}`;
  }
}

function paintStall(sim, ac) {
  const kt = stallKnotsNow(ac);
  ac.stallKt = kt;
  const shown = Math.round(kt);
  if (shown !== R.kt) {
    R.kt = shown;
    R.stall.textContent = shown ? `stall ${shown} kt` : '';
  }
  const ias = ac.ias * 1.94384;
  const state = !shown || ac.onGround ? '' : ias < kt * 1.05 ? 'is-low' : ias < kt * 1.15 ? 'is-near' : '';
  if (state !== R.state) {
    R.state = state;
    R.stall.className = state ? `fc-stall ${state}` : 'fc-stall';
  }
}

registerExtension({
  id: 'hud-readouts',
  startMode() {
    R.acc = 0;
    R.stallT = 0;
  },
  update(sim, dt) {
    if (!sim.hud || !sim.hud.speedValue || !sim.weather) return;
    if (R.built !== sim.hud) build(sim.hud);
    const w = sim.weather;
    R.acc += dt;
    const step = SUN_STEP_MIN * 60;
    if (R.acc >= step) {
      R.acc -= step;
      w.hour = (w.hour + step / 3600) % 24;
    }
    paintClock(sim);
    R.stallT -= dt;
    if (R.stallT <= 0 && sim.aircraft) {
      R.stallT = STALL_S;
      paintStall(sim, sim.aircraft);
    }
  },
});

export const __readouts = { R, SUN_STEP_MIN };
