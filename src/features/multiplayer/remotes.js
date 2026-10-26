/**
 * The other players, drawn.
 *
 * Each remote player is the game's own model for whatever they are flying or
 * driving — createAircraftModel for an aeroplane or the helicopter, exactly as
 * main.js builds the player's own, and createBoat / createCar for the other
 * two — painted in their colour, with a name tag that stays readable at any
 * distance and shows how far away they are.
 *
 * Nothing here registers an obstacle, a platform or a contact. Bumping into
 * a friend (list 2, part 2) is ../../bump.js: each game pushes only its own
 * ride off where it draws the others, under the game's bumping rule, and
 * never on the ground, at spawn or when two start inside each other.
 *
 * Out on foot (PROTO 4), a player is their aeroplane where they left it AND
 * their pilot walking about (./walkers.js): the tag and the minimap dot go
 * with the pilot, and the pilot can be knocked down (knock()).
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
import { findLivery, schemeFor } from '../../aircraft/liveries.js';
import { createBoat, createCar, updateVehicleModel } from '../../vehicles/models.js';
import { VEHICLES } from '../../vehicles/surface.js';
import { Track, Smoother, RotSmoother, LEAD_K } from './interp.js';
import { QUICK_CHAT } from './protocol.js';
import { RemoteWalker } from './walkers.js';

const tmpV = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);
/** How long a friend's wreck stays where they came down after their last crashed snapshot (scuffs #13). */
export const WRECK_MS = 8000;

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
/*
 * Scuffs #9: painting the whole hull and deck made a friend's Kestrel Launch
 * a plain green boat with railings, nothing like the white-and-orange launch
 * they were driving — and the van a one-colour van. The boat and the van
 * keep their own paint now, and the player's colour goes on their stripe
 * (the launch's navy band, the van's blue one), which is where a livery's
 * own colour is. A model without such a stripe (another pack) is tinted the
 * old way, so a player is still told apart by their colour.
 */
const STRIPE_MAT = /^(paint_navy|paint_blue|stripe|accent)/i;

function tintStripe(model, colour) {
  const clones = new Map();
  const tint = new THREE.Color(colour);
  model.traverse((o) => {
    if (!o.isMesh || Array.isArray(o.material) || !o.material || !o.material.color) return;
    const m = o.material;
    if (!STRIPE_MAT.test(m.name || '')) return;
    if (!clones.has(m)) {
      const c = m.clone();
      c.color.copy(tint);
      clones.set(m, c);
    }
    o.material = clones.get(m);
  });
  if (!clones.size) return false;
  model.userData.mpTinted = [...clones.values()];
  return true;
}

function tintVehicle(model, colour) {
  if (tintStripe(model, colour)) return;
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

/*
 * List 2: "the nametags are weird". Looked at with eight in a lobby at
 * 1366x768 and 1024x768: every tag was the same size at every distance, so
 * the friends two and five kilometres off — a few pixels of aeroplane —
 * wore labels as big as the one ten metres away and piled into one
 * unreadable heap on the horizon, half of it under the badge and the "joined"
 * toasts. So now:
 *
 *   - one line, "● Swift Falcon  230 m", in a pill; the distance only past
 *     150 m, where it helps you find them;
 *   - the pill is about 3 % of the screen's height up close and shrinks to
 *     2 % by a kilometre and a half — readable, never a banner;
 *   - no two tags overlap: nearest first, a tag that would land on another
 *     steps up above it (twice at most), and one that still does not fit
 *     becomes a small dot in the player's colour — they are still there,
 *     and on the minimap;
 *   - v56, "increase range": a tag is shown out to the far edge of the view
 *     (it stopped at 8 km, past which a friend was an unnamed dot), and
 *     neither tags nor dots are hazed by the fog — at 10 km on a cloudy day
 *     the fog had washed a third of the colour out of them, on a rainy one
 *     nearly all. Far off, the aeroplane itself is a one-draw-call stand-in
 *     (impostor(), below) and then the dot under its tag.
 *   - a chat bubble sits over its own pill, and a player talking goes first.
 *
 * Part 3b: whoever hosts the game — a lobby's owner — has a small gold crown
 * on top of their pill (moved to the pill's corner while a chat bubble is
 * up), and an admin an ADMIN badge in it, after the name — the owner, in
 * their hour (owner.js), a gold OWNER badge instead. The crown is about
 * two-thirds of the pill's height, so it reads as a crown as far off as the
 * name does, and it follows the host when the lobby re-forms (the roster).
 */
const TAG_W = 384;
const TAG_H = 96;
const PILL_Y = 50;
const PILL_H = 40;
const BUBBLE_H = 40;
/** How tall the pill is on screen, as a fraction of the viewport's height: close to, and from FAR_M on. */
const PILL_NEAR = 0.03;
const PILL_FAR = 0.02;
const NEAR_M = 60;
const FAR_M = 1500;
/** As far as the camera sees (main.js: a 60 km far plane): the whole of any island. */
const TAG_MAX_M = 60000;
const PIP_FRAC = 0.012;
export const TAG_LAYOUT = { TAG_W, TAG_H, PILL_Y, PILL_H, BUBBLE_H, PILL_NEAR, PILL_FAR, NEAR_M, FAR_M, TAG_MAX_M };

function spriteOf(canvas, name) {
  const tex = new THREE.CanvasTexture(canvas);
  if ('colorSpace' in tex) tex.colorSpace = THREE.SRGBColorSpace;
  // fog: false — a label, not a thing in the world; the haze took the far ones away.
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, sizeAttenuation: false, fog: false });
  const sprite = new THREE.Sprite(mat);
  sprite.renderOrder = 998;
  sprite.frustumCulled = false;
  sprite.name = name;
  return { sprite, tex };
}

