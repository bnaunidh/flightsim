/**
 * The minimap.
 *
 * A map you can glance at without leaving the cockpit: the islands drawn from
 * the same data the terrain is generated from, the runway where the runway
 * actually is, you in the middle, and anything that matters marked on it.
 *
 * Two rules it is built around:
 *
 *   North is up, always. A map that spins with you is easier to *follow* and
 *   much harder to *learn* — you never build a picture of the place, because
 *   the place never looks the same twice. The aeroplane rotates instead.
 *
 *   It warns you. If you are descending towards ground you cannot see, the
 *   ring around the edge goes red and says so, because "I did not know the
 *   hill was there" is the commonest way a flight ends badly.
 */

import { ISLANDS, AIRPORT, heightAt } from '../world/terrain.js';

const SIZE = 190;

export class Minimap {
  constructor(root) {
    this.el = document.createElement('div');
    this.el.className = 'minimap';
    this.el.style.display = 'none';
    this._want = false;
    this._suppressed = false;
    this._faulty = false;

    this.canvas = document.createElement('canvas');
    this.canvas.width = SIZE * 2;
    this.canvas.height = SIZE * 2;
    this.canvas.className = 'minimap-canvas';
    this.ctx = this.canvas.getContext('2d');
    this.ctx.scale(2, 2);

    this.warn = document.createElement('div');
    this.warn.className = 'minimap-warn';
    this.warn.style.display = 'none';

    this.scaleLabel = document.createElement('div');
    this.scaleLabel.className = 'minimap-scale';

    this.el.appendChild(this.canvas);
    this.el.appendChild(this.warn);
    this.el.appendChild(this.scaleLabel);
    root.appendChild(this.el);

    // How much world fits across the map, in metres. Cycled by the player.
    this.ranges = [3000, 6000, 12000, 24000];
    this.rangeIndex = 1;
    this.t = 0;
  }

  get visible() {
    return this.el.style.display !== 'none';
  }

  /**
   * Hidden along with the rest of the interface.
   *
   * Kept separate from `toggle`, so pressing U for a clean shot and then
   * pressing it again gives you back exactly the map state you had rather
   * than silently turning the map off for good.
   */
  setSuppressed(on) {
    this._suppressed = !!on;
    this.el.style.display = this._suppressed || !this._want ? 'none' : '';
  }

  /**
   * The map runs off the same instruments as everything else, so when they
   * are out it flashes rather than quietly lying to you with a position it
   * cannot actually know.
   */
  setFaulty(on) {
    if (this._faulty === !!on) return;
    this._faulty = !!on;
    this.el.classList.toggle('is-faulty', this._faulty);
  }

  toggle(force) {
    const on = force === undefined ? !this._want : !!force;
    this._want = on;
    this.el.style.display = on && !this._suppressed ? '' : 'none';
    return on;
  }

  /** Step through the zoom levels. */
  cycleRange() {
    this.rangeIndex = (this.rangeIndex + 1) % this.ranges.length;
    return this.ranges[this.rangeIndex];
  }

