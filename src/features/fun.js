/**
 * FUN STUFF — "add anything that would make it more fun for kids".
 *
 * Four things, each explained in one line on its own screen (the gold
 * "Fun Stuff" button on the start screen), all saved on this device:
 *
 *   ⭐ STAR HUNT   ten golden stars on every map for each of the four games —
 *                  in the sky for the plane and the helicopter, on the water
 *                  for the boat, on the roads for the car. Gold stars on the
 *                  minimap, 25 credits each and 250 more for the lot.
 *   🎪 STUNTS      barrel rolls, loops, flying upside down or on your side,
 *                  low passes, a helicopter spin, donuts and jumps in the
 *                  car — pop-up points, combos, a best score per game.
 *   💨 SMOKE       T (or the 💨 button) leaves a coloured trail behind any
 *                  aircraft; stickers unlock the colours.
 *   📒 STICKERS    twenty-one of them, each with its "how" printed on it.
 *
 * Plus the Wildfire disaster, which is features/wildfire.js and
 * game/disasters.js; this only gives the Firefighter sticker for putting
 * one out, and says on the Fun Stuff screen where to find it.
 *
 * Nothing in main.js knows any of this is here: it plugs in through
 * game/extensions.js like every other feature, and a fault in it switches
 * off this feature alone. The pure parts — where the stars go, what counts
 * as a stunt, what the stickers and colours are — live in ./fun/ and are
 * tested in node by tests/features/fun.mjs; tests/features/fun.browser.js
 * plays it in the real game.
 */

import * as THREE from '../vendor/three.module.js';
import { registerExtension } from '../game/extensions.js';
import { MAP, AIRPORT, heightAt, harbourMouth } from '../world/terrain.js';
import * as Prog from '../game/progression.js';
import { fireStatus } from './wildfire.js';
import { loadFun, saveFun, totalStars, mapsWithStars, today } from './fun/save.js';
import { findSticker, activeColour, SMOKE_COLOURS, colourUnlocked } from './fun/stickers.js';
import { StuntMeter } from './fun/stunts.js';
import { placeStars, starSetFor, catches } from './fun/stars.js';
import { StarField, Burst, SmokeTrail, rainbowAt, linearRGB } from './fun/fx.js';
import { FunHud, addMenuButton, setMenuCount, buildFunScreen, GAME_WORDS } from './fun/ui.js';

const STAR_CREDITS = 25;
const ALL_STARS_CREDITS = 250;
/** Stunts pay a tenth of their points in credits, up to this much a flight. */
const STUNT_CREDIT_CAP = 150;

const F = {
  sim: null,
  data: null,
  hud: null,
  screen: null,
  menuBtn: null,
  field: null,
  burst: null,
  smoke: null,
  time: 0,
  setKey: null,
  kind: 'air',
  stars: [],
  found: new Set(),
  cache: new Map(),
  meter: new StuntMeter(),
  flightCredits: 0,
  smokeOn: false,
  rgb: [1, 1, 1],
  fireSeen: false,
  nightT: 0,
  colours: 1,
  fresh: new Set(),
  tips: new Set(),
  dirty: false,
  saveT: 0,
  pixelScale: 400,
};

const _tail = new THREE.Vector3();
const _fwd = new THREE.Vector3();

/* ------------------------------------------------------------------ *
 * Who is playing what
 * ------------------------------------------------------------------ */

function craftOf(sim) {
  if (sim.mode === 'drive') return sim.game === 'car' ? 'car' : 'boat';
  const t = sim.aircraftType;
  return t && t.shape && t.shape.power && t.shape.power.rotor ? 'heli' : 'plane';
}

/** Which of the four games this is, for the saves: the boat and the car drive, the others fly. */
function gameOf(sim) {
  const g = sim && sim.game;
  if (sim && sim.mode === 'drive') return g === 'car' ? 'car' : 'boat';
  return g === 'heli' ? 'heli' : 'flight';
}

function playerPos(sim) {
  return sim.mode === 'drive' ? sim.vehicle && sim.vehicle.pos : sim.aircraft && sim.aircraft.pos;
}

/**
 * Stars are out in Free Flight, the boat's Open Water, the car's Island
 * Roads and multiplayer — not in the tutorial, a mission or a courier job,
 * where a gold thing in the sky would be mistaken for the objective.
 */
