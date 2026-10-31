/**
 * "Last Flight Out" — the containment-breach evacuation on Nunatak Reach:
 * everything the mission (game/extra/scp-escape.js) shows and counts.
 *
 * SCP Foundation content by the SCP Wiki community, CC BY-SA 3.0,
 * scpwiki.com (LICENSE, "SCP FOUNDATION CONTENT"). The Foundation, the Site,
 * the Class-D, the Mobile Task Force and the on-site Alpha Warhead are theirs;
 * the aeroplane, the apron and the clock are ours. No numbered SCP is named
 * or shown.
 *
 * THE LOOP (the owner, 2026-10-30: "the scp are breaching but u have the last
 * escape plane, people will board and get items, you need to choose when to
 * fly, especially before one of the scps or nukes get u"): you sit on the
 * Site's ice strip in the C-17 with the ramp down. Waves of people — Site
 * staff in white and grey, Class-D in orange, a few MTF in dark gear — run
 * out of the blast door and the annex, through the gate and up the ramp into
 * the hold; some push carts (medical, records, rations, a sealed case). The
 * Alpha Warhead counts down from four minutes; the compound's six sectors go
 * dark one by one on a seeded timer, and when the one by the strip goes you
 * have STRIP_GRACE_S seconds. Close the ramp when YOU choose (the ramp key,
 * or the big CLOSE RAMP button): whoever is not on the ramp turns back for
 * the hangar — nobody is shown being hurt — and you go. Airborne, be
 * BLAST_SAFE_M away when the warhead goes: a distant dome of light behind
 * you, then a pressure wave some seconds later, strong turbulence and no
 * more. Closer, and the wave knocks the aeroplane about and the mission ends
 * "Too close to the blast". Land at Caribou and it is over: saved, left,
 * cargo, the margin, the landing.
 *
 * SPOOKY, NOT GRAPHIC. Sirens, red lamps, fog, sectors going dark. No
 * creature, no gore, nothing happens to anybody on screen. The loss on the
 * ground is the floodlights dying, a deep sound (if audio is on) and a fade
 * to black. The warhead is a glow on the horizon and a shockwave.
 *
 * FLASH SAFETY (render/flash-safety.js): every light here only ever goes DOWN
 * over seconds (a sector's lamps), or pulses as slowly as the Site's own
 * beacon (blinkLevel, 2.6 s), or rises once through a FlashSmoother to a
 * brightness under CAPS (the dome). No full-screen white; the fade to black
 * is one change, over two and a half seconds. No particles: the explosions
 * module's bomb (sparks, a twinkling fireball) measured 2.4% of the screen
 * flickering under the probe from 5.5 km, so the column of smoke is one
 * quiet mesh that grows and darkens over twenty seconds.
 *
 * CHEAP (a Chromebook on Low): the people are the lite figures of
 * staff/person.js, pooled (POOL[quality]) and reused as each goes aboard;
 * the carts one mesh each; the sector lamps a dozen small meshes whose
 * materials change intensity — no new lights, no shadows. The dome is one
 * sphere.
 *
 * Pure parts (the schedule, the score, the blast rule, the clock text) are
 * exported for tests/features/scp-escape.mjs; `__escape` is the test hook
 * the browser check uses to wind the clock.
 */

import * as THREE from '../vendor/three.module.js';
import { registerExtension, extLayer } from '../game/extensions.js';
import { registerActions, isKey, keyName, bindingsVersion } from '../flight/input.js';
import { MAP, heightAt } from '../world/terrain.js';
import { FLASH, CAPS, dim, blinkLevel, FlashSmoother } from '../render/flash-safety.js';
import { createPerson, posePerson, disposePerson } from './staff/person.js';
import { rampOf, rampHeight, bodyPoint, holdGateOpen, setSiteLights, siteGroup } from './scp-site.js';
import { pressRamp } from './cargo-ramp.js';
import { debriefPayRow } from '../game/progression.js';

export const ID = 'last-flight';

/* ------------------------------------------------------------------ */
/* The numbers                                                         */
/* ------------------------------------------------------------------ */

/** The Alpha Warhead: armed at the start, seconds to detonation. */
export const WARHEAD_S = 240;
/**
 * Far enough from the Site when it goes. The brief said "about 6 km";
 * Caribou's runway is 5.5 km from the Site, and a pilot on short final there
 * when it goes has done everything right, so the line is 5 km.
 */
export const BLAST_SAFE_M = 5000;
/** Seconds between the strip's sector going dark and the breach reaching the strip. */
export const STRIP_GRACE_S = 20;
/**
 * Already away: on the take-off roll at this speed (m/s, about 50 kt) when the
 * breach reaches the strip, you are leaving it behind. "About twenty seconds"
 * has to be true for a pilot who goes the moment the strip's sector goes — and
 * the C-17 needs 21 s from a standstill to lift off (measured, ramp closing as
 * it rolls), but only 8 s to be rolling at this.
 */
export const STRIP_ESCAPE_MS = 25;
/** Seconds the ramp takes to close (the C-17's own, aircraft/extra/c17.js openSeconds). */
export const RAMP_CLOSE_S = 8;
/** The compound's sectors, in the order they are lost: A furthest from the strip, F the one beside it. */
export const SECTORS = ['A', 'B', 'C', 'D', 'E', 'F'];
/**
 * When each sector goes, seconds from the start, before the run's jitter.
 * F (the strip's) at 135: in most runs it goes before the last of the people
 * are aboard (about 138-148 s), so waiting for everybody is a choice made
 * against its twenty seconds — and in about a quarter of runs it is a choice
 * that costs you the strip.
 */
export const SECTOR_BASE = [25, 50, 72, 95, 115, 135];
/** The most a sector's time moves per run, either way. */
export const SECTOR_JITTER = 10;
/** The most a wave's release moves per run, either way. */
export const WAVE_JITTER = 6;
/** Figures on the apron at once, by detail level (pooled; the rest wait their turn). */
export const POOL = { low: 14, medium: 20, high: 24 };
/**
 * Running speeds, metres a second (running for it, not jogging). A cart's crew
 * moves at the cart's. At these the last of the forty are aboard at about
 * 138-148 s, and a C-17 that goes then is 5 km out with ten seconds or so to
 * spare (brake release to 5 km: 82 s, measured) — the three-star run is
 * there to be flown.
 */
export const SPEED = { staff: 4.0, sitestaff: 3.8, classd: 3.7, tactical: 4.2, cart: 3.1 };
/** At most this many on the ramp at once; the rest wait at its foot. */
export const RAMP_SLOTS = 3;
/** Metres from the Site's centre inside which "on the ground" means "at the Site". */
export const SITE_RANGE_M = 1600;
/** Speed of sound, for the pressure wave's arrival (the explosions module's SOUND_SPEED). */
const SOUND_SPEED = 340;

/**
 * The waves. `at` is seconds from the start; `from` where they come out
 * (see origins()); `people` the outfits; `cargo` the carts, each pushed by
 * two of the people. Spread so the first group is at the ramp inside a
 * minute and the last reaches it about when the strip's sector goes: waiting
 * for them is the gamble.
 */
export const WAVES = Object.freeze([
  // Aboard (all of a wave, the queue at the ramp included) at about 33-50, 58-80, 84-110, 105-140, 107-140 and
  // 123-146 s over the routes in origins() (measured, tests/features/scp-escape.mjs "the three-star run").
  { id: 'w1', at: 0, from: 'edge', people: ['staff', 'staff', 'sitestaff', 'sitestaff', 'staff', 'staff'], cargo: ['medical', 'rations'] },
  { id: 'w2', at: 0, from: 'apron', people: ['sitestaff', 'sitestaff', 'sitestaff', 'tactical', 'classd', 'classd'], cargo: ['rations'] },
  { id: 'w3', at: 0, from: 'door', people: ['sitestaff', 'sitestaff', 'sitestaff', 'classd', 'classd', 'classd', 'tactical'], cargo: ['records', 'medical'] },
  { id: 'w4', at: 0, from: 'annex', people: ['sitestaff', 'sitestaff', 'sitestaff', 'sitestaff', 'staff', 'staff'], cargo: ['sealed'] },
  { id: 'w5', at: 15, from: 'door', people: ['classd', 'classd', 'classd', 'classd', 'tactical', 'tactical', 'sitestaff', 'sitestaff'], cargo: ['rations', 'records'] },
  { id: 'w6', at: 0, from: 'far', people: ['sitestaff', 'sitestaff', 'sitestaff', 'sitestaff', 'staff', 'tactical', 'tactical'], cargo: [] },
]);
export const TOTAL_PEOPLE = WAVES.reduce((n, w) => n + w.people.length, 0);
export const TOTAL_CARGO = WAVES.reduce((n, w) => n + w.cargo.length, 0);