  /**
   * @param {object} sim the game, for the aeroplane, target and hazards
   */
  update(dt, sim) {
    if (!this.visible) return;
    this.t += dt;
    const ctx = this.ctx;
    const ac = sim.aircraft;
    const r = ac.readouts();
    const span = this.ranges[this.rangeIndex];
    const k = SIZE / span; // pixels per metre
    const cx = SIZE / 2;
    const cy = SIZE / 2;
    // World → map. North (-Z) is up.
    const mx = (x) => cx + (x - ac.pos.x) * k;
    const my = (z) => cy + (z - ac.pos.z) * k;

    ctx.clearRect(0, 0, SIZE, SIZE);

    // Sea.
    ctx.fillStyle = '#0b2334';
    ctx.beginPath();
    ctx.arc(cx, cy, SIZE / 2 - 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, SIZE / 2 - 2, 0, Math.PI * 2);
    ctx.clip();

    // Islands, from the same list the terrain is built from.
    for (const isl of ISLANDS) {
      const rr = isl.radius * k;
      if (rr < 0.6) continue;
      ctx.fillStyle = '#20402a';
      ctx.beginPath();
      ctx.arc(mx(isl.cx), my(isl.cz), rr * 1.04, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#2f5c39';
      ctx.beginPath();
      ctx.arc(mx(isl.cx), my(isl.cz), rr * 0.9, 0, Math.PI * 2);
      ctx.fill();
      // High ground, so you can see what you might fly into.
      const relief = Math.min(0.72, isl.peak / 900);
      if (relief > 0.1) {
        ctx.fillStyle = '#6a6357';
        ctx.beginPath();
        ctx.arc(mx(isl.cx), my(isl.cz), rr * relief, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // The runway, drawn where it really is.
    const R = AIRPORT.runway;
    ctx.strokeStyle = '#e8eef5';
    ctx.lineWidth = Math.max(1.5, 26 * k);
    ctx.beginPath();
    ctx.moveTo(mx(R.cx - R.length / 2), my(R.cz));
    ctx.lineTo(mx(R.cx + R.length / 2), my(R.cz));
    ctx.stroke();

    // Hazards: a tornado is worth a great deal of ink.
    if (sim.tornado && sim.tornado.active) {
      const t = sim.tornado;
      const pulse = 0.55 + Math.sin(this.t * 5) * 0.25;
      ctx.fillStyle = `rgba(255, 70, 45, ${pulse})`;
      ctx.beginPath();
      ctx.arc(mx(t.pos.x), my(t.pos.z), Math.max(4, (t.coreR || 130) * k), 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,120,90,0.55)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(mx(t.pos.x), my(t.pos.z), Math.max(8, (t.reach || 1400) * k), 0, Math.PI * 2);
      ctx.stroke();
    }

    // The objective.
    const target = sim.activeTarget;
    if (target) {
      const tx = mx(target.pos.x);
      const ty = my(target.pos.z);
      ctx.fillStyle = '#7dffb4';
      ctx.beginPath();
      ctx.arc(tx, ty, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(125,255,180,0.6)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(tx, ty, 8 + Math.sin(this.t * 3) * 2, 0, Math.PI * 2);
      ctx.stroke();
    }

    /*
     * Every aeroplane on the map.
     *
     * Right now that is you and nothing else, because there is no other
     * traffic in the game yet — so rather than pretend, this draws whatever
     * `sim.traffic` contains and simply finds it empty. When there is traffic
     * to show, it will already be here.
     */
    for (const other of sim.traffic || []) {
      ctx.fillStyle = '#ffd23f';
      ctx.beginPath();
      ctx.arc(mx(other.pos.x), my(other.pos.z), 3, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();

    // You, in the middle, pointing where you are pointing.
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((r.heading * Math.PI) / 180);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#0b1220';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(0, -7);
    ctx.lineTo(5, 6);
    ctx.lineTo(0, 3);
    ctx.lineTo(-5, 6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // North, so the fixed orientation is obvious rather than assumed.
    ctx.fillStyle = '#8fa2b4';
    ctx.font = '600 10px "Helvetica Neue", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('N', cx, 12);

    this.scaleLabel.textContent = span >= 1000 ? `${span / 1000} km` : `${span} m`;

    /*
     * Terrain ahead.
     *
     * Sample the ground along the track for the next half minute at the
     * current speed. If the ground out there is higher than where this descent
     * puts you, say so — that is a warning you can act on, unlike a number.
     */
    let hit = null;
    if (!ac.onGround && !ac.crashed) {
      const spd = Math.max(20, ac.groundSpeed);
      const hdg = (r.heading * Math.PI) / 180;
      const dirX = Math.sin(hdg);
      const dirZ = -Math.cos(hdg);
      for (let s = 4; s <= 30; s += 2) {
        const px = ac.pos.x + dirX * spd * s;
        const pz = ac.pos.z + dirZ * spd * s;
        const py = ac.pos.y + ac.vel.y * s;
        const ground = heightAt(px, pz);
        if (py < ground + 45) {
          hit = Math.round(s);
          break;
        }
      }
    }
    if (hit !== null) {
      this.warn.style.display = '';
      this.warn.textContent = `TERRAIN — ${hit}s`;
      this.el.classList.add('is-alert');
    } else {
      this.warn.style.display = 'none';
      this.el.classList.remove('is-alert');
    }
  }
}
