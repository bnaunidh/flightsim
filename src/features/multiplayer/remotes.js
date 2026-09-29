/**
 * The other players, drawn.
 *
 * Each remote player is the game's own model for whatever they are flying or
 * driving — createAircraftModel for an aeroplane or the helicopter, exactly as
 * main.js builds the player's own, and createBoat / createCar for the other
 * two — painted in their colour, with a name tag that stays readable at any
 * distance and shows how far away they are.
 *
 * They are GHOSTS. Nothing here registers an obstacle, a platform or a
 * contact: you can fly straight through a friend, which in a class of
 * ten-year-olds is the only safe way to do formation flying.
 *
 * Models live in the group the world hands this feature, so a world rebuild
 * (a map change, a graphics change) disposes them with everything else; the
 * next frame builds them again. Released models are kept, one per type and
 * colour, so a friend who crashes and comes back in the same aeroplane does
 * not cost a rebuild.
 */

import * as THREE from '../../vendor/three.module.js';
import { createAircraftModel, syncAircraftModel, groundOffsetFor } from '../../aircraft/model-adapter.js';
import { getAircraft, specFor } from '../../aircraft/types.js';
import { createBoat, createCar, updateVehicleModel } from '../../vehicles/models.js';
import { VEHICLES } from '../../vehicles/surface.js';
import { Track, Smoother } from './interp.js';
import { QUICK_CHAT } from './protocol.js';

const tmpV = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);

/** Dispose a model the way main.js disposes the player's when the type changes. */
function disposeModel(model) {
  if (!model) return;
  model.removeFromParent();
  if (model.userData && model.userData.fleetBridge && typeof model.userData.dispose === 'function') {
    try {
      model.userData.dispose();
      return;
    } catch (err) {
      /* fall through to the plain walk */
    }
  }
  const seen = new Set();
  model.traverse((o) => {
    if (o.geometry && !seen.has(o.geometry)) {
      seen.add(o.geometry);
      o.geometry.dispose();
    }
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) {
      if (seen.has(m)) continue;
      seen.add(m);
      m.dispose();
    }
  });
}

/** A livery in one colour: the body in theirs, a white accent, the fin to match. */
function schemeIn(colour) {
  const c = new THREE.Color(colour);
  return {
    id: 'multiplayer',
    name: 'Multiplayer',
    base: `#${c.getHexString()}`,
    accent: '#ffffff',
    cheatline: 'rgba(255,255,255,0.9)',
    tail: c.getHex(),
    reg: null,
  };
}

/*
 * The boat and the van take no paint, so theirs goes on afterwards: the hull
 * or the body panels, found by name, get a cloned material in the player's
 * colour. Cloned, because the pack shares materials between parts and a
 * shared material painted red would paint the player's own boat red too.
 */
function tintVehicle(model, colour) {
  /*
   * The deck as well as the hull. Painting the hull alone was measured to
   * show nothing: the pack's planing hull spans -0.45 to +0.65 m and the
   * launch is drawn 0.42 m lower, so almost all of it is under the water and
   * what a chase camera sees of somebody else's boat is a white deck. Hana's
   * red boat came out grey in the playtest screenshot. The van is the same
   * story from above: its lower body is one material and the hood, roof,
   * doors and rear quarters another, white, which is most of what you see.
   */
  const want = /hull|deck|console|body|panel|shell|cab(?!in)|hood|bonnet|roof|door|quarter/i;
  const avoid = /instrument|dash|glass|window|windscreen|mirror|plate|handle|wheel|tyre|tire|light|lamp|beacon|screen|seat|rubber|wake|spray|slick|wave/i;
  const hits = [];
  model.traverse((o) => {
    if (o.isMesh && want.test(o.name || '') && !avoid.test(o.name || '')) hits.push(o);
  });
  if (!hits.length) {
    let best = null;
    let r = 0;
    model.traverse((o) => {
      if (!o.isMesh || !o.geometry || avoid.test(o.name || '')) return;
      if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
      const rad = o.geometry.boundingSphere ? o.geometry.boundingSphere.radius : 0;
      if (rad > r) {
        r = rad;
        best = o;
      }
    });
    if (best) hits.push(best);
  }
  const clones = new Map();
  const tint = new THREE.Color(colour).multiplyScalar(1.5);
  for (const mesh of hits) {
    const m = mesh.material;
    if (!m || Array.isArray(m) || !m.color) continue;
    if (!clones.has(m)) {
      const c = m.clone();
      c.color.copy(tint);
      clones.set(m, c);
    }
    mesh.material = clones.get(m);
  }
  model.userData.mpTinted = [...clones.values()];
}

