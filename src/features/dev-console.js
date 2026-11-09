/**
 * The dev console: a command line for the owner, inside Dev mode.
 *
 * The owner, 2026-10-30: "in dev mode add a console where i can be like
 * /runcmd allaircraft (unlocks all aircraft)". So: a "Console" button in the
 * Dev mode panel (devActions, like every other plug-in's). Nothing here
 * exists for a player who has not been let into Dev mode.
 *
 *   /runcmd allaircraft      unlock every aircraft in the hangar
 *   /runcmd credits <n>      set your credits to n
 *   /runcmd addcredits <n>   add n credits
 *   /runcmd unlock <id>      unlock one aircraft (ids: /runcmd list)
 *   /runcmd list             every aircraft id
 *   /runcmd help             this list
 *   /clear                   clear the console
 *
 * And /give (the owner, 2026-11-08: "a /give command in dev mode i can give
 * myself all planes or a certain plane"):
 *
 *   /give all                every plane: the shop's, the secret ones, the Javelin
 *   /give <plane>            one plane, by id or by name ("a320", "Javelin",
 *                            "storm petrel"); a part of a name works if only one
 *                            plane matches
 *
 * And /tp (the owner, the same day: "and a /tp command (it will all show
 * things like press tab to fill in this airport etc"):
 *
 *   /tp <airport>            a World Map field, by code, id or name (XHVN, haven,
 *                            "Haven International"): Free Flight there, started
 *                            the way the Free Flight screen says (runway, gate, air)
 *   /tp <map>                another map, Free Flight at its field
 *   /tp nullspire            the hidden city's long final
 *   /tp <x> <z>              a spot, in metres ("12km" works): on the World Map
 *                            a pin's airborne start; anywhere else, in the air,
 *                            you are moved there as you fly
 *
 * And /time (the owner, the same day: "add a /time command to set the time of
 * day"):
 *
 *   /time <word>             morning, day (noon), sunset, night, midnight, real
 *                            (your clock); "/time set day" works too
 *   /time <hour>             14, 14:30, 2pm, 7:30am
 *   /time add <hours>        on from now (-1 goes back)
 *   /time                    what time it is
 *
 * In a flight the sky changes at once; Free Flight's Time of day is set to
 * match, so the next flight starts there too.
 *
 * As you type, the box under the line suggests what fits: commands, planes,
 * airports, maps. Tab fills in the first (Tab again for the next, Shift+Tab
 * back); on a touch screen, tap one.
 *
 * "/runcmd" is optional ("allaircraft" works on its own). Typing in the box
 * never reaches the game's keys. Changes go to the live progression object
 * (sim.prog, which the menus share) and are saved at once.
 */

import { registerExtension } from '../game/extensions.js';
import * as Prog from '../game/progression.js';
import { AIRCRAFT } from '../aircraft/types.js';
import { isHiddenAircraft } from '../core/edition.js';
import { secrets } from './secrets.js';
import { mapsForGame } from '../world/maps.js';
import { heightAt } from '../world/terrain.js';

const S = { root: null, log: null, input: null, sugg: null, sim: null, history: [], at: 0, pending: null, cycle: null };