function starsAllowed(sim) {
  if (sim.mode === 'free') return true;
  if (sim.mode !== 'drive') return false;
  // Open Water runs the lifeboat patrol, which is free sailing with the
  // odd shout for help, not a job with a clock.
  const r = sim.runner;
  const def = r && r.status === 'running' ? r.def : null;
  return !def || def.id === 'boat-patrol' || def.difficulty === 'Free';
}

function crashedNow(sim, craft) {
  if (craft === 'boat' || craft === 'car') return !!(sim.vehicle && sim.vehicle.crashed);
  return !!(sim.aircraft && sim.aircraft.crashed);
}

function calm(sim) {
  const s = sim && sim.settings;
  if (s && s.reducedMotion) return true;
  try {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  } catch (e) {
    return false;
  }
}

function pixelScale(sim) {
  const cam = sim.camera;
  const r = sim.renderer;
  const pr = r && r.getPixelRatio ? r.getPixelRatio() : 1;
  const hgt = (typeof window !== 'undefined' ? window.innerHeight : 800) * pr;
  return hgt / (2 * Math.tan((((cam && cam.fov) || 68) * Math.PI) / 360));
}

function light(sim) {
  const w = sim.weather;
  if (!w) return 1;
  if (w.isNight) return 0.35;
  return w.time === 'sunset' ? 0.7 : 1;
}

/* ------------------------------------------------------------------ *
 * Saving, paying, stickers
 * ------------------------------------------------------------------ */

function markDirty(now = false) {
  F.dirty = true;
  if (now) F.saveT = 0;
  else if (F.saveT <= 0) F.saveT = 2;
}

function flush() {
  if (!F.dirty || !F.data) return;
  saveFun(F.data);
  F.dirty = false;
}

/** Credits into the game's own purse, the same one the hangar spends. */
function pay(sim, n) {
  const p = sim && sim.prog;
  if (!p || !(n > 0)) return;
  p.credits += n;
  p.earned += n;
  Prog.save(p);
  if (sim.menus && sim.menus.syncProgression) sim.menus.syncProgression(p);
}

function chime(sim, kind) {
  const a = sim && sim.audio;
  if (!a || !a.available || !a.alerts) return;
  try {
    if (kind === 'big' && a.alerts.success) a.alerts.success();
    else if (kind === 'star' && a.alerts.checkpoint) a.alerts.checkpoint();
    else if (a.alerts.mixer && a.alerts.mixer.tone) {
      const m = a.alerts.mixer;
      m.tone({ bus: 'alerts', freq: 660, sweepTo: 1320, duration: 0.22, gain: 0.09, type: 'triangle' });
    }
  } catch (e) {
    /* a sound is never worth a thrown frame */
  }
}

function grant(sim, id) {
  if (!F.data || F.data.stickers[id]) return false;
  const s = findSticker(id);
  if (!s) return false;
  F.data.stickers[id] = today();
  F.fresh.add(id);
  markDirty(true);
  // A sticker that opens a smoke colour says so on the same card.
  const colours = SMOKE_COLOURS.filter((c) => colourUnlocked(F.data, c));
  const opened = colours.length > F.colours ? colours[colours.length - 1] : null;
  F.colours = colours.length;
  if (F.hud) F.hud.sticker(s, opened ? `🎨 ${opened.name} smoke unlocked — pick it in Fun Stuff` : '');
  chime(sim, 'big');
  setMenuCount(F.menuBtn, F.data);
  return true;
}

/* ------------------------------------------------------------------ *
 * Stars
 * ------------------------------------------------------------------ */

function startPoint() {
  const rw = AIRPORT && AIRPORT.runway;
  if (rw) return { x: rw.cx, z: rw.cz };
  const i = (MAP.islands || [])[0];
  return i ? { x: i.cx, z: i.cz } : { x: 0, z: 0 };
}

/** This map's stars for a game, worked out once per map (and per road network). */
function starsFor(sim, game) {
  const kind = starSetFor(game);
  const roads = (sim && sim.roads && sim.roads.list) || null;
  const key = `${kind}:${MAP.id}`;
  const hit = F.cache.get(key);
  if (hit && hit.roads === roads) return hit.stars;
  let stars = [];
  try {
    stars = placeStars(kind, {
      map: MAP,
      heightAt,
      airport: AIRPORT,
      harbour: kind === 'sea' ? harbourMouth() : null,
      roads,
      start: startPoint(),
    });
  } catch (e) {
    console.warn('[fun] could not place the stars here:', e);
  }
  F.cache.set(key, { roads, stars });
  return stars;
}

