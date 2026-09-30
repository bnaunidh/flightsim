/**
 * What the four "play together" features share — PvP (../pvp.js), bumping
 * (../bump.js), racing (../race.js) and the shared world (../mpworld.js):
 *
 *   - ride(sim): what this player is in right now, as one shape for an
 *     aeroplane, the helicopter, the boat and the car;
 *   - ghost(reason, on): the one "nobody can bump into or hit me" bit every
 *     snapshot carries (protocol.js). Each feature holds its own reasons —
 *     just arrived, tagged out, on the runway, racing — and the bit is on
 *     while any of them is;
 *   - the cartoon effects: puffs, stars, comic words ("POW!", "BONK!",
 *     "POOF!") and pellets, pooled and made once per world, one draw call a
 *     kind, nothing that looks like a real weapon or a real wound;
 *   - small sounds through the game's own mixer, quiet, and never unless the
 *     game's sound is on;
 *   - the chip row on the multiplayer badge, and a big comic card in the
 *     middle of the screen for a moment that matters.
 */

import * as THREE from '../../vendor/three.module.js';
import { extLayer, registerExtension } from '../../game/extensions.js';
import { multiplayer } from '../multiplayer.js';

export const mp = multiplayer;
export const ch = multiplayer.events;

/* ---- the ghost bit -------------------------------------------------------- */

const reasons = new Set();
export function ghost(reason, on) {
  if (on) reasons.add(reason);
  else reasons.delete(reason);
}
export function ghostReasons() {
  return [...reasons];
}
Object.defineProperty(multiplayer.extraFlags, 'ghost', { get: () => reasons.size > 0, enumerable: true, configurable: true });

/* ---- what this player is in -------------------------------------------------- */

const box = new THREE.Box3();
const sphere = new THREE.Sphere();
const radii = new Map();

/** Half the size of what is drawn, in metres, measured once per model. */
function radiusOfModel(model, key) {
  if (!model) return 6;
  if (radii.has(key)) return radii.get(key);
  let r = 6;
  try {
    box.setFromObject(model);
    if (!box.isEmpty()) {
      box.getBoundingSphere(sphere);
      r = Math.max(1.5, Math.min(60, sphere.radius));
    }
  } catch (e) {
    r = 6;
  }
  radii.set(key, r);
  return r;
}

/**
 * This player's ride, or null when there is nothing to fly: { kind: 'air' |
 * 'boat' | 'car', heli, obj (the aircraft or the vehicle), pos, vel, quat,
 * onGround, model, radius, type }.
 */
export function ride(sim) {
  if (!sim) return null;
  if (sim.mode === 'drive' && sim.vehicle) {
    const v = sim.vehicle;
    const kind = v.spec && v.spec.kind === 'car' ? 'car' : 'boat';
    return { kind, heli: false, obj: v, pos: v.pos, vel: v.vel, quat: v.quat, onGround: true, model: sim.vehicleModel || null, radius: radiusOfModel(sim.vehicleModel, kind), type: kind };
  }
  const ac = sim.aircraft;
  if (!ac || !ac.pos) return null;
  const type = sim.aircraftType ? sim.aircraftType.id : 'skylark';
  return { kind: 'air', heli: type === 'harrier', obj: ac, pos: ac.pos, vel: ac.vel, quat: ac.quat, onGround: !!ac.onGround, model: sim.model || null, radius: radiusOfModel(sim.model, `air:${type}`), type };
}

const FWD = new THREE.Vector3();
/** Which way a quaternion's nose points (the game's models face -Z). */
export function forwardOf(q, out = FWD) {
  return out.set(0, 0, -1).applyQuaternion(q);
}

/** In a game with others, and past the loading. */
export function inGame() {
  return !!(multiplayer.role && multiplayer.ready && ch.active);
}

/** A player's name and colour, as the roster has them (list-built usernames: safe to show). */
export function who(id) {
  const p = ch.players().find((x) => x.id === id);
  return p ? { id, name: p.name, colour: p.colour, me: !!p.me } : { id, name: 'Somebody', colour: '#c9d6e8', me: false };
}

export function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/* ---- sounds ------------------------------------------------------------------ */

