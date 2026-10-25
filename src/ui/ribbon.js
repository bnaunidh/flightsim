/**
 * The destination ribbon: a slim heading tape, top centre, with the place
 * you are flying to marked on it.
 *
 * "Where do I go?" is the question a young pilot asks most, and the arrow
 * pill answered it with a glyph and a distance. The tape answers it the way
 * a real heading indicator does: your heading under the lubber line, the
 * compass points sliding past, and a marker where the target sits — turn
 * until the marker is under the line and you are pointing at it. When the
 * mission's final destination is somewhere else, a second, dimmer marker
 * shows that too. The ribbon exists only while a mission or job gives you
 * somewhere to go; a free flight has no tape.
 *
 * Cost: one transform per frame on the tick strip and one on each marker,
 * change-gated text. The ticks are built once.
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
    // strip whichever way you are pointing: -180 .. 540.
    let html = '';
    for (let d = -180; d <= 540; d += 10) {
      const x = (d * PX_PER_DEG).toFixed(1);
      const major = d % 30 === 0;
      html += `<i class="hud-dest-tick${major ? ' is-major' : ''}" style="left:${x}px"></i>`;
      if (major) {
        const lbl = CARDINAL[(((d / 30) % 12) + 12) % 12];
        html += `<b class="hud-dest-lbl${lbl.length === 1 ? ' is-card' : ''}" style="left:${x}px">${lbl}</b>`;
      }
    }
    strip.innerHTML = html;
    this.strip = strip;
    this.mark = document.createElement('span');
    this.mark.className = 'hud-dest-mark';
    this.markFinal = document.createElement('span');
    this.markFinal.className = 'hud-dest-mark is-final';
    this.markFinal.style.display = 'none';
    const lubber = document.createElement('span');
    lubber.className = 'hud-dest-lubber';
    tape.appendChild(strip);
    tape.appendChild(this.markFinal);
    tape.appendChild(this.mark);
    tape.appendChild(lubber);
    this.text = document.createElement('div');
    this.text.className = 'hud-dest-text';
    el.appendChild(tape);
    el.appendChild(this.text);
    this.el = el;
  }

  /**
   * @param {number} headingDeg   the aeroplane's heading
   * @param {{x,z}} pos           where the aeroplane is
   * @param {{pos:{x,z}, label}} target   the current target, or null to hide the ribbon
   * @param {{pos:{x,z}, label}} dest     the mission's final destination, if it is somewhere else
   */
  update(headingDeg, pos, target, dest) {
    if (!this.el) return;
    if (!target || !target.pos || !pos) {
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
    const dist = Math.hypot(target.pos.x - pos.x, target.pos.z - pos.z);
    const rel = relDeg(bearingDeg(pos, target.pos), hdg);
    const m = markerOffset(rel);
    const mx = Math.round(m.px);
    if (this.last.mx !== mx || this.last.behind !== m.behind) {
      this.mark.style.transform = `translateX(${mx}px)`;
      this.mark.classList.toggle('is-behind', m.behind);
      this.last.mx = mx;
      this.last.behind = m.behind;
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

  /** Is the ribbon on screen? */
  get shown() {
    return !!this.el && this.el.style.display !== 'none';
  }
}
