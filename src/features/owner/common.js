/**
 * What the owner's three toys share (./trolls.js, ./disasters.js,
 * ./teleport.js):
 *
 *   - hostOwner(id): the HOST's answer to "is this player the owner?" — the
 *     session's own check of the pass and its signature (multiplayer/session.js
 *     isOwner), never a flag a player sent. Every owner request goes to the
 *     host (ch.toHost) and the host does nothing for anybody else;
 *   - hostRole(id) and mayTroll(by, target): "troll thing for admin" — the
 *     owner's toys are the admins' too (every troll, the disaster trolls,
 *     teleport; taking an aircraft over stays the owner's). The host works
 *     out each player's role for ITSELF — owner (the pass), admin (the
 *     signature on the admin key), or a plain player — and the one rule is
 *     mayTroll: nobody trolls the owner, only the owner trolls an admin, an
 *     admin trolls plain players, a plain player trolls nobody;
 *   - amOwnerInGame(): this copy, in a game where the host has checked its pass;
 *     amStaffInGame(): the same for an owner OR an admin (the host checked the
 *     key); myRole(): which of the two this copy is;
 *   - the small "🃏 trolled by the owner" tag the target sees;
 *   - where a player is right now, as this copy draws them.
 */

import { extLayer } from '../../game/extensions.js';
import { mp, ch, ride, inGame, who, feed } from '../mpplay/shared.js';
import { headingOf } from '../multiplayer/remotes.js';

export const OWNER_GOLD = '#ffd23f';
export const PLAYER_IDS = 8;

export const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
export const isId = (v) => Number.isInteger(v) && v >= 0 && v < PLAYER_IDS;
export const num = (v, lim = 2e5) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= lim;

/** HOST ONLY: whether player `id` is the owner here, by the session's own check of their pass. */
export function hostOwner(id) {
  const h = mp.host;
  if (!h || !ch.isHost) return false;
  const p = id === 0 ? h.me : h.players.get(id);
  return !!p && typeof h.isOwner === 'function' && h.isOwner(p);
}

/**
 * A role, ranked: what a player is to the HOST. `owner` is a pass in its hour (session.js isOwner), `admin` an admin key
 * whose signature the host checked (p.admin === true) — an owner who is also an admin is an owner —, and `player`
 * everybody else.
 */
export const ROLE_RANK = Object.freeze({ player: 0, admin: 1, owner: 2 });

/**
 * THE rule for who may troll whom, as a pure function of two roles (null: not in the game). Nobody trolls the owner; only
 * the owner trolls an admin; an admin or the owner trolls a plain player; a plain player trolls nobody. (Two owners do not
 * troll each other either: the owner is never a target.)
 */
export function mayTroll(by, target) {
  // Own keys only: 'toString' and friends are "in" every object, and are no role.
  const known = (r) => typeof r === 'string' && Object.prototype.hasOwnProperty.call(ROLE_RANK, r);
  if (!known(by) || !known(target) || by === 'player' || target === 'owner') return false;
  return target === 'player' || by === 'owner';
}

/** HOST ONLY: player `id`'s role by the session's own checks — 'owner', 'admin', 'player' — or null for nobody here. */
export function hostRole(id) {
  const h = mp.host;
  if (!h || !ch.isHost) return null;
  const p = id === 0 ? h.me : h.players.get(id);
  if (!p) return null;
  if (typeof h.isOwner === 'function' && h.isOwner(p)) return 'owner';
  return p.admin === true ? 'admin' : 'player';
}

/** HOST ONLY: may player `from` troll player `target`, by the host's own reading of both roles? */
export function hostMayTroll(from, target) {
  return mayTroll(hostRole(from), hostRole(target));
}

/** This copy is the owner in a game right now: its pass checked by the host (mp.me.owner), in a game past the loading. */
export function amOwnerInGame() {
  return !!(inGame() && mp.me && mp.me.owner);
}

/** This copy is an owner or an admin in a game right now, as the host checked it (mp.me.admin is "has admin powers"). */
export function amStaffInGame() {
  return !!(inGame() && mp.me && (mp.me.owner || mp.me.admin));
}