/**
 * Quiet cartoon noises through the game's own alert voice — which honours
 * the mute key and the sound sliders — and nothing at all when the game has
 * no sound running. `what`: 'pew' 'ding' 'pop' 'bonk' 'beep' 'go' 'gate'.
 */
export function blip(sim, what) {
  const a = sim && sim.audio;
  const al = a && a.available && a.alerts;
  if (!al || typeof al._note !== 'function') return false;
  try {
    switch (what) {
      case 'pew': al._note(0, 1500, 0.07, 0.025, 'square', 700); break;
      case 'ding': al._note(0, 1320, 0.09, 0.05, 'sine'); al._note(0.08, 1760, 0.12, 0.05, 'sine'); break;
      case 'pop': al._note(0, 520, 0.08, 0.08, 'triangle', 1400); al._note(0.1, 1400, 0.45, 0.05, 'sine', 300); break;
      case 'bonk': if (al.thud) al.thud(); else al._note(0, 140, 0.15, 0.1, 'sine', 70); break;
      case 'beep': al._note(0, 880, 0.14, 0.07, 'sine'); break;
      case 'go': al._note(0, 1320, 0.4, 0.08, 'sine'); break;
      case 'gate': al._note(0, 988, 0.08, 0.05, 'sine'); al._note(0.07, 1319, 0.1, 0.05, 'sine'); break;
      default: return false;
    }
    return true;
  } catch (e) {
    return false;
  }
}

/* ---- cartoon effects ------------------------------------------------------------ */