/** What each cart is worth and looks like. */
export const CARGO = Object.freeze({
  medical: { label: 'Medical', points: 1, colour: 0xe8eef2 },
  records: { label: 'Records', points: 1, colour: 0x6b6f76 },
  rations: { label: 'Rations', points: 1, colour: 0x7a6a4a },
  sealed: { label: 'Sealed case', points: 2, colour: 0x262a30 },
});

/* ------------------------------------------------------------------ */
/* Pure                                                                */
/* ------------------------------------------------------------------ */

/** A small seeded generator (mulberry32), so a run's waves and sectors repeat for a seed. */
export function rng(seed) {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The run's timetable from a seed: each sector's time (in order, never
 * closer than eight seconds), when the breach reaches the strip, and each
 * wave's release. The same seed gives the same run; Retry draws a new one.
 */
export function schedule(seed) {
  const r = rng(seed);
  const sectors = [];
  let last = -Infinity;
  SECTOR_BASE.forEach((base, i) => {
    let at = base + (r() * 2 - 1) * SECTOR_JITTER;
    if (at < last + 8) at = last + 8;
    at = Math.round(at * 10) / 10;
    last = at;
    sectors.push({ id: SECTORS[i], at });
  });
  const waves = WAVES.map((w) => ({ id: w.id, from: w.from, at: Math.max(0, Math.round((w.at + (r() * 2 - 1) * WAVE_JITTER) * 10) / 10), people: w.people.length, cargo: w.cargo.length }));
  return { seed, sectors, stripLostAt: sectors[sectors.length - 1].at + STRIP_GRACE_S, waves };
}

/** "3:42" from seconds (never negative). */
export function fmtClock(s) {
  const t = Math.max(0, Math.ceil(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

/**
 * What the warhead does to an aeroplane `distM` from the Site when it goes:
 * 'ground' (on the ground, anywhere near the Site), 'close' (airborne but
 * inside BLAST_SAFE_M: the wave is an upset and the mission ends), 'clear'
 * (strong turbulence, nothing more).
 */
export function blastOutcome(distM, onGround) {
  if (onGround && distM < BLAST_SAFE_M) return 'ground';
  if (distM < BLAST_SAFE_M) return 'close';
  return 'clear';
}

/**
 * The score, 0..100: people saved weigh most (60), the cargo (22), the
 * landing (10) and the seconds to spare before the warhead (8, all of it
 * at a minute). An empty aeroplane that makes it is a low score, not a
 * failure.
 */
export function scoreOf({ saved = 0, total = TOTAL_PEOPLE, cargoPts = 0, cargoMax = cargoPoints(), marginS = 0, landing = 50 } = {}) {
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  const pts = 60 * clamp01(total ? saved / total : 0) + 22 * clamp01(cargoMax ? cargoPts / cargoMax : 0) + 10 * clamp01((landing || 0) / 100) + 8 * clamp01((marginS || 0) / 60);
  return Math.max(0, Math.min(100, Math.round(pts)));
}

/** The most cargo points there are to load. */
export function cargoPoints() {
  return WAVES.reduce((n, w) => n + w.cargo.reduce((m, c) => m + CARGO[c].points, 0), 0);
}

/** The pressure wave's strength 0..1 at `d` metres: full inside the safe line, fading to a quarter by twice it. */
export function waveStrength(d) {
  if (d <= BLAST_SAFE_M) return 1;
  return Math.max(0.25, 1 - (d - BLAST_SAFE_M) / BLAST_SAFE_M);
}

/* ------------------------------------------------------------------ */
/* State                                                               */
/* ------------------------------------------------------------------ */

const E = {
  sim: null,
  /** The run: set by begin(), cleared by stop(). */
  run: null,
  ui: null,
  keysVer: -1,
  /** The frame clock of the whole feature (lamps pulse on it). */
  t: 0,
};

function fresh(seed) {
  return {
    seed,
    sched: schedule(seed),
    t: 0,
    /** 'boarding' (ramp down, people coming) | 'leaving' (ramp closing, stragglers turning back) | 'gone' (airborne or rolling) */
    phase: 'boarding',
    leftAt: null,
    saved: 0,
    left: 0,
    cargo: 0,
    cargoPts: 0,
    lost: 0,
    stripLost: false,
    stripLostAt: null,
    /** Warhead: seconds left; `blast` once it has gone. */
    warhead: WARHEAD_S,
    blast: null,
    /** Seconds left on the warhead when the aeroplane first crossed BLAST_SAFE_M (the margin). */
    crossedAt: null,
    failReason: null,
    failAt: null,
    /** The end, for the debrief: { kind: 'landed' | 'failed', ... }. */
    result: null,
    /** The world: people, carts, lamps, dome. */
    built: false,
    pool: [],
    walkers: [],
    carts: [],
    cartPool: [],
    released: new Set(),
    lamps: [],
    poleMesh: null,
    dome: null,
    column: null,
    domeSmooth: new FlashSmoother(0.35, 1.2),
    /** The Site's lamp scale: where the sectors put it, and where it has got to (eased, never a step). */
    siteWant: 1,
    siteNow: 1,
    fade: null,
    rolledFor: 0,
    fadeAt: null,
    turbWas: null,
    poolMax: POOL.high,
    group: null,
    toldSector: -1,
    saidWave: new Set(),
    lastNote: '',
  };
}

/* ------------------------------------------------------------------ */
/* Geometry of the Site                                                */
/* ------------------------------------------------------------------ */

function cfg() {
  return MAP && MAP.scp ? MAP.scp : null;
}

/**
 * Where the waves come out, and the way from there to the apron: the gate
 * in the fence (every route but the apron's goes through it), round the main
 * block on the west for the annex and on the east for the far hut.
 */
export function origins(c = cfg()) {
  if (!c) return null;
  const Y = c.yard;
  const via = { x: c.gate.x, z: Y.z1 + 8 };
  // Inside the gate: the bend every route round the main block takes, so nobody cuts the fence.
  const gateIn = { x: c.gate.x, z: Y.z1 - 6 };
  const bx = c.door.x;
  return {
    via,
    gateIn,
    edge: { spawn: { x: c.gate.x + 90, z: Y.z1 + 120 }, path: [] },
    apron: { spawn: { x: c.gate.x + 20, z: Y.z1 + 40 }, path: [] },
    gate: { spawn: { x: c.gate.x, z: Y.z1 - 4 }, path: [via] },
    door: { spawn: { x: c.door.x, z: c.door.z + 4 }, path: [via] },
    annex: { spawn: { x: bx - 52, z: c.door.z - 47 }, path: [{ x: bx - 52, z: c.door.z + 6 }, gateIn, via] },
    far: { spawn: { x: bx + 130, z: c.door.z - 130 }, path: [{ x: bx + 65, z: c.door.z + 2 }, gateIn, via] },
  };
}

/**
 * The sector lamps: six masts inside the fence, A at the far (north) side,
 * F at the gate beside the apron and the strip.
 */
export function sectorPosts(c = cfg()) {
  if (!c) return [];
  const Y = c.yard;
  const cx = (Y.x0 + Y.x1) / 2;
  const cz = (Y.z0 + Y.z1) / 2;
  return [
    { id: 'A', x: cx, z: Y.z0 + 26 },
    { id: 'B', x: Y.x1 - 40, z: Y.z0 + 70 },
    { id: 'C', x: Y.x0 + 40, z: Y.z0 + 70 },
    { id: 'D', x: Y.x1 - 30, z: cz + 40 },
    { id: 'E', x: Y.x0 + 30, z: cz + 40 },
    { id: 'F', x: c.gate.x + 44, z: Y.z1 - 18 },
  ];
}

/**
 * Where the C-17 starts: on the strip, lined up west (Caribou is that way),
 * 720 m of ice ahead. Measured with the real flight model (full power,
 * rotate at 120 kt, flap 20): the roll is about 700 m, so from 110 m east of
 * the middle the wheels left the ice at its very end; from 170 m there is a
 * margin of a strip's width.
 */
export function startPose(c = cfg()) {
  if (!c || !c.strip) return null;
  const h = (c.strip.headingDeg || 90) + 180;
  return { x: c.strip.cx + 170, z: c.strip.cz, headingDeg: ((h % 360) + 360) % 360 };
}

const flat = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);

function siteCentre() {
  const c = cfg();
  return c ? { x: c.cx, z: c.cz } : { x: 0, z: 0 };
}

/* ------------------------------------------------------------------ */
/* The world: lamps, people, carts, the dome                           */
/* ------------------------------------------------------------------ */

let poleMat = null;
let cartMats = null;
function mats() {
  if (!poleMat) poleMat = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.5, metalness: 0.6 });
  if (!cartMats) {
    cartMats = {};
    for (const k in CARGO) cartMats[k] = new THREE.MeshStandardMaterial({ color: CARGO[k].colour, roughness: 0.8, metalness: 0.1 });
  }
}

function buildLamps(R, group) {
  mats();
  const posts = sectorPosts();
  const geos = [];
  for (const p of posts) {
    const y = heightAt(p.x, p.z);
    const g = new THREE.CylinderGeometry(0.14, 0.24, 9, 6);
    g.translate(p.x, y + 4.5, p.z);
    geos.push(g);
    // The lamp head: a lit box, its own material (it goes dark on its own).
    const headMat = new THREE.MeshStandardMaterial({ color: 0xfff6dc, emissive: 0xfff0c8, emissiveIntensity: 1.5, roughness: 0.4 });
    const head = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.4, 0.8), headMat);
    head.position.set(p.x, y + 9.1, p.z);
    head.name = `lfo-lamp-${p.id}`;
    group.add(head);
    // The red lamp under it: dark until the sector is lost, then a slow pulse.
    const redMat = new THREE.MeshBasicMaterial({ color: 0xff3b2f, transparent: true, opacity: 0 });
    const red = new THREE.Mesh(new THREE.SphereGeometry(0.32, 8, 6), redMat);
    red.position.set(p.x, y + 8.5, p.z);
    red.name = `lfo-red-${p.id}`;
    group.add(red);
    R.lamps.push({ id: p.id, x: p.x, z: p.z, head, headMat, red, redMat, lit: 1, lost: false });
  }
  // One mesh for the six poles.
  const flatGeos = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  let n = 0;
  for (const g of flatGeos) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3);
  const nrm = new Float32Array(n * 3);
  let at = 0;
  for (const ng of flatGeos) {
    pos.set(ng.attributes.position.array, at * 3);
    nrm.set(ng.attributes.normal.array, at * 3);
    at += ng.attributes.position.count;
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  const poles = new THREE.Mesh(merged, poleMat);
  poles.name = 'lfo-poles';
  group.add(poles);
  R.poleMesh = poles;
}

