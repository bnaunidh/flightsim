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

import { ISLANDS, AIRPORT, MAP, PALETTE, heightAt } from '../world/terrain.js';

const SIZE = 190;

/*
 * The chart underneath.
 *
 * The islands used to be drawn as filled circles with a browner circle inside
 * for the high ground, which is what the island list literally contains — a
 * centre, a radius and a peak. It reads as a diagram of an island rather than
 * as a map of this one: every coast a perfect circle, no bays, no ridge, and
 * the same shape on every map in the game.
 *
 * So the chart is sampled from `heightAt` — the same function the terrain
 * itself is built from — and shaded with a hillshade, which is what makes a
 * paper map legible: you can see which way the ground falls. Sampled once per
 * map into an offscreen image and then simply blitted, because the terrain
 * does not move and 65,000 samples is not something to do every frame.
 *
 * It is filled in a few rows at a time over the first half second so nothing
 * stutters on a school laptop, and whatever is done so far is drawn.
 */
/*
 * 512, not 256.
 *
 * The chart covers the whole map — around 29 km across on Kestrel — so at 256
 * a pixel is 112 m of the world, and the closest zoom then stretches fifty of
 * them across 190 screen pixels. It looked like a chart drawn in Lego. At 512
 * a pixel is 56 m and the same view is sharp enough to steer by.
 *
 * Paid for by sampling the ground once per pixel instead of three times: the
 * hillshade needs the neighbours to the north and west, and those are pixels
 * this loop has already done. One row of them is kept, which is all it takes.
 */
