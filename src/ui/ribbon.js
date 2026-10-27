/**
 * The heading tape: top centre, in every flight — the compass you read like
 * a real HUD's, with where you are going marked on it.
 *
 * The owner, 2026-10-26: "on the top lets make a compass thingy". Your
 * heading sits in the box over the lubber line; the tape slides under it,
 * ticks every 5 degrees, the cardinal letters and the numbers every 30. On it:
 *
 *   ▼ amber   the target (a mission's, a job's), or magenta when it is a
 *             DIRECT TO / route waypoint the autopilot flies in NAV
 *   ▼ blue    the mission's final destination, when the target is a step
 *   ◆ cyan    the nearest airport
 *   ↓ pale    where the wind comes from
 *   ● yellow  the sun
 *
 * Turn until a marker is under the line and you are pointing at it. The
 * target's name and distance read under the tape while there is one. It was
 * once only shown with a target ("a free flight has nowhere to go"); a free
 * flight has a heading, a nearest field, the wind and the sun, so it stays.
 * The boat and the van have their own compass and never show it; the Photo
 * HUD hides it with the rest of the top lane.
 *
 * Cost: one transform per frame on the tick strip and one on each marker,
 * change-gated; the ticks are built once.
 */

const PX_PER_DEG = 2.2;
// A marker further round than this sits at the edge. 50, not more: the tape
// fades out over its outer 16% (the CSS mask, ~51 px of a 320 px tape), and a
// clamped "it's behind you" marker parked inside the fade all but vanished.
const WINDOW_DEG = 50;
const CARDINAL = ['N', '03', '06', 'E', '12', '15', 'S', '21', '24', 'W', '30', '33'];

/** True bearing from `from` to `to` (world x east, z south), 0..360. */
export function bearingDeg(from, to) {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  return ((Math.atan2(dx, -dz) * 180) / Math.PI + 360) % 360;
}

/** Bearing relative to a heading: -180..180, negative to the left. */
export function relDeg(bearing, heading) {
  return ((bearing - heading + 540) % 360) - 180;
}

/** Distance text at the precision useful at that distance (as the arrow pill had it). */
export function distText(m) {
  if (m > 1200) return `${(m / 1000).toFixed(1)} km`;
  if (m <= 125) return `${Math.round(m / 5) * 5} m`;
  return `${Math.round(m / 10) * 10} m`;
}

/** Where a marker sits on the tape, in px from the centre, clamped to the window. */
export function markerOffset(rel) {
  const r = Math.max(-WINDOW_DEG, Math.min(WINDOW_DEG, rel));
  return { px: r * PX_PER_DEG, behind: Math.abs(rel) > WINDOW_DEG };
}

/** "087": the heading box's digits (360 for north, as a compass card reads). */
export function headingText(deg) {
  const d = Math.round(((Number(deg) || 0) % 360 + 360) % 360) % 360;
  return String(d === 0 ? 360 : d).padStart(3, '0');
}

/** Tick kind at d degrees: 'major' every 30 (labelled), 'mid' every 10, 'minor' every 5. */
export function tickKind(d) {
  const m = ((d % 360) + 360) % 360;
  return m % 30 === 0 ? 'major' : m % 10 === 0 ? 'mid' : 'minor';
}

export class DestRibbon {
  constructor() {
    this.last = {};
    if (typeof document === 'undefined') return;
    const el = document.createElement('div');
    el.className = 'hud-dest';
    el.style.display = 'none';
    const tape = document.createElement('div');
    tape.className = 'hud-dest-tape';
    const strip = document.createElement('div');
    strip.className = 'hud-dest-strip';
    // Two turns of the compass, so the window never runs off the end of the
    // strip whichever way you are pointing: -180 .. 540, a tick every 5.
    let html = '';
    for (let d = -180; d <= 540; d += 5) {
      const x = (d * PX_PER_DEG).toFixed(1);
      const k = tickKind(d);
      html += `<i class="hud-dest-tick${k === 'major' ? ' is-major' : k === 'mid' ? ' is-mid' : ''}" style="left:${x}px"></i>`;
      if (k === 'major') {
        const lbl = CARDINAL[(((d / 30) % 12) + 12) % 12];
        html += `<b class="hud-dest-lbl${lbl.length === 1 ? ' is-card' : ''}" style="left:${x}px">${lbl}</b>`;
      }
    }
    strip.innerHTML = html;
    this.strip = strip;
    const mk = (cls, title) => {
      const s = document.createElement('span');
      s.className = cls;
      s.style.display = 'none';
      if (title) s.title = title;
      tape.appendChild(s);
      return s;
    };
    tape.appendChild(strip);
    this.markSun = mk('hud-dest-sym is-sun', 'The sun');
    this.markWind = mk('hud-dest-sym is-wind', 'Where the wind comes from');
    this.markApt = mk('hud-dest-sym is-apt', 'The nearest airport');
    this.markFinal = mk('hud-dest-mark is-final');
    this.mark = mk('hud-dest-mark');
    const lubber = document.createElement('span');
    lubber.className = 'hud-dest-lubber';
    tape.appendChild(lubber);
    // The heading box hangs under the lubber line, where the eye already is.
    this.box = document.createElement('span');
    this.box.className = 'hud-dest-hdg';
    this.box.setAttribute('aria-label', 'Heading');
    this.text = document.createElement('div');
    this.text.className = 'hud-dest-text';
    this.text.style.display = 'none';
    el.appendChild(tape);
    el.appendChild(this.box);
    el.appendChild(this.text);
    this.el = el;
  }