function buildDome(R, group) {
  const c = siteCentre();
  const y = heightAt(c.x, c.z);
  // Plain blending, not additive: additive over a bright night sky (the aurora) read as a grey bubble; a warm
  // translucent shell reads as a glowing dome on the horizon, and never brighter than its own colour.
  const mat = new THREE.MeshBasicMaterial({ color: 0xffc070, transparent: true, opacity: 0, depthWrite: false, fog: false });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 12), mat);
  // On the ground: the half under the terrain is not drawn, so it reads as a dome on the horizon.
  dome.position.set(c.x, y, c.z);
  dome.scale.setScalar(1);
  dome.visible = false;
  dome.renderOrder = 6;
  dome.name = 'lfo-dome';
  group.add(dome);
  R.dome = dome;
  // The column: a tall cone of dark smoke that rises out of the dome and widens at the top, over twenty seconds.
  const colMat = new THREE.MeshBasicMaterial({ color: 0x3a3230, transparent: true, opacity: 0, depthWrite: false, fog: false });
  const col = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 0.6, 1, 10, 1, true), colMat);
  col.position.set(c.x, y, c.z);
  col.visible = false;
  col.renderOrder = 5;
  col.name = 'lfo-column';
  group.add(col);
  R.column = col;
}

function person(kind, seed) {
  const p = createPerson({ outfit: kind, seed, lite: true });
  p.userData.anim = p.userData.anim || { t: 0, walk: 0, run: 0, air: 0, wave: 0, stop: 0, pointL: 0, pointR: 0, hello: 0, phase: Math.random() * 6 };
  p.visible = false;
  return p;
}

function poolSize(sim) {
  const q = (sim && sim.settings && sim.settings.quality) || 'high';
  return POOL[q] || POOL.high;
}

function takeFigure(R, kind, seed) {
  // A figure of the same outfit if one is free; else a free one re-dressed is
  // too costly (a new figure), so a free one of any outfit is only taken for
  // the same kind; otherwise the walker waits for one.
  const i = R.pool.findIndex((f) => !f.busy && f.kind === kind);
  if (i >= 0) {
    R.pool[i].busy = true;
    return R.pool[i];
  }
  if (R.pool.length < R.poolMax) {
    const f = { kind, p: person(kind, seed), busy: true };
    R.group.add(f.p);
    R.pool.push(f);
    return f;
  }
  return null;
}

function freeFigure(f) {
  if (!f) return;
  f.busy = false;
  f.p.visible = false;
}

function takeCart(R, kind) {
  mats();
  let c = R.cartPool.find((k) => !k.busy);
  if (!c) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.95, 0.9), cartMats[kind]);
    mesh.name = 'lfo-cart';
    mesh.visible = false;
    R.group.add(mesh);
    c = { mesh, busy: false };
    R.cartPool.push(c);
  }
  c.busy = true;
  c.mesh.material = cartMats[kind];
  c.mesh.visible = true;
  return c;
}

function freeCart(c) {
  if (!c) return;
  c.busy = false;
  c.mesh.visible = false;
}

/**
 * Release a wave: its people (and carts) start out from their origin, each a
 * little behind the one before, along the origin's path to the gate and then
 * the ramp. Two people per cart push it at the cart's pace.
 */
function releaseWave(R, w, sim) {
  if (R.released.has(w.id)) return;
  R.released.add(w.id);
  if (R.phase !== 'boarding') {
    // The ramp is up: this wave is not coming out to a closed aeroplane. Counted as left behind at the end.
    return;
  }
  const O = origins();
  const spec = WAVES.find((x) => x.id === w.id);
  if (!O || !spec) return;
  const o = O[spec.from];
  if (!o) return;
  let seed = 100 + WAVES.indexOf(spec) * 31;
  const walkers = [];
  spec.people.forEach((kind, i) => {
    const side = (i % 2 ? 1 : -1) * (0.6 + (i % 3) * 0.25);
    walkers.push({
      wave: w.id, kind, seed: seed++, side, delay: i * 0.55,
      x: o.spawn.x + side, z: o.spawn.z + i * 0.9, path: o.path.slice(), leg: 0,
      state: 'queued', fig: null, cart: null, onRamp: false, waitSlot: -1, origin: { ...o.spawn }, speed: SPEED[kind] || 3,
    });
  });
  // Carts: the last two people of the wave per cart push it (they are its crew; they move at its pace).
  spec.cargo.forEach((kind, k) => {
    const crew = walkers.slice(Math.max(0, walkers.length - 2 * (k + 1)), walkers.length - 2 * k);
    const cart = {
      wave: w.id, kind, x: o.spawn.x, z: o.spawn.z + 4 + k * 3, path: o.path.slice(), leg: 0, state: 'queued', mesh: null, crew, onRamp: false, delay: 1.2 + k * 1.5, origin: { ...o.spawn },
    };
    for (const c of crew) {
      c.cart = cart;
      c.speed = SPEED.cart;
    }
    R.carts.push(cart);
  });
  R.walkers.push(...walkers);
  if (sim && !R.saidWave.has(w.id)) {
    R.saidWave.add(w.id);
    const where = { edge: 'on the apron', gate: 'at the gate', door: 'out of the blast door', annex: 'from the annex', far: 'from the far huts — a long way out' }[spec.from] || '';
    note(sim, `${spec.people.length} more coming ${where}${spec.cargo.length ? `, with ${spec.cargo.length === 1 ? 'a cart' : `${spec.cargo.length} carts`}` : ''}.`, 'info', 4);
  }
}

/** The point a walker is heading for now: the next bend, or the foot of the ramp. */
function nextPoint(w, geom) {
  if (w.leg < w.path.length) return w.path[w.leg];
  return geom ? geom.foot : null;
}

function moveToward(w, tx, tz, speed, dt) {
  const ex = tx - w.x;
  const ez = tz - w.z;
  const dist = Math.hypot(ex, ez);
  if (dist < 1e-3) return 0;
  const step = Math.min(speed * dt, dist);
  w.x += (ex / dist) * step;
  w.z += (ez / dist) * step;
  return dist;
}

function faceToward(obj, ex, ez) {
  if (Math.abs(ex) + Math.abs(ez) > 1e-4) obj.rotation.y = Math.atan2(-ex, -ez);
}

/**
 * Everybody, one frame. People spawn when a figure is free, follow their
 * path to the ramp's foot, queue there (RAMP_SLOTS on the ramp at once), walk
 * up it to the hold and go aboard. A cart's crew keep station on the cart. On
 * 'leaving', anyone not on the ramp turns for where they came from and is
 * gone when they get there; anyone already on it comes in.
 */