function makeTag() {
  const canvas = document.createElement('canvas');
  canvas.width = TAG_W;
  canvas.height = TAG_H;
  const { sprite, tex } = spriteOf(canvas, 'mp-tag');
  sprite.center.set(0.5, 0);
  // Sized every frame (Remotes.update): a fraction of the screen, smaller with distance.
  sprite.scale.set(0.1 * (TAG_W / TAG_H), 0.1, 1);
  const pc = document.createElement('canvas');
  pc.width = pc.height = 32;
  const pip = spriteOf(pc, 'mp-pip');
  pip.sprite.center.set(0.5, 0.5);
  // Under the tags: a dot that lands behind somebody's pill is covered by it, not printed on their name.
  pip.sprite.renderOrder = 997;
  pip.sprite.visible = false;
  return { sprite, canvas, tex, key: '', pillW: TAG_W, chat: false, pip: pip.sprite, pipCanvas: pc, pipTex: pip.tex, pipKey: '' };
}

function disposeTag(tag) {
  if (!tag) return;
  for (const sp of [tag.sprite, tag.pip]) {
    if (!sp) continue;
    sp.removeFromParent();
    if (sp.material.map) sp.material.map.dispose();
    sp.material.dispose();
  }
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

/** A small gold crown, its base on `baseY`, centred on `cx`, `w` wide. */
function drawCrown(g, cx, baseY, w) {
  const h = w * 0.72;
  const x0 = cx - w / 2;
  const top = baseY - h;
  g.beginPath();
  g.moveTo(x0, baseY);
  g.lineTo(x0 + w, baseY);
  g.lineTo(x0 + w, top + h * 0.22);
  g.lineTo(x0 + w * 0.74, top + h * 0.55);
  g.lineTo(cx, top);
  g.lineTo(x0 + w * 0.26, top + h * 0.55);
  g.lineTo(x0, top + h * 0.22);
  g.closePath();
  g.lineJoin = 'round';
  g.lineWidth = 4;
  g.strokeStyle = 'rgba(8, 13, 22, 0.9)';
  g.stroke();
  g.fillStyle = '#ffd23f';
  g.fill();
  // A band and three jewels, so it is a crown and not a zigzag.
  g.fillStyle = '#e0a800';
  g.fillRect(x0 + 2, baseY - h * 0.2, w - 4, h * 0.2 - 1);
  g.fillStyle = '#ff5a4f';
  for (const fx of [0.2, 0.5, 0.8]) {
    g.beginPath();
    g.arc(x0 + w * fx, baseY - h * 0.1, Math.max(1.5, w * 0.05), 0, Math.PI * 2);
    g.fill();
  }
}

export const TAG_CROWN_W = 40;

function drawTag(tag, name, colour, dist, chat, host = false, admin = false, owner = false) {
  const key = `${name}|${colour}|${dist}|${chat || ''}|${host ? 'h' : ''}${owner ? 'o' : admin ? 'a' : ''}`;
  if (tag.key === key) return;
  tag.key = key;
  tag.chat = !!chat;
  const g = tag.canvas.getContext('2d');
  if (!g || typeof g.fillText !== 'function') return;
  g.clearRect(0, 0, TAG_W, TAG_H);
  const font = '"Helvetica Neue", Arial, sans-serif';
  g.textBaseline = 'middle';
  // Chat bubble on top, when there is one.
  if (chat) {
    g.font = `700 25px ${font}`;
    const w = Math.min(TAG_W - 8, g.measureText(chat).width + 28);
    g.fillStyle = 'rgba(255,255,255,0.95)';
    roundRect(g, (TAG_W - w) / 2, 4, w, BUBBLE_H - 4, 16);
    g.fill();
    g.fillStyle = '#0b1220';
    g.textAlign = 'center';
    g.fillText(chat, TAG_W / 2, 4 + (BUBBLE_H - 4) / 2 + 1, TAG_W - 30);
  }
  // The pill: a dot in their colour, the name, and how far.
  g.font = `700 26px ${font}`;
  const nameW = g.measureText(name).width;
  g.font = `600 20px ${font}`;
  const distW = dist ? g.measureText(dist).width + 12 : 0;
  g.font = `800 16px ${font}`;
  // The owner's badge says OWNER, in gold; an admin's says ADMIN, in red. Never both: the owner has every admin power.
  const word = owner ? 'OWNER' : admin ? 'ADMIN' : '';
  const adminW = word ? g.measureText(word).width + 14 + 10 : 0;
  const nw = Math.min(TAG_W - 4, 12 + 16 + 8 + nameW + adminW + distW + 14);
  tag.pillW = nw;
  const x0 = (TAG_W - nw) / 2;
  const y = PILL_Y;
  g.fillStyle = 'rgba(8, 13, 22, 0.74)';
  roundRect(g, x0, y, nw, PILL_H, PILL_H / 2);
  g.fill();
  g.fillStyle = colour;
  g.beginPath();
  g.arc(x0 + 12 + 8, y + PILL_H / 2, 8, 0, Math.PI * 2);
  g.fill();
  g.textAlign = 'left';
  g.font = `700 26px ${font}`;
  g.fillStyle = '#ffffff';
  const tx = x0 + 12 + 16 + 8;
  const room = nw - (tx - x0) - distW - adminW - 10;
  g.fillText(name, tx, y + PILL_H / 2 + 1, room);
  let after = tx + Math.min(nameW, room);
  if (word) {
    // ADMIN (or OWNER), in a badge of its own: an admin is always seen to be one, and so is the owner.
    const bw = adminW - 10;
    g.fillStyle = owner ? '#ffd23f' : '#ff5a4f';
    roundRect(g, after + 10, y + 8, bw, PILL_H - 16, 6);
    g.fill();
    g.fillStyle = owner ? '#3a2a00' : '#ffffff';
    g.font = `800 16px ${font}`;
    g.fillText(word, after + 10 + 7, y + PILL_H / 2 + 1);
    after += adminW;
  }
  if (dist) {
    g.font = `600 20px ${font}`;
    g.fillStyle = 'rgba(200, 216, 236, 0.9)';
    g.fillText(dist, after + 12, y + PILL_H / 2 + 1);
  }
  if (host) {
    // The crown: on top of the pill, in the middle; at its corner while a chat bubble has the middle.
    if (chat) drawCrown(g, x0 + 20, y + 3, TAG_CROWN_W * 0.8);
    else drawCrown(g, TAG_W / 2, y + 3, TAG_CROWN_W);
  }
  tag.host = !!host;
  tag.admin = !!admin;
  tag.owner = !!owner;
  tag.tex.needsUpdate = true;
}

/** One tag's canvas, painted as it is over an aeroplane — for the tests and a look at the crown. */
export function paintTag(name, colour, { dist = '', chat = null, host = false, admin = false, owner = false } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = TAG_W;
  canvas.height = TAG_H;
  const tag = { canvas, tex: {}, key: '', pillW: TAG_W, chat: false };
  drawTag(tag, name, colour, dist, chat, host, admin, owner);
  return { canvas, pillW: tag.pillW, key: tag.key };
}

function drawPip(tag, colour) {
  if (tag.pipKey === colour) return;
  tag.pipKey = colour;
  const g = tag.pipCanvas.getContext('2d');
  if (!g || typeof g.arc !== 'function') return;
  g.clearRect(0, 0, 32, 32);
  g.fillStyle = 'rgba(8, 13, 22, 0.85)';
  g.beginPath();
  g.arc(16, 16, 14, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = colour;
  g.beginPath();
  g.arc(16, 16, 10, 0, Math.PI * 2);
  g.fill();
  tag.pipTex.needsUpdate = true;
}

function fmtDist(m) {
  if (m < 150) return '';
  if (m < 1000) return `${Math.round(m / 10) * 10} m`;
  return `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`;
}

/** The pill's height on screen, as a fraction of the viewport, at distance d: 3 % close to, 2 % from 1.5 km, between on a log scale. */
export function pillFraction(d) {
  if (!(d > NEAR_M)) return PILL_NEAR;
  if (d >= FAR_M) return PILL_FAR;
  const k = Math.log(d / NEAR_M) / Math.log(FAR_M / NEAR_M);
  return PILL_NEAR + (PILL_FAR - PILL_NEAR) * k;
}

const tmpP = new THREE.Vector3();

/* ------------------------------------------------------------------ */
/* Far off: a stand-in                                                  */
/* ------------------------------------------------------------------ */

/*
 * A friend's aeroplane a few pixels across is still the whole model — about
 * 29 draw calls (tests/features/multiplayer-list2.browser.js) for a speck.
 * So once the model would be under STANDIN_PX across, it is swapped for one
 * mesh: a fuselage, a wing, a tailplane and a fin in their colour, 64
 * triangles in one draw call, turned and sized as the real one is. Under
 * PIP_PX it is the dot under their tag instead, out to the edge of the view.
 */
const STANDIN_PX = 6;
const PIP_PX = 2.5;
/** Always the real model this close, whatever the screen. */
const MODEL_ALWAYS_M = 600;

let standinGeo = null;
/** One geometry for every stand-in: unit-sized (span 1.8), nose to −Z, made of four boxes merged into one. */
function standinGeometry() {
  if (standinGeo) return standinGeo;
  const parts = [
    [0.2, 0.2, 1.7, 0, 0, 0],        // fuselage
    [1.8, 0.05, 0.36, 0, 0.02, -0.08], // wing
    [0.72, 0.04, 0.22, 0, 0.04, 0.72], // tailplane
    [0.04, 0.32, 0.26, 0, 0.2, 0.72],  // fin
  ];
  const pos = [];
  const nor = [];
  for (const [w, h, d, x, y, z] of parts) {
    const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
    g.translate(x, y, z);
    pos.push(...g.attributes.position.array);
    nor.push(...g.attributes.normal.array);
    g.dispose();
  }
  standinGeo = new THREE.BufferGeometry();
  standinGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  standinGeo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  standinGeo.computeBoundingSphere();
  return standinGeo;
}

/* ------------------------------------------------------------------ */

export class Remotes {
  constructor() {
    this.players = new Map();
    /**
     * Each player's chosen paint, by player id: a livery id they sent (features/mpskin.js, 'skin:paint').
     * Absent means they sent none (an older copy of the game, or not yet), and the remote is drawn in
     * their player colour as it always was.
     */
    this.paints = new Map();
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
    /*
     * 'predict' (now) or 'sample' (the older 100-350 ms in the past), for
     * the lobby playtest to measure both on the same real tabs. The game
     * never changes it.
     */
    this.drawMode = 'predict';
    /*
     * List 2, part 2, set by other features: hidden(id) is true while a
     * player is not to be drawn at all — tagged out in PvP, between the puff
     * and coming back (../../pvp.js); note(id) is a few characters for their
     * tag, before the distance — their hearts, in PvP.
     */
    this.hidden = null;
    this.note = null;
    /*
     * Scuffs #9 and #10 (../mplook.js): away(id) is true while a player is
     * paused or in another tab ("⏸ away" on their tag); liveryOf(id) is the
     * hangar livery they picked, or null.
     */
    this.away = null;
    this.liveryOf = null;
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
      // The stand-in was in the world's group too, and went with it.
      p.lod = null;
      if (p.tag) {
        disposeTag(p.tag);
        p.tag = null;
      }
      if (p.walker) p.walker.forget(!!(p.walker.model && this.own && p.walker.model.parent === this.own));
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

  add(id, { name, colour, host = false, admin = false, owner = false }) {
    let p = this.players.get(id);
    if (!p) {
      // Every seam slid over (ignoreM): a 25 cm step passed straight through was a twitch at fifteen a second, close to.
      p = { id, name, colour, track: new Track(), smooth: new Smoother({ snapSecs: 0.6, noBack: true, ignoreM: 0.02 }), rot: new RotSmoother(), drawn: null, quat: null, model: null, modelKey: '', tag: null, chat: null, chatUntil: 0, sample: null, dist: 0, visible: false, host: false, admin: false, owner: false, walker: new RemoteWalker() };
      this.players.set(id, p);
    }
    p.name = name;
    // Part 3b: the crown (whoever hosts right now) and the ADMIN badge, redrawn on the tag's next paint.
    p.host = !!host;
    p.admin = !!admin;
    p.owner = !!owner;
    if (p.colour !== colour) {
      p.colour = colour;
      this._release(p);
      if (p.lod) p.lod.material = this._lodMat(colour);
    }
    return p;
  }

  /** The stand-in's paint: one material per colour, shared. */
  _lodMat(colour) {
    const mats = this._lodMats || (this._lodMats = new Map());
    let m = mats.get(colour);
    if (!m) {
      /*
       * Unlit, flat: under six pixels nobody sees shading. And a kind of
       * material the game already draws with everywhere, so its shader is
       * already built. The first version was lit (Lambert, which hardly
       * anything else uses): its shader was compiled — with every light on
       * the island in it — the first time a friend shrank to a stand-in, and
       * in the Wi-Fi playtest that one frame took 22-24 SECONDS on a busy Mac.
       */
      m = new THREE.MeshBasicMaterial({ color: new THREE.Color(colour).multiplyScalar(0.8) });
      mats.set(colour, m);
    }
    return m;
  }

  /** Their far-off stand-in (see standinGeometry), in the group the models are in. */
  _standin(p, root) {
    if (!p.lod) {
      p.lod = new THREE.Mesh(standinGeometry(), this._lodMat(p.colour));
      p.lod.name = `mp-standin-${p.id}`;
      p.lod.matrixAutoUpdate = true;
    }
    if (root && p.lod.parent !== root) root.add(p.lod);
    return p.lod;
  }

  /**
   * Their paint arrived: the livery id they fly in. A change redraws them (their model is rebuilt on the
   * next frame, in the new paint), and the same one again costs nothing.
   */
  setPaint(id, livery) {
    const want = typeof livery === 'string' ? livery : '';
    if ((this.paints.get(id) || '') === want) return false;
    if (want) this.paints.set(id, want);
    else this.paints.delete(id);
    const p = this.players.get(id);
    if (p) this._release(p);
    return true;
  }

  remove(id) {
    this.paints.delete(id);
    const p = this.players.get(id);
    if (!p) return;
    this._release(p);
    if (p.tag) disposeTag(p.tag);
    p.tag = null;
    if (p.lod) p.lod.removeFromParent();
    p.lod = null;
    if (p.walker) p.walker.forget(true);
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
    // Numbered afresh: a paint heard for the old number is nobody's. Everyone sends theirs again within seconds (mpskin.js).
    this.paints.clear();
  }

  clear() {
    for (const id of [...this.players.keys()]) this.remove(id);
    this.paints.clear();
    for (const m of this.pool.values()) disposeModel(m);
    this.pool.clear();
    if (this._lodMats) for (const m of this._lodMats.values()) m.dispose();
    this._lodMats = null;
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

  /** How long the fastest trip from their game to this one takes, ms (multiplayer.js, from the host's pings). */
  setLatency(id, ms) {
    const p = this.players.get(id);
    if (p) p.track.setLatency(ms * LEAD_K);
  }

  /** Their game says their pilot was knocked down (../pilot-mp.js 'pilot:down'): the same fall, here. */
  knock(id, d) {
    const p = this.players.get(id);
    return !!(p && p.walker && p.walker.knock(d));
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

  /**
   * The scheme a remote aeroplane is painted in. In the paint its pilot chose (a named livery, once their
   * game has said so — mpskin's 'skin:paint' event or mplook's shared looks) with their player colour as
   * its accent (scuffs #9); with the factory colours picked or nothing heard, in their player colour — the
   * eight a ten-year-old can tell apart across a sky. The colour is still on their name tag and the map dot.
   */
  _schemeFor(colour, paint) {
    const l = paint ? findLivery(paint) : null;
    return l && !l.house && l.id === paint ? { ...l, accent: colour } : schemeIn(colour);
  }

  _build(kind, type, colour, paint = '') {
    if (kind === 'boat' || kind === 'car') {
      const m = kind === 'boat' ? createBoat() : createCar();
      tintVehicle(m, colour);
      m.userData.mpKind = kind;
      return m;
    }
    const t = getAircraft(type);
    // A type with a paint of its own (Marine One, aircraft/extra/helis.js `fixedLivery`) wears it on
    // every screen, not its pilot's general paint pick or their player colour.
    const livery = t && t.fixedLivery ? schemeFor(t, paint) : this._schemeFor(colour, paint);
    const model = createAircraftModel({ type: t, livery });
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
    // The paint they fly in: the 'skin:paint' event (mpskin.js) first, else the host's shared looks (mplook.js).
    let paint = kind === 'air' ? this.paints.get(p.id) || '' : '';
    if (!paint && kind === 'air') {
      try {
        const l = this.liveryOf && this.liveryOf(p.id);
        if (l && l !== 'house') paint = l;
      } catch (e) {
        paint = '';
      }
    }
    const key = `${kind}:${type}:${p.colour}:${paint}`;
    if (p.model && p.modelKey === key && p.model.parent) return p.model;
    this._release(p);
    const root = this._root(sim);
    if (!root) return null;
    let model = this.pool.get(key);
    if (model) this.pool.delete(key);
    else {
      try {
        model = this._build(kind, type, p.colour, paint);
      } catch (err) {
        console.warn('[mp] could not build a model for', type, err);
        return null;
      }
    }
    model.name = `mp-player-${p.id}`;
    if (model.userData.mpTop === undefined) model.userData.mpTop = topOf(model);
    if (model.userData.mpRadius === undefined) model.userData.mpRadius = radiusOf(model);
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
    /*
     * When anything last came in for anybody else: a friend gone quiet while
     * the others keep arriving has hitched, and is coasted to a stop; everybody
     * quiet at once is this player's own Wi-Fi, and they fly on (interp.js).
     */
    // Pixels a metre covers at a metre away (half the viewport's height × the projection's y scale): sizes on screen.
    const cam = sim && sim.camera;
    const vh = (typeof window !== 'undefined' && window.innerHeight) || 720;
    const pxPerM = ((cam && cam.projectionMatrix ? cam.projectionMatrix.elements[5] : 0) || 1.48) * (vh / 2);
    /*
     * The smoothers run on the wall clock, not the game's dt. After a long
     * frame of this player's own (a hitch, a garbage collection) the game's dt
     * is capped (main.js, 0.25 s) but the friends flew on for all of it, and
     * the guess says so; with the capped dt the smoothers took the rest of
     * the way as a seam — every friend held back a few metres, then surging
     * to catch up, after every hitch. A second or more is a fresh start
     * (Smoother and RotSmoother reset), as after a pause. Never less than
     * the game's dt: a check that steps the game faster than the clock
     * (sim.update(1 / 30) every 16 ms) moves its friends with the game.
     */
    const wall = this._nowAt != null && now > this._nowAt ? Math.max(dt, (now - this._nowAt) / 1000) : dt;
    this._nowAt = now;
    let first = -Infinity;
    let second = -Infinity;
    for (const p of this.players.values()) {
      const a = p.track.lastArrival;
      if (a > first) {
        second = first;
        first = a;
      } else if (a > second) second = a;
    }
    for (const p of this.players.values()) {
      const others = p.track.lastArrival === first ? second : first;
      // Where they are now, not a tenth of a second ago (interp.js, predict).
      const s = this.drawMode === 'sample' ? p.track.sample(now, p.sample || undefined)
        : p.track.predict(now, p.sample || undefined, Number.isFinite(others) ? others : null);
      if (s) p.sample = s;
      const stale = !s || p.track.stale(now);
      /*
       * Scuffs #13: a friend who crashed was simply gone — the model dropped
       * the moment their game went to its debrief (no more snapshots), and
       * nothing at all was left where they came down. The wreck stays where
       * it stopped for a few seconds now, under a puff of smoke
       * (../mplook.js), and goes when they fly again or the time is up.
       */
      if (s && s.snap && s.snap.crashed) {
        // Kept from the last crashed snapshot: their game shows the crash for a while before its debrief, then goes quiet.
        if (!p.wreck) p.wreck = { since: now, until: now + WRECK_MS };
        else if (!stale) p.wreck.until = now + WRECK_MS;
      } else if (s && s.snap && !stale && p.wreck) p.wreck = null;
      if (stale && p.wreck && now < p.wreck.until && p.model && p.model.parent && p.drawn) {
        p.model.visible = true;
        if (p.lod) p.lod.visible = false;
        if (p.walker) p.walker.hide();
        if (p.tag) p.tag.sprite.visible = p.tag.pip.visible = false;
        p.visible = false;
        p.wrecked = true;
        continue;
      }
      p.wrecked = false;
      if (stale) {
        if (p.model) p.model.visible = false;
        if (p.lod) p.lod.visible = false;
        if (p.walker) p.walker.hide();
        if (p.tag) p.tag.sprite.visible = p.tag.pip.visible = false;
        p.visible = false;
        p.smooth.reset();
        p.rot.reset();
        continue;
      }
      const snap = s.snap;
      // Where to draw them: the guess, with its seams smoothed over (see Smoother and RotSmoother).
      const at = p.smooth.step(s.pos, s.vel, wall);
      const q = p.rot.step(s.quat, this.drawMode === 'sample' ? null : s.omega, wall);
      p.drawn = at;
      p.quat = q;
      const model = this._ensureModel(p, snap, sim);
      if (!model) continue;
      /*
       * A speck is not worth the whole model: seven remote aircraft were
       * measured at 201 draw calls, about 29 each
       * (tests/features/multiplayer-list2.browser.js), which is a lot to
       * spend on a few pixels on a school Chromebook.
       */
      const dm = me ? Math.hypot(at.x - me.x, at.y - me.y, at.z - me.z) : 0;
      const kind = model.userData.mpKind;
      const rad = model.userData.mpRadius || 6;
      /*
       * How many pixels across they are (v56): the real model while it is
       * STANDIN_PX or more — or closer than MODEL_ALWAYS_M — then the
       * one-draw-call stand-in, then the dot. A boat or a car has no
       * stand-in: past the old distance it is the dot and its tag.
       */
      const px = dm > 0 ? (2 * rad * pxPerM) / dm : Infinity;
      if (kind === 'air') model.visible = dm < MODEL_ALWAYS_M || px >= STANDIN_PX;
      else model.visible = dm < Math.max(MODEL_MIN_M, rad * MODEL_PX_K);
      p.visible = true;
      p.far = px < PIP_PX || (kind !== 'air' && !model.visible);
      let gone = false;
      try {
        gone = !!(this.hidden && this.hidden(p.id));
      } catch (e) {
        gone = false;
      }
      if (gone) model.visible = false;
      const standin = kind === 'air' && !gone && !model.visible && px >= PIP_PX * 0.6;
      if (standin) {
        const lod = this._standin(p, this._root(sim));
        lod.visible = true;
        lod.position.set(at.x, at.y, at.z);
        lod.quaternion.set(q.x, q.y, q.z, q.w);
        // Its span about the real one's: the box's half-diagonal is about three-quarters of a span.
        lod.scale.setScalar(rad * 0.74);
      } else if (p.lod) p.lod.visible = false;
      if (!model.visible) {
        // Too far to draw: nothing to pose or animate either.
      } else if (kind === 'air') {
        const ac = this._fakeAc(p);
        ac.pos.set(at.x, at.y, at.z);
        ac.quat.set(q.x, q.y, q.z, q.w);
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
        ac.crashed = !!snap.crashed;
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
        model.quaternion.set(q.x, q.y, q.z, q.w);
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

      // Out on foot: their pilot, walking (or knocked down) beside wherever their ride is.
      let walking = false;
      try {
        walking = !!(p.walker && p.walker.update(p.track, now, dt, this._root(sim), gone || dm > 900));
      } catch (err) {
        walking = false;
      }
      const wk = walking ? p.walker : null;

      // The tag.
      const root = this._root(sim);
      if (!p.tag) {
        p.tag = makeTag();
        p.tagAt = -Infinity;
      }
      if (root && !p.tag.sprite.parent) root.add(p.tag.sprite);
      if (root && !p.tag.pip.parent) root.add(p.tag.pip);
      const tx = wk ? wk.x : at.x;
      const ty = wk ? wk.y : at.y;
      const tz = wk ? wk.z : at.z;
      const d = me ? Math.hypot(tx - me.x, ty - me.y, tz - me.z) : 0;
      p.dist = d;
      const chat = p.chatUntil > now ? p.chat : null;
      let note = '';
      try {
        note = this.note ? String(this.note(p.id) || '') : '';
      } catch (e) {
        note = '';
      }
      // Paused or in another tab (scuffs #10): said on the tag, so a friend who has stopped is not taken for lag.
      let away = false;
      try {
        away = !!(this.away && this.away(p.id));
      } catch (e) {
        away = false;
      }
      p.away = away;
      if (away) note = note ? `⏸ away ${note}` : '⏸ away';
      /*
       * Redrawing the tag is a canvas paint and a texture upload. Every frame,
       * for four friends, that was half a megabyte a frame to the GPU on a
       * school Chromebook for a number nobody reads that fast — so the
       * distance is refreshed twice a second, and a chat bubble at once.
       */
      // ...unless it is suddenly a different number: a joiner dropped beside the host read "560 m" for half a second.
      const jumped = p.tagDist != null && Math.abs(d - p.tagDist) > Math.max(20, 0.25 * p.tagDist);
      if (chat !== p.tagChat || note !== p.tagNote || jumped || !(now - (p.tagAt || -Infinity) < 500)) {
        p.tagAt = now;
        p.tagChat = chat;
        p.tagNote = note;
        p.tagDist = d;
        // List 2, part 2: their PvP hearts (this.note) before the distance; part 3b: the host's crown and an admin's badge.
        drawTag(p.tag, p.name, p.colour, note ? `${note}  ${fmtDist(d)}` : fmtDist(d), chat, p.host, p.admin, p.owner);
      }
      drawPip(p.tag, p.colour);
      /*
       * A fixed five metres over the aeroplane's middle floated the tag a
       * wingspan clear of a Skylark — ten metres off in the playtest it sat
       * over the hangars behind it rather than the aeroplane — and inside the
       * fin of anything big. So it goes a metre and a bit over the top of the
       * model actually drawn, and higher with distance, where the model is a
       * few pixels and the tag must not cover it.
       */
      // syncAircraftModel drops only the pack's models by their ground offset; the built-in ones sit where they are.
      // Over the pilot's head, when they are out walking: the name, and the crown if they host.
      const top = wk ? (wk.down ? 0.5 : 1.75) : (model.userData.mpTop || 2) + (kind === 'air' && model.userData.fleetBridge ? model.userData.groundOffsetY || 0 : 0);
      const lift = top + (wk ? 0.75 : 1.3) + Math.min(wk ? 20 : kind === 'air' ? 30 : 20, d * 0.004);
      p.tag.sprite.position.set(tx, ty, tz).addScaledVector(UP, lift);
      p.tag.pip.position.set(tx, ty, tz).addScaledVector(UP, top + (wk ? 0.5 : 1));
      // Hidden with the rest of the interface (U), for a clean shot; placed, sized and decluttered in _layoutTags.
      p.tagOn = tags && d > 4 && !gone;
      let dot = this._dots.get(p.id);
      if (!dot) {
        dot = { id: p.id, name: '', colour: '', x: 0, z: 0, heading: 0, dist: 0 };
        this._dots.set(p.id, dot);
      }
      dot.name = p.name;
      dot.colour = p.colour;
      dot.x = tx;
      dot.z = tz;
      dot.heading = wk ? wk.heading : headingOf(q);
      dot.dist = d;
      out.push(dot);
    }
    this._layoutTags(sim);
    return out;
  }

  /**
   * Size every tag for its distance and keep them off each other: nearest
   * (or talking) first; a tag that would land on one already placed steps up
   * above it, at most twice; one that still does not fit — and anybody past
   * 8 km — is a dot in their colour instead. A few projections a frame.
   */
  _layoutTags(sim) {
    const cam = sim && sim.camera;
    const list = this._tagList || (this._tagList = []);
    list.length = 0;
    for (const p of this.players.values()) if (p.tag) list.push(p);
    if (!list.length) return;
    const W = (typeof window !== 'undefined' && window.innerWidth) || 1280;
    const H = (typeof window !== 'undefined' && window.innerHeight) || 720;
    const P11 = cam && cam.projectionMatrix ? cam.projectionMatrix.elements[5] || 1.73 : 1.73;
    list.sort((a, b) => (b.tag.chat - a.tag.chat) || (a.dist - b.dist));
    const placed = this._placed || (this._placed = []);
    placed.length = 0;
    const pipH = (2 * PIP_FRAC) / P11;
    for (const p of list) {
      const tag = p.tag;
      const sp = tag.sprite;
      tag.pip.scale.set(pipH, pipH, 1);
      if (!p.visible || !p.tagOn) {
        sp.visible = tag.pip.visible = false;
        continue;
      }
      if (p.dist >= TAG_MAX_M || !cam) {
        sp.visible = false;
        tag.pip.visible = !!cam;
        continue;
      }
      const frac = pillFraction(p.dist);
      const sy = (2 * frac * (TAG_H / PILL_H)) / P11;
      sp.scale.set(sy * (TAG_W / TAG_H), sy, 1);
      // On screen: where the anchor is, and the pill (with its bubble) above it.
      tmpP.copy(sp.position).project(cam);
      if (tmpP.z > 1 || tmpP.z < -1) {
        sp.visible = tag.pip.visible = false;
        continue;
      }
      const ax = ((tmpP.x + 1) / 2) * W;
      const ay = ((1 - tmpP.y) / 2) * H;
      const hPx = (frac * TAG_H / PILL_H) * H;
      const pillW = (tag.pillW / TAG_W) * hPx * (TAG_W / TAG_H);
      // Far off, the dot marks the aeroplane and the pill sits clear above it.
      const lift = p.far ? (PIP_FRAC / 2) * H + 2 : 0;
      const bottom = ay - ((TAG_H - PILL_Y - PILL_H) / TAG_H) * hPx - lift;
      const tall = ((tag.chat ? PILL_H + BUBBLE_H + 6 : PILL_H) / TAG_H) * hPx;
      const step = ((PILL_H + 6) / TAG_H) * hPx;
      let at = -1;
      for (let k = 0; k < 3 && at < 0; k++) {
        const r = { l: ax - pillW / 2 - 2, r: ax + pillW / 2 + 2, b: bottom - k * step + 2, t: bottom - k * step - tall - 2 };
        if (!placed.some((q) => r.l < q.r && r.r > q.l && r.t < q.b && r.b > q.t)) {
          at = k;
          placed.push(r);
        }
      }
      if (at < 0) {
        sp.visible = false;
        tag.pip.visible = true;
        continue;
      }
      sp.center.y = -at * ((PILL_H + 6) / TAG_H) - lift / hPx;
      sp.visible = true;
      // Too far off to be more than a speck: the dot marks the aeroplane, under its name.
      tag.pip.visible = !!p.far;
    }
  }
}

/** A model is drawn out to this far, or its radius times MODEL_PX_K (about two pixels on a 700 px screen), whichever is further. */
const MODEL_MIN_M = 2500;
const MODEL_PX_K = 700;

/** Half the diagonal of a model's box: how big it is, for how far away it is still worth drawing. */
function radiusOf(model) {
  try {
    const box = new THREE.Box3().setFromObject(model);
    const r = box.min.distanceTo(box.max) / 2;
    return Number.isFinite(r) && r > 0 && r < 200 ? r : 6;
  } catch (err) {
    return 6;
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
