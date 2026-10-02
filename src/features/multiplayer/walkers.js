/**
 * The other players' pilots, out on foot.
 *
 * "people on other computers should see you, the human" — the owner. When a
 * friend climbs out and walks, their snapshot carries their pilot as well as
 * their parked (or runaway) aeroplane (protocol.js, the walker's tail), and
 * this draws them: the same little person the game draws for you, in the
 * uniform their aeroplane gives them, walking with the walk you have — legs,
 * arms, the lot — where their game says they are. Their name tag (and the
 * crown, if they host) moves from the aeroplane to the pilot (remotes.js).
 *
 * WHERE: drawn a moment in the past, between the two snapshots either side
 * of it, on the same clock and with the same delay remotes.js's Track
 * already keeps for this player — a walker at 1.8 m/s is 20 cm behind,
 * and it never guesses a pilot through a wall. A gap in the stream holds
 * them still (a little way on along their heading, never more than 25 cm);
 * a jump of more than a few metres is a jump, not a sprint.
 *
 * KNOCKED DOWN: the moment their game says they were hit, it sends one
 * 'pilot:down' (../pilot-mp.js) with where, which way and how hard; this
 * game runs the same ragdoll (../ragdoll.js) from the pilot as drawn here,
 * so everybody sees the fall. Their snapshot says they are down until they
 * are up; then they are eased back up into the walk, as on their own screen.
 * A down with no event (it was lost, or you joined mid-fall) is a fall where
 * they stand.
 *
 * COST: a person is eleven draw calls; one each for up to seven friends who
 * are walking, none for anybody in their aeroplane.
 */

import { createPerson, posePerson, disposePerson } from '../staff/person.js';
import { createUniformPerson } from '../uniforms.js';
import { Ragdoll, GetUp, cleanRig, groundWorld } from '../ragdoll.js';
import { floorAt } from '../staff/walk.js';

const D2R = Math.PI / 180;
const WORLD = groundWorld(() => null);
/** Seconds a down without its event is waited for before falling where they stand. */
const EVENT_WAIT = 0.45;

const lerp = (a, b, t) => a + (b - a) * t;
function lerpAngle(a, b, t) {
  const d = ((b - a + 540) % 360) - 180;
  return (a + d * t + 360) % 360;
}

function makePerson(outfit) {
  const m = createUniformPerson(outfit, { seed: 5 }) || createPerson({ outfit, seed: outfit === 'passenger' ? 11 : 5 });
  m.name = 'mp-walker';
  return m;
}

/** One friend's pilot. Kept on the friend's Remotes entry as `p.walker`. */
export class RemoteWalker {
  constructor() {
    this.on = false;
    this.model = null;
    this.outfit = '';
    this.x = 0;
    this.y = 0;
    this.z = 0;
    this.heading = 0;
    this.speed = 0;
    this.air = false;
    this.wave = false;
    /** Knocked down, as their game says. */
    this.down = false;
    this.rd = null;
    this.rdKnock = -1;
    this.downSince = 0;
    this.up = new GetUp();
    this.started = false;
    this._t = { x: 0, y: 0, z: 0, heading: 0, speed: 0, air: false, down: false, wave: false, knock: 0, outfit: 'pilot' };
    this.pose = { speed: 0, air: false, wave: null };
    /** For the tests: knocks seen, and how. */
    this.falls = 0;
    this.fromEvent = 0;
  }

  /** The newest walk this player sent, or null (they are in their ride). */
  static newest(track) {
    const S = track && track.snaps;
    if (!S || !S.length) return null;
    const last = S[S.length - 1];
    return last && last.walk ? last.walk : null;
  }

  /**
   * Where the pilot is at our time `now`: between the snapshots either side,
   * at the Track's own delay. Writes this._t; false if there is nothing.
   */
  _target(track, now) {
    const S = track.snaps;
    const n = S.length;
    if (!n || !S[n - 1].walk) return false;
    const rt = now - (track.offset || 0) - (track.delayMs || 100);
    let a = null;
    let b = null;
    for (let i = n - 1; i >= 0; i--) {
      const s = S[i];
      if (!s.walk) break; // before they got out: not a walk
      if (s.t <= rt) {
        a = s;
        b = i + 1 < n ? S[i + 1] : null;
        break;
      }
      b = s;
    }
    const T = this._t;
    let w;
    if (a && b && b.walk && b.t > a.t) {
      const k = Math.max(0, Math.min(1, (rt - a.t) / (b.t - a.t)));
      const wa = a.walk;
      const wb = b.walk;
      const jump = Math.hypot(wb.x - wa.x, wb.z - wa.z) > 4 + 12 * ((b.t - a.t) / 1000);
      if (jump) {
        w = k < 0.5 ? wa : wb;
        T.x = w.x;
        T.y = w.y;
        T.z = w.z;
        T.heading = w.heading;
        T.speed = w.speed;
      } else {
        T.x = lerp(wa.x, wb.x, k);
        T.y = lerp(wa.y, wb.y, k);
        T.z = lerp(wa.z, wb.z, k);
        T.heading = lerpAngle(wa.heading, wb.heading, k);
        T.speed = lerp(wa.speed, wb.speed, k);
        w = wb;
      }
    } else {
      // Past the newest, or before the oldest walk held: the nearest there is, a little way on.
      const s = a || b || S[n - 1];
      w = s.walk;
      const gap = a ? Math.max(0, Math.min(0.25, (rt - a.t) / 1000)) : 0;
      const h = w.heading * D2R;
      const on = w.down ? 0 : w.speed * gap;
      T.x = w.x + Math.sin(h) * on;
      T.y = w.y;
      T.z = w.z - Math.cos(h) * on;
      T.heading = w.heading;
      T.speed = gap >= 0.25 ? 0 : w.speed;
    }
    T.air = !!w.air;
    T.wave = !!w.wave;
    // Down, and which fall, from the NEWEST: a knock is news, not history.
    const nw = S[n - 1].walk;
    T.down = !!nw.down;
    T.knock = nw.knock;
    T.outfit = nw.outfit || 'pilot';
    return true;
  }