const CSS = `
.dcon { position: fixed; left: 50%; top: 12%; transform: translateX(-50%); z-index: 120; width: min(640px, calc(100vw - 24px));
  background: rgba(8, 12, 20, 0.94); border: 1px solid rgba(160, 195, 240, 0.25); border-radius: 12px; box-shadow: 0 18px 50px rgba(0,0,0,0.5);
  font: 13px/1.45 "SF Mono", ui-monospace, Menlo, Consolas, monospace; color: #dfe8f3; }
.dcon[hidden] { display: none; }
.dcon-head { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; border-bottom: 1px solid rgba(160, 195, 240, 0.15);
  font: 600 12px/1 system-ui, -apple-system, 'Segoe UI', sans-serif; letter-spacing: 0.08em; text-transform: uppercase; color: #9fb2cc; }
.dcon-head button { min-width: 40px; min-height: 32px; border: 0; border-radius: 8px; background: rgba(255,255,255,0.08); color: #dfe8f3; font: inherit; cursor: pointer; }
.dcon-log { max-height: 42vh; overflow-y: auto; padding: 10px 12px; white-space: pre-wrap; overflow-wrap: anywhere; }
.dcon-log .ok { color: #7ee8b2; }
.dcon-log .err { color: #ff9a8a; }
.dcon-log .cmd { color: #58c6ff; }
.dcon-row { display: flex; gap: 8px; padding: 10px 12px; border-top: 1px solid rgba(160, 195, 240, 0.15); }
.dcon-row input { flex: 1; min-height: 40px; padding: 0 10px; border-radius: 8px; border: 1px solid rgba(160, 195, 240, 0.25); background: rgba(255,255,255,0.05);
  color: #fff; font: inherit; }
.dcon-sugg { padding: 6px 12px 0; border-top: 1px solid rgba(160, 195, 240, 0.15); display: flex; flex-direction: column; gap: 2px; max-height: 34vh; overflow-y: auto; }
.dcon-sugg[hidden] { display: none; }
.dcon-tip { display: flex; justify-content: space-between; gap: 8px; color: #9fb2cc; font: 600 11px/1.4 system-ui, -apple-system, 'Segoe UI', sans-serif; padding: 2px 0 4px; }
.dcon-tip span { font-weight: 400; opacity: 0.8; }
.dcon-s { display: flex; align-items: baseline; gap: 10px; text-align: left; min-height: 36px; padding: 6px 8px; border: 0; border-radius: 6px; background: transparent; color: #dfe8f3; font: inherit; cursor: pointer; }
.dcon-s b { color: #58c6ff; font-weight: 600; white-space: nowrap; }
.dcon-s span { color: #9fb2cc; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dcon-s.is-on, .dcon-s:hover { background: rgba(88, 198, 255, 0.14); }
@media (pointer: coarse) { .dcon-s { min-height: 44px; } }
.dcon-row button { min-height: 40px; padding: 0 14px; border: 0; border-radius: 8px; background: #58c6ff; color: #04111d; font: 700 13px/1 system-ui, sans-serif; cursor: pointer; }
`;

function prog(sim) {
  return (sim && sim.prog) || Prog.load();
}

function print(text, cls = '') {
  if (!S.log) return;
  const line = document.createElement('div');
  if (cls) line.className = cls;
  line.textContent = text;
  S.log.appendChild(line);
  S.log.scrollTop = S.log.scrollHeight;
}

function commit(sim, p) {
  const saved = Prog.save(p);
  if (sim && sim.menus && typeof sim.menus.syncMissionLocks === 'function') sim.menus.syncMissionLocks();
  return saved;
}

const HELP = [
  '/runcmd allaircraft      unlock every aircraft',
  '/runcmd credits <n>      set your credits',
  '/runcmd addcredits <n>   add credits',
  '/runcmd unlock <id>      unlock one aircraft',
  '/runcmd list             every aircraft id',
  '/runcmd help             this list',
  '/give all                every plane, secret ones too',
  '/give <plane>            one plane, by id or name (e.g. /give a320)',
  '/tp <airport | map>      Free Flight there (e.g. /tp XHVN, /tp kestrel)',
  '/tp nullspire            the hidden city',
  '/tp <x> <z>              a spot, metres or km (e.g. /tp 12km -4km)',
  '/time <word | hour>      morning, day, sunset, night, real, 14:30, 2pm',
  '/time add <hours>        move the clock on (or back, -1)',
  'Tab                      fill in a suggestion',
  '/clear                   clear the console',
].join('\n');

const JAVELIN = 'javelin';
const squash = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** The planes /give knows: every type this copy shows, and the Javelin (registered only once earned). */
function givable() {
  const list = AIRCRAFT.filter((a) => !isHiddenAircraft(a.id)).map((a) => ({ id: a.id, name: a.name || a.id, secret: !!a.secret }));
  if (!list.some((a) => a.id === JAVELIN)) list.push({ id: JAVELIN, name: 'Javelin', secret: true });
  return list;
}

/** A plane by id, then by name, then by a part of either that only one plane has. Returns { hit } or { many }. */
export function findPlane(query) {
  const q = squash(query);
  if (!q) return { many: [] };
  const all = givable();
  const exact = all.find((a) => squash(a.id) === q) || all.find((a) => squash(a.name) === q);
  if (exact) return { hit: exact };
  const part = all.filter((a) => squash(a.id).includes(q) || squash(a.name).includes(q));
  return part.length === 1 ? { hit: part[0] } : { many: part };
}