  /** Put a symbol marker at a bearing (hidden when it is off the tape's window). */
  _sym(node, key, bearing, hdg, title) {
    if (!Number.isFinite(bearing)) {
      if (node.style.display !== 'none') node.style.display = 'none';
      this.last[key] = undefined;
      return;
    }
    const rel = relDeg(bearing, hdg);
    const vis = Math.abs(rel) <= WINDOW_DEG;
    const want = vis ? '' : 'none';
    if (node.style.display !== want) node.style.display = want;
    if (!vis) return;
    const x = Math.round(rel * PX_PER_DEG);
    if (this.last[key] !== x) {
      node.style.transform = `translateX(${x}px)`;
      this.last[key] = x;
    }
    if (title && node.title !== title) node.title = title;
  }

  /**
   * @param {number} headingDeg   the aeroplane's heading
   * @param {{x,z}} pos           where the aeroplane is
   * @param {{pos:{x,z}, label, nav?}} target   the current target, or null
   * @param {{pos:{x,z}, label}} dest     the mission's final destination, if it is somewhere else
   * @param {object} [marks]      { airport: {x, z, label}, windFromDeg, windKts, sunDeg }
   */
  update(headingDeg, pos, target, dest, marks = null) {
    if (!this.el) return;
    if (!pos) {
      if (this.el.style.display !== 'none') this.el.style.display = 'none';
      this.last = {};
      return;
    }
    if (this.el.style.display === 'none') this.el.style.display = '';
    const hdg = ((Number(headingDeg) || 0) + 360) % 360;
    // The strip slides so the heading under the lubber line is the current one.
    const shift = Math.round(-hdg * PX_PER_DEG * 10) / 10;
    if (this.last.shift !== shift) {
      this.strip.style.transform = `translateX(${shift}px)`;
      this.last.shift = shift;
    }
    const ht = headingText(hdg);
    if (this.last.ht !== ht) {
      this.box.textContent = ht;
      this.last.ht = ht;
    }
    // The other markers: the nearest field, the wind, the sun.
    const m = marks || {};
    this._sym(this.markApt, 'apt', m.airport ? bearingDeg(pos, m.airport) : NaN, hdg, m.airport ? `Nearest airport: ${m.airport.label || ''}` : '');
    this._sym(this.markWind, 'wind', m.windKts > 2 ? m.windFromDeg : NaN, hdg, `Wind from ${headingText(m.windFromDeg)}° at ${Math.round(m.windKts || 0)} kt`);
    this._sym(this.markSun, 'sun', Number.isFinite(m.sunDeg) ? m.sunDeg : NaN, hdg, 'The sun');
    if (!target || !target.pos) {
      if (this.mark.style.display !== 'none') this.mark.style.display = 'none';
      if (this.markFinal.style.display !== 'none') this.markFinal.style.display = 'none';
      if (this.last.txt) {
        this.text.textContent = '';
        this.text.style.display = 'none';
        this.last.txt = '';
        this.last.mx = undefined;
        this.last.fx = undefined;
      }
      this.el.classList.remove('is-near', 'has-target');
      return;
    }
    this.el.classList.add('has-target');
    if (this.mark.style.display === 'none') this.mark.style.display = '';
    if (this.text.style.display === 'none') this.text.style.display = '';
    this.mark.classList.toggle('is-nav', !!target.nav);
    const dist = Math.hypot(target.pos.x - pos.x, target.pos.z - pos.z);
    const rel = relDeg(bearingDeg(pos, target.pos), hdg);
    const mo = markerOffset(rel);
    const mx = Math.round(mo.px);
    if (this.last.mx !== mx || this.last.behind !== mo.behind) {
      this.mark.style.transform = `translateX(${mx}px)`;
      this.mark.classList.toggle('is-behind', mo.behind);
      this.last.mx = mx;
      this.last.behind = mo.behind;
    }
    const near = dist <= 125;
    const label = target.label || 'Target';
    const txt = near ? `${label} · ${distText(dist)} — almost there` : `${label} · ${distText(dist)}`;
    if (this.last.txt !== txt) {
      this.text.textContent = txt;
      this.el.classList.toggle('is-near', near);
      this.last.txt = txt;
    }
    // The final destination, when the current target is a step on the way.
    const far = dest && dest.pos && Math.hypot(dest.pos.x - target.pos.x, dest.pos.z - target.pos.z) > 300;
    if (far) {
      const r2 = relDeg(bearingDeg(pos, dest.pos), hdg);
      const m2 = markerOffset(r2);
      const fx = Math.round(m2.px);
      if (this.markFinal.style.display === 'none') this.markFinal.style.display = '';
      if (this.last.fx !== fx || this.last.fb !== m2.behind) {
        this.markFinal.style.transform = `translateX(${fx}px)`;
        this.markFinal.classList.toggle('is-behind', m2.behind);
        this.markFinal.title = dest.label || 'Destination';
        this.last.fx = fx;
        this.last.fb = m2.behind;
      }
    } else if (this.markFinal.style.display !== 'none') {
      this.markFinal.style.display = 'none';
      this.last.fx = undefined;
    }
  }

  /** Is the tape on screen? */
  get shown() {
    return !!this.el && this.el.style.display !== 'none';
  }

  /** Is a target marked on it (a mission's, a job's, a route's)? */
  get hasTarget() {
    return !!this.el && this.el.classList.contains('has-target');
  }
}