  _ensure(root) {
    const want = this._t.outfit;
    if (this.model && this.outfit === want && this.model.parent === root) return this.model;
    if (this.model) {
      disposePerson(this.model);
      this.model = null;
    }
    if (!root) return null;
    this.model = makePerson(want);
    this.outfit = want;
    root.add(this.model);
    return this.model;
  }

  /**
   * Once a frame. `track` is the player's Track (interp.js), `root` the
   * group to draw in, `hidden` true when the player is not to be drawn at
   * all. Returns true while there is a pilot to put the tag over.
   */
  update(track, now, dt, root, hidden = false) {
    const had = this._target(track, now);
    if (!had) {
      this.hide();
      return false;
    }
    const T = this._t;
    const m = this._ensure(root);
    if (!m) return false;
    m.visible = !hidden;
    this.on = true;
    // Their game says they are down: the fall, here too.
    if (T.down) {
      if (!this.down) {
        this.down = true;
        this.downSince = now;
      }
      if (!this.rd && now - this.downSince > EVENT_WAIT * 1000) this._fall(null);
    } else if (this.down) {
      this.down = false;
      if (this.rd) {
        // Up: eased out of where the body lay, into the walk at their new spot.
        this.rd = null;
        this.up.begin(m, 0.7);
        this.started = false;
      }
    }
    if (this.rd) {
      this.rd.step(Math.min(dt, 0.1), WORLD);
      this.rd.applyTo(m);
      const p = this.rd.pelvis;
      this.x = p.x;
      this.y = floorAt(p.x, p.z);
      this.z = p.z;
      return true;
    }
    // Walking: smoothed onto where they are.
    if (!this.started || Math.hypot(T.x - this.x, T.z - this.z) > 6) {
      this.x = T.x;
      this.y = T.y;
      this.z = T.z;
      this.heading = T.heading;
      this.started = true;
    } else {
      const k = 1 - Math.exp(-dt / 0.09);
      this.x += (T.x - this.x) * k;
      this.y += (T.y - this.y) * k;
      this.z += (T.z - this.z) * k;
      this.heading = lerpAngle(this.heading, T.heading, 1 - Math.exp(-dt / 0.08));
    }
    this.speed = T.speed;
    this.air = T.air;
    this.wave = T.wave;
    m.position.set(this.x, this.y, this.z);
    m.rotation.set(0, -this.heading * D2R, 0);
    this.pose.speed = this.speed;
    this.pose.air = this.air;
    this.pose.wave = this.wave ? 'hello' : null;
    posePerson(m, dt, this.pose);
    if (this.up.on) this.up.apply(m, dt);
    return true;
  }

  /**
   * Their game says they were knocked down, and how (pilot-mp.js
   * 'pilot:down'): the fall starts from the pilot as drawn here, put where
   * and facing the way their game had them.
   */
  knock(d) {
    if (!d) return false;
    if (d.n === this.rdKnock && this.rd) return false;
    this.rdKnock = d.n;
    this._fall(d);
    this.fromEvent++;
    return true;
  }

  _fall(d) {
    const m = this.model;
    this.falls++;
    this.rd = this.rd || new Ragdoll();
    this.up.on = false;
    if (d) {
      this.x = d.x;
      this.y = d.y;
      this.z = d.z;
      this.heading = d.h;
    }
    if (m) {
      m.position.set(this.x, this.y, this.z);
      m.rotation.set(0, -this.heading * D2R, 0);
      cleanRig(m);
      posePerson(m, 0, this.pose);
      if (!this.rd.capture(m)) this.rd.standAt(this.x, this.y, this.z, this.heading);
    } else {
      this.rd.standAt(this.x, this.y, this.z, this.heading);
    }
    this.rd.knock(d ? { x: d.vx, y: d.vy, z: d.vz } : { x: 0, y: 0, z: 0 }, d ? d.hy : 0.9);
    this.down = true;
  }

  hide() {
    if (this.model) this.model.visible = false;
    this.on = false;
    this.rd = null;
    this.down = false;
    this.started = false;
    this.up.on = false;
  }

  /** The world was rebuilt (it disposed the model with its group) — or the player left. */
  forget(dispose = false) {
    if (this.model && dispose) disposePerson(this.model);
    this.model = null;
    this.outfit = '';
    this.hide();
  }
}