function ensureStars(sim, game) {
  const key = `${game}:${MAP.id}`;
  if (F.setKey === key) return;
  F.setKey = key;
  F.kind = starSetFor(game);
  F.stars = starsFor(sim, game);
  F.found = new Set(F.data.stars[key] || []);
  if (F.field) F.field.set(F.stars, F.found);
}

function clearStars() {
  F.setKey = null;
  F.stars = [];
  if (F.field) F.field.clear();
}

function foundHere() {
  let n = 0;
  for (const s of F.stars) if (F.found.has(s.id)) n++;
  return n;
}

function collect(sim, i, craft) {
  const s = F.stars[i];
  if (!s || F.found.has(s.id)) return;
  F.found.add(s.id);
  const list = F.data.stars[F.setKey] || (F.data.stars[F.setKey] = []);
  if (!list.includes(s.id)) list.push(s.id);
  markDirty(true);
  if (F.field) F.field.pop(i);
  if (F.burst) F.burst.emit(s.x, s.y, s.z, 70);
  const n = foundHere();
  const of = F.stars.length;
  const all = n >= of;
  pay(sim, STAR_CREDITS + (all ? ALL_STARS_CREDITS : 0));
  if (F.hud) {
    F.hud.pop(all ? 'ALL THE STARS!' : '⭐ STAR!', all ? `${n} of ${of} · +${STAR_CREDITS + ALL_STARS_CREDITS} credits` : `${n} of ${of} · +${STAR_CREDITS} credits`, { star: true, calm: calm(sim) });
    F.hud.bump();
  }
  chime(sim, all ? 'big' : 'star');
  grant(sim, 'first-star');
  if (totalStars(F.data) >= 10) grant(sim, 'star-10');
  if (all) grant(sim, 'star-map');
  if (mapsWithStars(F.data) >= 3) grant(sim, 'star-3maps');
  if (craft === 'heli') grant(sim, 'heli-star');
  if (craft === 'boat') grant(sim, 'sea-star');
  if (craft === 'car') grant(sim, 'road-star');
}

/**
 * Gold stars on the game's minimap, and a gold tick on its rim towards the
 * nearest one you have not found. Drawn over the minimap only on a frame it
 * has just redrawn itself (it runs at 30 a second), with its own
 * arithmetic: north up, you in the middle, 190 logical pixels across.
 */