function canvasTex(w, h, paint) {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (g && typeof g.fillRect === 'function') paint(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const WORDS = ['POW!', 'BONK!', 'POOF!', 'SPLAT!', 'ZAP!', 'GO!'];
const WORD_COLOURS = { 'POW!': '#ffd23f', 'BONK!': '#ffb3d9', 'POOF!': '#ffffff', 'SPLAT!': '#9dff7a', 'ZAP!': '#8ee6ff', 'GO!': '#7dff9a' };

/**
 * Pooled sprites: soft puffs, stars and comic words, all made once per world
 * and reused. At most 48 puffs, 24 stars and 6 words at a time; asking for
 * more recycles the oldest.
 */
export class Toon {
  constructor() {
    this.group = null;
    this.puffs = [];
    this.stars = [];
    this.words = [];
    this.pellets = null;
    this.pel = [];
    this.bubbles = [];
    this._i = { puff: 0, star: 0, word: 0 };
    this._tmp = new THREE.Vector3();
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0);
    this._col = new THREE.Color();
  }

  build(group) {
    this.group = group;
    const puffTex = canvasTex(64, 64, (g, w) => {
      const r = g.createRadialGradient(w / 2, w / 2, 2, w / 2, w / 2, w / 2);
      r.addColorStop(0, 'rgba(255,255,255,1)');
      r.addColorStop(0.55, 'rgba(255,255,255,0.85)');
      r.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = r;
      g.fillRect(0, 0, w, w);
    });
    const starTex = canvasTex(64, 64, (g, w) => {
      g.translate(w / 2, w / 2);
      g.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
        const rr = i % 2 ? 11 : 28;
        g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
      }
      g.closePath();
      g.fillStyle = '#fff6b0';
      g.strokeStyle = '#6b4b00';
      g.lineWidth = 3;
      g.fill();
      g.stroke();
    });
    this.puffs = [];
    for (let i = 0; i < 48; i++) {
      const m = new THREE.SpriteMaterial({ map: puffTex, transparent: true, depthWrite: false, opacity: 0 });
      const s = new THREE.Sprite(m);
      s.visible = false;
      s.renderOrder = 5;
      group.add(s);
      this.puffs.push({ s, t: 0, life: 1, v: new THREE.Vector3(), size: 4, grow: 2 });
    }
    this.stars = [];
    for (let i = 0; i < 24; i++) {
      const m = new THREE.SpriteMaterial({ map: starTex, transparent: true, depthWrite: false, opacity: 0 });
      const s = new THREE.Sprite(m);
      s.visible = false;
      s.renderOrder = 6;
      group.add(s);
      this.stars.push({ s, t: 0, life: 1, v: new THREE.Vector3(), size: 3 });
    }
    this.wordTex = {};
    for (const w of WORDS) {
      this.wordTex[w] = canvasTex(256, 128, (g) => {
        g.font = '900 78px "Arial Black", Impact, sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.lineJoin = 'round';
        g.lineWidth = 14;
        g.strokeStyle = '#1b1030';
        g.strokeText(w, 128, 66);
        g.fillStyle = WORD_COLOURS[w] || '#ffffff';
        g.fillText(w, 128, 66);
      });
    }
    this.words = [];
    for (let i = 0; i < 6; i++) {
      const m = new THREE.SpriteMaterial({ map: this.wordTex['POW!'], transparent: true, depthWrite: false, depthTest: false, opacity: 0 });
      const s = new THREE.Sprite(m);
      s.visible = false;
      s.renderOrder = 7;
      group.add(s);
      this.words.push({ s, t: 0, life: 1, base: 10 });
    }
    // Pellets: glowing streaks, one instanced draw call for everybody's.
    // Big enough to see from behind at a few hundred metres: 9 m long, over a metre across, and
    // solid in the shooter's colour — added light (the first try) all but vanished against a bright sky.
    const geo = new THREE.CylinderGeometry(0.6, 0.6, 9, 6, 1, false);
    geo.rotateX(Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    this.pellets = new THREE.InstancedMesh(geo, mat, 192);
    this.pellets.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.pellets.count = 0;
    this.pellets.frustumCulled = false;
    this.pellets.name = 'pvp-pellets';
    const colours = new Float32Array(192 * 3);
    this.pellets.instanceColor = new THREE.InstancedBufferAttribute(colours, 3);
    group.add(this.pellets);
    this.pel = [];
    // Shield bubbles: a see-through ball round whoever has one.
    this.bubbleGeo = new THREE.SphereGeometry(1, 20, 14);
    this.bubbles = [];
  }

  get ready() {
    return !!(this.group && this.group.parent);
  }

  puff(pos, colour = '#ffffff', { n = 8, size = 5, spread = 6, life = 1.1, up = 2 } = {}) {
    if (!this.ready) return;
    for (let k = 0; k < n; k++) {
      const p = this.puffs[this._i.puff++ % this.puffs.length];
      p.s.position.set(pos.x + (Math.random() - 0.5) * spread * 0.4, pos.y + (Math.random() - 0.5) * spread * 0.4, pos.z + (Math.random() - 0.5) * spread * 0.4);
      p.v.set((Math.random() - 0.5) * spread, (Math.random() - 0.2) * spread * 0.6 + up, (Math.random() - 0.5) * spread);
      p.t = 0;
      p.life = life * (0.75 + Math.random() * 0.5);
      p.size = size * (0.7 + Math.random() * 0.6);
      p.grow = size * 1.4;
      p.s.material.color.set(colour);
      p.s.visible = true;
    }
  }

  starBurst(pos, n = 6, speed = 9) {
    if (!this.ready) return;
    for (let k = 0; k < n; k++) {
      const p = this.stars[this._i.star++ % this.stars.length];
      const a = (k / n) * Math.PI * 2 + Math.random() * 0.5;
      p.s.position.set(pos.x, pos.y, pos.z);
      p.v.set(Math.cos(a) * speed, 3 + Math.random() * 5, Math.sin(a) * speed);
      p.t = 0;
      p.life = 1.2 + Math.random() * 0.5;
      p.size = 2.2 + Math.random() * 1.6;
      p.s.visible = true;
    }
  }

  /** A comic word over a place, kept about the same size on screen whatever the distance. */
  word(text, pos, camera, big = 1) {
    if (!this.ready || !this.wordTex[text]) return;
    const w = this.words[this._i.word++ % this.words.length];
    w.s.material.map = this.wordTex[text];
    w.s.material.needsUpdate = true;
    w.s.position.set(pos.x, pos.y + 6, pos.z);
    const d = camera ? camera.position.distanceTo(w.s.position) : 60;
    w.base = Math.max(8, d * 0.11) * big;
    w.t = 0;
    w.life = 1.1;
    w.s.visible = true;
  }

  /** A pellet: from, velocity (m/s), colour, life (s), and whether it is this player's own (only those are hit-tested). */
  pellet(from, vel, colour, life, mine, owner) {
    if (!this.ready) return null;
    if (this.pel.length >= 190) this.pel.shift();
    const p = { pos: new THREE.Vector3().copy(from), prev: new THREE.Vector3().copy(from), vel: new THREE.Vector3().copy(vel), col: new THREE.Color(colour), t: 0, life, mine, owner, dead: false };
    this.pel.push(p);
    return p;
  }

  /** A shield bubble's place each frame: id → { pos, r } or nothing. */
  bubblesAt(list) {
    if (!this.ready) return;
    while (this.bubbles.length < list.length) {
      const m = new THREE.Mesh(this.bubbleGeo, new THREE.MeshBasicMaterial({ color: 0x8ee6ff, transparent: true, opacity: 0.16, depthWrite: false, toneMapped: false }));
      m.renderOrder = 4;
      this.group.add(m);
      this.bubbles.push(m);
    }
    const pulse = 0.12 + 0.06 * Math.sin((typeof performance !== 'undefined' ? performance.now() : 0) / 140);
    for (let i = 0; i < this.bubbles.length; i++) {
      const b = this.bubbles[i];
      const it = list[i];
      if (!it) {
        b.visible = false;
        continue;
      }
      b.visible = true;
      b.position.set(it.pos.x, it.pos.y, it.pos.z);
      b.scale.setScalar(it.r);
      b.material.opacity = pulse;
    }
  }

  update(dt, camera) {
    if (!this.ready) return;
    for (const p of this.puffs) {
      if (!p.s.visible) continue;
      p.t += dt;
      const k = p.t / p.life;
      if (k >= 1) {
        p.s.visible = false;
        continue;
      }
      p.s.position.addScaledVector(p.v, dt);
      p.v.multiplyScalar(1 - Math.min(1, dt * 2.2));
      p.s.scale.setScalar(p.size + p.grow * k);
      p.s.material.opacity = 0.9 * (1 - k * k);
    }
    for (const p of this.stars) {
      if (!p.s.visible) continue;
      p.t += dt;
      const k = p.t / p.life;
      if (k >= 1) {
        p.s.visible = false;
        continue;
      }
      p.s.position.addScaledVector(p.v, dt);
      p.v.y -= 9 * dt;
      p.s.scale.setScalar(p.size);
      p.s.material.rotation += dt * 6;
      p.s.material.opacity = k < 0.7 ? 1 : (1 - k) / 0.3;
    }
    for (const w of this.words) {
      if (!w.s.visible) continue;
      w.t += dt;
      const k = w.t / w.life;
      if (k >= 1) {
        w.s.visible = false;
        continue;
      }
      // Pops in big, settles, floats up and fades.
      const pop = k < 0.15 ? 0.6 + (k / 0.15) * 0.6 : 1.2 - Math.min(0.2, (k - 0.15) * 0.6);
      w.s.scale.set(w.base * 2 * pop, w.base * pop, 1);
      w.s.position.y += dt * w.base * 0.4;
      w.s.material.opacity = k < 0.7 ? 1 : (1 - k) / 0.3;
    }
    // Pellets.
    const im = this.pellets;
    let n = 0;
    const out = [];
    for (const p of this.pel) {
      if (p.dead) continue;
      p.t += dt;
      if (p.t >= p.life) {
        p.dead = true;
        continue;
      }
      p.prev.copy(p.pos);
      p.pos.addScaledVector(p.vel, dt);
      if (n < 192) {
        this._q.setFromUnitVectors(this._s.set(0, 0, 1), this._tmp.copy(p.vel).normalize());
        this._m.compose(p.pos, this._q, this._s.set(1, 1, 1));
        im.setMatrixAt(n, this._m);
        im.setColorAt(n, p.col);
        n++;
      }
      out.push(p);
    }
    this.pel = out;
    im.count = n;
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
  }

  clear() {
    for (const p of this.puffs) p.s.visible = false;
    for (const p of this.stars) p.s.visible = false;
    for (const w of this.words) w.s.visible = false;
    for (const b of this.bubbles) b.visible = false;
    this.pel = [];
    if (this.pellets) this.pellets.count = 0;
  }
}

/** One set of effects for all four features. */
export const toon = new Toon();

/* ---- the screen ---------------------------------------------------------------- */

const STYLE_ID = 'ifs-mpplay-style';
const CSS = `
.mpp-chip { display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; }
/* A compact row on a laptop — the badge stays small by the minimap; a finger-sized one on a touch screen (ui.js). */
.mp-hud button.mpp-chip { padding: 3px 9px; font-size: 12px; }
.is-touch-device .mp-hud button.mpp-chip { padding: 8px 12px; font-size: 13.5px; }
.mp-hud .mpp-chip.is-hot { background: rgba(255, 122, 89, 0.28); border-color: rgba(255, 122, 89, 0.8); }
.mp-hud .mpp-chip.is-armed { background: rgba(255, 210, 63, 0.22); border-color: rgba(255, 210, 63, 0.7); }
.mpp-hearts { color: #ff6b8b; letter-spacing: 1px; font-size: 12px; }
.mpp-hearts s { color: rgba(255, 255, 255, 0.28); text-decoration: none; }
.mpp-menu { position: absolute; right: 0; z-index: 3; display: flex; flex-direction: column; gap: 4px; min-width: 220px; max-width: 280px;
  padding: 8px; border-radius: 12px; background: rgba(10, 17, 30, 0.94); border: 1px solid var(--panel-line); box-shadow: var(--shadow); pointer-events: auto; }
.mpp-menu[hidden] { display: none !important; }
.mpp-menu.is-up { bottom: calc(100% + 8px); }
.mpp-menu.is-down { top: calc(100% + 8px); }
.mp-hud .mpp-menu button { text-align: left; display: grid; grid-template-columns: 22px minmax(0, 1fr); gap: 1px 8px; align-items: center; padding: 6px 8px; }
.mpp-menu button b { font-weight: 650; }
.mpp-menu button small { grid-column: 2; color: var(--text-dim); font-size: 11px; line-height: 1.25; white-space: normal; }
.mpp-menu h5 { margin: 0 2px 4px; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--accent); }
.mpp-menu p { margin: 2px 4px 0; font-size: 11px; color: var(--text-dim); }
.mpp-board { width: 100%; display: flex; flex-direction: column; gap: 2px; font-size: 12px; padding-top: 4px; border-top: 1px solid var(--panel-line); }
.mpp-board[hidden] { display: none; }
.mpp-board .mpp-row { display: grid; grid-template-columns: 10px minmax(0, 1fr) auto auto; gap: 6px; align-items: center; }
.mpp-board .mpp-row.is-me b { color: var(--accent); }
.mpp-board .mpp-row.is-down { opacity: 0.5; }
.mpp-board i { width: 9px; height: 9px; border-radius: 50%; display: block; }
.mpp-board b { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mpp-board em { font-style: normal; font-weight: 700; font-variant-numeric: tabular-nums; }
.mpp-board h6 { margin: 0; font-size: 10.5px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-dim); display: flex; justify-content: space-between; }
.mpp-card { position: fixed; left: 50%; top: 24%; transform: translate(-50%, -50%) scale(0.9); z-index: 31; pointer-events: none; text-align: center;
  font-family: "Arial Black", Impact, var(--font), sans-serif; opacity: 0; transition: opacity 0.18s, transform 0.18s; }
.mpp-card.is-on { opacity: 1; transform: translate(-50%, -50%) scale(1); }
.mpp-card strong { display: block; font-size: clamp(30px, 6.5vw, 64px); line-height: 1; color: #ffd23f; letter-spacing: 0.02em;
  -webkit-text-stroke: 2px #1b1030; text-shadow: 0 4px 0 #1b1030, 0 8px 22px rgba(0,0,0,0.45); }
.mpp-card span { display: inline-block; margin-top: 8px; font-family: var(--font), sans-serif; font-weight: 700; font-size: clamp(14px, 2.2vw, 20px);
  color: #fff; background: rgba(10, 17, 30, 0.72); padding: 5px 12px; border-radius: 999px; }
.mpp-feed { position: fixed; left: 16px; top: 38%; z-index: 30; pointer-events: none; display: flex; flex-direction: column; gap: 4px; max-width: min(320px, 60vw); }
.mpp-feed div { font: 600 12.5px var(--font), sans-serif; color: #fff; background: rgba(10, 17, 30, 0.7); padding: 4px 9px; border-radius: 9px;
  transition: opacity 0.5s; display: flex; align-items: center; gap: 6px; }
.mpp-feed div i { width: 8px; height: 8px; border-radius: 50%; display: inline-block; flex: none; }
.mpp-feed div.is-old { opacity: 0; }
`;

export function injectStyle() {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const st = document.createElement('style');
  st.id = STYLE_ID;
  st.textContent = CSS;
  document.head.appendChild(st);
}

/** The chip row on the multiplayer badge, or null outside a game. */
export function chipRow() {
  const hud = multiplayer.hud;
  return hud && hud.ext ? hud.ext : null;
}

/** A button on the badge's chip row, made once; `order` keeps PvP, Summon and Race in that order. */
export function chip(id, order, onClick) {
  const row = chipRow();
  if (!row) return null;
  let b = row.querySelector(`[data-mpp-chip="${id}"]`);
  if (!b) {
    injectStyle();
    b = document.createElement('button');
    b.type = 'button';
    b.className = 'mpp-chip';
    b.dataset.mppChip = id;
    b.style.order = String(order);
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      onClick(e);
    });
    row.appendChild(b);
  }
  if (row.hidden) row.hidden = false;
  return b;
}

