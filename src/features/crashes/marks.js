/**
 * "crashes show on minimap" — where you (and, in multiplayer, everybody
 * else) came down, as a little comic burst on the map.
 *
 * TIDY, because a minimap is 190 pixels and a class crashes a lot:
 *   - at most MAX marks; the oldest goes when a new one comes;
 *   - two crashes within MERGE metres of each other are one mark (the newer
 *     one, with a count of how many) — the end of the runway would otherwise
 *     be a pile of them;
 *   - each mark is solid for LIFE - FADE seconds and fades out over the last
 *     FADE, then it is gone;
 *   - only marks made on the map you are on are drawn, and only inside the
 *     circle — no arrows on the bezel, those belong to where you are going;
 *   - your own newest one pulses for its first few seconds so you can find it.
 *
 * Your crashes are orange (a splash is blue); another player's are their own
 * colour with a white edge, so you can tell whose is whose.
 *
 * The store is pure data (node-testable); drawCrashMarks is canvas 2D on the
 * minimap's own context, after the minimap has drawn itself.
 */

export const MARK_LIFE = 90;
export const MARK_FADE = 30;
export const MARK_MAX = 10;
export const MARK_MERGE = 70;

export class CrashMarks {
  constructor() {
    this.list = [];
  }

  /** @param m { x, z, kind, map, mine, colour, now (seconds) } */
  add(m) {
    const now = m.now;
    // Same place, same map: bump the one that is there.
    for (let i = this.list.length - 1; i >= 0; i--) {
      const o = this.list[i];
      if (o.map === m.map && Math.hypot(o.x - m.x, o.z - m.z) < MARK_MERGE) {
        this.list.splice(i, 1);
        m = { ...m, count: (o.count || 1) + 1 };
        break;
      }
    }
    const mark = { x: m.x, z: m.z, kind: m.kind, map: m.map, mine: !!m.mine, colour: m.colour || null, t0: now, count: m.count || 1 };
    this.list.push(mark);
    while (this.list.length > MARK_MAX) this.list.shift();
    return mark;
  }

  prune(now) {
    this.list = this.list.filter((m) => now - m.t0 < MARK_LIFE);
  }

  /** 0..1, how visible a mark is now. */
  static alpha(m, now) {
    const age = now - m.t0;
    if (age < 0) return 1;
    if (age >= MARK_LIFE) return 0;
    const solid = MARK_LIFE - MARK_FADE;
    return age <= solid ? 1 : 1 - (age - solid) / MARK_FADE;
  }

  clear() {
    this.list.length = 0;
  }
}

function burst(ctx, x, y, r) {
  ctx.beginPath();
  const n = 8;
  for (let i = 0; i < n * 2; i++) {
    const rr = i % 2 ? r * 0.5 : r;
    const a = -Math.PI / 2 + (i * Math.PI) / n;
    const px = x + Math.cos(a) * rr;
    const py = y + Math.sin(a) * rr;
    if (i) ctx.lineTo(px, py);
    else ctx.moveTo(px, py);
  }
  ctx.closePath();
}

/**
 * Draw the marks on a north-up minimap centred on `centre`.
 * @param ctx      the minimap's 2D context (already scaled to its logical size)
 * @param size     logical size in pixels (190)
 * @param span     metres across
 * @param scale    how much bigger to draw (the minimap's textScale, for small screens)
 * @returns how many were drawn
 */
export function drawCrashMarks(ctx, marks, centre, span, size, now, map, newestMine = null, scale = 1) {
  if (!ctx || !marks || !marks.list.length || !(span > 0)) return 0;
  const k = size / span;
  const c = size / 2;
  const edge = size / 2 - 7;
  let drawn = 0;
  ctx.save();
  ctx.beginPath();
  ctx.arc(c, c, size / 2 - 2, 0, Math.PI * 2);
  ctx.clip();
  for (const m of marks.list) {
    if (m.map !== map) continue;
    const a = CrashMarks.alpha(m, now);
    if (a <= 0) continue;
    const x = c + (m.x - centre.x) * k;
    const y = c + (m.z - centre.z) * k;
    if (Math.hypot(x - c, y - c) > edge) continue;
    ctx.globalAlpha = a;
    const r = (m.count > 1 ? 6.2 : 5.2) * scale;
    if (m === newestMine && now - m.t0 < 6) {
      const p = ((now - m.t0) % 1.2) / 1.2;
      ctx.strokeStyle = `rgba(255, 200, 80, ${0.9 * (1 - p)})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(x, y, r + 2 + p * 9, 0, Math.PI * 2);
      ctx.stroke();
    }
    burst(ctx, x, y, r);
    ctx.fillStyle = m.mine ? (m.kind === 'splash' ? '#5ec8ff' : '#ffa928') : m.colour || '#c9a0ff';
    ctx.fill();
    ctx.lineWidth = 1.3;
    ctx.strokeStyle = m.mine ? 'rgba(20, 16, 30, 0.95)' : 'rgba(255, 255, 255, 0.95)';
    ctx.stroke();
    // A tiny X in the middle: "here".
    ctx.strokeStyle = 'rgba(20, 16, 30, 0.9)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    const q = 1.8 * scale;
    ctx.moveTo(x - q, y - q);
    ctx.lineTo(x + q, y + q);
    ctx.moveTo(x + q, y - q);
    ctx.lineTo(x - q, y + q);
    ctx.stroke();
    if (m.count > 1) {
      ctx.font = `700 ${Math.round(7 * scale)}px system-ui, sans-serif`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 2.2;
      ctx.strokeStyle = 'rgba(8, 12, 20, 0.9)';
      ctx.strokeText(`×${m.count}`, x + r + 1, y - r + 1);
      ctx.fillStyle = '#fff';
      ctx.fillText(`×${m.count}`, x + r + 1, y - r + 1);
    }
    drawn++;
  }
  ctx.globalAlpha = 1;
  ctx.restore();
  return drawn;
}