function drawOnMinimap(sim) {
  const mm = sim.minimap;
  if (!mm || !mm.visible || !mm.ctx || typeof mm.span !== 'number' || mm._offstage || mm._acc !== 0) return;
  const me = (mm._g && mm._g.craft) || playerPos(sim);
  if (!me) return;
  const SIZE = 190;
  const k = SIZE / mm.span;
  const c = SIZE / 2;
  const rim = SIZE / 2 - 7;
  const ts = Math.min(1.8, mm.textScale || 1);
  const ctx = mm.ctx;
  let near = null;
  let nd = Infinity;
  ctx.save();
  ctx.beginPath();
  ctx.arc(c, c, SIZE / 2 - 2, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = '#ffd23f';
  ctx.strokeStyle = 'rgba(60, 30, 0, 0.9)';
  ctx.lineWidth = 1;
  for (const s of F.stars) {
    if (F.found.has(s.id)) continue;
    const dx = (s.x - me.x) * k;
    const dz = (s.z - me.z) * k;
    const d = Math.hypot(dx, dz);
    if (d < nd) {
      nd = d;
      near = s;
    }
    if (d > rim) continue;
    starPath(ctx, c + dx, c + dz, 5 * ts, 2.2 * ts);
    ctx.fill();
    ctx.stroke();
  }
  if (near && nd > rim) {
    const a = Math.atan2(near.z - me.z, near.x - me.x);
    const x = c + Math.cos(a) * rim;
    const y = c + Math.sin(a) * rim;
    ctx.translate(x, y);
    ctx.rotate(a);
    ctx.beginPath();
    ctx.moveTo(6 * ts, 0);
    ctx.lineTo(-4 * ts, -5 * ts);
    ctx.lineTo(-4 * ts, 5 * ts);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

function starPath(ctx, x, y, R, r) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 ? r : R;
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const px = x + Math.cos(a) * rad;
    const py = y + Math.sin(a) * rad;
    if (i) ctx.lineTo(px, py);
    else ctx.moveTo(px, py);
  }
  ctx.closePath();
}

/* ------------------------------------------------------------------ *
 * Stunts
 * ------------------------------------------------------------------ */

const SNAP = { craft: 'plane', airborne: false, height: 0, speed: 0, rollRate: 0, pitchRate: 0, upY: 1, noseY: 0, heading: 0, crashed: false };
const _u = new THREE.Vector3();

function snapshot(sim, craft, crashed) {
  const s = SNAP;
  s.craft = craft;
  s.crashed = crashed;
  if (craft === 'boat' || craft === 'car') {
    const v = sim.vehicle;
    s.airborne = !!(v && v.air);
    s.speed = v ? v.speed : 0;
    s.heading = v ? v.heading : 0;
    s.height = 0;
    return s;
  }
  const ac = sim.aircraft;
  s.airborne = !ac.onGround;
  s.height = ac.pos.y - Math.max(0, heightAt(ac.pos.x, ac.pos.z));
  s.speed = ac.vel.length();
  s.rollRate = ac.omega.z;
  s.pitchRate = ac.omega.x;
  s.upY = ac.up(_u).y;
  s.noseY = ac.forward(_u).y;
  s.heading = ac.heading;
  return s;
}

const STUNT_STICKER = { roll: 'roll', loop: 'loop', upside: 'upside', sideways: 'sideways', low: 'low', spin: 'spin', donut: 'donut', air: 'air' };

function onStunt(sim, e, game) {
  const sub = `+${e.points.toLocaleString()}${e.combo > 1 ? ` · <span class="combo">COMBO ×${e.combo}</span>` : ''}`;
  if (F.hud) F.hud.pop(e.name, sub, { calm: calm(sim) });
  chime(sim, 'stunt');
  const st = F.data.stunts;
  st.count[e.id] = (st.count[e.id] || 0) + 1;
  if ((st.best[game] || 0) < e.total) st.best[game] = e.total;
  markDirty();
  const c = Math.min(Math.round(e.points / 10), STUNT_CREDIT_CAP - F.flightCredits);
  if (c > 0) {
    F.flightCredits += c;
    pay(sim, c);
  }
  if (STUNT_STICKER[e.id]) grant(sim, STUNT_STICKER[e.id]);
  if (e.combo >= 3) grant(sim, 'combo');
  if (e.total >= 1000) grant(sim, 'stunt-1000');
}

/* ------------------------------------------------------------------ *
 * Smoke
 * ------------------------------------------------------------------ */

function toggleSmoke(sim) {
  const craft = craftOf(sim);
  if (craft !== 'plane' && craft !== 'heli') return false;
  F.smokeOn = !F.smokeOn;
  if (F.smokeOn) {
    grant(sim, 'smoke');
    const c = activeColour(F.data);
    if (F.hud) F.hud.note(`Smoke on: ${c.name}. ${F.hud.chip.classList.contains('is-touch-fun') ? 'Tap 💨' : 'T'} turns it off.`, 2.5);
  } else if (F.smoke) {
    F.smoke.cut();
  }
  return true;
}

function tailPoint(sim, out) {
  const ac = sim.aircraft;
  const t = sim.aircraftType;
  const back = (t && t.plan && t.plan.tail) || 5;
  ac.forward(_fwd);
  return out.copy(ac.pos).addScaledVector(_fwd, -back * 0.95);
}

/* ------------------------------------------------------------------ *
 * The stickers that watch rather than wait for an event
 * ------------------------------------------------------------------ */

function watch(sim, dt, craft, crashed) {
  if (crashed || sim.state !== 'flying') return;
  const w = sim.weather;
  if (w && w.isNight) {
    F.nightT += dt;
    if (F.nightT > 10) grant(sim, 'night');
  }
  if (craft === 'plane' || craft === 'heli') {
    const ev = sim.activeEvents;
    let any = false;
    if (ev) for (const k in ev) if (ev[k] > 0) any = true;
    if (any && sim.aircraft && !sim.aircraft.onGround) {
      F.data.storm += dt;
      if (F.data.storm >= 30) grant(sim, 'storm');
    }
    let st = null;
    try {
      st = fireStatus(sim);
    } catch (e) {
      st = null;
    }
    if (st && st.live && st.burning > 0) F.fireSeen = true;
    else if (st && F.fireSeen && st.live && st.out && st.hits > 0) {
      F.fireSeen = false;
      grant(sim, 'firefighter');
    } else if (!st || !st.live) F.fireSeen = false;
  }
}

/* ------------------------------------------------------------------ *
 * The Fun Stuff screen's numbers
 * ------------------------------------------------------------------ */

function model(sim) {
  const game = (sim.menus && sim.menus.currentGame) || gameOf(sim);
  const stars = starsFor(sim, game);
  const found = new Set(F.data.stars[`${game}:${MAP.id}`] || []);
  let n = 0;
  for (const s of stars) if (found.has(s.id)) n++;
  return {
    data: F.data,
    game: GAME_WORDS[game] ? game : 'flight',
    mapName: MAP.name || 'this map',
    hunt: { n, of: stars.length },
    total: totalStars(F.data),
    colour: activeColour(F.data).id,
    fresh: F.fresh,
    stunts: ['roll', 'loop', 'upside', 'sideways', 'low', 'spin', 'donut', 'air'],
  };
}

function openFun(sim) {
  if (!F.screen) return;
  try {
    F.screen.render();
  } catch (e) {
    console.warn('[fun] the Fun Stuff screen could not draw:', e);
  }
  sim.menus.show('fun');
  if (sim.audio && sim.audio.available && sim.audio.alerts && sim.audio.alerts.uiClick) sim.audio.alerts.uiClick();
}

/* ------------------------------------------------------------------ *
 * The frame
 * ------------------------------------------------------------------ */

function update(sim, dt) {
  F.sim = sim;
  if (!F.data) return;
  F.time += dt;
  const craft = craftOf(sim);
  const game = gameOf(sim);
  const pos = playerPos(sim);
  const crashed = crashedNow(sim, craft);
  F.pixelScale = pixelScale(sim);

  // Stars.
  const allowed = starsAllowed(sim) && !!pos;
  if (allowed) ensureStars(sim, game);
  else if (F.setKey || F.stars.length) clearStars();
  if (allowed && !crashed) {
    for (let i = 0; i < F.stars.length; i++) {
      const s = F.stars[i];
      if (!F.found.has(s.id) && catches(F.kind, s, pos)) collect(sim, i, craft);
    }
  }
  if (F.field) F.field.update(dt, F.time, sim.camera, F.pixelScale);
  if (F.burst) F.burst.update(dt, F.pixelScale);

  // Stunts: everywhere but the tutorial.
  if (sim.mode !== 'tutorial') {
    const evs = F.meter.update(dt, snapshot(sim, craft, crashed));
    for (let i = 0; i < evs.length; i++) onStunt(sim, evs[i], game);
  }

  // Smoke.
  const smokeOk = craft === 'plane' || craft === 'heli';
  if (F.smoke) {
    // Not while parked: a smoking aeroplane standing on the apron is a fire.
    const parked = sim.aircraft && sim.aircraft.onGround && sim.aircraft.vel.lengthSq() < 25;
    if (F.smokeOn && smokeOk && !crashed && sim.aircraft && !parked) {
      const c = activeColour(F.data);
      const rgb = c.rgb ? linearRGB(c.rgb, F.rgb) : rainbowAt(F.time, F.rgb);
      F.smoke.emit(dt, F.time, tailPoint(sim, _tail), rgb);
    } else {
      F.smoke.cut();
    }
    F.smoke.update(F.time, F.pixelScale, light(sim));
  }

  watch(sim, dt, craft, crashed);

  // The chip.
  if (F.hud) {
    const show = sim.state === 'flying' && !(sim.hud && sim.hud.hidden);
    F.hud.setVisible(show);
    if (show) {
      F.hud.set({ n: foundHere(), of: allowed ? F.stars.length : 0, pts: F.meter.total, smokeOk, smokeOn: F.smokeOn && smokeOk });
      F.hud.place(dt, typeof document !== 'undefined' ? document.body : null);
    }
  }
  if (allowed && F.stars.length) drawOnMinimap(sim);

  if (F.dirty) {
    F.saveT -= dt;
    if (F.saveT <= 0) flush();
  }
}

/* ------------------------------------------------------------------ *
 * The plug-in
 * ------------------------------------------------------------------ */

registerExtension({
  id: 'fun',

  install(sim) {
    F.sim = sim;
    F.data = loadFun();
    F.colours = SMOKE_COLOURS.filter((c) => colourUnlocked(F.data, c)).length;
    F.hud = new FunHud({ onSmoke: () => toggleSmoke(sim), touch: !!sim.touch });
    F.menuBtn = addMenuButton(sim.menus, () => openFun(sim));
    setMenuCount(F.menuBtn, F.data);
    F.screen = buildFunScreen(sim.menus, {
      model: () => model(sim),
      onColour: (id) => {
        F.data.smoke.color = id;
        markDirty(true);
        flush();
      },
    });
    if (typeof window !== 'undefined') window.addEventListener('pagehide', flush);
    // The chip sits above the menus (the plug-in layer is), so it goes the
    // moment the game stops flying: update() is not called to do it while
    // the pause menu is up.
    if (typeof setInterval === 'function') {
      setInterval(() => {
        if (F.hud && sim.state !== 'flying') F.hud.setVisible(false);
      }, 250);
    }
  },

  buildWorld(sim, group) {
    // New pictures for every world: the old ones went with the old world.
    F.field = new StarField(12);
    F.burst = new Burst(160);
    F.smoke = new SmokeTrail(700);
    F.field.addTo(group);
    group.add(F.burst.points, F.smoke.points);
    F.setKey = null;
    F.cache.clear();
  },

  startMode(sim, mode) {
    F.meter.reset();
    F.flightCredits = 0;
    F.smokeOn = false;
    F.fireSeen = false;
    F.nightT = 0;
    if (F.smoke) F.smoke.clear();
    if (F.burst) F.burst.clear();
    clearStars();
    if (!starsAllowed(sim)) return;
    const game = gameOf(sim);
    ensureStars(sim, game);
    // Once a session per game: say the stars are there, and where to look.
    if (!F.tips.has(game) && F.stars.length && F.hud) {
      F.tips.add(game);
      const where = F.kind === 'sea' ? 'on the water' : F.kind === 'road' ? 'on the roads' : 'around the island';
      const left = F.stars.length - foundHere();
      const touch = F.hud && F.hud.chip.classList.contains('is-touch-fun');
      const smoke = game === 'flight' || game === 'heli' ? (touch ? ' Tap 💨 for a smoke trail.' : ' T = smoke trail.') : '';
      F.hud.note(
        left
          ? `⭐ ${left} golden star${left === 1 ? ' is' : 's are'} hidden ${where} — find them on your minimap!${smoke}`
          : `⭐ You found every star here! Try another map.${smoke}`,
        5
      );
    }
  },

  stop(sim) {
    if (F.smoke) F.smoke.clear();
    F.smokeOn = false;
    clearStars();
    if (F.hud) {
      F.hud.setVisible(false);
      F.hud.clearPops();
    }
    markDirty(true);
    flush();
  },

  update,

  key(sim, code, down, e) {
    if (code !== 'KeyT') return false;
    const craft = craftOf(sim);
    if (craft !== 'plane' && craft !== 'heli') return false;
    if (down && !(e && e.repeat)) toggleSmoke(sim);
    return true;
  },

  devActions: [
    {
      label: 'Fun: collect the nearest star',
      hint: 'Moves you onto the nearest golden star you have not found yet.',
      run(sim) {
        const pos = playerPos(sim);
        if (!pos || !F.stars.length) return;
        let best = null;
        for (const s of F.stars) if (!F.found.has(s.id) && (!best || Math.hypot(s.x - pos.x, s.z - pos.z) < Math.hypot(best.x - pos.x, best.z - pos.z))) best = s;
        if (best) pos.set(best.x, sim.mode === 'drive' ? pos.y : best.y, best.z);
      },
    },
    {
      label: 'Fun: forget stars, stickers and stunts',
      hint: 'Wipes the Fun Stuff save on this device (not your credits or aeroplanes).',
      run(sim) {
        F.data = loadFun({ getItem: () => null });
        F.fresh.clear();
        F.setKey = null;
        F.colours = 1;
        markDirty(true);
        flush();
        setMenuCount(F.menuBtn, F.data);
        if (F.hud) F.hud.note('Fun Stuff reset.', 2);
      },
    },
  ],
});

/* For the tests. */
export const __test = { F, starsFor, grant, collect, toggleSmoke, model, openFun, craftOf, starsAllowed };