/** One plane into the Hangar, for good: a secret one as if found, the Javelin as if earned. */
function giveOne(sim, p, a) {
  if (a.id === JAVELIN) {
    S.pending = import('./farlands-run.js').then((m) => m.earnJavelin(sim, 'the Dev console')).catch(() => false);
    return;
  }
  if (a.secret && secrets && typeof secrets.unlock === 'function') {
    try {
      secrets.unlock(a.id);
    } catch (e) {
      /* the line below puts it in the Hangar anyway */
    }
  }
  if (!p.unlocked.includes(a.id)) p.unlocked.push(a.id);
}

function give(sim, p, what) {
  const q = what.join(' ').replace(/^(@s|@p|me|myself)\s+/i, '').trim();
  if (!q) return { ok: false, text: 'Give what? /give all, or /give <plane> (e.g. /give a320). /runcmd list for the ids.' };
  if (/^(all|everything|\*)$/i.test(q)) {
    const all = givable();
    const before = new Set(p.unlocked);
    for (const a of all) giveOne(sim, p, a);
    const saved = commit(sim, p);
    const fresh = all.filter((a) => !before.has(a.id)).length;
    return { ok: true, text: `Gave you all ${all.length} planes, secret ones and the Javelin too (${fresh} new).${saved ? '' : ' (This browser would not save it.)'}` };
  }
  const f = findPlane(q);
  if (!f.hit) {
    if (!f.many.length) return { ok: false, text: `No plane called "${q}". Try /runcmd list.` };
    return { ok: false, text: `"${q}" could be ${f.many.length} planes — say which:\n${f.many.slice(0, 12).map((a) => `  ${a.id}  ${a.name}`).join('\n')}${f.many.length > 12 ? '\n  …' : ''}` };
  }
  const had = p.unlocked.includes(f.hit.id);
  giveOne(sim, p, f.hit);
  commit(sim, p);
  return { ok: true, text: had ? `You already have the ${f.hit.name}.` : `Gave you the ${f.hit.name}. It's in your Hangar.` };
}

/* ------------------------------------------------------------------ */
/* /tp                                                                  */
/* ------------------------------------------------------------------ */

const WORLD_MAP = 'world-preview';
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

/** Everywhere /tp can go: Nullspire, the World Map's fields, the other maps. */
export function tpTargets(sim) {
  const out = [{ fill: 'nullspire', name: 'Nullspire', what: 'the hidden city · World Map', keys: ['nullspire', 'xnul', 'city'], go: { city: true } }];
  const wp = sim && sim.worldPreview;
  const fields = wp && typeof wp.airports === 'function' ? wp.airports() || [] : [];
  for (const a of fields) out.push({ fill: a.code || a.id, name: a.name, what: 'World Map airport', keys: [a.code, a.id, a.name], go: { field: a.id } });
  let maps = [];
  try {
    maps = mapsForGame((sim && sim.game) || 'flight');
  } catch (e) {
    maps = [];
  }
  for (const m of maps) if (m.id !== WORLD_MAP) out.push({ fill: m.id, name: m.name, what: 'map', keys: [m.id, m.name], go: { map: m.id } });
  return out;
}

/** A target by its code, id or name, then by a part only one has. Returns { hit } or { many }. */
export function findTarget(sim, query) {
  const q = squash(query);
  const all = tpTargets(sim);
  if (!q) return { many: [] };
  const exact = all.find((t) => t.keys.some((k) => squash(k) === q));
  if (exact) return { hit: exact };
  const part = all.filter((t) => t.keys.some((k) => squash(k).includes(q)));
  return part.length === 1 ? { hit: part[0] } : { many: part };
}

/** "12000", "-3.5km", "800m" → metres, or null. */
function metres(w) {
  const m = /^(-?\d+(?:\.\d+)?)(km|m)?$/i.exec(String(w || '').replace(/[,_]/g, ''));
  if (!m) return null;
  return Number(m[1]) * (m[2] && m[2].toLowerCase() === 'km' ? 1000 : 1);
}

function freeSetup(sim) {
  const menus = sim.menus;
  return menus && menus.readFree ? menus.readFree() : { aircraft: menus && menus.chosenAircraft };
}