function stepPeople(R, sim, dt) {
  const geom = rampOf(sim);
  const ac = sim.aircraft;
  const moving = !!(geom && geom.moving) || !ac || !ac.onGround;
  const rampOpen = !!(geom && geom.open) && R.phase === 'boarding';
  let onRamp = 0;
  for (const w of R.walkers) if (w.onRamp && w.state === 'out') onRamp++;
  for (const c of R.carts) if (c.onRamp && c.state === 'out') onRamp += 2;

  /* ---- carts ---- */
  for (const c of R.carts) {
    if (c.state === 'done' || c.state === 'left') continue;
    if (c.state === 'queued') {
      if (R.phase !== 'boarding') { c.state = 'left'; continue; }
      c.delay -= dt;
      if (c.delay > 0) continue;
      c.cartRef = takeCart(R, c.kind);
      c.state = 'out';
    }
    const m = c.cartRef.mesh;
    if (R.phase !== 'boarding' && !c.onRamp) {
      // Left where it stands: the crew turn back without it.
      c.state = 'left';
      continue;
    }
    if (c.onRamp) {
      const to = geom ? geom.inside : null;
      if (to) {
        const d = moveToward(c, to.x, to.z, SPEED.cart * 0.8, dt);
        faceToward(m, to.x - c.x, to.z - c.z);
        m.position.set(c.x, rampHeight(geom, c.x, c.z) + 0.5, c.z);
        if (d < 0.4) {
          c.state = 'done';
          R.cargo++;
          R.cargoPts += CARGO[c.kind].points;
          freeCart(c.cartRef);
          note(sim, `${CARGO[c.kind].label} aboard.`, 'good', 2.5);
        }
      }
      continue;
    }
    const tgt = nextPoint(c, geom);
    if (!tgt) continue;
    const atFoot = c.leg >= c.path.length;
    const dist = flat(c.x, c.z, tgt.x, tgt.z);
    // At the foot: onto the ramp when it is down, nothing is moving and there is room for the cart and its crew.
    if (atFoot && dist < 1.6) {
      if (rampOpen && !moving && onRamp + 2 <= RAMP_SLOTS + 1) {
        c.onRamp = true;
        onRamp += 2;
        for (const p of c.crew) { p.onRamp = true; p.state = 'out'; }
      }
      m.position.set(c.x, heightAt(c.x, c.z) + 0.5, c.z);
      continue;
    }
    if (!atFoot && dist < 1.2) c.leg++;
    // A cart does not push itself: it waits for both of its crew to be out and on it (a crew member still
    // waiting for a figure, or lagging, would otherwise chase it across the yard — and through the block).
    const crewOn = c.crew.every((p) => p.state === 'out' && flat(p.x, p.z, c.x, c.z) < 4);
    const hold = (atFoot && moving) || !crewOn;
    if (!hold) {
      moveToward(c, tgt.x, tgt.z, SPEED.cart, dt);
      faceToward(m, tgt.x - c.x, tgt.z - c.z);
    }
    m.position.set(c.x, heightAt(c.x, c.z) + 0.5, c.z);
  }

  /* ---- people ---- */
  // Out of the door on their time whether or not a figure is free: a walker
  // without one still runs its route (so Low, with its smaller pool, is the
  // same game), and the figures go to whoever is nearest the ramp.
  for (const w of R.walkers) {
    if (w.state !== 'queued') continue;
    if (R.phase !== 'boarding') { w.state = 'gone'; continue; }
    w.delay -= dt;
    if (w.delay <= 0) w.state = 'out';
  }
  const unseen = R.walkers.filter((w) => !w.fig && (w.state === 'out' || w.state === 'turned'));
  if (unseen.length) {
    const foot = geom ? geom.foot : null;
    const far = (w) => (foot ? flat(w.x, w.z, foot.x, foot.z) : 0) + (w.state === 'turned' ? 1e5 : 0);
    unseen.sort((a, b) => far(a) - far(b));
    for (const w of unseen) {
      const f = takeFigure(R, w.kind, w.seed);
      if (!f) break;
      w.fig = f;
      f.p.visible = true;
      f.p.position.set(w.x, heightAt(w.x, w.z), w.z);
    }
  }
  let waitRank = 0;
  for (const w of R.walkers) {
    if (w.state === 'aboard' || w.state === 'gone' || w.state === 'queued') continue;
    const p = w.fig ? w.fig.p : null;
    /** Put the figure (if this walker has one) where the walker is, facing (ex, ez), at this pace. */
    const place = (y, ex, ez, speed) => {
      if (!p) return;
      faceToward(p, ex, ez);
      p.position.set(w.x, y, w.z);
      posePerson(p, dt, { speed });
    };
    // A cart's crew: station behind the cart, at its pace; aboard with it.
    if (w.cart) {
      const c = w.cart;
      if (c.state === 'done') {
        w.state = 'aboard';
        R.saved++;
        freeFigure(w.fig);
        w.fig = null;
        continue;
      }
      if (c.state === 'left' && w.state !== 'turned') {
        w.cart = null;
        w.speed = SPEED[w.kind] || 3;
        turnBack(w);
      } else if (c.state === 'out' || c.state === 'queued') {
        const k = c.crew.indexOf(w);
        const m = c.cartRef ? c.cartRef.mesh : null;
        const ry = m ? m.rotation.y : 0;
        // Behind the cart (its heading is -z in its frame): a metre back, half a metre to each side.
        const bx = (k === 0 ? -0.55 : 0.55);
        const bz = 1.1;
        const sx = c.x + Math.cos(ry) * bx + Math.sin(ry) * bz;
        const sz = c.z - Math.sin(ry) * bx + Math.cos(ry) * bz;
        const d = moveToward(w, sx, sz, SPEED.cart * 1.4, dt);
        place(c.onRamp && geom ? rampHeight(geom, w.x, w.z) : heightAt(w.x, w.z), c.x - w.x, c.z - w.z, d > 0.05 ? SPEED.cart : 0);
        continue;
      }
    }
    if (w.state === 'turned') {
      // Back the way they came, and gone at the door.
      const d = moveToward(w, w.origin.x, w.origin.z, w.speed, dt);
      place(heightAt(w.x, w.z), w.origin.x - w.x, w.origin.z - w.z, w.speed);
      if (d < 1.5) {
        w.state = 'gone';
        freeFigure(w.fig);
        w.fig = null;
      }
      continue;
    }
    if (w.onRamp) {
      const to = geom ? geom.inside : null;
      if (!to) continue;
      const d = moveToward(w, to.x, to.z, w.speed * 0.75, dt);
      place(rampHeight(geom, w.x, w.z), to.x - w.x, to.z - w.z, w.speed * 0.75);
      if (d < 0.35) {
        w.state = 'aboard';
        R.saved++;
        freeFigure(w.fig);
        w.fig = null;
      }
      continue;
    }
    if (R.phase !== 'boarding') {
      turnBack(w);
      continue;
    }
    const tgt = nextPoint(w, geom);
    if (!tgt) continue;
    const atFoot = w.leg >= w.path.length;
    if (atFoot) {
      // The queue at the foot: a slot each, a stride apart, back along the way they came — for
      // whoever is near it. Somebody still a long way out (past the gate, on the open apron) has no
      // place in it yet: ranks given out by walking order left the head of the queue 150 m away and
      // the people at the foot standing behind an empty slot.
      const fx = tgt.x;
      const fz = tgt.z;
      const near = flat(w.x, w.z, fx, fz) < 14;
      const r = near ? waitRank++ : 0;
      const bx = geom ? geom.hinge.x - geom.foot.x : 0;
      const bz = geom ? geom.hinge.z - geom.foot.z : 1;
      const L = Math.hypot(bx, bz) || 1;
      const ux = bx / L;
      const uz = bz / L;
      const slotX = fx - ux * (1.2 + r * 1.1) + (-uz) * w.side;
      const slotZ = fz - uz * (1.2 + r * 1.1) + ux * w.side;
      const dSlot = moveToward(w, slotX, slotZ, w.speed, dt);
      place(heightAt(w.x, w.z), fx - w.x, fz - w.z, dSlot > 0.12 ? Math.min(w.speed, dSlot / Math.max(dt, 1e-3)) : 0);
      // The head of the queue steps onto the ramp when it is down, still, and has room.
      if (near && r === 0 && flat(w.x, w.z, fx, fz) < 2.2 && rampOpen && !moving && onRamp < RAMP_SLOTS) {
        w.onRamp = true;
        onRamp++;
        waitRank--;
      }
      continue;
    }
    const dist = flat(w.x, w.z, tgt.x, tgt.z);
    if (dist < 1.2) {
      w.leg++;
      continue;
    }
    moveToward(w, tgt.x, tgt.z, w.speed, dt);
    place(heightAt(w.x, w.z), tgt.x - w.x, tgt.z - w.z, w.speed);
  }
}