const TILE = 512;
/** Rows of the chart sampled per frame while it is being built. */
const TILE_ROWS_PER_FRAME = 20;

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

    // The sampled chart: see TILE above.
    this.tile = document.createElement('canvas');
    this.tile.width = this.tile.height = TILE;
    /** Last row of ground heights, kept for the hillshade. */
    this.prevRow = null;
    this.tileCtx = this.tile.getContext('2d');
    this.tileRow = 0;
    this.tileFor = null;
    this.tileExtent = 0;
  }

  /**
   * Sample a few more rows of the chart.
   *
   * Height at the pixel decides the colour; the slope between it and its
   * neighbour to the north-west decides how much light it gets. That second
   * part is the whole difference between a green blob and something you can
   * read a ridge off.
   */
  buildTileSlice() {
    const half = this.tileExtent / 2;
    const step = this.tileExtent / TILE;
    const pal = PALETTE || {};
    const tint = (rgb, mul) => [
      Math.min(255, rgb[0] * (mul ? mul[0] : 1)),
      Math.min(255, rgb[1] * (mul ? mul[1] : 1)),
      Math.min(255, rgb[2] * (mul ? mul[2] : 1)),
    ];
    // Base colours, warped by the map's own palette so a desert map gets a
    // desert chart rather than a tropical one painted the wrong colour.
    const SAND = tint([176, 158, 118], pal.sand);
    const GRASS = tint([74, 104, 62], pal.grass);
    const ROCK = tint([124, 116, 104], pal.rock);
    const end = Math.min(TILE, this.tileRow + TILE_ROWS_PER_FRAME);
    const img = this.tileCtx.createImageData(TILE, end - this.tileRow);
    const d = img.data;
    if (!this.prevRow || this.prevRow.length !== TILE) this.prevRow = new Float32Array(TILE);
    const row = new Float32Array(TILE);
    for (let j = this.tileRow; j < end; j++) {
      const z = -half + j * step;
      let west = 0;
      for (let i = 0; i < TILE; i++) {
        const x = -half + i * step;
        const h = heightAt(x, z);
        row[i] = h;
        let r;
        let g;
        let b;
        if (h <= 0) {
          // Water, darkening with depth.
          const k = Math.min(1, -h / 60);
          r = 22 + (1 - k) * 26;
          g = 58 + (1 - k) * 40;
          b = 84 + (1 - k) * 34;
        } else {
          const beach = Math.min(1, h / 14);
          const high = Math.min(1, Math.max(0, (h - 130) / 420));
          const lo0 = SAND[0] + (GRASS[0] - SAND[0]) * beach;
          const lo1 = SAND[1] + (GRASS[1] - SAND[1]) * beach;
          const lo2 = SAND[2] + (GRASS[2] - SAND[2]) * beach;
          r = lo0 + (ROCK[0] - lo0) * high;
          g = lo1 + (ROCK[1] - lo1) * high;
          b = lo2 + (ROCK[2] - lo2) * high;
          /*
           * Hillshade, lit from the north-west, off the two neighbours this
           * loop has already sampled: the pixel to the west on this row and
           * the pixel to the north on the last one. The first pixel of a row
           * and the first row of the chart have no neighbour, and take the
           * flat value — one pixel at the edge of the sea.
           */
          const dWest = i > 0 ? h - west : 0;
          const dNorth = j > this.tileRow || this.tileRow > 0 ? h - this.prevRow[i] : 0;
          const shade = 1 + Math.max(-0.42, Math.min(0.42, (dWest + dNorth) / (step * 0.5)));
          r *= shade;
          g *= shade;
          b *= shade;
        }
        west = h;
        const o = ((j - this.tileRow) * TILE + i) * 4;
        d[o] = Math.max(0, Math.min(255, r));
        d[o + 1] = Math.max(0, Math.min(255, g));
        d[o + 2] = Math.max(0, Math.min(255, b));
        d[o + 3] = 255;
      }
      this.prevRow.set(row);
    }
    this.tileCtx.putImageData(img, 0, this.tileRow);
    this.tileRow = end;
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

    /*
     * The chart. Rebuilt when the map changes, a few rows per frame.
     *
     * Its extent covers everything anyone can reach: the furthest island edge
     * on this map, with a wide margin of sea around it so the coastline is
     * not clipped by the edge of the image.
     */
    if (this.tileFor !== (MAP && MAP.id)) {
      this.tileFor = MAP && MAP.id;
      this.tileRow = 0;
      let reach = 12000;
      for (const isl of ISLANDS) reach = Math.max(reach, Math.hypot(isl.cx, isl.cz) + isl.radius);
      this.tileExtent = reach * 2.4;
      this.tileCtx.clearRect(0, 0, TILE, TILE);
    }
    if (this.tileRow < TILE) this.buildTileSlice();

    // Sea, which is also what shows through wherever the chart is not built yet.
    ctx.fillStyle = '#0d2740';
    ctx.beginPath();
    ctx.arc(cx, cy, SIZE / 2 - 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, SIZE / 2 - 2, 0, Math.PI * 2);
    ctx.clip();

    /*
     * Blit the piece of the chart under the aeroplane.
     *
     * The chart is a fixed picture of the whole map, so panning it is
     * arithmetic rather than redrawing: work out which rectangle of it the
     * window is looking at, and let the canvas scale it.
     */
    const ppm = TILE / this.tileExtent; // chart pixels per metre
    const half = this.tileExtent / 2;
    const sw = span * ppm;
    const sx = (ac.pos.x + half) * ppm - sw / 2;
    const sy = (ac.pos.z + half) * ppm - sw / 2;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.tile, sx, sy, sw, sw, 0, 0, SIZE, SIZE);

    // Range rings, so a glance gives you a distance and not just a picture.
    ctx.strokeStyle = 'rgba(190, 214, 236, 0.16)';
    ctx.lineWidth = 1;
    for (const f of [0.25, 0.5]) {
      ctx.beginPath();
      ctx.arc(cx, cy, (SIZE / 2 - 2) * f * 2 * 0.5, 0, Math.PI * 2);
      ctx.stroke();
    }

    // The runway, drawn where it really is: a dark strip with a centreline,
    // which is what tells it apart from a road at a glance.
    const R = AIRPORT.runway;
    const rw = Math.max(2.5, 60 * k);
    ctx.lineCap = 'butt';
    ctx.strokeStyle = 'rgba(18, 22, 28, 0.9)';
    ctx.lineWidth = rw;
    ctx.beginPath();
    ctx.moveTo(mx(R.cx - R.length / 2), my(R.cz));
    ctx.lineTo(mx(R.cx + R.length / 2), my(R.cz));
    ctx.stroke();
    ctx.strokeStyle = '#f2f6fa';
    ctx.lineWidth = Math.max(1, rw * 0.3);
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
      // A diamond rather than another dot, and the distance beside it, so
      // the map answers "how far" without anybody doing arithmetic.
      ctx.save();
      ctx.translate(tx, ty);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = '#7dffb4';
      ctx.strokeStyle = 'rgba(8,14,22,0.8)';
      ctx.lineWidth = 1;
      ctx.fillRect(-3.4, -3.4, 6.8, 6.8);
      ctx.strokeRect(-3.4, -3.4, 6.8, 6.8);
      ctx.restore();
      ctx.strokeStyle = `rgba(125,255,180,${0.5 + Math.sin(this.t * 3) * 0.2})`;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(tx, ty, 9 + Math.sin(this.t * 3) * 2, 0, Math.PI * 2);
      ctx.stroke();
      const km = Math.hypot(target.pos.x - ac.pos.x, target.pos.z - ac.pos.z) / 1000;
      ctx.fillStyle = 'rgba(190, 255, 220, 0.95)';
      ctx.font = '600 9px "Helvetica Neue", Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`, tx, ty - 13);
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

    /*
     * You, in the middle, pointing where you are pointing — with the track
     * you are on drawn ahead of you.
     *
     * The line is a minute of flying at the speed you are doing. It is the
     * one thing on the map that answers "where will I be", which is a better
     * question than "where am I" and the whole reason to look at a map while
     * flying rather than after landing.
     */
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((r.heading * Math.PI) / 180);
    const lead = Math.min(SIZE * 0.42, Math.max(10, ac.groundSpeed * 60 * k));
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 1.2;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(0, -8);
    ctx.lineTo(0, -lead);
    ctx.stroke();
    ctx.setLineDash([]);
    // The aeroplane: a swept symbol with a tail, which reads as an aeroplane
    // at nine pixels where a triangle reads as a cursor.
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = 'rgba(8,14,22,0.9)';
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(0, -8.5);
    ctx.lineTo(1.6, -2);
    ctx.lineTo(7.5, 2.2);
    ctx.lineTo(7.5, 4);
    ctx.lineTo(1.6, 2.4);
    ctx.lineTo(1.4, 6);
    ctx.lineTo(3.4, 7.4);
    ctx.lineTo(3.4, 8.6);
    ctx.lineTo(0, 7.6);
    ctx.lineTo(-3.4, 8.6);
    ctx.lineTo(-3.4, 7.4);
    ctx.lineTo(-1.4, 6);
    ctx.lineTo(-1.6, 2.4);
    ctx.lineTo(-7.5, 4);
    ctx.lineTo(-7.5, 2.2);
    ctx.lineTo(-1.6, -2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    /*
     * The compass, on the bezel rather than as a letter floating in the sea.
     *
     * North is always up on this map and that has to be obvious at a glance,
     * because the whole design rests on it: four ticks and an N, which is how
     * every chart and every instrument in the cockpit says the same thing.
     */
    ctx.save();
    ctx.translate(cx, cy);
    const ring = SIZE / 2 - 3;
    for (let i = 0; i < 4; i++) {
      ctx.save();
      ctx.rotate((i * Math.PI) / 2);
      ctx.strokeStyle = i === 0 ? 'rgba(236, 244, 252, 0.85)' : 'rgba(190, 214, 236, 0.45)';
      ctx.lineWidth = i === 0 ? 2 : 1.3;
      ctx.beginPath();
      ctx.moveTo(0, -ring);
      ctx.lineTo(0, -ring + (i === 0 ? 8 : 5));
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
    ctx.fillStyle = 'rgba(236, 244, 252, 0.9)';
    ctx.font = '700 10px "Helvetica Neue", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('N', cx, 23);

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