/** 'owner', 'admin' or null: which this copy is in the game, by the host's word. */
export function myRole() {
  if (!inGame() || !mp.me) return null;
  return mp.me.owner ? 'owner' : mp.me.admin ? 'admin' : null;
}

/** A player's role as the roster says it (the host checked it): 'owner', 'admin' or 'player'. */
export function rosterRole(p) {
  return p && p.owner ? 'owner' : p && p.admin ? 'admin' : 'player';
}

/**
 * Who did it, in words, for the one it was done to: "an admin" when the roster (the host's word) has the player `id` as an
 * admin and not the owner; otherwise "the owner" — the host only relays a troll from one of the two.
 */
export function byWho(id) {
  const p = playerOf(id);
  return p && p.admin && !p.owner ? 'an admin' : 'the owner';
}

export function playerOf(id) {
  return ch.players().find((p) => p.id === id) || null;
}

/**
 * Where a player is, as this copy has them: this player's own ride, or where
 * a friend is drawn. { x, y, z, heading (deg), speed (m/s), vel } or null.
 */
export function placeOf(id, sim) {
  if (id === mp.meId) {
    const me = ride(sim);
    if (!me) return null;
    return { x: me.pos.x, y: me.pos.y, z: me.pos.z, heading: headingOf(me.quat), speed: Math.hypot(me.vel.x, me.vel.z), vel: me.vel, me: true, onGround: !!me.onGround };
  }
  const p = playerOf(id);
  if (!p || !p.pos) return null;
  const vel = p.vel || { x: 0, y: 0, z: 0 };
  return { x: p.pos.x, y: p.pos.y, z: p.pos.z, heading: p.quat ? headingOf(p.quat) : 0, speed: Math.hypot(vel.x, vel.z), vel, me: false, onGround: !!p.onGround };
}

/** A player's name for a line on the screen (list-built usernames: safe). */
export function nameOf(id) {
  return who(id).name;
}

/* ---- "not yet": the host to the owner ------------------------------------------------ */

/** Why the host said not yet: the words are looked up here, never sent. */
export const WAIT_LINES = Object.freeze([
  (s) => `🃏 Give them a moment — the next troll on them can come in ${s} s`,
  (s) => `🃏 Three disasters are already running — stop one first (or wait ${s} s)`,
  (s) => `🃏 Not yet — try again in ${s} s`,
  (s) => `🃏 The owner has one running on them already — try again in ${s} s`,
]);

export function cleanWait(d) {
  return d && Number.isInteger(d.s) && d.s >= 1 && d.s <= 60 && Number.isInteger(d.w) && d.w >= 0 && d.w < WAIT_LINES.length ? { s: d.s, w: d.w } : null;
}

ch.define('owner:wait', { from: 'host', validate: cleanWait, rate: 4 });

export function waitLine(s, w = 0) {
  feed((WAIT_LINES[w] || WAIT_LINES[2])(s));
}

/** HOST: tell player `id` not yet — in its own words, on its own screen. */
export function tellWait(id, ms, w = 0) {
  const s = Math.max(1, Math.min(60, Math.ceil(ms / 1000)));
  if (id === mp.meId) waitLine(s, w);
  else ch.sendTo(id, 'owner:wait', { s, w });
}

ch.on('owner:wait', (d, from) => {
  if (from && from.host) waitLine(d.s, d.w);
});

/* ---- the tag ---------------------------------------------------------------------- */