/* ------------------------------------------------------------------ */
/* Name tags                                                           */
/* ------------------------------------------------------------------ */

const TAG_W = 320;
const TAG_H = 112;
const TAG_SCALE = 0.1;

function makeTag() {
  const canvas = document.createElement('canvas');
  canvas.width = TAG_W;
  canvas.height = TAG_H;
  const tex = new THREE.CanvasTexture(canvas);
  if ('colorSpace' in tex) tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, sizeAttenuation: false });
  const sprite = new THREE.Sprite(mat);
  sprite.center.set(0.5, 0);
  /*
   * Constant size on screen. At 0.057 the whole tag was 35 px of a 713 px
   * window and the name in it 9 px — measured on the playtest screenshot,
   * "Hana" over a Skylark twenty metres away was a smudge. At 0.1 the name
   * is about 15 px, the size of the HUD's own labels.
   */
  sprite.scale.set(TAG_SCALE * (TAG_W / TAG_H), TAG_SCALE, 1);
  sprite.renderOrder = 998;
  sprite.frustumCulled = false;
  sprite.name = 'mp-tag';
  return { sprite, canvas, tex, key: '' };
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function drawTag(tag, name, colour, line2, chat) {
  const key = `${name}|${colour}|${line2}|${chat || ''}`;
  if (tag.key === key) return;
  tag.key = key;
  const g = tag.canvas.getContext('2d');
  if (!g || typeof g.fillText !== 'function') return;
  g.clearRect(0, 0, TAG_W, TAG_H);
  const font = '"Helvetica Neue", Arial, sans-serif';
  // Chat bubble on top, when there is one.
  if (chat) {
    g.font = `700 26px ${font}`;
    const w = Math.min(TAG_W - 8, g.measureText(chat).width + 28);
    g.fillStyle = 'rgba(255,255,255,0.94)';
    roundRect(g, (TAG_W - w) / 2, 2, w, 40, 16);
    g.fill();
    g.fillStyle = '#0b1220';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(chat, TAG_W / 2, 23, TAG_W - 30);
  }
  // Name pill.
  g.font = `700 28px ${font}`;
  const nw = Math.min(TAG_W - 8, g.measureText(name).width + 44);
  const y = 48;
  g.fillStyle = 'rgba(8, 13, 22, 0.72)';
  roundRect(g, (TAG_W - nw) / 2, y, nw, 38, 12);
  g.fill();
  g.fillStyle = colour;
  g.beginPath();
  g.arc((TAG_W - nw) / 2 + 17, y + 19, 7, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#ffffff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(name, TAG_W / 2 + 9, y + 20, nw - 36);
  if (line2) {
    g.font = `600 20px ${font}`;
    g.fillStyle = 'rgba(234, 241, 251, 0.95)';
    g.shadowColor = 'rgba(0,0,0,0.8)';
    g.shadowBlur = 4;
    g.fillText(line2, TAG_W / 2, y + 52);
    g.shadowBlur = 0;
  }
  tag.tex.needsUpdate = true;
}

function fmtDist(m) {
  if (m < 1000) return `${Math.max(10, Math.round(m / 10) * 10)} m`;
  return `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`;
}

/* ------------------------------------------------------------------ */

export class Remotes {
  constructor() {
    this.players = new Map();
    this.root = null;
    this.own = null;
    this.pool = new Map();
    this.offsets = new Map();
    this.scene = null;
    this._acs = new Map();
    /*
     * Reused every frame: the list the minimap draws from, one dot per
     * player, and the argument updateVehicleModel takes. Review counted a new
     * array, an object per player, a quaternion per player and a closure per
     * boat or car, every frame.
     */
    this._out = [];
    this._dots = new Map();
    this._veh = new Map();
  }

  /**
   * The world was (re)built. Everything in the old group has just been
   * disposed by it, so every model held here is dead: forget them, and build
   * again into the new group on the next frame.
   */
  setGroup(group) {
    for (const p of this.players.values()) {
      // A model in our own fallback group was not part of the world, so it is still alive: dispose it here.
      if (p.model && this.own && p.model.parent === this.own) disposeModel(p.model);
      p.model = null;
      p.modelKey = '';
      if (p.tag) {
        p.tag.sprite.removeFromParent();
        p.tag.sprite.material.map.dispose();
        p.tag.sprite.material.dispose();
        p.tag = null;
      }
    }
    // Pooled models were detached when they were released, so the world did not dispose them; they are kept.
    if (this.own) {
      this.own.removeFromParent();
      this.own = null;
    }
    this.root = group;
  }

  _root(sim) {
    if (this.root && this.root.parent) return this.root;
    // No world group (loaded after the world was built): keep our own, on the scene.
    if (!this.own && sim && sim.scene) {
      this.own = new THREE.Group();
      this.own.name = 'ext:multiplayer:own';
      sim.scene.add(this.own);
    }
    return this.own;
  }

  add(id, { name, colour }) {
    let p = this.players.get(id);
    if (!p) {
      p = { id, name, colour, track: new Track(), smooth: new Smoother(), drawn: null, model: null, modelKey: '', tag: null, chat: null, chatUntil: 0, sample: null, dist: 0, visible: false };
      this.players.set(id, p);
    }
    p.name = name;
    if (p.colour !== colour) {
      p.colour = colour;
      this._release(p);
    }
    return p;
  }

  remove(id) {
    const p = this.players.get(id);
    if (!p) return;
    this._release(p);
    if (p.tag) {
      p.tag.sprite.removeFromParent();
      p.tag.sprite.material.map.dispose();
      p.tag.sprite.material.dispose();
    }
    this.players.delete(id);
    this._acs.delete(id);
    this._dots.delete(id);
    this._veh.delete(id);
  }

  /**
   * Everybody out, their models kept for when they come back. A lobby
   * re-forming numbers everybody afresh a second later (lobby.js), and seven
   * aircraft models built again at once is a frame a child would feel.
   */
  dropPlayers() {
    for (const id of [...this.players.keys()]) this.remove(id);
  }

  clear() {
    for (const id of [...this.players.keys()]) this.remove(id);
    for (const m of this.pool.values()) disposeModel(m);
    this.pool.clear();
    if (this.own) {
      this.own.removeFromParent();
      this.own = null;
    }
  }

  push(snap, now) {
    const p = this.players.get(snap.id);
    if (!p) return false;
    return p.track.push(snap, now);
  }

  say(id, m, now) {
    const p = this.players.get(id);
    const c = QUICK_CHAT[m];
    if (!p || !c) return;
    p.chat = c.text;
    p.chatUntil = now + 4500;
  }

  _release(p) {
    if (!p.model) return;
    p.model.removeFromParent();
    const key = p.modelKey;
    if (key && !this.pool.has(key) && this.pool.size < 8) this.pool.set(key, p.model);
    else disposeModel(p.model);
    p.model = null;
    p.modelKey = '';
  }

  _build(kind, type, colour) {
    if (kind === 'boat' || kind === 'car') {
      const m = kind === 'boat' ? createBoat() : createCar();
      tintVehicle(m, colour);
      m.userData.mpKind = kind;
      return m;
    }
    const t = getAircraft(type);
    const model = createAircraftModel({ type: t, livery: schemeIn(colour) });
    // How far the picture drops so the wheels meet the ground — measured once per type, as main.js does for yours.
    if (!this.offsets.has(t.id)) {
      let off = 0;
      try {
        off = groundOffsetFor(model, specFor(t.id));
      } catch (err) {
        off = 0;
      }
      this.offsets.set(t.id, off);
    }
    model.userData.groundOffsetY = this.offsets.get(t.id);
    model.userData.mpKind = 'air';
    return model;
  }

  _ensureModel(p, snap, sim) {
    const kind = snap.game === 'boat' || snap.game === 'car' ? snap.game : 'air';
    const type = kind === 'air' ? (snap.type || 'skylark') : kind;
    const key = `${kind}:${type}:${p.colour}`;
    if (p.model && p.modelKey === key && p.model.parent) return p.model;
    this._release(p);
    const root = this._root(sim);
    if (!root) return null;
    let model = this.pool.get(key);
    if (model) this.pool.delete(key);
    else {
      try {
        model = this._build(kind, type, p.colour);
      } catch (err) {
        console.warn('[mp] could not build a model for', type, err);
        return null;
      }
    }
    model.name = `mp-player-${p.id}`;
    if (model.userData.mpTop === undefined) model.userData.mpTop = topOf(model);
    root.add(model);
    p.model = model;
    p.modelKey = key;
    return model;
  }

  _fakeAc(p) {
    let ac = this._acs.get(p.id);
    if (!ac) {
      ac = {
        pos: new THREE.Vector3(), quat: new THREE.Quaternion(), vel: new THREE.Vector3(), omega: new THREE.Vector3(),
        controls: { pitch: 0, roll: 0, yaw: 0, brakes: 0, throttle: 0 },
        rpm: 0, flaps: 0, gearPos: 1, gearDown: true, onGround: true, groundSpeed: 0, engineOn: true, agl: 0, crashed: false,
      };
      this._acs.set(p.id, ac);
    }
    return ac;
  }

  /**
   * Once a frame: where everybody is, drawn. Returns the list the minimap
   * overlay needs.
   */
  update(dt, now, sim, tags = true) {
    const out = this._out;
    out.length = 0;
    const me = sim && (sim.mode === 'drive' && sim.vehicle ? sim.vehicle.pos : sim.aircraft && sim.aircraft.pos);
    for (const p of this.players.values()) {
      const s = p.track.sample(now, p.sample || undefined);
      if (s) p.sample = s;
      const stale = !s || p.track.stale(now);
      if (stale) {
        if (p.model) p.model.visible = false;
        if (p.tag) p.tag.sprite.visible = false;
        p.visible = false;
        p.smooth.reset();
        continue;
      }
      const snap = s.snap;
      // Where to draw them: the sample, with its seams smoothed over (see Smoother).
      const at = p.smooth.step(s.pos, s.vel, dt);
      p.drawn = at;
      const model = this._ensureModel(p, snap, sim);
      if (!model) continue;
      model.visible = true;
      p.visible = true;
      const kind = model.userData.mpKind;
      if (kind === 'air') {
        const ac = this._fakeAc(p);
        ac.pos.set(at.x, at.y, at.z);
        ac.quat.set(s.quat.x, s.quat.y, s.quat.z, s.quat.w);
        ac.vel.set(s.vel.x, s.vel.y, s.vel.z);
        ac.controls.pitch = snap.pitch;
        ac.controls.roll = snap.roll;
        ac.controls.yaw = snap.yaw;
        ac.controls.brakes = snap.brakes ? 1 : 0;
        ac.controls.throttle = snap.throttle;
        ac.rpm = snap.rpm;
        ac.flaps = snap.flaps;
        ac.gearPos = snap.gearPos;
        ac.gearDown = snap.gearDown;
        ac.onGround = snap.onGround;
        ac.groundSpeed = Math.hypot(s.vel.x, s.vel.z);
        ac.engineOn = snap.engineOn;
        ac.agl = snap.onGround ? 0 : 500;
        ac.crashed = false;
        try {
          syncAircraftModel(model, ac);
          if (model.userData.update) model.userData.update(dt, ac, sim && sim.weather);
        } catch (err) {
          model.position.copy(ac.pos);
          model.quaternion.copy(ac.quat);
        }
      } else {
        model.position.set(at.x, at.y, at.z);
        // The same draught correction main.js gives the player's own launch.
        if (kind === 'boat' && model.userData.fromPack) model.position.y -= 0.42;
        model.quaternion.set(s.quat.x, s.quat.y, s.quat.z, s.quat.w);
        const speed = Math.hypot(s.vel.x, s.vel.z);
        const fwd = tmpV.set(0, 0, -1).applyQuaternion(model.quaternion);
        const signed = fwd.x * s.vel.x + fwd.z * s.vel.z >= 0 ? speed : -speed;
        let v = this._veh.get(p.id);
        if (!v) {
          const none = {};
          v = { spec: null, speed: 0, steer: 0, throttle: 0, brakes: 0, readouts: () => none };
          this._veh.set(p.id, v);
        }
        v.spec = VEHICLES[kind] || VEHICLES.boat;
        v.speed = signed;
        v.steer = snap.steer;
        v.throttle = snap.throttle;
        v.brakes = snap.brakes ? 1 : 0;
        try {
          updateVehicleModel(model, v, dt);
        } catch (err) {
          /* a model that will not animate is still a model in the right place */
        }
      }

      // The tag.
      if (!p.tag) {
        p.tag = makeTag();
        p.tagAt = -Infinity;
        this._root(sim) && this._root(sim).add(p.tag.sprite);
      } else if (!p.tag.sprite.parent) {
        const r = this._root(sim);
        if (r) r.add(p.tag.sprite);
      }
      const d = me ? Math.hypot(at.x - me.x, at.y - me.y, at.z - me.z) : 0;
      p.dist = d;
      const chat = p.chatUntil > now ? p.chat : null;
      /*
       * Redrawing the tag is a canvas paint and a texture upload. Every frame,
       * for four friends, that was half a megabyte a frame to the GPU on a
       * school Chromebook for a number nobody reads that fast — so the
       * distance is refreshed twice a second, and a chat bubble at once.
       */
      // ...unless it is suddenly a different number: a joiner dropped beside the host read "560 m" for half a second.
      const jumped = p.tagDist != null && Math.abs(d - p.tagDist) > Math.max(20, 0.25 * p.tagDist);
      if (chat !== p.tagChat || jumped || !(now - (p.tagAt || -Infinity) < 500)) {
        p.tagAt = now;
        p.tagChat = chat;
        p.tagDist = d;
        drawTag(p.tag, p.name, p.colour, fmtDist(d), chat);
      }
      /*
       * A fixed five metres over the aeroplane's middle floated the tag a
       * wingspan clear of a Skylark — ten metres off in the playtest it sat
       * over the hangars behind it rather than the aeroplane — and inside the
       * fin of anything big. So it goes a metre and a bit over the top of the
       * model actually drawn, and higher with distance, where the model is a
       * few pixels and the tag must not cover it.
       */
      // syncAircraftModel drops only the pack's models by their ground offset; the built-in ones sit where they are.
      const top = (model.userData.mpTop || 2) + (kind === 'air' && model.userData.fleetBridge ? model.userData.groundOffsetY || 0 : 0);
      const lift = top + 1.3 + Math.min(kind === 'air' ? 30 : 20, d * 0.004);
      p.tag.sprite.position.set(at.x, at.y, at.z).addScaledVector(UP, lift);
      // Past eight kilometres a tag is clutter, and a friend that far off is on the minimap.
      // Hidden with the rest of the interface (U), for a clean shot.
      p.tag.sprite.visible = tags && d < 8000 && d > 4;
      let dot = this._dots.get(p.id);
      if (!dot) {
        dot = { id: p.id, name: '', colour: '', x: 0, z: 0, heading: 0, dist: 0 };
        this._dots.set(p.id, dot);
      }
      dot.name = p.name;
      dot.colour = p.colour;
      dot.x = at.x;
      dot.z = at.z;
      dot.heading = headingOf(s.quat);
      dot.dist = d;
      out.push(dot);
    }
    return out;
  }
}

/** How far the top of a model is above its origin, measured once while it sits unrotated at the origin. */
function topOf(model) {
  try {
    const box = new THREE.Box3().setFromObject(model);
    const top = box.max.y - model.position.y;
    return Number.isFinite(top) && top > 0 && top < 60 ? top : 2;
  } catch (err) {
    return 2;
  }
}

/** Compass heading of a quaternion: 0 is north (−Z), 90 is east. */
export function headingOf(q) {
  const f = tmpV.set(0, 0, -1).applyQuaternion(tmpQ.set(q.x, q.y, q.z, q.w));
  return ((Math.atan2(f.x, -f.z) * 180) / Math.PI + 360) % 360;
}