function turnBack(w) {
  if (w.state === 'turned' || w.state === 'gone' || w.state === 'aboard') return;
  w.state = 'turned';
  w.cart = null;
}

/* ------------------------------------------------------------------ */
/* The clock, the sectors, the warhead                                 */
/* ------------------------------------------------------------------ */

function audioOk(sim) {
  const a = sim && sim.audio;
  return !!(a && a.available && a.mixer && !a.mixer.muted && a.mixer.busEnabled('environment'));
}

/** A low tone from the Site, if the player has sound on. Never otherwise. */
function lowTone(sim, { freq = 110, to = 70, duration = 1.6, gain = 0.05 } = {}) {
  if (!audioOk(sim)) return false;
  try {
    sim.audio.mixer.tone({ bus: 'environment', freq, duration, gain, type: 'sine', attack: 0.3, sweepTo: to });
    return true;
  } catch (e) {
    return false;
  }
}

function note(sim, text, kind = 'info', seconds = 4) {
  try {
    if (sim && sim.hud && sim.hud.notify) sim.hud.notify(text, kind, seconds);
  } catch (e) {
    /* no HUD */
  }
}

function loseSector(R, sim, i) {
  const lamp = R.lamps[i];
  if (lamp && !lamp.lost) lamp.lost = true;
  R.lost = Math.max(R.lost, i + 1);
  // The Site's own lamps dim with each sector, to a glimmer when the strip's goes (eased there in stepLamps).
  R.siteWant = i >= SECTORS.length - 1 ? 0.12 : 1 - (R.lost / SECTORS.length) * 0.8;
  lowTone(sim, { freq: 110, to: 70, duration: 1.6, gain: 0.05 });
  if (i >= SECTORS.length - 1) {
    note(sim, `Sector ${SECTORS[i]} lost — the strip is next. About ${STRIP_GRACE_S} seconds.`, 'warn', 6);
  } else {
    note(sim, `Sector ${SECTORS[i]} lost.`, 'warn', 3.5);
  }
}

function stripLost(R, sim) {
  R.stripLost = true;
  R.stripLostAt = R.t;
  R.siteWant = 0;
  for (const l of R.lamps) l.lost = true;
  lowTone(sim, { freq: 70, to: 40, duration: 3.2, gain: 0.08 });
}

function detonate(R, sim) {
  if (R.blast) return;
  const c = siteCentre();
  const ac = sim.aircraft;
  const d = ac && ac.pos ? flat(ac.pos.x, ac.pos.z, c.x, c.z) : Infinity;
  const onGround = !!(ac && ac.onGround);
  R.blast = { at: R.t, dist: d, outcome: blastOutcome(d, onGround), arrives: d / SOUND_SPEED, waved: false, waveT: 0 };
  R.warhead = 0;
  if (R.dome) {
    R.dome.visible = true;
    R.domeSmooth.v = 0;
  }
  if (R.column) R.column.visible = true;
  if (R.blast.outcome === 'ground') {
    fail(R, sim, 'The warhead went while you were still on the ground.');
  } else {
    note(sim, 'Behind you: the warhead. Hold the wings level — the pressure wave is coming.', 'warn', 6);
  }
}

function fail(R, sim, reason) {
  if (R.failReason) return;
  R.failReason = reason;
  R.failAt = R.t;
  // The clock stops here: the weather's turbulence goes back to its own at once.
  if (sim && sim.weather && R.turbWas != null) {
    sim.weather.turbulenceScale = R.turbWas;
    R.turbWas = null;
  }
  R.result = { kind: 'failed', reason, saved: R.saved, left: TOTAL_PEOPLE - R.saved, cargo: R.cargo, cargoPts: R.cargoPts, seed: R.seed };
}

/** The pressure wave, when it reaches you: `k` 0..1 over its three seconds. */
function stepWave(R, sim, dt) {
  const B = R.blast;
  if (!B) return;
  const since = R.t - B.at;
  if (since < B.arrives) return;
  const ac = sim.aircraft;
  if (!B.waved) {
    B.waved = true;
    const s = waveStrength(B.dist);
    if (sim.rig && typeof sim.rig.kick === 'function') sim.rig.kick(0.5 + 0.8 * s);
    if (audioOk(sim)) {
      try {
        sim.audio.mixer.noiseBurst({ bus: 'environment', duration: 2.4, gain: 0.18 * s, type: 'lowpass', freq: 160, q: 0.6, attack: 0.05, pink: true });
      } catch (e) {
        /* no audio */
      }
    }
    if (sim.weather) {
      R.turbWas = sim.weather.turbulenceScale;
      sim.weather.turbulenceScale = (R.turbWas || 1) * (2 + 3 * s);
    }
    if (B.outcome === 'close') note(sim, 'The pressure wave — too close.', 'bad', 4);
    else note(sim, 'The pressure wave. Hold it steady.', 'warn', 4);
  }
  B.waveT += dt;
  const T = B.waveT;
  const s = waveStrength(B.dist);
  if (T < 3 && ac && ac.omega && !ac.onGround) {
    // A filtered gust: a heave, a roll and a pitch on slow sines, strong for a moment, dying over three seconds.
    const env = Math.exp(-T / 1.1) * s;
    ac.omega.x += Math.sin(T * 5.1) * 0.9 * env * dt;
    ac.omega.z += Math.sin(T * 3.7 + 1) * 1.4 * env * dt;
    if (ac.vel) ac.vel.y += Math.sin(T * 4.3) * 6 * env * dt;
  }
  if (T > 6 && sim.weather && R.turbWas != null) {
    sim.weather.turbulenceScale = R.turbWas;
    R.turbWas = null;
  }
  if (B.outcome === 'close' && T > 1.2 && !R.failReason) {
    fail(R, sim, 'Too close to the blast.');
  }
}

function stepDome(R, dt) {
  const d = R.dome;
  if (!d || !R.blast) return;
  const since = R.t - R.blast.at;
  // The dome: a sphere that grows for seven seconds and fades over twelve.
  const grow = Math.min(1, since / 7);
  const radius = 80 + 1100 * Math.pow(grow, 0.55);
  d.scale.setScalar(radius);
  // Bright at once (through the smoother: a rise over a third of a second, not one frame), then down.
  const want = since < 2.5 ? 1 : Math.max(0, 1 - (since - 2.5) / 12);
  const cap = dim(0.85, CAPS.blastSprite);
  const level = R.domeSmooth.step(want, dt) * cap;
  d.material.opacity = level;
  // Warm white to a deep orange as it cools.
  const k = Math.min(1, since / 6);
  d.material.color.setRGB(1, 0.76 - 0.36 * k, 0.44 - 0.3 * k);
  if (since > 15) d.visible = false;
  const col = R.column;
  if (col) {
    // Up out of the dome from the third second: to 2,400 m tall and 500 m across over twenty seconds, darkening, then thinning.
    const u = Math.max(0, Math.min(1, (since - 2.5) / 20));
    const h = 60 + 2400 * Math.pow(u, 0.7);
    col.scale.set(120 + 380 * u, h, 120 + 380 * u);
    col.position.y = heightAt(col.position.x, col.position.z) + h / 2;
    col.material.opacity = u <= 0 ? 0 : Math.min(0.55, u * 1.4) * Math.max(0, 1 - Math.max(0, since - 40) / 40);
    if (since > 80) col.visible = false;
  }
}

function stepLamps(R, sim, dt) {
  const night = sim.weather && sim.weather.isNight ? 1 : 0.6;
  // The Site's floodlights and beams follow the sectors down over about a second and a half — a dimming, not a cut.
  if (R.siteNow !== R.siteWant) {
    const k = Math.min(1, dt / 0.5);
    R.siteNow = Math.abs(R.siteWant - R.siteNow) < 0.004 ? R.siteWant : R.siteNow + (R.siteWant - R.siteNow) * k;
    setSiteLights(R.siteNow);
  }
  for (const l of R.lamps) {
    // Lit → dark over about 1.5 s (a dimming); the red lamp a slow pulse on the beacon's period, capped like the beacons.
    const want = l.lost ? 0 : 1;
    l.lit += (want - l.lit) * Math.min(1, dt / 0.6);
    l.headMat.emissiveIntensity = (0.3 + 1.3 * night) * l.lit;
    const redCap = FLASH.reduce ? 0.5 + 0.5 * CAPS.strobe : 1;
    l.redMat.opacity = l.lost && !R.stripLost ? blinkLevel(E.t, 2.6, 0.5, 0.3) * 0.9 * redCap : l.lost ? 0.3 * redCap : 0;
  }
}

/* ------------------------------------------------------------------ */
/* The HUD card and the button                                         */
/* ------------------------------------------------------------------ */