/** Another map, then Free Flight at its field. */
async function goMap(sim, id) {
  const cfg = freeSetup(sim);
  if (sim.settings.map !== id) {
    const before = sim.scenery;
    if (sim.menus && sim.menus.hooks && sim.menus.hooks.chooseMap) sim.menus.hooks.chooseMap(id);
    else sim.setMap(id);
    for (let i = 0; i < 1200 && (sim.scenery === before || sim._worldBuilding || sim.settings.map !== id); i++) await sleep(50);
  }
  await sim.startMode('free', cfg);
  return true;
}

/** Off the World Map, in the air: moved to (x, z), as you were flying, never into the ground. */
function moveTo(sim, x, z) {
  const ac = sim.aircraft;
  if (!ac || !(sim.state === 'flying' || sim.state === 'paused') || ac.onGround || ac.crashed) {
    return { ok: false, text: 'On this map, /tp <x> <z> moves you in the air: take off first — or /tp an airport.' };
  }
  const g = heightAt(x, z);
  ac.pos.set(x, Math.max(ac.pos.y, (Number.isFinite(g) ? g : 0) + 150), z);
  if (sim.rig) sim.rig.initialised = false;
  return { ok: true, text: `Moved to ${Math.round(x)}, ${Math.round(z)}.` };
}

function later(sim, job, ok, fail) {
  S.pending = job.then((done) => {
    if (S.log) print(done === false ? fail : ok, done === false ? 'err' : 'ok');
    return done !== false;
  }).catch((e) => {
    console.error('[dev-console] /tp', e);
    if (S.log) print(fail, 'err');
    return false;
  });
  // The console steps aside for the flight it has just started.
  close();
}

function tp(sim, words) {
  const wp = sim && sim.worldPreview;
  const usage = 'Where to? /tp <airport | map>, /tp nullspire, or /tp <x> <z>. Start typing and press Tab for suggestions.';
  if (!words.length) return { ok: false, text: usage };
  // A spot: two numbers.
  const x = metres(words[0]);
  const z = metres(words[1]);
  if (x != null && z != null) {
    const onWorld = wp && typeof wp.active === 'function' && wp.active();
    if (!onWorld) return moveTo(sim, x, z);
    later(sim, wp.tpSpot(x, z), `Teleported to ${Math.round(x)}, ${Math.round(z)}.`, 'That spot did not load. Try again.');
    return { ok: true, text: `Going to ${Math.round(x)}, ${Math.round(z)} on the World Map…` };
  }
  if (x != null) return { ok: false, text: 'A spot needs two numbers: /tp <x> <z> (metres, or km like 12km).' };
  const q = words.join(' ');
  const f = findTarget(sim, q);
  if (!f.hit) {
    if (!f.many.length) return { ok: false, text: `Nowhere called "${q}". Press Tab after /tp for the list.` };
    return { ok: false, text: `"${q}" could be ${f.many.length} places — say which:\n${f.many.slice(0, 12).map((t) => `  ${t.fill}  ${t.name} (${t.what})`).join('\n')}${f.many.length > 12 ? '\n  …' : ''}` };
  }
  const t = f.hit;
  if (!sim || typeof sim.startMode !== 'function') return { ok: false, text: 'No game to teleport in.' };
  if ((t.go.city || t.go.field) && !(wp && wp.tpField)) return { ok: false, text: 'The World Map is not loaded yet. Try again in a moment.' };
  if (t.go.city) later(sim, wp.tpCity(), 'Teleported to Nullspire. Runway 09 is ahead.', 'Nullspire did not load. Try again.');
  else if (t.go.field) later(sim, wp.tpField(t.go.field), `Teleported to ${t.name}.`, `${t.name} did not load. Try again.`);
  else later(sim, goMap(sim, t.go.map), `Teleported to ${t.name}.`, `${t.name} did not load. Try again.`);
  return { ok: true, text: `Teleporting to ${t.name}…` };
}

/* ------------------------------------------------------------------ */
/* /time                                                                */
/* ------------------------------------------------------------------ */