const STYLE_ID = 'owner-trolls-style';
export const CSS = `
/* "🃏 trolled by the owner / an admin" */
.owner-trolltag { position: fixed; left: 50%; top: 58px; transform: translateX(-50%); z-index: 32; pointer-events: none;
  padding: 5px 12px; border-radius: 99px; background: rgba(12, 20, 34, 0.9); color: #fff; border: 1px solid rgba(255, 210, 63, 0.7);
  font: 650 13px var(--font, system-ui, sans-serif); white-space: nowrap; max-width: 92vw; overflow: hidden; text-overflow: ellipsis; }
.owner-trolltag[hidden] { display: none; }
:root.is-touch-device .owner-trolltag { top: 52px; }
/* The troll button beside Admin in the player list, and the gold rows it opens (multiplayer/ui.js paints them). */
.mp-hud button.mp-ownbtn, .mp-pausefold button.mp-ownbtn { border-color: rgba(255, 210, 63, 0.6); }
.mp-ownrow { border-left: 2px solid rgba(255, 210, 63, 0.45); margin-left: 24px; padding-left: 8px; }
.mp-ownrow button.is-on { background: rgba(255, 210, 63, 0.26); border-color: rgba(255, 210, 63, 0.85); }
.mp-ownrow .mp-own-tab { font-weight: 650; }
.mp-ownrow .mp-own-group { display: inline-flex; flex-wrap: wrap; gap: 4px; align-items: center; }
.mp-ownrow .mp-own-group small { color: var(--text-dim); margin-right: 2px; }
.mp-ownrow input[type=range] { width: 120px; vertical-align: middle; accent-color: #ffd23f; }
.mp-ownrow output { font-variant-numeric: tabular-nums; min-width: 4.5em; display: inline-block; color: var(--text); }
.mp-hud .mp-ownrow button.mp-own-stop, .mp-pausefold .mp-ownrow button.mp-own-stop { background: rgba(255, 90, 79, 0.28); border-color: rgba(255, 90, 79, 0.7); font-weight: 700; }
.mp-hud .mp-ownrow button.mp-own-go, .mp-pausefold .mp-ownrow button.mp-own-go { background: rgba(255, 210, 63, 0.22); border-color: rgba(255, 210, 63, 0.8); font-weight: 700; }
.mp-ownrow .mp-own-note { flex-basis: 100%; font-size: 11.5px; color: var(--text-dim); }
`;

export function injectOwnerStyle() {
  if (typeof document === 'undefined' || !document.head || document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = CSS;
  document.head.appendChild(s);
}

const TAG = { el: null, text: '', until: 0, lines: new Map(), by: new Map() };

/** Show "🃏 trolled by the owner — <what>" ("…by an admin —", for an admin's) for `secs`; several at once are joined. */
export function showTag(what, secs = 3, by = null) {
  if (by != null) TAG.by.set(what, byWho(by));
  const t = now();
  TAG.lines.set(what, t + Math.max(1, secs) * 1000);
  tickTag();
}

export function clearTag() {
  TAG.lines.clear();
  TAG.by.clear();
  tickTag();
}

/** One line off the tag now (its troll is over early, or was replaced). */
export function dropTag(what) {
  TAG.by.delete(what);
  if (TAG.lines.delete(what)) tickTag();
}

export function tagText() {
  return TAG.el && !TAG.el.hidden ? TAG.el.textContent : '';
}

/** Once a frame: drop lines whose time is up, and write the element only when the text changed. */
export function tickTag() {
  const t = now();
  for (const [k, until] of TAG.lines) {
    if (t >= until) {
      TAG.lines.delete(k);
      TAG.by.delete(k);
    }
  }
  // "by the owner", or "by an admin" when every line on it is an admin's (a mix says the owner: the bigger name).
  const byOwner = [...TAG.lines.keys()].some((k) => TAG.by.get(k) !== 'an admin');
  const text = TAG.lines.size ? `🃏 trolled by ${byOwner ? 'the owner' : 'an admin'} — ${[...TAG.lines.keys()].join(' · ')}` : '';
  if (text === TAG.text) return;
  TAG.text = text;
  if (typeof document === 'undefined') return;
  if (!TAG.el) {
    if (!text) return;
    injectOwnerStyle();
    TAG.el = document.createElement('div');
    TAG.el.className = 'owner-trolltag';
    TAG.el.dataset.ownerTrolltag = '';
    TAG.el.setAttribute('role', 'status');
    TAG.el.setAttribute('aria-live', 'polite');
    extLayer().appendChild(TAG.el);
  }
  TAG.el.textContent = text;
  TAG.el.hidden = !text;
}