const CSS = `
.lfo-card { position: absolute; right: 18px; top: 38%; min-width: 196px; padding: 8px 10px 8px 12px; border-radius: 14px;
  background: rgba(14,16,24,.78); border: 1px solid rgba(255,120,100,.28); color: var(--text, #eaf1fb);
  font: 600 12px/1.25 var(--font, system-ui, sans-serif); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
  display: none; user-select: none; }
.lfo-card.is-shown { display: block; }
.hud-rstack > .lfo-card { position: static; align-self: flex-end; }
.hud-rstack > .lfo-card:not(.is-shown) { display: none !important; }
.lfo-title { font-size: 10.5px; letter-spacing: .14em; text-transform: uppercase; color: #ff9d8a; margin-bottom: 4px; }
.lfo-row { display: flex; justify-content: space-between; gap: 10px; white-space: nowrap; margin: 2px 0; }
.lfo-row b { font-variant-numeric: tabular-nums; }
.lfo-row.is-hot b { color: #ffb3a3; }
.lfo-row.is-lost b { color: #ff7a66; }
.lfo-btn { pointer-events: auto; margin-top: 6px; width: 100%; display: inline-flex; align-items: center; justify-content: center; gap: 7px;
  padding: 8px 10px; border-radius: 10px; border: 1px solid rgba(255,140,120,.5); background: rgba(190,60,45,.35); color: #fff;
  cursor: pointer; font: 700 12px/1 var(--font, system-ui, sans-serif); touch-action: manipulation; }
.lfo-btn:hover { background: rgba(190,60,45,.5); }
.lfo-btn[hidden] { display: none; }
.lfo-btn kbd { font: 700 10px/1 var(--mono, ui-monospace, monospace); min-width: 16px; padding: 2px 4px 1px; text-align: center; border-radius: 5px;
  border: 1px solid rgba(255,255,255,.22); border-bottom-width: 2px; background: rgba(255,255,255,.08); color: #eaf1fb; }
.lfo-btn kbd:empty { display: none; }
.lfo-card.is-touch .lfo-btn { min-height: 46px; font-size: 13px; }
/* The big round button: on the right between the touch pads (their top is 260 px up) and the floor of the
   HUD's right-hand column (376 px up, styles/main.css --rs-bottom), clear of both. Under 700 px tall there is
   no room (measured: at 1024x600 it sat on this card; at 740x360 above the screen, over the HUD's buttons):
   there the card's own button, 46 px tall, is the big button, and the pads keep their CLOSE RAMP. And if
   anything in the column grows down onto it, it steps aside (updateUi, .is-crowded). */
.lfo-go { position: fixed; right: 18px; bottom: 272px; width: 92px; height: 92px; border-radius: 50%; z-index: 31; pointer-events: auto;
  border: 2px solid rgba(255,255,255,.35); color: #fff; font: 800 13px/1.1 var(--font, system-ui, sans-serif); letter-spacing: .04em;
  background: radial-gradient(circle at 35% 30%, #ff8a74, #d7483a 60%, #8f2a21); box-shadow: 0 5px 0 #3a1210, 0 8px 22px rgba(0,0,0,.4);
  touch-action: manipulation; user-select: none; -webkit-user-select: none; }
.lfo-go.is-down { transform: translateY(3px); box-shadow: 0 2px 0 #3a1210; }
.lfo-go[hidden] { display: none !important; }
@media (max-height: 700px) { .lfo-go { display: none !important; } }
.lfo-go.is-crowded { display: none !important; }
.lfo-fade { position: fixed; inset: 0; background: #000; opacity: 0; pointer-events: none; z-index: 29; transition: opacity 2.5s linear; }
.lfo-fade[hidden] { display: none; }
`;

function buildUi(sim) {
  if (E.ui || typeof document === 'undefined') return E.ui;
  const style = document.createElement('style');
  style.id = 'ifs-lfo-style';
  style.textContent = CSS;
  document.head.appendChild(style);
  const card = document.createElement('div');
  card.className = 'lfo-card';
  card.setAttribute('role', 'status');
  card.innerHTML = `
    <div class="lfo-title">Last flight out</div>
    <div class="lfo-row lfo-warhead"><span>Warhead</span><b>4:00</b></div>
    <div class="lfo-row lfo-breach"><span>Breach</span><b>—</b></div>
    <div class="lfo-row lfo-aboard"><span>Aboard</span><b>0 / ${TOTAL_PEOPLE}</b></div>
    <div class="lfo-row lfo-cargo"><span>Cargo</span><b>0 / ${TOTAL_CARGO}</b></div>
    <button class="lfo-btn" type="button" aria-label="Close the ramp and go"><span>CLOSE RAMP · GO</span><kbd></kbd></button>`;
  const layer = extLayer();
  layer.appendChild(card);
  const go = document.createElement('button');
  go.type = 'button';
  go.className = 'lfo-go';
  go.hidden = true;
  go.setAttribute('aria-label', 'Close the ramp and go');
  go.textContent = 'CLOSE RAMP';
  const press = (on) => (e) => {
    if (e && e.cancelable) e.preventDefault();
    go.classList.toggle('is-down', on);
    if (on) closeRamp(sim, 'button');
  };
  go.addEventListener('pointerdown', (e) => {
    try { go.setPointerCapture(e.pointerId); } catch (err) { /* a synthetic event */ }
    press(true)(e);
  });
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) go.addEventListener(ev, press(false));
  layer.appendChild(go);
  const fade = document.createElement('div');
  fade.className = 'lfo-fade';
  fade.hidden = true;
  layer.appendChild(fade);
  const q = (s) => card.querySelector(s);
  const btn = q('.lfo-btn');
  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    closeRamp(sim, 'card');
  });
  E.ui = {
    card, go, fade, btn, key: q('.lfo-btn kbd'),
    warhead: q('.lfo-warhead b'), breach: q('.lfo-breach b'), breachRow: q('.lfo-breach'), aboard: q('.lfo-aboard b'), cargo: q('.lfo-cargo b'), warheadRow: q('.lfo-warhead'),
    stacked: false, shown: '',
    touch: !!sim.touch || (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches),
  };
  card.classList.toggle('is-touch', E.ui.touch);
  return E.ui;
}

function joinStack(sim) {
  const ui = E.ui;
  const stack = sim && sim.hud && sim.hud.stack;
  if (!ui || ui.stacked || !stack || typeof stack.add !== 'function' || !stack.el) return;
  // keep: a card with a button to answer never waits off screen (hud-stack.js) — on a landscape phone the
  // column has no room down the right and moves into the map's corner, and this card goes with it.
  stack.add(ui.card, { prio: 1, id: 'last-flight', chip: false, keep: true });
  ui.stacked = true;
}

function syncKeys(sim) {
  const ui = E.ui;
  if (!ui || ui.keysVer === bindingsVersion()) return;
  ui.keysVer = bindingsVersion();
  ui.key.textContent = ui.touch ? '' : keyName('lastFlightClose', sim);
}

function updateUi(R, sim) {
  const ui = E.ui;
  if (!ui) return;
  joinStack(sim);
  // A touch screen found after the card was built (the first touch): the big button and the big card button.
  if (!ui.touch && sim.touch) {
    ui.touch = true;
    ui.card.classList.add('is-touch');
    ui.keysVer = -1;
  }
  const on = !!R && sim.state === 'flying' && !(sim.hud && (sim.hud.enabled === false || sim.hud.hidden));
  if (ui.card.classList.contains('is-shown') !== on) ui.card.classList.toggle('is-shown', on);
  const goOn = on && ui.touch && R.phase === 'boarding';
  if (ui.go.hidden === goOn) ui.go.hidden = !goOn;
  // Twice a second while it shows: does the right-hand column (this card, a warning above it) reach down onto it?
  if (goOn && E.t - (ui.crowdT || 0) > 0.5) {
    ui.crowdT = E.t;
    const col = ui.stacked ? ui.card.parentElement : ui.card;
    const a = col && col.getBoundingClientRect ? col.getBoundingClientRect() : null;
    ui.go.classList.remove('is-crowded');
    const b = ui.go.getBoundingClientRect ? ui.go.getBoundingClientRect() : null;
    if (a && b && b.width > 0 && a.bottom > b.top - 8 && a.left < b.right && a.right > b.left) ui.go.classList.add('is-crowded');
  }
  if (!on) return;
  syncKeys(sim);
  const boarding = R.phase === 'boarding';
  if (ui.btn.hidden === boarding) ui.btn.hidden = !boarding;
  const next = R.lost < SECTORS.length ? SECTORS[R.lost] : null;
  const breach = R.stripLost ? 'at the strip' : R.lost === 0 ? `all sectors held${next ? ` · ${next} next` : ''}` : `Sector ${SECTORS[R.lost - 1]} lost${next ? ` · ${next} next` : ' · strip next'}`;
  const key = `${fmtClock(R.warhead)}|${breach}|${R.saved}|${R.cargo}|${boarding}`;
  if (key === ui.shown) return;
  ui.shown = key;
  ui.warhead.textContent = R.blast ? 'detonated' : fmtClock(R.warhead);
  ui.warheadRow.classList.toggle('is-hot', !R.blast && R.warhead < 60);
  ui.breach.textContent = breach;
  ui.breachRow.classList.toggle('is-hot', R.lost >= SECTORS.length - 1);
  ui.breachRow.classList.toggle('is-lost', R.stripLost);
  ui.aboard.textContent = `${R.saved} / ${TOTAL_PEOPLE}`;
  ui.cargo.textContent = `${R.cargo} / ${TOTAL_CARGO}`;
}