/** The words /time knows: a weather preset (setTime), a fixed hour, or the device's clock. */
export const TIME_WORDS = [
  { fill: 'morning', name: 'Morning', what: '07:30, a low sun in the east', hour: 7.5, menu: 'morning' },
  { fill: 'day', name: 'Midday', what: 'the map’s own midday sun', preset: 'day', keys: ['day', 'noon', 'midday'] },
  { fill: 'sunset', name: 'Sunset', what: 'the map’s own sunset', preset: 'sunset', keys: ['sunset', 'dusk', 'evening'] },
  { fill: 'night', name: 'Night', what: 'dark, the moon up', preset: 'night' },
  { fill: 'midnight', name: 'Midnight', what: '00:00', hour: 0 },
  { fill: 'sunrise', name: 'Sunrise', what: '06:00', hour: 6, keys: ['sunrise', 'dawn'] },
  { fill: 'real', name: 'Real time', what: 'your clock', real: true, keys: ['real', 'now', 'irl'] },
];

/** "14", "14:30", "2pm", "7:30am", "0730" → 0..24, or null. */
export function parseHour(w) {
  const t = String(w || '').trim().toLowerCase().replace(/\s+/g, '');
  let m = /^(\d{1,2})(?::(\d{2}))?(am|pm)?$/.exec(t) || /^(\d{2})(\d{2})$/.exec(t);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  const ap = m[3];
  if (min > 59) return null;
  if (ap) {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (ap === 'pm' ? 12 : 0);
  }
  if (h > 24 || (h === 24 && min > 0)) return null;
  return (h + min / 60) % 24;
}