let card = null;
let cardTimer = null;
/** The big comic card in the middle of the screen: a word and a line under it. */
export function bigCard(word, line = '', secs = 1.8) {
  if (typeof document === 'undefined') return;
  injectStyle();
  if (!card) {
    card = document.createElement('div');
    card.className = 'mpp-card';
    card.setAttribute('role', 'status');
    card.setAttribute('aria-live', 'polite');
    card.innerHTML = '<strong></strong><span></span>';
    extLayer().appendChild(card);
  }
  card.querySelector('strong').textContent = word;
  const sp = card.querySelector('span');
  sp.textContent = line;
  sp.hidden = !line;
  card.classList.add('is-on');
  clearTimeout(cardTimer);
  cardTimer = setTimeout(() => card && card.classList.remove('is-on'), secs * 1000);
}
export function bigCardText() {
  return card && card.classList.contains('is-on') ? card.textContent : '';
}

let feedEl = null;
/** A line in the corner feed — "Swift Falcon tagged Brave Otter" — for four seconds. */
export function feed(html, colour = null) {
  if (typeof document === 'undefined') return;
  injectStyle();
  if (!feedEl) {
    feedEl = document.createElement('div');
    feedEl.className = 'mpp-feed';
    feedEl.setAttribute('aria-live', 'polite');
    extLayer().appendChild(feedEl);
  }
  const d = document.createElement('div');
  d.innerHTML = `${colour ? `<i style="background:${esc(colour)}"></i>` : ''}<span>${html}</span>`;
  feedEl.appendChild(d);
  while (feedEl.children.length > 4) feedEl.firstChild.remove();
  setTimeout(() => d.classList.add('is-old'), 4000);
  setTimeout(() => d.remove(), 4600);
}
export function feedLines() {
  return feedEl ? [...feedEl.children].map((d) => d.textContent) : [];
}

/* ---- one extension carries the effects for all four ----------------------------- */

registerExtension({
  id: 'mpplay-fx',
  buildWorld(sim, group) {
    toon.build(group);
  },
  update(sim, dt) {
    toon.update(dt, sim.camera);
    // Hidden with the rest of the interface (U), for a clean screenshot.
    const hide = !!(sim.hud && sim.hud.hidden);
    if (feedEl && feedEl.hidden !== hide) feedEl.hidden = hide;
    if (card && card.hidden !== hide) card.hidden = hide;
  },
  stop(sim, why) {
    if (why !== 'airport') toon.clear();
  },
});