function hideUi() {
  const ui = E.ui;
  if (!ui) return;
  ui.card.classList.remove('is-shown');
  ui.go.hidden = true;
  ui.fade.hidden = true;
  ui.fade.style.opacity = '0';
  ui.shown = '';
}

/* ------------------------------------------------------------------ */
/* The controls                                                        */
/* ------------------------------------------------------------------ */

registerActions({
  // The ramp key itself (a share by design, like Space = brakes and fire): during the mission closing the ramp IS the decision.
  lastFlightClose: { label: 'Last Flight Out: close the ramp and go', group: 'Missions & events', ctx: ['plane'], default: ['Digit6'] },
});

/**
 * The decision: close the ramp. Everyone not on it turns back; it comes up
 * in RAMP_CLOSE_S seconds and you go. Returns whether this press was it.
 */
export function closeRamp(sim, how = 'key') {
  const R = E.run;
  if (!R || R.phase !== 'boarding' || !sim) return false;
  const cargo = sim.model && sim.model.userData && sim.model.userData.cargo;
  if (cargo && cargo.target > 0.5) {
    // Through the ramp feature when it is there (its own words and its panel), else the model.
    if (how !== 'ramp') {
      try {
        pressRamp(sim);
      } catch (e) {
        cargo.close();
      }
    }
  }
  leave(R, sim);
  return true;
}

function leave(R, sim) {
  if (R.phase !== 'boarding') return;
  R.phase = 'leaving';
  R.leftAt = R.t;
  holdGateOpen(false);
  const coming = R.walkers.filter((w) => w.state === 'out' && !w.onRamp).length;
  note(sim, coming ? `Ramp coming up. ${coming} turn back for the hangar.` : 'Ramp coming up.', coming ? 'warn' : 'good', 4);
}

/* ------------------------------------------------------------------ */
/* The debrief                                                         */
/* ------------------------------------------------------------------ */

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

/** Stars like the briefing's (ui/briefing.js STAR_SCORES), drawn here so the debrief needs nothing of it. */
export function starsFor(score) {
  return score >= 88 ? 3 : score >= 68 ? 2 : score >= 45 ? 1 : 0;
}

/** The mission's own debrief, from the run: the winning one. */
export function debriefFor(res, shown, sim) {
  const stars = starsFor(res.score);
  const glyphs = [0, 1, 2].map((i) => `<span style="font-size:22px;color:${i < stars ? '#ffd166' : 'rgba(255,255,255,.22)'}">★</span>`).join('');
  const margin = res.marginS == null ? '—' : res.marginS <= 0 ? 'none' : `${Math.round(res.marginS)} s`;
  const l = res.landing;
  const rows = [
    `<li>Saved <b>${res.saved} of ${res.total}</b></li>`,
    `<li>Left behind <b>${res.left}</b></li>`,
    `<li>Cargo <b>${res.cargo} of ${TOTAL_CARGO}</b></li>`,
    `<li>Margin before the warhead <b>${esc(margin)}</b></li>`,
    l ? `<li>Landing <b>${l.score}/100</b> (${esc(l.quality)})</li>` : '',
    debriefPayRow(shown && shown.paid) || '',
  ].join('');
  const words = res.saved >= res.total
    ? 'Everybody. Nobody flies that any better.'
    : res.saved === 0
      ? 'You made it out — with an empty hold. Wait for the first group next time; they are closer than they look.'
      : res.left > res.saved
        ? 'Out, and alive. More than half were left on the apron; the clock allows one more wave than that.'
        : 'Well flown. The last wave is the gamble — the strip\'s sector gives you twenty seconds.';
  return {
    title: 'Last flight out — made it',
    kind: (shown && shown.kind) || 'good',
    body: `
      <div class="debrief-score">${res.score}<span>/100</span></div>
      <div role="img" aria-label="${stars} out of 3 stars" style="margin:-4px 0 6px;letter-spacing:4px">${glyphs}</div>
      <ul class="debrief-list">${rows}</ul>
      <p>${esc(words)}</p>
    `,
    actions: (shown && shown.actions) || [
      { label: 'Fly again', onClick: () => sim.restart(), primary: true },
      { label: 'Missions', onClick: () => sim.quitToMenu('missions') },
      { label: 'Main menu', onClick: () => sim.quitToMenu('main') },
    ],
  };
}

/** The calm one-liner for a loss, and Retry (a new seed: the runs differ). */
export function lossDebriefFor(res, shown, sim) {
  const line = {
    strip: 'Containment was lost at the strip.',
    ground: 'The warhead went while you were still on the ground.',
    close: 'Too close to the blast.',
  }[res.why] || res.reason || 'The mission ended.';
  return {
    title: 'Last flight out',
    kind: 'bad',
    body: `<p class="debrief-reason">${esc(line)}</p><p>${res.saved ? `${res.saved} were aboard. ` : ''}Nobody is hurt in this simulator. Retry draws a new run — the waves and the sectors fall differently.</p>`,
    actions: [
      { label: 'Retry', onClick: () => sim.restart(), primary: true },
      { label: 'Missions', onClick: () => sim.quitToMenu('missions') },
      { label: 'Main menu', onClick: () => sim.quitToMenu('main') },
    ],
  };
}

function wrapDebrief(sim) {
  const menus = sim && sim.menus;
  if (!menus || typeof menus.showDebrief !== 'function' || menus.showDebrief.__lastFlight) return;
  const orig = menus.showDebrief;
  const wrapped = function (opts) {
    let o = opts;
    try {
      const R = E.run;
      const res = R && R.result;
      const mine = sim.runner && sim.runner.def && sim.runner.def.id === ID;
      if (res && mine && o && !o.__lastFlight) {
        if (res.kind === 'landed' && o.kind !== 'bad') o = { ...debriefFor(res, o, sim), __lastFlight: true };
        else if (res.kind === 'failed' && o.kind === 'bad') o = { ...lossDebriefFor(res, o, sim), __lastFlight: true };
      }
    } catch (e) {
      o = opts;
    }
    return orig.call(this, o);
  };
  wrapped.__lastFlight = true;
  menus.showDebrief = wrapped;
}

/* ------------------------------------------------------------------ */
/* What the mission calls                                              */
/* ------------------------------------------------------------------ */

/**
 * Start a run (the mission's onStart). The seed is the run's: a Retry draws
 * a new one unless the start asked for one (`opts.seed`, the tests).
 */
export function begin(sim, seed = null) {
  const s = Number.isFinite(seed) ? seed >>> 0 : (Math.floor(Math.random() * 0xffffffff) >>> 0) || 1;
  // A run before this one (a Retry): its people, lamps and dome go first.
  teardown();
  const R = fresh(s);
  R.poolMax = poolSize(sim);
  E.run = R;
  E.sim = sim;
  if (sim) {
    buildUi(sim);
    wrapDebrief(sim);
    hideUi();
  }
  holdGateOpen(true);
  setSiteLights(1);
  return R;
}

/** The run in progress (or the last one, until stop), for the mission, the debrief and the tests. */
export function run() {
  return E.run;
}

/** The mission's failIf: the reason, once there is one. */
export function failReason() {
  return E.run ? E.run.failReason : null;
}

/** The mission's onComplete: the landing ends it. */
export function finish(ctx) {
  const R = E.run;
  if (!R) return null;
  const marginS = R.crossedAt == null ? (R.blast ? 0 : R.warhead) : R.crossedAt;
  const l = ctx && ctx.data ? ctx.data.lastTouchdown : null;
  const score = scoreOf({ saved: R.saved, total: TOTAL_PEOPLE, cargoPts: R.cargoPts, cargoMax: cargoPoints(), marginS, landing: l ? l.score : 50 });
  R.result = { kind: 'landed', saved: R.saved, total: TOTAL_PEOPLE, left: TOTAL_PEOPLE - R.saved, cargo: R.cargo, cargoPts: R.cargoPts, marginS, landing: l || null, score, seed: R.seed };
  return R.result;
}