export function clockText(h) {
  const x = ((h % 24) + 24) % 24;
  let hh = Math.floor(x);
  let mm = Math.round((x - hh) * 60);
  if (mm === 60) { hh = (hh + 1) % 24; mm = 0; }
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/** Free Flight's Time of day, set to match (the select and the hour slider, through their own handlers). */
function syncFreeTime(sim, how) {
  const s = sim && sim.menus && sim.menus.screens && sim.menus.screens.free;
  if (!s || typeof s.querySelector !== 'function') return;
  const sel = s.querySelector('[data-time]');
  const slider = s.querySelector('[data-hour]');
  if (!sel || !slider) return;
  if (how.menu && [...sel.options].some((o) => o.value === how.menu)) {
    sel.value = how.menu;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  } else {
    if (sel.value === 'real' || sel.value === 'morning') sel.value = 'day';
    slider.value = String(Math.round(how.hour * 4) / 4);
    slider.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

function setTimeOfDay(sim, how) {
  const W = sim && sim.weather;
  const flying = !!(W && sim.aircraft && (sim.state === 'flying' || sim.state === 'paused'));
  if (W) {
    if (how.preset && typeof W.setTime === 'function') W.setTime(how.preset);
    else if (typeof W.setHour === 'function') W.setHour(how.hour);
    if (sim.sky && typeof sim.sky.update === 'function') {
      try {
        sim.sky.update(W);
      } catch (e) {
        /* the next frame paints it */
      }
    }
  }
  const menu = how.real ? { menu: 'real', hour: how.hour } : how.preset ? { menu: how.preset, hour: W ? W.hour : 12 } : how.menu ? { menu: how.menu, hour: how.hour } : { hour: how.hour };
  syncFreeTime(sim, menu);
  const at = W && Number.isFinite(W.hour) ? clockText(W.hour) : how.hour != null ? clockText(how.hour) : '';
  return { ok: true, text: `Time set to ${how.label}${at && how.label !== at ? ` (${at})` : ''}.${flying ? '' : ' Your next flight starts then.'}` };
}

function time(sim, words) {
  const W = sim && sim.weather;
  let w = words.map((x) => String(x).toLowerCase());
  if (w[0] === 'set') w = w.slice(1);
  if (!w.length) {
    if (!W || !Number.isFinite(W.hour)) return { ok: false, text: 'Set it: /time morning, day, sunset, night, real, or an hour like 14:30.' };
    return { ok: true, text: `It is ${clockText(W.hour)}${W.preset ? ` (${W.preset})` : ''}. /time <word | hour> to change it.` };
  }
  if (w[0] === 'add') {
    const n = Number(String(w[1] || '').replace(/h$/, ''));
    if (!Number.isFinite(n) || Math.abs(n) > 48) return { ok: false, text: 'How many hours? /time add 2 (or -1 to go back).' };
    const from = W && Number.isFinite(W.hour) ? W.hour : 12;
    const h = (((from + n) % 24) + 24) % 24;
    return setTimeOfDay(sim, { hour: h, label: clockText(h) });
  }
  const q = squash(w.join(''));
  const word = TIME_WORDS.find((t) => (t.keys || [t.fill]).some((k) => squash(k) === q));
  if (word) {
    if (word.real) {
      const d = new Date();
      return setTimeOfDay(sim, { hour: d.getHours() + d.getMinutes() / 60, real: true, label: 'your clock' });
    }
    return setTimeOfDay(sim, { preset: word.preset, hour: word.hour, menu: word.menu, label: word.name.toLowerCase() });
  }
  const h = parseHour(w.join(''));
  if (h == null) return { ok: false, text: `"${w.join(' ')}" is not a time. Try /time sunset, /time 14:30 or /time 2pm.` };
  return setTimeOfDay(sim, { hour: h, label: clockText(h) });
}

/* ------------------------------------------------------------------ */
/* Suggestions, and Tab                                                 */
/* ------------------------------------------------------------------ */

const COMMANDS = [
  { cmd: 'give', what: 'give yourself planes' },
  { cmd: 'tp', what: 'teleport: an airport, a map, a spot' },
  { cmd: 'time', what: 'set the time of day' },
  { cmd: 'runcmd', what: 'credits, unlocks, the aircraft list' },
  { cmd: 'help', what: 'every command' },
  { cmd: 'clear', what: 'clear the console' },
];
const RUNCMDS = [
  { cmd: 'allaircraft', what: 'unlock every aircraft' },
  { cmd: 'credits', what: 'set your credits' },
  { cmd: 'addcredits', what: 'add credits' },
  { cmd: 'unlock', what: 'unlock one aircraft' },
  { cmd: 'list', what: 'every aircraft id' },
  { cmd: 'help', what: 'the list' },
];

/** How well `q` fits: 0 the fill starts with it, 1 a word of the name does, 2 it is inside; null, not at all. */
function fit(q, fill, keys) {
  if (!q) return 3;
  const f = squash(fill);
  if (f.startsWith(q)) return 0;
  const words = keys.flatMap((k) => String(k || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  if (words.some((w) => w.startsWith(q)) || keys.some((k) => squash(k).startsWith(q))) return 1;
  if (keys.some((k) => squash(k).includes(q))) return 2;
  return null;
}

function ranked(q, items, max) {
  const out = [];
  items.forEach((it, i) => {
    const r = fit(q, it.fill, it.keys || [it.fill]);
    if (r != null) out.push({ it, r, i });
  });
  out.sort((a, b) => a.r - b.r || a.i - b.i);
  return out.slice(0, max).map((o) => o.it);
}

/**
 * What fits the line so far: [{ line, fill, name, what }], best first. `line`
 * is the whole line with that suggestion filled in (and a space after a
 * command, ready for what comes next). Pure but for the lists; the tests call it.
 */
export function suggest(sim, line, max = 8) {
  const raw = String(line || '');
  const m = /^\s*\/?(\S*)(\s+)?(.*)$/.exec(raw) || [];
  const cmd = (m[1] || '').toLowerCase();
  const rest = m[3] || '';
  if (!m[2]) {
    return ranked(cmd, COMMANDS.map((c) => ({ fill: c.cmd, name: `/${c.cmd}`, what: c.what })), max).map((c) => ({ ...c, line: `/${c.fill} ` }));
  }
  if (cmd === 'runcmd') {
    if (/\s/.test(rest)) {
      const sub = rest.split(/\s+/)[0].toLowerCase();
      return sub === 'unlock' ? suggest(sim, `/give ${rest.slice(sub.length).trim()}`, max).map((g) => ({ ...g, line: `/runcmd unlock ${g.fill}` })).filter((g) => g.fill !== 'all') : [];
    }
    return ranked(squash(rest), RUNCMDS.map((c) => ({ fill: c.cmd, name: c.cmd, what: c.what })), max).map((c) => ({ ...c, line: `/runcmd ${c.fill} ` }));
  }
  if (cmd === 'give') {
    const pre = (/^(@s|@p|me|myself)\s+/i.exec(rest) || [''])[0];
    const q = squash(rest.slice(pre.length));
    const items = [{ fill: 'all', name: 'Every plane', what: 'secret ones too', keys: ['all'] }, ...givable().map((a) => ({ fill: a.id, name: a.name, what: a.secret ? 'secret plane' : 'plane', keys: [a.id, a.name] }))];
    return ranked(q, items, max).map((it) => ({ ...it, line: `/give ${pre}${it.fill}` }));
  }
  if (cmd === 'time') {
    const pre = /^set\s+/i.test(rest) ? 'set ' : '';
    const r2 = rest.slice(pre.length);
    if (/^-?\d/.test(r2.trim()) || /^add\b/i.test(r2)) return [];
    const items = [...TIME_WORDS, { fill: 'add', name: 'add <hours>', what: 'move the clock on', keys: ['add'] }];
    return ranked(squash(r2), items, max).map((t) => ({ fill: t.fill, name: t.name, what: t.what, line: `/time ${pre}${t.fill}${t.fill === 'add' ? ' ' : ''}` }));
  }
  if (cmd === 'tp') {
    if (/^-?\d/.test(rest.trim())) return [];
    return ranked(squash(rest), tpTargets(sim), max).map((t) => ({ fill: t.fill, name: t.name, what: t.what, line: `/tp ${t.fill}` }));
  }
  return [];
}

function paintSuggestions() {
  if (!S.sugg) return;
  const list = S.cycle ? S.cycle.items : suggest(S.sim, S.input.value);
  const on = S.cycle ? S.cycle.at : 0;
  S.sugg.hidden = !list.length;
  if (!list.length) {
    S.sugg.textContent = '';
    return;
  }
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  S.sugg.innerHTML = `<div class="dcon-tip">${esc(list[on] ? `Tab to fill in ${list[on].name}` : 'Tab to fill in')}<span>tap one to fill it in</span></div>` +
    list.map((it, i) => `<button type="button" class="dcon-s${i === on ? ' is-on' : ''}" data-dcon-fill="${esc(it.line)}"><b>${esc(it.fill)}</b> <span>${esc(it.name === it.fill || it.name === `/${it.fill}` ? it.what : `${it.name} · ${it.what}`)}</span></button>`).join('');
}

/** Tab: the next suggestion into the line (Shift+Tab, the one before). */
function tab(back) {
  if (!S.cycle) {
    const items = suggest(S.sim, S.input.value);
    if (!items.length) return;
    S.cycle = { items, at: back ? items.length - 1 : 0 };
  } else {
    const n = S.cycle.items.length;
    S.cycle.at = (S.cycle.at + (back ? n - 1 : 1)) % n;
  }
  S.input.value = S.cycle.items[S.cycle.at].line;
  paintSuggestions();
  // One choice and it is a command: straight on to what it takes.
  if (S.cycle.items.length === 1) {
    S.cycle = null;
    paintSuggestions();
  }
}

/** Run one line. Exported for the tests: returns { ok, text }. */
export function runLine(sim, line) {
  const words = String(line || '').trim().replace(/^\/runcmd\b/i, '').trim().replace(/^\//, '').split(/\s+/).filter(Boolean);
  const cmd = (words[0] || '').toLowerCase();
  const arg = words[1];
  const p = prog(sim);
  if (cmd === 'give') return give(sim, p, words.slice(1));
  if (cmd === 'tp') return tp(sim, words.slice(1));
  if (cmd === 'time') return time(sim, words.slice(1));
  const num = (s) => {
    const n = Math.round(Number(String(s || '').replace(/[,_]/g, '')));
    return Number.isFinite(n) && n >= 0 && n <= Prog.CODE_AMOUNT_MAX ? n : null;
  };
  switch (cmd) {
    case '':
    case 'help':
      return { ok: true, text: HELP };
    case 'clear':
      if (S.log) S.log.textContent = '';
      return { ok: true, text: '' };
    case 'allaircraft': {
      const before = p.unlocked.length;
      p.unlocked = [...new Set([...p.unlocked, ...AIRCRAFT.map((a) => a.id)])];
      const saved = commit(sim, p);
      return { ok: true, text: `Unlocked all ${AIRCRAFT.length} aircraft (${p.unlocked.length - before} new).${saved ? '' : ' (This browser would not save it.)'}` };
    }
    case 'unlock': {
      const t = AIRCRAFT.find((a) => a.id === String(arg || '').toLowerCase());
      if (!t) return { ok: false, text: `No aircraft "${arg || ''}". Try /runcmd list.` };
      if (!p.unlocked.includes(t.id)) p.unlocked.push(t.id);
      commit(sim, p);
      return { ok: true, text: `Unlocked ${t.name || t.id}.` };
    }
    case 'list':
      return { ok: true, text: AIRCRAFT.map((a) => `${a.id}  ${a.name || ''}`).join('\n') };
    case 'credits':
    case 'addcredits': {
      const n = num(arg);
      if (n == null) return { ok: false, text: `Give a number, e.g. /runcmd ${cmd} 5000` };
      p.credits = cmd === 'credits' ? n : Math.min(Prog.CODE_AMOUNT_MAX, (p.credits || 0) + n);
      commit(sim, p);
      return { ok: true, text: `Credits: ${Prog.formatCredits(p.credits)}.` };
    }
    default:
      return { ok: false, text: `Unknown command "${cmd}". Type /runcmd help.` };
  }
}

function build() {
  if (S.root || typeof document === 'undefined') return;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const root = document.createElement('div');
  root.className = 'dcon';
  root.hidden = true;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'Dev console');
  root.innerHTML = `<div class="dcon-head"><span>Dev console</span><button type="button" data-dcon-close aria-label="Close">✕</button></div>
    <div class="dcon-log" data-dcon-log></div>
    <div class="dcon-sugg" data-dcon-sugg role="listbox" aria-label="Suggestions" hidden></div>
    <form class="dcon-row" data-dcon-form><input type="text" data-dcon-input placeholder="/give all" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="go"><button type="submit">Run</button></form>`;
  document.body.appendChild(root);
  S.root = root;
  S.log = root.querySelector('[data-dcon-log]');
  S.input = root.querySelector('[data-dcon-input]');
  S.sugg = root.querySelector('[data-dcon-sugg]');
  root.querySelector('[data-dcon-close]').addEventListener('click', close);
  S.input.addEventListener('input', () => {
    S.cycle = null;
    paintSuggestions();
  });
  // A tap (or a click) on a suggestion fills it in: the touch screen's Tab.
  S.sugg.addEventListener('pointerdown', (e) => e.preventDefault());
  S.sugg.addEventListener('click', (e) => {
    const b = e.target.closest('[data-dcon-fill]');
    if (!b) return;
    S.input.value = b.dataset.dconFill;
    S.cycle = null;
    paintSuggestions();
    S.input.focus();
  });
  // Typing here is never a game key (and Esc / the arrows work like a terminal's).
  S.input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') close();
    else if (e.key === 'Tab') { e.preventDefault(); tab(e.shiftKey); }
    else if (e.key === 'ArrowUp' && S.history.length) { S.at = Math.max(0, S.at - 1); S.input.value = S.history[S.at] || ''; e.preventDefault(); }
    else if (e.key === 'ArrowDown' && S.history.length) { S.at = Math.min(S.history.length, S.at + 1); S.input.value = S.history[S.at] || ''; e.preventDefault(); }
  });
  S.input.addEventListener('keyup', (e) => e.stopPropagation());
  root.querySelector('[data-dcon-form]').addEventListener('submit', (e) => {
    e.preventDefault();
    const line = S.input.value.trim();
    if (!line) return;
    S.history.push(line);
    S.at = S.history.length;
    S.input.value = '';
    S.cycle = null;
    print(`> ${line}`, 'cmd');
    const r = runLine(S.sim, line);
    if (r.text) print(r.text, r.ok ? 'ok' : 'err');
    paintSuggestions();
  });
}

export function open(sim, text = '') {
  S.sim = sim;
  build();
  if (!S.root) return;
  S.root.hidden = false;
  if (!S.log.textContent) print('Type / to see the commands; Tab fills in a suggestion. /help for the list.');
  if (text) S.input.value = text;
  S.cycle = null;
  paintSuggestions();
  S.input.focus();
}

export function close() {
  if (S.root) S.root.hidden = true;
}

export function isOpen() {
  return !!(S.root && !S.root.hidden);
}

registerExtension({
  id: 'dev-console',
  install(sim) {
    S.sim = sim;
  },
  devActions: [
    {
      label: 'Console',
      hint: '/give, /tp, /time (Tab fills in), credits and more',
      run(sim) { open(sim); },
    },
  ],
});

/** For the tests: the Javelin's earn, when /give started one. */
export const __devConsole = {
  get pending() {
    return S.pending;
  },
};