/** The score as the runner asks for it (def.score). */
export function scoreNow(ctx) {
  const R = E.run;
  if (!R) return 0;
  if (R.result && R.result.kind === 'failed') return 0;
  const res = R.result && R.result.kind === 'landed' ? R.result : finish(ctx);
  return res ? res.score : 0;
}

/** A snapshot for the tests and the console. */
export function escapeState() {
  const R = E.run;
  if (!R) return null;
  return {
    seed: R.seed, t: R.t, phase: R.phase, saved: R.saved, cargo: R.cargo, cargoPts: R.cargoPts, lost: R.lost, stripLost: R.stripLost, warhead: R.warhead,
    blast: R.blast ? { ...R.blast } : null, failReason: R.failReason, crossedAt: R.crossedAt, result: R.result,
    out: R.walkers.filter((w) => w.state === 'out').length, turned: R.walkers.filter((w) => w.state === 'turned').length, queued: R.walkers.filter((w) => w.state === 'queued').length,
    released: [...R.released], sched: R.sched, figures: R.pool.length, poolMax: R.poolMax, lamps: R.lamps.map((l) => ({ id: l.id, lost: l.lost, lit: l.lit })),
    carts: R.carts.map((c) => ({ kind: c.kind, state: c.state, onRamp: c.onRamp })),
  };
}

/* ------------------------------------------------------------------ */
/* The extension                                                       */
/* ------------------------------------------------------------------ */

function teardown() {
  const R = E.run;
  if (!R) return;
  for (const f of R.pool) {
    if (f.p.parent) f.p.parent.remove(f.p);
    try { disposePerson(f.p); } catch (e) { /* gone */ }
  }
  for (const c of R.cartPool) if (c.mesh.parent) c.mesh.parent.remove(c.mesh);
  for (const l of R.lamps) {
    for (const m of [l.head, l.red]) if (m.parent) m.parent.remove(m);
    l.headMat.dispose();
    l.redMat.dispose();
  }
  if (R.poleMesh && R.poleMesh.parent) {
    R.poleMesh.parent.remove(R.poleMesh);
    R.poleMesh.geometry.dispose();
  }
  if (R.dome && R.dome.parent) {
    R.dome.parent.remove(R.dome);
    R.dome.material.dispose();
  }
  if (R.column && R.column.parent) {
    R.column.parent.remove(R.column);
    R.column.material.dispose();
  }
  if (E.sim && E.sim.weather && R.turbWas != null) E.sim.weather.turbulenceScale = R.turbWas;
  holdGateOpen(false);
  setSiteLights(1);
  E.run = null;
  hideUi();
}

function ensureBuilt(R, sim) {
  if (R.built) return true;
  const group = siteGroup() || sim.scene;
  if (!group || !cfg()) return false;
  R.group = group;
  buildLamps(R, group);
  buildDome(R, group);
  R.built = true;
  return true;
}

registerExtension({
  id: 'scp-escape',

  install(sim) {
    E.sim = sim;
    buildUi(sim);
    wrapDebrief(sim);
  },

  startMode(sim) {
    // A run that was not begun by the mission's onStart (any other flight starting) is over.
    const r = sim && sim.runner;
    if (!(r && r.def && r.def.id === ID)) teardown();
  },

  stop() {
    teardown();
  },

  update(sim, dt) {
    E.t += dt;
    const R = E.run;
    if (!R) return;
    if (!ensureBuilt(R, sim)) return;
    const running = sim.state === 'flying';
    if (running && !R.result) {
      R.t += dt;
      const ac = sim.aircraft;
      const c = siteCentre();
      const dSite = ac && ac.pos ? flat(ac.pos.x, ac.pos.z, c.x, c.z) : 0;

      // Waves out on their time.
      for (const w of R.sched.waves) if (!R.released.has(w.id) && R.t >= w.at) releaseWave(R, w, sim);

      // Rolling with the ramp down: the loadmaster closes it — you are leaving.
      if (R.phase === 'boarding' && ac && (ac.groundSpeed > 3 || !ac.onGround)) {
        R.rolledFor += dt;
        if (R.rolledFor > 1.5) {
          note(sim, 'Rolling — the loadmaster is raising the ramp.', 'warn', 4);
          closeRamp(sim, 'roll');
        }
      } else R.rolledFor = 0;
      // The ramp closed by any other means (the ramp key through its own feature, the panel, the pad): that is the decision too.
      if (R.phase === 'boarding') {
        const cargo = sim.model && sim.model.userData && sim.model.userData.cargo;
        if (cargo && cargo.target < 0.5) leave(R, sim);
      }
      if (R.phase === 'leaving' && ac && !ac.onGround && ac.airborneTime > 2) R.phase = 'gone';

      // The sectors.
      for (let i = R.lost; i < R.sched.sectors.length; i++) {
        if (R.t >= R.sched.sectors[i].at) loseSector(R, sim, i);
        else break;
      }
      // Caught by the breach: on the ground at the Site and not already away down the strip.
      const caught = !!(ac && ac.onGround && dSite < SITE_RANGE_M && !(ac.groundSpeed >= STRIP_ESCAPE_MS));
      if (!R.stripLost && R.t >= R.sched.stripLostAt) {
        stripLost(R, sim);
        if (!caught && ac && ac.onGround) note(sim, 'The floodlights go out behind you. Keep going.', 'warn', 3);
      }
      // On the ground at the Site, not already away, once the breach is at the strip (then, or stopping or landing
      // back there later): the floodlights are gone, the screen fades to black over 2.5 s, and that is the loss.
      if (R.stripLost && R.fadeAt == null && caught && !R.failReason) {
        R.fadeAt = R.t;
        if (E.ui) {
          E.ui.fade.hidden = false;
          // A moment later, so the CSS transition runs from 0.
          setTimeout(() => { if (E.ui && E.run === R) E.ui.fade.style.opacity = '1'; }, 30);
        }
        note(sim, 'The floodlights are gone.', 'bad', 3);
      }
      if (R.stripLost && R.fadeAt != null && !R.failReason && R.t - R.fadeAt > 2.5) {
        fail(R, sim, 'Containment was lost at the strip.');
        R.result.why = 'strip';
      }

      // The warhead.
      if (!R.blast) {
        R.warhead = Math.max(0, WARHEAD_S - R.t);
        if (R.crossedAt == null && dSite >= BLAST_SAFE_M && ac && !ac.onGround) R.crossedAt = R.warhead;
        if (R.warhead <= 0) {
          detonate(R, sim);
          if (R.result && R.blast.outcome === 'ground') R.result.why = 'ground';
        }
      } else {
        stepWave(R, sim, dt);
        if (R.result && R.result.kind === 'failed' && R.blast.outcome === 'close') R.result.why = 'close';
      }
    }
    // The scene goes on moving through the debrief (the dome behind the words, the people still walking back).
    const dtv = Math.min(dt, 0.1);
    stepPeople(R, sim, dtv);
    stepLamps(R, sim, dtv);
    stepDome(R, dtv);
    updateUi(R, sim);
  },

  key(sim, code, down, e) {
    const R = E.run;
    if (!R || !isKey(sim, 'lastFlightClose', code)) return false;
    if (down && !(e && e.repeat) && R.phase === 'boarding') return closeRamp(sim, 'key');
    return false;
  },

  devActions: [
    {
      label: 'Last Flight Out: warhead in 10 s',
      hint: 'Winds the Alpha Warhead to ten seconds — where are you?',
      run(sim) {
        if (E.run && !E.run.blast) E.run.t = Math.max(E.run.t, WARHEAD_S - 10);
      },
    },
  ],
});

/** Test hooks: wind the run. Nothing in the game calls these. */
export const __escape = {
  get run() { return E.run; },
  /** Make the warhead go in `s` seconds. */
  detonateIn(s) { if (E.run && !E.run.blast) E.run.t = Math.max(E.run.t, WARHEAD_S - Math.max(0, s)); },
  /** Lose sectors up to and including index i, now. */
  loseThrough(i) { if (E.run) for (let k = 0; k <= i && k < E.run.sched.sectors.length; k++) E.run.sched.sectors[k].at = Math.min(E.run.sched.sectors[k].at, E.run.t); },
  /** Bring the breach to the strip in `s` seconds. */
  stripIn(s) { if (E.run) E.run.sched.stripLostAt = E.run.t + Math.max(0, s); },
  /** Release wave `id` now. */
  release(id) { if (E.run) { const w = E.run.sched.waves.find((x) => x.id === id); if (w) w.at = Math.min(w.at, E.run.t); } },
  /** The pure parts, for a test that has the module. */
  schedule, scoreOf, blastOutcome, waveStrength, fmtClock, origins, sectorPosts, startPose, debriefFor, lossDebriefFor,
};
