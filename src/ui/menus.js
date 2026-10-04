/**
 * All the screens that are not the HUD: start menu, mission picker, free-flight
 * setup, settings (with key remapping), credits, pause and the debrief.
 */

import { MISSIONS } from '../game/missions.js';
import { icon } from './icons.js';
import { AIRCRAFT, performanceFor } from '../aircraft/types.js';
import { NATURAL_EVENTS, SELECTABLE_EVENTS } from '../game/disasters.js';
import { EF_SCALE } from '../world/tornado.js';
import { AP_MODES } from '../flight/autopilot.js';
import { PRESETS, TIMES, CONDITIONS } from '../world/weather.js';
import { ACTIONS, keyLabel, groupedActions } from '../flight/input.js';
import { CREDITS_HTML } from './credits.js';
import { MAPS } from '../world/maps.js';
import { extDevActions, extCode } from '../game/extensions.js';
import { loadFreePresets, saveFreePresets, MAX_FREE_PRESETS } from '../core/storage.js';
import * as Prog from '../game/progression.js';
import { LIVERIES, schemeFor } from '../aircraft/liveries.js';
// The hangar's showroom: tabs, arrows, the card, the podium (hangar-showcase-ui.js).
import { installHangarShowcase } from './hangar-showcase-ui.js';

function h(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

/* ====================================================================== */
/*
 * CATEGORIES — "Add categorys for missions and planes".
 *
 * That is the wishlist, in the owner's hand. What it was about: the flight
 * mission board was twelve cards in the order they were written, so Island
 * Circuit (the first lesson) sat beside Carrier Qualification (the hardest
 * thing in the game) and a tornado, and the aeroplane picker was one run in
 * the order the types were typed in, which put the Tempest, a propeller
 * tourer, between a carrier jet and the helicopter. Seven more aeroplanes and
 * three more kinds of mission are being built alongside this, so an unsorted
 * list was about to double.
 *
 * Everything below is data plus two functions, aircraftCategory() and
 * missionCategory(). Nothing is ever written back onto a roster entry or a
 * mission: other code owns those objects, and a menu that quietly adds a
 * field to them is how two teams end up disagreeing about what it means.
 *
 * A type or mission that names its own `category` goes where it says. One that
 * does not is placed from what it is — the aeroplane's `class`, the mission's
 * id, or failing that the words in its name — so anything added later lands
 * under a heading without anyone having to come back here.
 */

/* Heading icons, drawn on the same 24-unit grid and 1.7 stroke as icons.js so
   they sit beside the rest of the set. Kept here because icons.js belongs to
   the whole interface and these are only ever used by the headings. */
const CAT_ICONS = {
  light: '<path d="M12 3.6v15.2"/><path d="M3.4 10.2h17.2"/><path d="M8.6 18.6h6.8"/><path d="M9.4 3.4h5.2"/>',
  airliner: '<path d="M12 2.6c1.5 0 2.1 2.4 2.2 5.4l6.6 4.1v2.3l-6.6-2v3.9l2.3 1.7v1.7L12 19l-4.5.7v-1.7l2.3-1.7v-3.9l-6.6 2v-2.3L9.8 8c.1-3 .7-5.4 2.2-5.4Z"/>',
  jet: '<path d="M12 2.8 13.9 9l6.6 8.3-.3 1.3-6.3-2.3-.7 2.6 2.2 1.6v.9L12 20.8l-3.4.6v-.9l2.2-1.6-.7-2.6-6.3 2.3-.3-1.3L10.1 9Z"/>',
  heli: '<path d="M3.5 6h17"/><path d="M12 6v2.6"/><path d="M7.5 8.6h6l2.5 3.4h4.5"/><path d="M7.5 8.6a3.4 3.4 0 0 0 0 6.8h6.5l2-3.4"/><path d="M19.5 10.2v3.6"/><path d="M6 18h9"/><path d="M8.5 15.4V18M13 15.4V18"/>',
  special: '<path d="M12 3.4 13.9 10.1 20.6 12l-6.7 1.9L12 20.6l-1.9-6.7L3.4 12l6.7-1.9Z"/>',
  training: '<path d="M2.6 9.4 12 5l9.4 4.4L12 13.8Z"/><path d="M6.4 11.4v4.3c3.2 2.3 8 2.3 11.2 0v-4.3"/><path d="M21.4 9.4v5.2"/>',
  airline: '<rect x="3.5" y="7.5" width="17" height="11.5" rx="2"/><path d="M9 7.5V5.8a1.3 1.3 0 0 1 1.3-1.3h3.4A1.3 1.3 0 0 1 15 5.8v1.7"/><path d="M3.5 12.4h17"/>',
  delivery: '<path d="M12 3.2 20.5 7.6v8.8L12 20.8 3.5 16.4V7.6Z"/><path d="M3.5 7.6 12 12l8.5-4.4"/><path d="M12 12v8.8"/><path d="m7.8 5.4 8.5 4.4"/>',
  rescue: '<circle cx="12" cy="12" r="8.4"/><circle cx="12" cy="12" r="3.6"/><path d="m6.1 6.1 3.4 3.4M17.9 6.1l-3.4 3.4M6.1 17.9l3.4-3.4M17.9 17.9l-3.4-3.4"/>',
  challenge: '<path d="M7.5 4.5h9v4a4.5 4.5 0 0 1-9 0Z"/><path d="M7.5 6.3H4.6a3 3 0 0 0 3.1 4M16.5 6.3h2.9a3 3 0 0 1-3.1 4"/><path d="M12 13v3.4"/><path d="M8.6 19.6h6.8l-1-3.2H9.6Z"/>',
  events: '<path d="M6.6 17v-4.8a5.4 5.4 0 0 1 10.8 0V17"/><path d="M4.6 17h14.8v2.6H4.6Z"/><path d="M12 3v2M4.4 6.1l1.4 1.4M19.6 6.1l-1.4 1.4"/>',
  meteor: '<circle cx="15.4" cy="8.6" r="3.8"/><path d="M12.6 11.4 3.8 20.2M10.9 8.4 5.4 13.9M15.6 13 10.1 18.5"/>',
  fire: '<path d="M12 20.8c-3.8 0-6.4-2.5-6.4-6 0-3.2 2.2-5 3.5-7.6.4 1.8 1.3 2.9 2.6 3.5.3-3.2 1.7-5.6 4-7.5-.3 2.9.8 4.7 2 6.5.9 1.4 1.5 2.9 1.5 5.1 0 3.5-2.9 6-7.2 6Z"/><path d="M12 20.8c-1.6 0-2.7-1.1-2.7-2.7 0-1.6 1.2-2.5 2-3.8.8 1.2 3.4 2.1 3.4 4 0 1.4-1.1 2.5-2.7 2.5Z"/>',
  military: '<path d="M12 3.2 19.5 6v5.6c0 4.3-3.1 7.7-7.5 9.2-4.4-1.5-7.5-4.9-7.5-9.2V6Z"/><path d="m12 8.3 1.2 2.5 2.7.3-2 1.8.6 2.7-2.5-1.4-2.5 1.4.6-2.7-2-1.8 2.7-.3Z"/>',
  other: '<circle cx="12" cy="12" r="8.4"/><circle cx="12" cy="12" r="4.4"/><circle cx="12" cy="12" r="0.9" fill="currentColor" stroke="none"/>',
  search: '<circle cx="10.6" cy="10.6" r="6.2"/><path d="m15.2 15.2 5 5"/>',
};

function catIcon(name, size = 20) {
  const body = CAT_ICONS[name] || CAT_ICONS.other;
  return (
    `<svg class="icon" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" ` +
    'stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" ' +
    `aria-hidden="true" focusable="false">${body}</svg>`
  );
}

/*
 * The five aircraft headings, in the order a child meets them: the ones you
 * learn in first, the big ones, the fast ones, the one that hovers.
 */
export const AIRCRAFT_CATEGORIES = [
  { id: 'light', label: 'Light aircraft', blurb: 'Small, slow and friendly — the ones to learn in', colour: '#7ee8b2', icon: 'light' },
  { id: 'airliner', label: 'Airliners', blurb: 'Lots of seats and a lot of momentum', colour: '#58c6ff', icon: 'airliner' },
  { id: 'military', label: 'Military jets', blurb: 'Very fast, and very twitchy', colour: '#b9cf8f', icon: 'jet' },
  { id: 'helicopter', label: 'Helicopters', blurb: 'They hover — nothing else here does', colour: '#ff9d6a', icon: 'heli' },
  { id: 'special', label: 'Special', blurb: 'The odd ones out', colour: '#c39bff', icon: 'special' },
];

/*
 * The mission headings. Eight are the contract every mission team builds
 * against; "Challenges" is the ninth, for the three flight missions that are
 * none of those things — a timed lap of an erupting volcano, three passes
 * through a tornado, and losing the jets on your tail in cloud. Putting them
 * under Training or Emergencies would have been a heading that lies about
 * what is under it, and a ten-year-old reads the heading, not the card.
 *
 * Military is last so the passcode gate never leaves a hole in the middle of
 * the list: before the code it is simply not there.
 *
 * "Firefighting" came after: the wishlist asked for forest fires to put out
 * in the aeroplane and the helicopter, and those missions have a slot of their
 * own (game/extra/fire.js) being filled in parallel. Without a heading here a
 * category of 'fire' still got one, but as a grey "Fire" with the plain ring
 * icon, and 'firefighting' or 'wildfire' would each have got another — so it
 * is listed, with the words a team is likely to type mapped onto it below.
 * If the fire missions say `rescue` instead, this heading never appears.
 */
export const MISSION_CATEGORIES = [
  { id: 'training', label: 'Training', blurb: 'Start here — one new thing at a time', colour: '#7ee8b2', icon: 'training' },
  { id: 'airline', label: 'Passengers & cargo', blurb: 'Big aeroplanes, people on board and a timetable', colour: '#58c6ff', icon: 'airline' },
  { id: 'delivery', label: 'Deliveries', blurb: 'Get it there on time, and in one piece', colour: '#ffd166', icon: 'delivery' },
  { id: 'rescue', label: 'Rescue', blurb: 'Somebody needs help. Go and get them', colour: '#ff7f78', icon: 'rescue' },
  { id: 'fire', label: 'Firefighting', blurb: 'The forest is on fire — scoop up water and put it out', colour: '#ff6a2b', icon: 'fire' },
  { id: 'challenge', label: 'Challenges', blurb: 'Against the clock, the weather or the ground', colour: '#c39bff', icon: 'challenge' },
  { id: 'events', label: 'Emergencies', blurb: 'Something goes wrong — stay calm and get it down', colour: '#ffa24d', icon: 'events' },
  { id: 'meteor', label: 'Meteor mode', blurb: 'Things falling out of space — keep out of the way', colour: '#8fa6ff', icon: 'meteor' },
  { id: 'military', label: 'Military', blurb: 'Fast jets, the carrier and the range', colour: '#b9cf8f', icon: 'military' },
];

/*
 * What the forty-odd missions that already existed are, read one by one.
 *
 * A table rather than a guess because the words mislead: "Man Overboard" is a
 * rescue in both the boat and the helicopter, but "The Airport Shuttle" is a
 * crate in a van, not passengers, and "First Shout" is a real tow, not a
 * lesson. Anything not in here is placed by missionCategory() below.
 */
const MISSION_CATEGORY_OF = {
  // Flight.
  circuit: 'training',
  storm: 'training', // "Teaches crosswind landings" — a lesson in bad weather, not an emergency
  delivery: 'delivery',
  medevac: 'rescue',
  deadstick: 'events', // the engine quits: the original emergency
  emberrun: 'challenge',
  chaser: 'challenge',
  tail: 'challenge', // in the Vanguard, which is not behind the passcode
  carrierqual: 'military',
  patrol: 'military',
  recon: 'military',
  range: 'military',
  // Helicopter: one lesson, and then everything is somebody to fetch.
  firstlight: 'training',
  covepickup: 'rescue',
  overboard: 'rescue',
  stackrescue: 'rescue',
  nightdeck: 'rescue',
  lastlight: 'rescue',
  oncall: 'rescue',
  // Boat: it is a lifeboat. All six are shouts.
  'first-shout': 'rescue',
  'man-overboard': 'rescue',
  'wren-aground': 'rescue',
  'night-shout': 'rescue',
  'in-the-gale': 'rescue',
  'long-tow': 'rescue',
  // Car: the courier. First Run is "learn where the pedals are".
  firstrun: 'training',
  shuttle: 'delivery',
  coastroad: 'delivery',
  summit: 'delivery',
  lowtide: 'delivery',
  nightcall: 'rescue', // the doctor to the outpost at two in the morning
};

/*
 * Words people will actually type into a `category` field, mapped to the ids.
 * Two tables, because the same word means different things: 'airliner' is an
 * aircraft heading, while on a mission it can only mean passengers.
 */
const MISSION_CATEGORY_WORDS = {
  training: 'training', train: 'training', lesson: 'training', lessons: 'training', tutorial: 'training',
  airline: 'airline', airlines: 'airline', airliner: 'airline', passengers: 'airline', 'passengers & cargo': 'airline', cargo: 'airline',
  delivery: 'delivery', deliveries: 'delivery',
  rescue: 'rescue', rescues: 'rescue',
  fire: 'fire', fires: 'fire', firefighting: 'fire', 'fire fighting': 'fire', firefighter: 'fire',
  wildfire: 'fire', wildfires: 'fire', 'forest fire': 'fire', 'forest fires': 'fire', 'water bombing': 'fire',
  challenge: 'challenge', challenges: 'challenge',
  events: 'events', event: 'events', emergency: 'events', emergencies: 'events',
  meteor: 'meteor', meteors: 'meteor', 'meteor mode': 'meteor',
  military: 'military',
};
const AIRCRAFT_CATEGORY_WORDS = {
  light: 'light', 'light aircraft': 'light',
  airliner: 'airliner', airliners: 'airliner',
  military: 'military', 'military jets': 'military',
  helicopter: 'helicopter', helicopters: 'helicopter', heli: 'helicopter',
  special: 'special',
};

function slug(v) {
  return String(v == null ? '' : v).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** A `category` field, read generously: 'Emergencies', 'emergency' and 'events' are one heading. */
function readCategory(raw, words) {
  const s = String(raw == null ? '' : raw).toLowerCase().trim();
  if (!s) return '';
  return words[s] || words[s.replace(/[-_]/g, ' ')] || slug(s);
}

/**
 * Which heading an aeroplane goes under. Always exactly one of the five.
 *
 * `category` if it names one of the five; otherwise the passcode flag (a
 * gated type is a military one whatever it is called); otherwise its class,
 * read by keyword so that "Stealth fighter" and "Wide-body airliner" land
 * where a person would put them; otherwise Special.
 */
export function aircraftCategory(type) {
  if (!type) return 'special';
  const own = readCategory(type.category, AIRCRAFT_CATEGORY_WORDS);
  if (AIRCRAFT_CATEGORIES.some((c) => c.id === own)) return own;
  if (type.military) return 'military';
  const cls = String(type.class || '').toLowerCase();
  if (/heli|rotor/.test(cls)) return 'helicopter';
  if (/fighter|bomber|carrier|attack|strike|military|interceptor|stealth/.test(cls)) return 'military';
  if (/airliner|jumbo|wide-?body|narrow-?body|jetliner|regional|transport/.test(cls)) return 'airliner';
  if (/trainer|tourer|touring|light|utility|bush|sport|single/.test(cls)) return 'light';
  return 'special';
}

/* The order keywords are tried in matters: "Medevac delivery" is a rescue. */
const MISSION_WORDS = [
  [/meteor|asteroid|comet|space ?rock/, 'meteor'],
  // A fire on the ground, not on board: that one is an emergency, below.
  [/wild ?fire|forest ?fire|bush ?fire|grass ?fire|water ?bomb|fire ?fight|put (?:it|them|the fires?) out/, 'fire'],
  [/hijack|7500|7700|mayday|emergenc|engine (?:fire|out|fail)|bird ?strike|fire on board|failure|dead ?stick/, 'events'],
  [/rescue|medevac|overboard|winch|casualty|stranded|call-?out|lifeboat|ambulance|search/, 'rescue'],
  [/passenger|airline|charter|cargo|freight|long ?haul|jumbo|holiday|boarding/, 'airline'],
  [/deliver|parcel|courier|supplies|supply|relay|mail|post run|pizza/, 'delivery'],
  [/first|lesson|training|practice|circuit|learn|basics/, 'training'],
];

/**
 * Which heading a mission goes under. Always exactly one.
 *
 * Its own `category` first, and an unfamiliar one is kept rather than
 * refused — a team that invents "stunts" gets a Stunts heading, not a mission
 * silently filed under something else. Then the table above; then the
 * passcode (a gated mission, or one flown in a gated aeroplane, is military);
 * then the words in its name; and anything still unplaced is a Challenge.
 */
export function missionCategory(m) {
  if (!m) return 'challenge';
  const own = readCategory(m.category, MISSION_CATEGORY_WORDS);
  if (own) return own;
  if (MISSION_CATEGORY_OF[m.id]) return MISSION_CATEGORY_OF[m.id];
  if (m.military) return 'military';
  const ac = m.aircraft ? AIRCRAFT.find((a) => a.id === m.aircraft) : null;
  if (ac && ac.military) return 'military';
  const words = `${m.id || ''} ${m.name || ''} ${m.short || ''}`.toLowerCase();
  for (const [re, cat] of MISSION_WORDS) if (re.test(words)) return cat;
  return 'challenge';
}

/*
 * The credits a mission pays depend on the heading it is under, and this is
 * the function that decides the heading — so progression.js is handed it,
 * once, rather than keeping a second opinion of its own.
 */
Prog.setCategoryResolver(missionCategory);

/** The heading for a category id; one nobody listed gets a plain heading of its own. */
export function categoryDef(kind, id) {
  const list = kind === 'aircraft' || kind === 'fleet' ? AIRCRAFT_CATEGORIES : MISSION_CATEGORIES;
  const known = list.find((c) => c.id === id);
  if (known) return known;
  const words = String(id || 'other').replace(/-/g, ' ');
  return {
    id,
    label: words.charAt(0).toUpperCase() + words.slice(1),
    blurb: '',
    colour: '#9fb2cc',
    icon: 'other',
    extra: true,
  };
}

/*
 * Sort order. A heading nobody listed goes after every listed one but before
 * Military, so the passcode section stays at the bottom.
 */
function categoryRank(kind, id) {
  const list = kind === 'aircraft' || kind === 'fleet' ? AIRCRAFT_CATEGORIES : MISSION_CATEGORIES;
  const i = list.findIndex((c) => c.id === id);
  if (i >= 0) return i * 10;
  const mil = list.findIndex((c) => c.id === 'military');
  return mil >= 0 ? mil * 10 - 5 : list.length * 10;
}

/**
 * Split a list into headed groups, in heading order, keeping each group's
 * items in the order they came. Groups with nothing in them are left out.
 */
export function groupByCategory(kind, items, catOf) {
  const groups = new Map();
  for (const it of items) {
    const id = catOf(it);
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(it);
  }
  return [...groups.keys()]
    .sort((a, b) => categoryRank(kind, a) - categoryRank(kind, b))
    .map((id) => ({ def: categoryDef(kind, id), items: groups.get(id) }));
}

/** '#58c6ff' → 'rgba(88,198,255,0.16)'. color-mix() is too new for a 2019 Chromebook. */
function soft(hex, a) {
  const n = parseInt(String(hex).replace('#', ''), 16) || 0;
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function catStyle(def) {
  return `--cat:${def.colour};--cat-soft:${soft(def.colour, 0.16)};--cat-line:${soft(def.colour, 0.42)}`;
}

/** Lower-case, accents off, one space between words: what the search box compares. */
function fold(s) {
  return String(s == null ? '' : s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function attr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/**
 * The attributes a card needs to live under a heading: which heading, and the
 * words the search box looks through. For cards built outside this file —
 * game-ui.js adds mission cards after build — so they are found the same way.
 */
export function categoryItemData(kind, obj) {
  const isFleet = kind === 'aircraft' || kind === 'fleet';
  const cat = isFleet ? aircraftCategory(obj) : missionCategory(obj);
  const label = categoryDef(kind, cat).label;
  const find = isFleet
    ? fold(`${obj.name} ${obj.id} ${obj.class || ''} ${obj.blurb || ''} ${label}`)
    : fold(`${obj.name} ${obj.short || ''} ${obj.blurb || ''} ${label}`);
  return { cat, find };
}

/**
 * The small "Up to 380 credits" line on a mission card: the most it can pay
 * (progression.js, maxPayout). Exported for cards built outside this file.
 */
export function payLineHtml(m, settings = 'normal') {
  const max = Prog.maxPayout(m, { settings: settings || 'normal' });
  return `<span class="mission-pay" data-pay-line="${attr(m.id)}" title="The most this pays. Fly it well to get all of it">${icon('credit', 13)}<span data-pay-words>${Prog.payLine(max)}</span></span>`;
}

/** One heading and the grid under it. `inner` is the cards, already HTML. */
function catGroupHtml(kind, def, inner, gridClass) {
  return `
    <section class="cat-group" data-cat-group="${attr(def.id)}" data-cat-kind="${kind}" style="${catStyle(def)}">
      <header class="cat-head">
        <span class="cat-badge">${catIcon(def.icon, 22)}</span>
        <span class="cat-words">
          <h3 class="cat-title">${def.label}</h3>
          ${def.blurb ? `<span class="cat-blurb">${def.blurb}</span>` : ''}
        </span>
        <span class="cat-count" data-cat-count title="How many are in this group"></span>
      </header>
      <div class="${gridClass}" data-cat-grid>${inner}</div>
    </section>`;
}

/** The chips and the search box above a grouped list. */
function catBarHtml(kind, noun) {
  return `
    <div class="cat-bar" data-cat-bar="${kind}">
      <div class="cat-chips" data-cat-chips role="group" aria-label="Show one group of ${noun}"></div>
      <label class="cat-search" data-cat-search-wrap>
        ${catIcon('search', 17)}
        <input type="search" data-cat-search placeholder="Find ${noun === 'aeroplanes' ? 'an aeroplane' : 'a mission'}"
          aria-label="Find ${noun}" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="search">
      </label>
    </div>
    <p class="cat-empty" data-cat-empty="${kind}" hidden>
      <span data-cat-empty-text></span>
      <button class="ghost" data-cat-clear>Show them all</button>
    </p>`;
}

/**
 * The four games, in the order they appear in the bar.
 *
 * They are four things to be in one world rather than four copies of the
 * engine: the boat needs the sea, the car needs the apron and the helicopter
 * needs terrain to hover over, and all three are already outside the window.
 */
export const GAMES = [
  { id: 'flight', name: 'Flight', icon: 'plane', title: 'Fly an aeroplane' },
  { id: 'heli', name: 'Heli', icon: 'heli', title: 'Skyhook H-3 — the one that hovers' },
  { id: 'boat', name: 'Boat', icon: 'boat', title: 'Kestrel Launch — out of the bay' },
  { id: 'car', name: 'Car', icon: 'car', title: 'Airfield Runabout — round the apron' },
];

/**
 * A small painted preview of a map, drawn from the same island list the
 * terrain generator uses — so the picture is genuinely the place you are
 * about to fly, not decoration.
 */
function mapThumbnail(def) {
  const S = 190;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  c.className = 'map-thumb';
  const g = c.getContext('2d');
  const pal = def.palette;
  const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;

  // Sea.
  const sea = g.createLinearGradient(0, 0, 0, S);
  sea.addColorStop(0, hex(pal.swell));
  sea.addColorStop(1, hex(pal.deepWater));
  g.fillStyle = sea;
  g.fillRect(0, 0, S, S);

  // Fit every island into the frame.
  let span = 2500;
  for (const i of def.islands) {
    span = Math.max(span, Math.abs(i.cx) + i.radius * 1.3, Math.abs(i.cz) + i.radius * 1.3);
  }
  const k = (S * 0.46) / span;
  const px = (x) => S / 2 + x * k;
  const pz = (z) => S / 2 + z * k;

  const land = `rgb(${Math.round(150 * pal.grass[0])}, ${Math.round(175 * pal.grass[1])}, ${Math.round(105 * pal.grass[2])})`;
  const shore = `rgb(${Math.round(214 * pal.sand[0])}, ${Math.round(198 * pal.sand[1])}, ${Math.round(158 * pal.sand[2])})`;
  const high = `rgb(${Math.round(150 * pal.rock[0])}, ${Math.round(148 * pal.rock[1])}, ${Math.round(144 * pal.rock[2])})`;

  for (const isl of def.islands) {
    const r = isl.radius * k;
    // Beach ring, then land, then a cap of high ground scaled by the peak.
    g.beginPath();
    g.arc(px(isl.cx), pz(isl.cz), r * 1.06, 0, Math.PI * 2);
    g.fillStyle = shore;
    g.fill();
    g.beginPath();
    g.arc(px(isl.cx), pz(isl.cz), r * 0.92, 0, Math.PI * 2);
    g.fillStyle = land;
    g.fill();
    const relief = Math.min(0.72, isl.peak / 900);
    if (relief > 0.08) {
      g.beginPath();
      g.arc(px(isl.cx), pz(isl.cz), r * relief, 0, Math.PI * 2);
      g.fillStyle = high;
      g.globalAlpha = 0.85;
      g.fill();
      g.globalAlpha = 1;
    }
  }

  /*
   * The runway — this map's runway, where this map actually put it.
   *
   * It was drawn from (-550, 0) to (550, 0) on every card, because for the
   * first nine maps that is where the runway is. Twenty-three more have
   * arrived since and most of them put the strip somewhere else entirely, so
   * every one of their cards drew a white line through the middle of the
   * island with nothing underneath it. A boat map drew one too.
   */
  const rw = def.airport && def.airport.runway;
  const half = rw ? rw.length / 2 : 550;
  const rcx = rw ? rw.cx : 0;
  const rcz = rw ? rw.cz : 0;
  const along = ((def.airport && def.airport.headingDeg) ?? 90) * (Math.PI / 180);
  g.strokeStyle = '#f2f5f8';
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(px(rcx - Math.sin(along) * half), pz(rcz + Math.cos(along) * half));
  g.lineTo(px(rcx + Math.sin(along) * half), pz(rcz - Math.cos(along) * half));
  g.stroke();
  /*
   * And a harbour, where the map has one, because a boat map's landmark is not
   * its airstrip.
   */
  const H = def.waters && def.waters.harbour;
  if (H && H.cx !== undefined) {
    g.fillStyle = '#7ee8b2';
    g.beginPath();
    g.arc(px(H.cx), pz(H.cz), 4, 0, Math.PI * 2);
    g.fill();
  }
  return c;
}

/**
 * A plan view of one aeroplane, drawn from the same shape data the 3D model
 * is lofted from — so the picture on the card is genuinely the aircraft you
 * are about to fly, not an illustration of one. Span, chord, sweep, tail size,
 * engine count and their positions all come straight off `type.shape`.
 */
function aircraftThumbnail(type, liveryId) {
  const W = 300;
  const H = 190;
  const c = document.createElement('canvas');
  c.width = W * 2;
  c.height = H * 2;
  c.className = 'fleet-art';
  const g = c.getContext('2d');
  g.scale(2, 2);
  const S = type.shape;
  /*
   * Lighten the livery for the plan view.
   *
   * Several aeroplanes are painted in genuinely dark colours — the Courier is
   * #1d2b3a — and on a dark card that silhouette simply disappeared: you got
   * an empty box where the picture should be. Mixing each livery two-thirds of
   * the way to white keeps the aircraft recognisably its own colour while
   * guaranteeing it reads against the panel behind it.
   */
  const lighten = (hex, amount) => {
    const n = parseInt(String(hex).replace('#', ''), 16);
    const r = (n >> 16) & 255;
    const g2 = (n >> 8) & 255;
    const b = n & 255;
    const mix = (v) => Math.round(v + (255 - v) * amount);
    return `rgb(${mix(r)},${mix(g2)},${mix(b)})`;
  };
  /*
   * The card has to show the paint you are actually flying, or the hangar is
   * quietly lying about what is on the apron.
   */
  const sch = schemeFor(type, liveryId);
  const livery = lighten(sch.base || type.livery || '#26323f', 0.66);
  const accent = sch.accent || type.accent || '#e0a838';
  const tailCol = sch.tail != null ? `#${sch.tail.toString(16).padStart(6, '0')}` : accent;

  // Fit the aeroplane into the frame: span across, length down. A type that
  // carries its real planform (S.plan, the airliners) is fitted nose to tail.
  const PL = S.plan || null;
  const span = S.halfSpan * 2 * S.scale;
  const len = (PL ? PL.tailZ - PL.noseZ : S.hZ + S.hRootChord + 3.4) * S.scale * S.bodyLength;
  const k = Math.min((W * 0.86) / span, (H * 0.84) / len);
  const cx = W / 2;
  // Centre the drawn length, not the centre of gravity, when the plan says
  // where the ends are: an airliner's CG is well aft of its middle.
  const cz = H / 2 - (PL ? ((PL.noseZ + PL.tailZ) / 2) * S.scale * S.bodyLength * k : 0);
  // Model space: -Z is forward, so screen-up is -Z.
  const px = (x) => cx + x * S.scale * k;
  const py = (z) => cz + z * S.scale * S.bodyLength * k;

  const wing = (half, root, tip, sweep, z, colour) => {
    for (const side of [-1, 1]) {
      g.fillStyle = colour;
      g.beginPath();
      g.moveTo(px(0), py(z - root / 2));
      g.lineTo(px(side * half), py(z + sweep - tip / 2));
      g.lineTo(px(side * half), py(z + sweep + tip / 2));
      g.lineTo(px(0), py(z + root / 2));
      g.closePath();
      g.fill();
    }
  };

  // Main wing, then tailplane.
  wing(S.halfSpan, S.rootChord, S.tipChord, S.sweep, S.wingZ, livery);
  wing(S.hSpan, S.hRootChord, S.hRootChord * 0.62, 0.28, S.hZ, livery);

  // Fuselage: a rounded spindle down the middle.
  const noseZ = PL ? PL.noseZ : -(2.9 + (S.power.kind === 'prop' ? 0.5 : 0));
  const tailZ = PL ? PL.tailZ : S.hZ + S.hRootChord * 0.7;
  // The real fuselage half-width when the plan has it: the 0.42 guess drew
  // the 747 at half its width, a needle with wings.
  const bw = PL && PL.halfWidth ? PL.halfWidth : 0.42 * (S.bodyRadius || 1);
  g.fillStyle = livery;
  g.beginPath();
  g.moveTo(px(0), py(noseZ));
  g.quadraticCurveTo(px(bw), py(noseZ + 1.2), px(bw), py(0));
  g.quadraticCurveTo(px(bw), py(tailZ - 1.2), px(0), py(tailZ));
  g.quadraticCurveTo(px(-bw), py(tailZ - 1.2), px(-bw), py(0));
  g.quadraticCurveTo(px(-bw), py(noseZ + 1.2), px(0), py(noseZ));
  g.closePath();
  g.fill();

  // A stripe down the spine, in the accent colour, plus the fin.
  g.strokeStyle = accent;
  g.lineWidth = Math.max(1.6, bw * S.scale * k * 0.5);
  g.beginPath();
  g.moveTo(px(0), py(noseZ + 1));
  g.lineTo(px(0), py(tailZ - 0.4));
  g.stroke();
  g.fillStyle = tailCol;
  g.beginPath();
  g.moveTo(px(0), py(S.finZ - S.finRootChord / 2));
  g.lineTo(px(0.12), py(S.finZ + S.finRootChord / 2));
  g.lineTo(px(-0.12), py(S.finZ + S.finRootChord / 2));
  g.closePath();
  g.fill();

  // Engines: propeller discs out front, or nacelles under the wing.
  const P = S.power;
  g.strokeStyle = 'rgba(226,236,248,0.8)';
  g.fillStyle = 'rgba(226,236,248,0.22)';
  if (P.kind === 'prop') {
    const spots = P.count === 1 ? [0] : [-S.halfSpan * 0.42, S.halfSpan * 0.42];
    for (const sx of spots) {
      g.beginPath();
      g.arc(px(sx), py(P.z), P.propRadius * S.scale * k, 0, Math.PI * 2);
      g.fill();
      g.lineWidth = 1.2;
      g.stroke();
    }
  } else {
    // Every engine where it really hangs when the plan knows (four on the
    // 747 and the A380); otherwise one mirrored pair, as before.
    const spots = PL && PL.engines
      ? PL.engines
      : (P.count >= 2 ? [-S.halfSpan * 0.46, S.halfSpan * 0.46] : [0]).map((x) => ({ x, z: S.wingZ }));
    for (const e of spots) {
      g.fillStyle = '#2a3340';
      const nw = 0.34 * S.scale * k;
      const nl = 1.5 * S.scale * k;
      g.beginPath();
      g.roundRect
        ? g.roundRect(px(e.x) - nw, py(e.z) - nl / 2, nw * 2, nl, nw)
        : g.rect(px(e.x) - nw, py(e.z) - nl / 2, nw * 2, nl);
      g.fill();
    }
  }

  // Canopy / flight-deck glazing, so the nose end is obvious.
  g.fillStyle = 'rgba(150,205,240,0.75)';
  g.beginPath();
  // Just behind the nose when the plan knows where the nose is.
  const glazeZ = PL ? PL.noseZ + 0.9 : S.wingZ - 1.5;
  g.ellipse(px(0), py(glazeZ), bw * 0.62 * S.scale * k, 0.9 * S.scale * k, 0, 0, Math.PI * 2);
  g.fill();
  return c;
}

export class Menus {
  /**
   * @param {HTMLElement} root
   * @param {object} hooks callbacks into the game
   */
  constructor(root, hooks) {
    this.root = root;
    this.hooks = hooks;
    /*
     * Read once here so the hangar can paint itself at build time. main.js
     * owns the live copy and hands the SAME object back through
     * syncProgression() — the two must never be separate objects, because the
     * hangar's buttons mutate this one in place while main.js reads its own
     * for gating. They diverged exactly that way once already: entering the
     * passcode unlocked the menus' copy and left main.js's at false for the
     * rest of the session.
     */
    this.prog = Prog.load();
    this.current = null;
    /** Which of the four the bar should show as lit. Set before build(). */
    this.currentGame = 'flight';
    this.screens = {};
    this.build();
  }

  build() {
    const layer = h('<div class="menu-layer" hidden></div>');
    this.layer = layer;

    // The bar is a sibling of the screens, not part of any one of them, so it
    // survives show() — which hides every screen but the named one.
    layer.appendChild(this.buildBar());

    layer.appendChild(this.buildMain());
    layer.appendChild(this.buildMissions());
    layer.appendChild(this.buildMaps());
    layer.appendChild(this.buildFree());
    layer.appendChild(this.buildSettings());
    layer.appendChild(this.buildCredits());
    layer.appendChild(this.buildHangar());
    layer.appendChild(this.buildMore());
    layer.appendChild(this.buildPause());
    layer.appendChild(this.buildDebrief());

    this.root.appendChild(layer);
  }

  /* ------------------------------------------------------------------ */

  /**
   * The bar that sits above every menu screen.
   *
   * Two things the class asked for, and they belong together: which game you
   * are in, and how many credits you have. Both were previously buried — the
   * other three vehicles were four clicks deep inside More, and your balance
   * only existed on the two screens that spend it. A switcher you can see is
   * the difference between "there is a boat somewhere" and "I will take the
   * boat out", and a balance you can see is what makes earning one mean
   * anything.
   *
   * It is built once and lives outside the screens, because show() hides every
   * screen but one — anything inside a screen would vanish with it.
   */
  buildBar() {
    const bar = h(`
      <div class="menu-bar">
        <div class="switcher" role="group" aria-label="Choose a game">
          ${GAMES.map(
            (g) => `<button class="switch-btn" data-game="${g.id}" title="${g.title}">
              ${icon(g.icon, 19)}<span>${g.name}</span>
            </button>`
          ).join('')}
        </div>
        <button class="credit-pill" data-goto-bar="hangar" title="Your credits — spend them in the hangar">
          ${icon('credit', 17)}<span data-bar-credits>0</span>
        </button>
      </div>
    `);

    bar.addEventListener('click', (e) => {
      const g = e.target.closest('[data-game]');
      if (g) {
        // Re-picking the game you are already in should do nothing rather than
        // restart it, which is what makes the bar safe to prod.
        if (g.dataset.game === this.currentGame) return;
        this.hooks.switchGame && this.hooks.switchGame(g.dataset.game);
        return;
      }
      const to = e.target.closest('[data-goto-bar]');
      if (to) this.show(to.dataset.gotoBar);
    });

    this.bar = bar;
    /**
     * Repaint the bar. Cheap enough to call from anywhere that touches
     * credits, which is the point — there is no list of callers to keep up to
     * date, only "call this after you change something".
     */
    this.syncBar = () => {
      const p = this.prog || Prog.load();
      bar.querySelector('[data-bar-credits]').textContent = Prog.formatCredits(p.credits);
      for (const btn of bar.querySelectorAll('[data-game]')) {
        btn.classList.toggle('is-on', btn.dataset.game === this.currentGame);
      }
    };
    this.syncBar();
    return bar;
  }

  /**
   * The start screen.
   *
   * The Missions card used to promise "three challenges: rings, a delivery and
   * a storm". MISSIONS holds twelve, and the rings went the day every
   * navigation objective became a real place on the island — so the card was
   * advertising a smaller, older game than the one behind the button, and one
   * of the three things it named no longer existed.
   *
   * It says eight rather than twelve on purpose: four are military and stay
   * hidden until the passcode is entered, so a child who counted the cards
   * after being promised twelve would think four had gone missing. That is the
   * same count the stats line under the nav uses. The three named are real
   * ones — Mango Cay Delivery, Storm Approach and Dead Stick — and the
   * sentence is kept to the length of its neighbours so the card does not grow
   * half again as tall as every other card in the row.
   *
   * Then a meteor mode, a goofy list and an emergencies list were built in
   * parallel, and "eight" was about to be wrong again the day they landed. So
   * the line is now counted, not written: game-ui.js's refreshMissionsLine()
   * rewrites it from MISSIONS on every visit to this screen, as "N missions —"
   * and the first few headings you will find behind the button. The text
   * below is only what shows for the instant before that runs.
   */
  buildMain() {
    const s = h(`
      <section class="screen screen-main" data-screen="main" hidden>
        <div class="brand">
          <div class="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 64 64" width="58" height="58">
              <path d="M32 6 L36 24 L58 32 L36 40 L32 58 L28 40 L6 32 L28 24 Z" fill="currentColor" opacity="0.9"/>
              <circle cx="32" cy="32" r="5" fill="#0b1220"/>
            </svg>
          </div>
          <div>
            <h1>Island Flight Simulator</h1>
            <p class="tagline">Learn to fly a real aeroplane — <span data-map-name>Kestrel Island</span></p>
          </div>
        </div>

        <nav class="main-nav">
          <button class="card-btn" data-act="tutorial">
            <span class="card-icon">${icon('learn', 24)}</span>
            <span class="card-body"><strong>Tutorial</strong><em>Start here — learn take-off, turning and landing</em></span>
          </button>
          <button class="card-btn" data-act="missions">
            <span class="card-icon">${icon('target', 24)}</span>
            <span class="card-body"><strong>Missions</strong><em data-missions-line>Training, rescues, deliveries and emergencies — sorted into groups</em></span>
          </button>
          <button class="card-btn" data-act="free">
            <span class="card-icon">${icon('cloud', 24)}</span>
            <span class="card-body"><strong>Free Flight</strong><em>Any weather, any time of day, no rules</em></span>
          </button>
          <button class="card-btn" data-act="multiplayer">
            <span class="card-icon">${icon('players', 24)}</span>
            <span class="card-body"><strong>Multiplayer</strong><em>Fly with friends — five open lobbies, or a private match with a code</em></span>
          </button>
          <button class="card-btn" data-act="maps">
            <span class="card-icon">${icon('map', 24)}</span>
            <span class="card-body"><strong>Choose Map</strong><em data-map-blurb>Five places to fly, from flat grassland to a volcano</em></span>
          </button>
          <button class="card-btn" data-act="more">
            <span class="card-icon">${icon('more', 24)}</span>
            <span class="card-body"><strong>More</strong><em>Your rank and leaderboard, the hangar, the other vehicles, and settings</em></span>
          </button>
        </nav>

        <div class="main-foot">
          <div class="stats" data-stats></div>
          <div class="foot-links">
            <button class="ghost" data-act="sound" data-sound>🔇 Sound is off — turn it on</button>
            <button class="ghost" data-act="credits">Credits &amp; licences</button>
            <button class="ghost" data-act="install" data-install hidden>⇩ Install / Download game</button>
            <a class="ghost" data-zip href="download/island-flight-sim-source.zip" download>⇩ Download source ZIP</a>
          </div>
          <p class="tiny">Works offline once installed. All artwork and sound is generated by the game itself.</p>
        </div>
      </section>
    `);
    s.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const act = btn.dataset.act;
      this.hooks.onClick && this.hooks.onClick(act);
      if (act === 'tutorial') this.hooks.startTutorial();
      else if (act === 'missions') this.show('missions');
      else if (act === 'free') this.show('free');
      else if (act === 'maps') this.show('maps');
      else if (act === 'multiplayer') this.hooks.openMultiplayer && this.hooks.openMultiplayer();
      else if (act === 'more') this.show('more');
      else if (act === 'hangar') this.show('hangar');
      else if (act === 'settings') this.show('settings');
      else if (act === 'credits') this.show('credits');
      else if (act === 'install') this.hooks.install && this.hooks.install();
      else if (act === 'sound') this.hooks.toggleSound && this.hooks.toggleSound();
    });
    this.screens.main = s;
    return s;
  }

  buildMaps() {
    const cards = MAPS.map(
      (m) => `
      <article class="map-card" data-map-card="${m.id}">
        <div class="map-art" data-map-art="${m.id}" aria-hidden="true"></div>
        <div class="map-text">
          <h3>${m.name}</h3>
          <span class="map-sub">${m.subtitle}</span>
          <span class="map-diff diff-${m.difficulty}">${'●'.repeat(m.difficulty)}${'○'.repeat(5 - m.difficulty)} ${m.difficultyLabel}</span>
          <p>${m.blurb}</p>
        </div>
        <div class="map-foot">
          <span class="map-current" data-map-current="${m.id}" hidden>Currently flying here</span>
          <button class="primary" data-choose-map="${m.id}">Fly here</button>
        </div>
      </article>`
    ).join('');

    const s = h(`
      <section class="screen screen-list" data-screen="maps" hidden>
        <header class="screen-head">
          <button class="ghost" data-back>← Back</button>
          <h2>Choose your map</h2>
          <span></span>
        </header>
        <p class="hint">Every map has the same runway, so everything you have learned still works.
        What changes is the land around it — and how much room it leaves you.</p>
        <div class="map-grid">${cards}</div>
      </section>
    `);
    // A little painted preview of each map's shape, drawn from the same island
    // data the terrain uses. Cheap, and it makes the choice mean something.
    for (const m of MAPS) {
      const host = s.querySelector(`[data-map-art="${m.id}"]`);
      if (host) host.appendChild(mapThumbnail(m));
    }
    s.addEventListener('click', (e) => {
      if (e.target.closest('[data-back]')) return this.show('main');
      const pick = e.target.closest('[data-choose-map]');
      if (pick) {
        // The CSS filter is not a gate on the engine, so guard the click too —
        // the same guard the mission list and the fleet list already have. For
        // a while the military map was hidden by an attribute that did nothing
        // and reachable by a button that checked nothing, which is no gate at
        // all in either direction.
        const m = MAPS.find((x) => x.id === pick.dataset.chooseMap);
        if (m && Prog.needsPasscode(this.prog, m)) {
          this.hooks.onLocked &&
            this.hooks.onLocked('That field is behind a passcode — enter it in the Hangar.');
          return;
        }
        this.hooks.onClick && this.hooks.onClick('map');
        this.hooks.chooseMap && this.hooks.chooseMap(pick.dataset.chooseMap);
      }
    });
    /*
     * Military maps are hidden until the passcode is in, the same as the
     * aircraft and the missions. Hidden rather than filtered out, because a
     * card that was never built cannot come back when the code is entered
     * mid-session — which is exactly how the fleet list broke once already.
     */
    this.syncMapLocks = () => {
      for (const m of MAPS) {
        const card = s.querySelector(`[data-map-card="${m.id}"]`);
        if (card) card.hidden = Prog.needsPasscode(this.prog, m);
      }
    };
    this.syncMapLocks();

    this.screens.maps = s;
    return s;
  }

  /** Highlight the map currently loaded, everywhere it is mentioned. */
  syncMap(id) {
    const def = MAPS.find((m) => m.id === id) || MAPS[0];
    for (const el of this.root.querySelectorAll('[data-map-name]')) el.textContent = def.name;
    for (const el of this.root.querySelectorAll('[data-map-blurb]')) {
      el.textContent = `Now flying ${def.name} — ${def.subtitle}`;
    }
    if (!this.screens.maps) return;
    for (const m of MAPS) {
      const tag = this.screens.maps.querySelector(`[data-map-current="${m.id}"]`);
      const card = this.screens.maps.querySelector(`[data-map-card="${m.id}"]`);
      if (tag) tag.hidden = m.id !== id;
      if (card) card.classList.toggle('is-current', m.id === id);
    }
  }

  buildMissions() {
    /*
     * Grouped under headings (see CATEGORIES at the top of this file). Every
     * card is still built, once, whatever game or passcode it belongs to —
     * the headings only decide where it sits. A heading with nothing visible
     * under it hides itself in syncCategories(), so the car's board never
     * shows an empty "Military" and the locked missions leave no gap.
     */
    const card = (m, c = categoryItemData('missions', m)) => `
      <article class="mission-card" data-mission="${m.id}" data-cat-item data-cat="${attr(c.cat)}" data-find="${attr(c.find)}">
        <div class="mission-top">
          <span class="mission-icon">${m.icon || '◎'}</span>
          <div>
            <h3>${m.name}</h3>
            <span class="mission-diff diff-${slug(m.difficulty || 'medium')}">${m.difficulty || 'Medium'}</span>
            <span class="mission-sub">${m.short || ''}</span>
            ${payLineHtml(m, this.settingsRef && this.settingsRef.difficulty)}
          </div>
        </div>
        <p>${m.blurb || ''}</p>
        <p class="mission-learn">${m.reward || ''}</p>
        <div class="mission-foot">
          <span class="mission-best" data-best="${m.id}"></span>
          <button class="primary" data-start="${m.id}">Fly this mission</button>
        </div>
      </article>`;
    const groups = groupByCategory('missions', MISSIONS, missionCategory)
      .map((g) => catGroupHtml('missions', g.def, g.items.map((m) => card(m)).join(''), 'mission-grid'))
      .join('');

    const s = h(`
      <section class="screen screen-list" data-screen="missions" hidden>
        <header class="screen-head">
          <button class="ghost" data-back>← Back</button>
          <h2>Missions</h2>
          <span></span>
        </header>
        ${catBarHtml('missions', 'missions')}
        <div class="cat-list" data-cat-list="missions">${groups}</div>
      </section>
    `);
    /*
     * Hide the military missions until the passcode is entered.
     *
     * Every card is rendered and then hidden, rather than filtered out of
     * MISSIONS at build time — build() runs exactly once from the constructor,
     * so a filter applied while mapping could never bring them back when the
     * passcode is entered mid-session.
     *
     * `this.prog` is read at call time, never captured: main.js owns the live
     * object and swaps it in later.
     */
    this.syncMissionLocks = () => {
      for (const m of MISSIONS) {
        const card = s.querySelector(`[data-mission="${m.id}"]`);
        if (card) card.hidden = Prog.needsPasscode(this.prog, m);
      }
      // game-ui.js wraps this and re-syncs after its own game filter; without
      // it installed, the headings still have to follow the passcode.
      this.syncCategories('missions');
    };
    this.bindCategoryBar(s, 'missions');
    this.syncMissionLocks();
    /*
     * "Up to 380 credits" on every card, for the settings difficulty as it is
     * NOW — Easy pays less and Realistic more, and that can change between
     * one visit to the board and the next. Cards added later (game-ui.js's
     * registerMissions) are found the same way.
     */
    this.syncPayLines = () => {
      const settings = (this.settingsRef && this.settingsRef.difficulty) || 'normal';
      for (const node of s.querySelectorAll('[data-pay-line]')) {
        const id = node.dataset.payLine;
        const def = MISSIONS.find((x) => x.id === id) || (this._extraMissions || {})[id];
        if (!def) continue;
        const text = Prog.payLine(Prog.maxPayout(def, { settings }));
        const words = node.querySelector('[data-pay-words]');
        if (words && words.textContent !== text) words.textContent = text;
      }
    };

    s.addEventListener('click', (e) => {
      if (e.target.closest('[data-back]')) return this.show('main');
      const start = e.target.closest('[data-start]');
      if (!start) return;
      // The UI filter is not a gate on the engine, so guard the click too.
      const m = MISSIONS.find((x) => x.id === start.dataset.start);
      if (m && Prog.needsPasscode(this.prog, m)) {
        this.hooks.onLocked &&
          this.hooks.onLocked('Military missions are behind a passcode — enter it in the Hangar.');
        return;
      }
      this.hooks.startMission(start.dataset.start);
    });
    this.screens.missions = s;
    return s;
  }

  /**
   * Free Flight setup.
   *
   * This screen grew an aircraft picker and a start picker and became 1,780
   * pixels tall in an 825 pixel window — with no scrolling, so everything
   * below the aeroplanes was off the bottom of the screen and unreachable.
   * Nothing was broken; you simply could not get to it.
   *
   * So it is four tabs and a bar along the bottom that is always there. Each
   * tab is short enough to read at a glance, the summary tells you what you
   * are about to fly without going back through the tabs, and "Take off"
   * never moves.
   */
  buildFree() {
    const pips = (n) =>
      Array.from({ length: 5 }, (_, i) => `<i class="fleet-pip${i < n ? ' is-lit' : ''}"></i>`).join('');
    /*
     * The numbers on a card are worked out from the flight model. This runs
     * inside the constructor, so a roster entry that is missing a field the
     * sum needs would throw here and take every menu with it — seven new
     * aeroplanes are arriving from two other teams. One that cannot be worked
     * out shows dashes instead.
     */
    const perfOf = (a) => {
      try {
        return performanceFor(a.id);
      } catch (err) {
        console.warn(`[menus] no performance figures for ${a.id}:`, err);
        return null;
      }
    };
    const num = (v, unit) => (Number.isFinite(v) ? `${v} ${unit}` : '—');
    const fleetCard = (a) => {
      const perf = perfOf(a) || {};
      const c = categoryItemData('fleet', a);
      return `
        <button class="fleet-card${a.id === 'skylark' ? ' is-on' : ''}" data-aircraft="${a.id}" data-cat-item
          data-cat="${attr(c.cat)}" data-find="${attr(c.find)}">
          <span class="fleet-art-slot" data-fleet-art="${a.id}"></span>
          <span class="fleet-head">
            <span class="fleet-name">${a.name}</span>
            <span class="fleet-class">${a.class || ''}</span>
          </span>
          <span class="fleet-blurb">${a.blurb || ''}</span>
          <span class="fleet-bars">
            <span class="fleet-bar"><span>Speed</span><span class="fleet-pips">${pips((a.stats || {}).speed || 0)}</span></span>
            <span class="fleet-bar"><span>Agility</span><span class="fleet-pips">${pips((a.stats || {}).handling || 0)}</span></span>
            <span class="fleet-bar"><span>Forgiving</span><span class="fleet-pips">${pips((a.stats || {}).ease || 0)}</span></span>
          </span>
          <span class="fleet-numbers">
            <span>Approach <b>${num(perf.stallLanding, 'kt')}</b></span>
            <span>Top <b>${num(perf.vne, 'kt')}</b></span>
            <span>Endurance <b>${num(perf.enduranceMin, 'min')}</b></span>
          </span>
        </button>`;
    };
    /*
     * The hangar floor, sorted: light aircraft, airliners, military jets,
     * helicopters, special. Fifteen aeroplanes in one unsorted run is a list
     * you scroll past; five short headed rows is one you can find a 747 in.
     */
    const fleet = groupByCategory('fleet', AIRCRAFT, aircraftCategory)
      .map((g) => catGroupHtml('fleet', g.def, g.items.map(fleetCard).join(''), 'fleet-grid'))
      .join('');

    const presets = PRESETS.map(
      (p) => `<button class="preset" data-preset="${p.id}"><strong>${p.name}</strong><em>${p.hint}</em></button>`
    ).join('');
    const times = Object.entries(TIMES).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('');
    const conds = Object.entries(CONDITIONS).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('');

    // Failures you arm before you go. Each one waits the number of minutes you
    // set, so you get to be somewhere interesting before it happens.
    const FAILURES = [
      { id: 'engine', label: 'Engine failure', hint: 'It stops, and it will not restart', delay: [0, 20, 5] },
      { id: 'fuelLeak', label: 'Fuel leak', hint: 'Choose how long the fuel lasts', delay: [0, 20, 2], amount: [2, 30, 6], amountLabel: 'Fuel lasts' },
      { id: 'elevator', label: 'Jammed elevator', hint: 'Pitch sticks — fly it on power and trim', delay: [0, 20, 4] },
      { id: 'icing', label: 'Icing', hint: 'More drag, less lift, an earlier stall', delay: [0, 20, 3] },
      { id: 'gear', label: 'Undercarriage jammed', hint: 'It stays wherever it is', delay: [0, 20, 6] },
      { id: 'brakes', label: 'Brake failure', hint: 'Found out about on the roll-out', delay: [0, 20, 0] },
      { id: 'roughEngine', label: 'Running rough', hint: 'Part power only — can you still make it back?', delay: [0, 20, 4] },
      { id: 'tyre', label: 'Burst tyre', hint: 'Drags hard to one side on the roll-out', delay: [0, 20, 0] },
    ];
    const failureRows = FAILURES.map((f) => `
      <div class="fail-row" data-fail-row="${f.id}">
        <label class="fail-head">
          <input type="checkbox" data-fail="${f.id}">
          <span><strong>${f.label}</strong><em>${f.hint}</em></span>
        </label>
        <div class="fail-sliders" hidden>
          <label class="field"><span>Happens <b data-fail-delay-val="${f.id}">${f.delay[2] === 0 ? 'straight away' : `after ${f.delay[2]} min of flight`}</b></span>
            <input type="range" min="${f.delay[0]}" max="${f.delay[1]}" step="1" value="${f.delay[2]}" data-fail-delay="${f.id}"></label>
          ${f.amount ? `<label class="field"><span>${f.amountLabel} <b data-fail-amount-val="${f.id}">${f.amount[2]}</b> min</span>
            <input type="range" min="${f.amount[0]}" max="${f.amount[1]}" step="1" value="${f.amount[2]}" data-fail-amount="${f.id}"></label>` : ''}
        </div>
      </div>`).join('');

    const eventRows = SELECTABLE_EVENTS.map((e) => `
      <div class="fail-row" data-fail-row="${e.id}">
        <label class="fail-head">
          <input type="checkbox" data-event="${e.id}">
          <span><strong>${e.name}</strong><em>${e.hint}</em></span>
        </label>
        <div class="fail-sliders" hidden>
          <label class="field"><span>Happens <b data-event-delay-val="${e.id}">straight away</b></span>
            <input type="range" min="0" max="25" step="1" value="0" data-event-delay="${e.id}"></label>
          ${
            e.id === 'tornado'
              ? `<label class="field"><span>Strength <b data-ef-val>whatever comes</b></span>
                   <input type="range" min="-1" max="5" step="1" value="-1" data-ef></label>
                 <p class="hint tiny" data-ef-hint>Left of EF0 it picks its own, and the weak ones are
                 far commoner — an EF5 should be a rare, bad day.</p>`
              : ''
          }
        </div>
      </div>`).join('');

    const s = h(`
      <section class="screen screen-list screen-free" data-screen="free" hidden>
        <header class="screen-head">
          <button class="ghost" data-back>← Back</button>
          <h2>Free Flight</h2>
          <span></span>
        </header>

        <div class="tabs">
          <button class="tab is-on" data-ftab="aircraft">Aircraft</button>
          <button class="tab" data-ftab="departure">Departure</button>
          <button class="tab" data-ftab="weather">Weather</button>
          <button class="tab" data-ftab="failures">Failures</button>
        </div>

        <div class="free-panel" data-fpanel="aircraft">
          <button class="hs-door" data-open-hangar>
            <span class="hs-door-icon">${icon('hangar', 26)}</span>
            <span><strong>See them in the Hangar</strong><em>Every aircraft on a spinning podium — pick one there, or unlock it</em></span>
            ${icon('chevronRight', 20)}
          </button>
          ${catBarHtml('fleet', 'aeroplanes')}
          <div class="cat-list" data-cat-list="fleet">${fleet}</div>
        </div>

        <div class="free-panel" data-fpanel="departure" hidden>
          <div class="start-grid">
            <button class="start-opt" data-start="gate">
              ${icon('gate', 22)}
              <span><strong>At the parking stand</strong>
              <em>Taxi out to the runway with ATC talking you through it. A skip button is on screen the whole way.</em></span>
            </button>
            <button class="start-opt is-on" data-start="runway">
              ${icon('plane', 22)}
              <span><strong>Lined up on the runway</strong><em>Straight to it — full power when you are ready.</em></span>
            </button>
            <button class="start-opt" data-start="air">
              ${icon('cloud', 22)}
              <span><strong>Already flying</strong><em>Airborne at 2,000 ft with the engine running.</em></span>
            </button>
          </div>

          <h3 class="fail-heading">Fuel on board</h3>
          <label class="field">
            <span><b data-fuelval>Full tanks</b></span>
            <input type="range" min="8" max="100" step="2" value="100" data-fuel>
          </label>
          <p class="hint" data-fuelhint></p>
        </div>

        <div class="free-panel free-two" data-fpanel="weather" hidden>
          <div>
            <h3>Presets</h3>
            <div class="preset-grid">${presets}</div>
          </div>
          <div>
            <h3>Or set it yourself</h3>
            <label class="field"><span>Time of day</span><select data-time>${times}</select></label>
            <label class="field"><span>Sky</span><select data-cond>${conds}</select></label>
            <label class="field"><span>Wind speed <b data-windval>4</b> kt</span>
              <input type="range" min="0" max="35" step="1" data-wind></label>
            <label class="field"><span>Wind comes from <b data-dirval>090</b>°</span>
              <input type="range" min="0" max="350" step="10" data-dir></label>
            <p class="hint" data-crosswind></p>
          </div>
          <div class="free-col-full">
            <h3>Disasters</h3>
            <p class="trigger-note">
              Weather that happens to you rather than to the aeroplane, and ends on its own. Harder maps and
              worse skies bring them round more often when the randomiser is on.
            </p>
            <div class="fail-list">${eventRows}</div>
          </div>
        </div>

        <div class="free-panel" data-fpanel="failures" hidden>
          <p class="trigger-note">
            Arm something before you go and it will happen while you are flying. Nothing here switches itself
            on — an ordinary flight is never sabotaged. You can also trigger any of these on the spot from the
            pause menu.
          </p>
          <div class="fail-list">${failureRows}</div>
          <label class="check check-wide"><input type="checkbox" data-random-disasters>
            <span><strong>Randomised disasters</strong>
            <em>Things go wrong on their own, at times you will not see coming. Bad weather makes them
            more likely — a storm is when an aeroplane is most likely to have a bad day.</em></span></label>
        </div>

        <div class="free-slots">
          <div class="free-slots-head">
            <span>Saved flights</span>
            <span class="hint tiny">Tap to load · hold to overwrite · × to clear</span>
          </div>
          <div class="slot-row" data-slots></div>
        </div>

        <footer class="free-bar">
          <div class="free-summary" data-summary></div>
          <button class="primary big" data-fly>Take off</button>
        </footer>
      </section>
    `);

    const wind = s.querySelector('[data-wind]');
    const dir = s.querySelector('[data-dir]');
    const time = s.querySelector('[data-time]');
    const cond = s.querySelector('[data-cond]');
    // A plan view on each card, drawn from that aeroplane's own shape data.
    this.repaintFleetArt = (liveryId) => {
      for (const a of AIRCRAFT) {
        const host = s.querySelector(`[data-fleet-art="${a.id}"]`);
        if (!host) continue;
        host.innerHTML = '';
        // Same reason as the numbers: one shape that cannot be drawn is an
        // empty frame on one card, not a menu that never finished building.
        try {
          host.appendChild(aircraftThumbnail(a, liveryId));
        } catch (err) {
          console.warn(`[menus] could not draw ${a.id}:`, err);
        }
      }
    };
    this.repaintFleetArt(this.settingsRef ? this.settingsRef.livery : 'house');
    // Show which of the fleet you have actually earned.
    this.syncFleetLocks = () => {
      for (const a of AIRCRAFT) {
        const card = s.querySelector(`[data-aircraft="${a.id}"]`);
        if (!card) continue;
        const gated = Prog.needsPasscode(this.prog, a);
        card.hidden = gated;
        const locked = gated || !Prog.isUnlocked(this.prog, a.id);
        card.classList.toggle('is-locked', locked);
        let tag = card.querySelector('.fleet-lock');
        if (locked && !tag) {
          tag = document.createElement('span');
          tag.className = 'fleet-lock';
          card.appendChild(tag);
        }
        /*
         * No price means not for sale — Prog.buy() answers "Not for sale" —
         * and "0 credits" on the card read as free. An aeroplane nobody has
         * added to progression.js's UNLOCKS lands here.
         */
        const cost = Prog.costOf(a.id);
        if (tag) tag.textContent = locked ? (cost ? `${cost.toLocaleString()} credits` : 'Not in the shop yet') : '';
        if (!locked && tag) tag.remove();
      }
      // The passcode adds cards to Military jets, so its count and chip change.
      this.syncCategories('fleet');
    };
    this.bindCategoryBar(s, 'fleet');
    this.syncFleetLocks();

    this.freeControls = { wind, dir, time, cond };
    this.chosenAircraft = 'skylark';
    this.chosenStart = 'runway';

    const startWords = {
      gate: 'from the parking stand',
      runway: 'from the runway',
      air: 'already airborne',
    };

    const refresh = () => {
      s.querySelector('[data-windval]').textContent = wind.value;
      s.querySelector('[data-dirval]').textContent = String(dir.value).padStart(3, '0');
      const rel = ((Number(dir.value) - 90 + 540) % 360) - 180;
      const cross = Math.abs(Math.sin((rel * Math.PI) / 180)) * Number(wind.value);
      const side = rel > 0 ? 'right' : 'left';
      let msg;
      if (Number(wind.value) < 2) msg = 'Calm air — the easiest conditions to fly in.';
      else if (cross < 4) msg = 'The wind is almost straight down the runway. Nice and easy.';
      else if (cross < 12) msg = `A gentle crosswind from the ${side} (${Math.round(cross)} kt across the runway).`;
      else msg = `A strong crosswind from the ${side} — ${Math.round(cross)} kt across the runway. Tricky!`;
      s.querySelector('[data-crosswind]').textContent = msg;

      // Fuel: shown as a share of the tanks *and* as the time it buys in this
      // particular aeroplane, because 40% means nothing on its own.
      const fuelPct = Number(s.querySelector('[data-fuel]').value);
      const perf = performanceFor(this.chosenAircraft);
      const mins = Math.round((perf.enduranceMin * fuelPct) / 100);
      s.querySelector('[data-fuelval]').textContent =
        fuelPct >= 100 ? 'Full tanks' : `${fuelPct}% of full tanks`;
      s.querySelector('[data-fuelhint]').textContent =
        `About ${mins} minutes at full power, and appreciably longer at a cruise setting. ` +
        (fuelPct <= 25 ? 'Enough to make fuel a real problem — plan where you are landing.' : '');

      // The summary is the whole point of the bottom bar: you can see what you
      // are about to fly without going back through the tabs.
      const ac = AIRCRAFT.find((a) => a.id === this.chosenAircraft);
      const armed = [...s.querySelectorAll('[data-fail]:checked, [data-event]:checked')].length;
      s.querySelector('[data-summary]').innerHTML =
        `<strong>${ac.name}</strong> · ${startWords[this.chosenStart]} · ` +
        `${CONDITIONS[cond.value].label.toLowerCase()}, ${wind.value} kt` +
        (fuelPct < 100 ? ` · <span class="sum-warn">${mins} min of fuel</span>` : '') +
        (armed ? ` · <span class="sum-warn">${armed} failure${armed > 1 ? 's' : ''} armed</span>` : '');
    };
    /** Pick an aeroplane from outside this screen (the hangar's podium). */
    this.pickFreeAircraft = (id) => {
      this.chosenAircraft = id;
      s.querySelectorAll('[data-aircraft]').forEach((n) => n.classList.toggle('is-on', n.dataset.aircraft === id));
      refresh();
    };
    wind.addEventListener('input', refresh);
    dir.addEventListener('input', refresh);
    s.querySelector('[data-fuel]').addEventListener('input', refresh);
    cond.addEventListener('change', refresh);
    this.refreshFree = refresh;

    // Sliders live-update their own labels and reveal themselves with the box.
    s.addEventListener('input', (e) => {
      const d = e.target.dataset;
      if (d.failDelay) {
        const v = Number(e.target.value);
        s.querySelector(`[data-fail-delay-val="${d.failDelay}"]`).textContent =
          v === 0 ? 'straight away' : `after ${v} min of flight`;
      }
      if (d.eventDelay) {
        const v = Number(e.target.value);
        s.querySelector(`[data-event-delay-val="${d.eventDelay}"]`).textContent =
          v === 0 ? 'straight away' : `after ${v} min of flight`;
      }
      if (d.failAmount) s.querySelector(`[data-fail-amount-val="${d.failAmount}"]`).textContent = e.target.value;
      if (d.ef !== undefined) {
        const v = Number(e.target.value);
        const band = v < 0 ? null : EF_SCALE[v];
        s.querySelector('[data-ef-val]').textContent = band ? band.label : 'whatever comes';
        s.querySelector('[data-ef-hint]').textContent = band
          ? `${Math.round(band.windMs * 2.23694)} mph at the wall — ${band.damage.toLowerCase()}.`
          : 'Left of EF0 it picks its own, and the weak ones are far commoner — an EF5 should be a rare, bad day.';
      }
    });
    s.addEventListener('change', (e) => {
      if (e.target.dataset.fail || e.target.dataset.event) {
        const row = e.target.closest('[data-fail-row]');
        row.querySelector('.fail-sliders').hidden = !e.target.checked;
        row.classList.toggle('is-armed', e.target.checked);
        refresh();
      }
    });

    /**
     * Everything the Free Flight screen is currently asking for, as one plain
     * object. "Take off" and "save this slot" both go through here so the
     * thing you save is exactly the thing you would have flown.
     */
    const collectSetup = () => {
      const failures = {};
      for (const f of FAILURES) {
        const box = s.querySelector(`[data-fail="${f.id}"]`);
        if (!box || !box.checked) continue;
        failures[f.id] = {
          afterMin: Number(s.querySelector(`[data-fail-delay="${f.id}"]`).value),
          amountMin: f.amount ? Number(s.querySelector(`[data-fail-amount="${f.id}"]`).value) : null,
        };
      }
      const events = {};
      for (const ev of SELECTABLE_EVENTS) {
        const box = s.querySelector(`[data-event="${ev.id}"]`);
        if (!box || !box.checked) continue;
        events[ev.id] = { afterMin: Number(s.querySelector(`[data-event-delay="${ev.id}"]`).value) };
      }
      const efRaw = Number(s.querySelector('[data-ef]')?.value ?? -1);
      return {
        fuel: Number(s.querySelector('[data-fuel]').value) / 100,
        events,
        // -1 means "let it choose", which is why this is null rather than 0.
        tornadoEF: efRaw < 0 ? null : efRaw,
        randomDisasters: s.querySelector('[data-random-disasters]').checked,
        time: time.value,
        condition: cond.value,
        windSpeedKts: Number(wind.value),
        windDirDeg: Number(dir.value),
        airborne: this.chosenStart === 'air',
        taxi: this.chosenStart === 'gate',
        aircraft: this.chosenAircraft,
        failures,
      };
    };

    /** Put a saved setup back into every control on the screen. */
    const applySetup = (c) => {
      if (!c) return;
      time.value = c.time;
      cond.value = c.condition;
      wind.value = c.windSpeedKts;
      dir.value = c.windDirDeg;
      this.chosenAircraft = c.aircraft || 'skylark';
      this.chosenStart = c.airborne ? 'air' : c.taxi ? 'gate' : 'runway';
      s.querySelectorAll('[data-aircraft]').forEach((n) =>
        n.classList.toggle('is-on', n.dataset.aircraft === this.chosenAircraft));
      s.querySelectorAll('[data-start]').forEach((n) =>
        n.classList.toggle('is-on', n.dataset.start === this.chosenStart));
      s.querySelector('[data-fuel]').value = Math.round((c.fuel ?? 1) * 100);
      s.querySelector('[data-random-disasters]').checked = !!c.randomDisasters;
      const ef = s.querySelector('[data-ef]');
      if (ef) {
        ef.value = c.tornadoEF == null ? -1 : c.tornadoEF;
        ef.dispatchEvent(new Event('input', { bubbles: true }));
      }
      // Failures and events: tick what was armed, clear everything else, and
      // reveal each row's sliders to match.
      const restore = (sel, saved, delaySel, amountSel) => {
        s.querySelectorAll(sel).forEach((box) => {
          const id = box.dataset.fail || box.dataset.event;
          const cfg = saved[id];
          box.checked = !!cfg;
          const row = box.closest('[data-fail-row]');
          if (row) {
            row.querySelector('.fail-sliders').hidden = !cfg;
            row.classList.toggle('is-armed', !!cfg);
          }
          if (!cfg) return;
          const d = s.querySelector(`[${delaySel}="${id}"]`);
          if (d) { d.value = cfg.afterMin ?? 0; d.dispatchEvent(new Event('input', { bubbles: true })); }
          if (amountSel && cfg.amountMin != null) {
            const a = s.querySelector(`[${amountSel}="${id}"]`);
            if (a) { a.value = cfg.amountMin; a.dispatchEvent(new Event('input', { bubbles: true })); }
          }
        });
      };
      restore('[data-fail]', c.failures || {}, 'data-fail-delay', 'data-fail-amount');
      restore('[data-event]', c.events || {}, 'data-event-delay', null);
      refresh();
    };

    /** Repaint the five slots from storage. */
    const renderSlots = () => {
      const saved = loadFreePresets();
      const host = s.querySelector('[data-slots]');
      if (!host) return;
      host.innerHTML = '';
      for (let i = 0; i < MAX_FREE_PRESETS; i++) {
        const p = saved[i];
        const b = document.createElement('button');
        b.className = 'slot' + (p ? ' is-filled' : '');
        b.dataset.slot = String(i);
        b.innerHTML = p
          ? `<strong>${p.label}</strong><em>${p.summary}</em>`
              + `<span class="slot-clear" data-slot-clear="${i}" role="button" aria-label="Clear slot ${i + 1}">\u00d7</span>`
          : `<strong>Slot ${i + 1}</strong><em>empty — save this setup here</em>`;
        host.appendChild(b);
      }
    };
    this.renderFreeSlots = renderSlots;

    /*
     * Long-press to overwrite, on anything with a pointer.
     *
     * Overwriting used to need shift-click and clearing needed alt-click, and
     * the hint underneath cheerfully promised "hold" and "long-press" — neither
     * of which was implemented anywhere. On an iPad a filled slot could only
     * ever be loaded: there was no way to overwrite it and no way to empty it,
     * for the entire life of the feature.
     *
     * 600 ms, the press is marked so the click that follows knows to do
     * nothing, and it is cancelled if the finger moves — otherwise scrolling
     * the panel saves over a slot.
     */
    let holdT = null;
    let heldSlot = null;
    const cancelHold = () => {
      if (holdT) clearTimeout(holdT);
      holdT = null;
    };
    s.addEventListener('pointerdown', (e) => {
      const slot = e.target.closest('[data-slot]');
      if (!slot || e.target.closest('[data-slot-clear]')) return;
      const i = Number(slot.dataset.slot);
      if (!loadFreePresets()[i]) return; // an empty slot already saves on tap
      heldSlot = slot;
      cancelHold();
      holdT = setTimeout(() => {
        holdT = null;
        slot.dataset.held = '1';
        saveIntoSlot(i);
        slot.classList.add('is-saved');
        setTimeout(() => slot.classList.remove('is-saved'), 600);
      }, 600);
    });
    s.addEventListener('pointerup', cancelHold);
    s.addEventListener('pointercancel', cancelHold);
    s.addEventListener('pointermove', (e) => {
      if (heldSlot && holdT) cancelHold();
    });

    /** Write the current setup into a slot. Shared by tap, hold and shift. */
    const saveIntoSlot = (i) => {
      const saved = loadFreePresets();
      const cfg = collectSetup();
      const ac = AIRCRAFT.find((a) => a.id === cfg.aircraft);
      saved[i] = {
        ...cfg,
        label: `${ac ? ac.name : cfg.aircraft}`,
        summary:
          `${CONDITIONS[cfg.condition].label.toLowerCase()}, ${cfg.windSpeedKts} kt`
          + `${startWords[this.chosenStart] ? ' · ' + startWords[this.chosenStart] : ''}`,
      };
      saveFreePresets(saved);
      renderSlots();
    };

    s.addEventListener('click', (e) => {
      if (e.target.closest('[data-back]')) return this.show('main');
      if (e.target.closest('[data-open-hangar]')) return this.show('hangar');

      const tab = e.target.closest('[data-ftab]');
      if (tab) {
        s.querySelectorAll('[data-ftab]').forEach((n) => n.classList.toggle('is-on', n === tab));
        s.querySelectorAll('[data-fpanel]').forEach((n) => (n.hidden = n.dataset.fpanel !== tab.dataset.ftab));
        return;
      }

      const p = e.target.closest('[data-preset]');
      if (p) {
        const preset = PRESETS.find((x) => x.id === p.dataset.preset);
        time.value = preset.time;
        cond.value = preset.condition;
        wind.value = preset.wind;
        dir.value = Math.round(preset.dir / 10) * 10;
        refresh();
        s.querySelectorAll('.preset').forEach((n) => n.classList.remove('is-on'));
        p.classList.add('is-on');
        return;
      }

      const plane = e.target.closest('[data-aircraft]');
      if (plane) {
        /*
         * Locked aeroplanes cannot be chosen, and say why.
         *
         * The alternative — letting you pick it and refusing at take-off — is
         * the version that feels broken, because the game let you do a thing
         * and then took it back.
         */
        const id = plane.dataset.aircraft;
        const type = AIRCRAFT.find((a) => a.id === id);
        if (Prog.needsPasscode(this.prog, type)) {
          this.hooks.onLocked && this.hooks.onLocked(
            'Military aircraft are behind a passcode — enter it in the Hangar.'
          );
          return;
        }
        if (!Prog.isUnlocked(this.prog, id)) {
          const cost = Prog.costOf(id);
          const short = cost - this.prog.credits;
          this.hooks.onLocked && this.hooks.onLocked(
            !cost
              ? 'Not in the shop yet, so it cannot be flown for now.'
              : short > 0
                ? `Locked — ${short.toLocaleString()} more credits needed. Fly missions to earn them.`
                : `Locked — unlock it for ${cost.toLocaleString()} credits in the Hangar.`
          );
          return;
        }
        // The Hangar's door too, so Multiplayer hears of it (features/multiplayer.js followMenuPlane).
        this.pickFreeAircraft(id);
        return;
      }

      const start = e.target.closest('[data-start]');
      if (start) {
        this.chosenStart = start.dataset.start;
        s.querySelectorAll('[data-start]').forEach((n) => n.classList.toggle('is-on', n === start));
        refresh();
        return;
      }

      const clear = e.target.closest('[data-slot-clear]');
      if (clear) {
        // A visible button, because a modifier key is not a thing a finger has.
        const saved = loadFreePresets();
        saved[Number(clear.dataset.slotClear)] = null;
        saveFreePresets(saved);
        renderSlots();
        return;
      }

      const slot = e.target.closest('[data-slot]');
      if (slot) {
        // The click that follows a long press is the press, not a tap.
        if (slot.dataset.held) {
          delete slot.dataset.held;
          return;
        }
        const i = Number(slot.dataset.slot);
        const saved = loadFreePresets();
        /*
         * One button, two jobs, decided by whether the slot has anything in
         * it. An empty slot saves; a full one loads. Shift-click overwrites a
         * full slot, and alt-click empties it — which keeps the common case to
         * a single unmodified click and hides nothing behind a menu.
         */
        if (e.altKey && saved[i]) {
          saved[i] = null;
          saveFreePresets(saved);
          renderSlots();
          return;
        }
        if (saved[i] && !e.shiftKey) {
          applySetup(saved[i]);
          s.querySelectorAll('[data-slot]').forEach((n) => n.classList.remove('is-loaded'));
          slot.classList.add('is-loaded');
          return;
        }
        const cfg = collectSetup();
        const ac = AIRCRAFT.find((a) => a.id === cfg.aircraft);
        saved[i] = {
          ...cfg,
          label: `${ac ? ac.name : cfg.aircraft}`,
          summary:
            `${CONDITIONS[cfg.condition].label.toLowerCase()}, ${cfg.windSpeedKts} kt` +
            `${startWords[this.chosenStart] ? ' · ' + startWords[this.chosenStart] : ''}`,
        };
        saveFreePresets(saved);
        renderSlots();
        return;
      }

      if (e.target.closest('[data-fly]')) this.hooks.startFree(collectSetup());
    });

    // The bar's switcher needs the world you last set up — weather, wind, time
    // — so hopping between the four does not reset the sky each time.
    this.readFree = collectSetup;

    renderSlots();
    this.screens.free = s;
    return s;
  }

  buildSettings() {
    const s = h(`
      <section class="screen screen-list" data-screen="settings" hidden>
        <header class="screen-head">
          <button class="ghost" data-back>← Back</button>
          <h2>Settings</h2>
          <button class="ghost" data-reset-all>Reset everything</button>
        </header>
        <div class="tabs">
          <button class="tab is-on" data-tab="flight">Flying</button>
          <button class="tab" data-tab="sound">Sound</button>
          <button class="tab" data-tab="graphics">Graphics</button>
          <button class="tab" data-tab="controls">Controls</button>
          <button class="tab" data-tab="access">Accessibility</button>
        </div>

        <div class="tab-body" data-panel="flight">
          <label class="field"><span>Airline livery</span>
            <select data-set="livery">
              ${LIVERIES.map((l) => `<option value="${l.id}">${l.name} — ${l.blurb}</option>`).join('')}
            </select>
          </label>
          <p class="hint">These are original airlines, styled after the real ones rather than copying
          them. The tail is painted with its own material — a stripe drawn into the shared body texture
          wraps around the fuselage as a ring instead, which is a property of how the mesh is unwrapped.</p>
          <label class="field"><span>Difficulty</span>
            <select data-set="difficulty">
              <option value="easy">Easy — for a first flight</option>
              <option value="normal">Normal — the usual game (recommended)</option>
              <option value="realistic">Realistic — no help at all</option>
            </select>
          </label>
          <p class="hint"><b>Easy</b> gives you much more elevator at low speed, so the aeroplane rotates and flares almost by itself, guards the stall earlier, and halves the gusts. <b>Normal</b> is the game as it has always flown: it levels the wings, coordinates the rudder and will not let you stall. <b>Realistic</b> switches all of that off — it can stall, and it will drift in a crosswind.</p>
          <label class="check"><input type="checkbox" data-set="mouseFlying"><span>Fly with the mouse (click the sky to capture the pointer)</span></label>
          <label class="check"><input type="checkbox" data-set="invertMouse"><span>Invert mouse up/down</span></label>
          <label class="field"><span>Mouse / stick sensitivity <b data-out="sensitivity"></b></span>
            <input type="range" min="0.3" max="2" step="0.1" data-set="sensitivity"></label>
          <label class="check"><input type="checkbox" data-set="gamepad"><span>Use a gamepad if one is plugged in</span></label>
          <label class="check"><input type="checkbox" data-set="showHints"><span>Repeat hints if I get stuck</span></label>
          <label class="check"><input type="checkbox" data-set="guidance"><span>Show guidance to the runway or target (N)</span></label>
          <label class="field"><span>Show it as</span>
            <select data-set="guideStyle">
              <option value="arrow">An arrow — points which way to turn</option>
              <option value="beacon">A beacon — a light standing on the spot</option>
              <option value="both">Both</option>
            </select></label>
          <label class="check"><input type="checkbox" data-set="startAtGate"><span>Start on the parking stand and taxi out (Free Flight)</span></label>
          <label class="check"><input type="checkbox" data-set="realisticFuel"><span>Realistic fuel — the tank drains 1% every 30 seconds, so you have to plan</span></label>
          <label class="check"><input type="checkbox" data-set="randomWinds"><span>Random winds — the wind wanders and gusts blow through</span></label>
          <label class="check"><input type="checkbox" data-set="minimap"><span>Minimap — the little round map, with a warning if you are heading at a hill (J)</span></label>
          <label class="check"><input type="checkbox" data-set="damageModel"><span>Damage instead of crashes — clip something and, depending on how hard you hit it, you may keep flying with that part damaged. A hurt wing rolls you towards it, a hurt tail goes soft, a hurt nose loses power, and the panel shows where you were hit.</span></label>
          <label class="check"><input type="checkbox" data-set="fleetModels"><span>Use the alternative models for every aeroplane — the redrawn airframes that come apart when you crash. Off by default, the military aeroplanes use them anyway and the civil ones use the built-in shapes.</span></label>
          <p class="hint">With random winds on, the wind drifts around the speed and direction you chose and a gust rolls
          through every half minute or so. It makes landings much more interesting. Leave it off while you are learning.</p>
        </div>

        <div class="tab-body" data-panel="sound" hidden>
          <label class="field"><span>Overall volume <b data-out="volumes.master"></b></span>
            <input type="range" min="0" max="1" step="0.05" data-set="volumes.master"></label>
          <div class="sound-row">
            <label class="check sound-switch"><input type="checkbox" data-set="soundOn.engine"><span>Engine</span></label>
            <label class="field"><span><b data-out="volumes.engine"></b></span>
              <input type="range" min="0" max="1" step="0.05" data-set="volumes.engine"></label>
          </div>
          <div class="sound-row">
            <label class="check sound-switch"><input type="checkbox" data-set="soundOn.environment"><span>Wind, rain &amp; tyres</span></label>
            <label class="field"><span><b data-out="volumes.environment"></b></span>
              <input type="range" min="0" max="1" step="0.05" data-set="volumes.environment"></label>
          </div>
          <div class="sound-row">
            <label class="check sound-switch"><input type="checkbox" data-set="soundOn.atc"><span>ATC radio</span></label>
            <label class="field"><span><b data-out="volumes.atc"></b></span>
              <input type="range" min="0" max="1" step="0.05" data-set="volumes.atc"></label>
          </div>
          <div class="sound-row">
            <label class="check sound-switch"><input type="checkbox" data-set="soundOn.alerts"><span>Warnings &amp; alerts</span></label>
            <label class="field"><span><b data-out="volumes.alerts"></b></span>
              <input type="range" min="0" max="1" step="0.05" data-set="volumes.alerts"></label>
          </div>
          <div class="sound-row">
            <label class="check sound-switch"><input type="checkbox" data-set="soundOn.music"><span>Music</span></label>
            <label class="field"><span><b data-out="volumes.music"></b></span>
              <input type="range" min="0" max="1" step="0.05" data-set="volumes.music"></label>
          </div>
          <label class="check"><input type="checkbox" data-set="music"><span>Play background music</span></label>
          <label class="field"><span>ATC voices</span>
            <select data-set="atcVoice">
              <option value="radio">Radio chatter (default — no text-to-speech)</option>
              <option value="speech">Your device's speech voice (text-to-speech)</option>
              <option value="recordings">Recordings I have added myself</option>
            </select></label>
          <p class="hint">The default radio is built entirely from Web Audio — indistinct formant chatter through a
          real radio chain, with the words as subtitles. No text-to-speech and no AI voices. The speech option uses your
          operating system's own voice; it is text-to-speech, which is why it is not the default. The third option plays
          clips you put in <code>assets/atc/</code> yourself.</p>
          <label class="check"><input type="checkbox" data-set="atcChatter"><span>Background radio chatter from other aircraft</span></label>
          <label class="check"><input type="checkbox" data-set="muted"><span>Mute everything</span></label>
          <p class="hint">Every sound is synthesised by the game — engine, wind, rain, tyres and the radio. Nothing is downloaded, so it all works offline.</p>
        </div>

        <div class="tab-body" data-panel="graphics" hidden>
          <label class="field"><span>Detail level</span>
            <select data-set="quality">
              <option value="low">Low — fastest, for older laptops</option>
              <option value="medium">Medium</option>
              <option value="high">High — best looking</option>
              <option value="ultra">Ultra — everything uncapped, for a fast computer</option>
            </select>
          </label>
          <p class="hint">Changing the detail level rebuilds the island, which takes a couple of seconds.</p>
          <label class="check"><input type="checkbox" data-set="reduceFlashing"><span>Reduce flashing</span></label>
          <p class="hint">On by default. Keeps lightning, explosions, hits and strobe lights dim and soft, never more
          than three flashes a second, and calms the camera's shake and the engine's buzz in the cockpit — for anyone
          who is sensitive to flashing light. Switch it off for the full effects.</p>
          <div class="fps-box">Frames per second: <b data-fps>—</b></div>
        </div>

        <div class="tab-body" data-panel="controls" hidden>
          <p class="hint">Click a key, then press the new key you want to use. <kbd>Esc</kbd> cancels.</p>
          <div class="keymap-ask" data-keymap-ask hidden></div>
          <div class="keymap" data-keymap></div>
          <button class="ghost" data-reset-keys>Reset all keys</button>
        </div>

        <div class="tab-body" data-panel="access" hidden>
          <label class="check"><input type="checkbox" data-set="subtitles"><span>Show subtitles for radio calls</span></label>
          <label class="check"><input type="checkbox" data-set="reducedMotion"><span>Reduced motion (much less camera shake)</span></label>
          <label class="check"><input type="checkbox" data-set="highContrast"><span>High-contrast display</span></label>
          <label class="check"><input type="checkbox" data-set="largeText"><span>Larger text</span></label>
        </div>
      </section>
    `);

    s.addEventListener('click', (e) => {
      if (e.target.closest('[data-back]')) return this.show(this.settingsReturn || 'main');
      const tab = e.target.closest('[data-tab]');
      if (tab) {
        s.querySelectorAll('.tab').forEach((t) => t.classList.toggle('is-on', t === tab));
        s.querySelectorAll('.tab-body').forEach((b) => (b.hidden = b.dataset.panel !== tab.dataset.tab));
        return;
      }
      if (e.target.closest('[data-reset-keys]')) {
        if (this.hooks.cancelListen) this.hooks.cancelListen();
        this.hooks.resetKeys();
        this.askKey('Every key is back to how it started.', null, 'good');
        this.renderKeymap();
        return;
      }
      if (e.target.closest('[data-reset-all]')) {
        if (confirm('Reset all settings, keys and mission progress?')) this.hooks.resetAll();
      }
    });

    s.addEventListener('input', (e) => {
      const t = e.target.closest('[data-set]');
      if (!t) return;
      const path = t.dataset.set;
      let value;
      if (t.type === 'checkbox') value = t.checked;
      else if (t.type === 'range') value = Number(t.value);
      else value = t.value;
      this.hooks.onSetting(path, value);
      const out = s.querySelector(`[data-out="${path}"]`);
      if (out) out.textContent = t.type === 'range' && Number(value) <= 1 ? `${Math.round(value * 100)}%` : value;
    });

    this.screens.settings = s;
    return s;
  }

  /**
   * Hangar: your rank, your credits, what you have earned and what is left to
   * earn — plus the other games.
   *
   * All of it local. There is no account and no server, which is why the game
   * opens instantly and keeps working with no wifi; a leaderboard of your own
   * best flights is also the version people actually play, because a global
   * board is somebody else's score and this one is yours to beat.
   */
  /**
   * "More" — one page for everything that is not flying.
   *
   * The main menu had grown a button per feature, which is how a start screen
   * turns into a filing cabinet. This gathers the four things you visit
   * between flights — where you stand, what you have earned, what else you can
   * drive, and the settings — behind one entry, with the leaderboard right
   * there on the page rather than a click further in.
   */
  buildMore() {
    const s = h(`
      <section class="screen screen-list" data-screen="more" hidden>
        <header class="screen-head">
          <button class="ghost" data-back>← Back</button>
          <h2>More</h2>
          <span></span>
        </header>

        <div class="rank-card">
          <div class="rank-badge" data-more-rank>Cadet</div>
          <div class="rank-meat">
            <div class="rank-line"><b data-more-credits>0</b> credits · <span data-more-earned>0</span> earned all-time</div>
            <div class="rank-bar"><div class="rank-fill" data-more-fill></div></div>
            <div class="hint tiny" data-more-next></div>
          </div>
        </div>

        <h3 class="fail-heading">Leaderboard — your best flights</h3>
        <div class="board" data-more-board></div>

        <h3 class="fail-heading">Other things to drive</h3>
        <p class="trigger-note">All of these are in the same world as the aeroplane — the same island, the
        same sea, the same runway. You can fly to the coast and then take the boat out.</p>
        <div class="games-grid" data-more-games></div>

        <h3 class="fail-heading">Everything else</h3>
        <div class="start-grid">
          <button class="start-opt" data-goto="hangar">
            ${icon('hangar', 22)}
            <span><strong>Hangar</strong><em>Buy aeroplanes with your credits, and enter codes</em></span>
          </button>
          <button class="start-opt" data-goto="settings">
            ${icon('gear', 22)}
            <span><strong>Settings</strong><em>Controls, difficulty, liveries, sound and graphics</em></span>
          </button>
          <button class="start-opt" data-goto="credits">
            ${icon('help', 22)}
            <span><strong>Credits &amp; licences</strong><em>Who made what, and what you may do with it</em></span>
          </button>
        </div>
      </section>
    `);

    const DRIVES = [
      { name: 'Helicopter', blurb: 'Skyhook H-3 — it hovers. Pick it in the hangar.', pick: 'harrier' },
      { name: 'Boat', blurb: 'Kestrel Launch — out of the bay', drive: 'boat' },
      { name: 'Car', blurb: 'Airfield Runabout — round the apron', drive: 'car' },
    ];
    s.querySelector('[data-more-games]').innerHTML = DRIVES.map((g) => {
      const attr = g.drive ? `data-drive="${g.drive}"` : `data-pick="${g.pick}"`;
      return `<button class="game-card" ${attr}><strong>${g.name}</strong><em>${g.blurb}</em></button>`;
    }).join('');

    const render = () => {
      const p = this.prog || Prog.load();
      const rank = Prog.rankFor(p);
      const next = Prog.nextRank(p);
      s.querySelector('[data-more-rank]').textContent = rank.name;
      s.querySelector('[data-more-credits]').textContent = p.credits.toLocaleString();
      s.querySelector('[data-more-earned]').textContent = p.earned.toLocaleString();
      s.querySelector('[data-more-fill]').style.width = next
        ? `${Math.max(2, Math.min(100, (next.into / next.span) * 100))}%`
        : '100%';
      s.querySelector('[data-more-next]').textContent = next
        ? `${next.need.toLocaleString()} more to ${next.rank.name} — ${next.rank.blurb}`
        : rank.blurb;
      const board = p.best || [];
      s.querySelector('[data-more-board]').innerHTML = board.length
        ? board.map((b, i) => `<div class="board-row"><span class="board-pos">${i + 1}</span><span class="board-name">${b.label}</span><span class="board-score">${b.score}</span><span class="board-date">${b.date}</span></div>`).join('')
        : '<p class="hint tiny">Fly something and it will show up here.</p>';
    };
    this.syncMore = render;

    s.addEventListener('click', (e) => {
      if (e.target.closest('[data-back]')) return this.show('main');
      const goto = e.target.closest('[data-goto]');
      if (goto) return this.show(goto.dataset.goto);
      const drive = e.target.closest('[data-drive]');
      if (drive) {
        this.hooks.startDrive && this.hooks.startDrive(drive.dataset.drive);
        return;
      }
      const pick = e.target.closest('[data-pick]');
      if (pick) {
        this.show('hangar');
        // Straight onto the podium, where "Fly this" is.
        if (this.showcaseUi) this.showcaseUi.select(pick.dataset.pick, 0);
        else if (this.hooks.onLocked) this.hooks.onLocked('The Skyhook is in the hangar — unlock it, then pick it in Free Flight.');
      }
    });

    render();
    this.screens.more = s;
    return s;
  }

  buildHangar() {
    const s = h(`
      <section class="screen screen-list screen-hangar" data-screen="hangar" hidden>
        <header class="screen-head">
          <button class="ghost" data-back>← Back</button>
          <h2>Hangar</h2>
          <button class="ghost" data-hs-codes>Got a code?</button>
        </header>
        <!-- The podium, the tabs and the card: hangar-showcase-ui.js. -->
        <div class="hs-host" data-showcase-host></div>

        <div class="hangar-rest" data-hangar-rest>
        <div class="rank-card">
          <div class="rank-badge" data-rank-name>Cadet</div>
          <div class="rank-meat">
            <div class="rank-line"><b data-credits>0</b> credits · <span data-earned>0</span> earned all-time</div>
            <div class="rank-bar"><div class="rank-fill" data-rank-fill></div></div>
            <div class="hint tiny" data-rank-next></div>
          </div>
        </div>

        <h3 class="fail-heading">Aeroplanes</h3>
        <div class="unlock-groups" data-unlocks></div>

        <h3 class="fail-heading">Your best flights</h3>
        <div class="board" data-board></div>

        <h3 class="fail-heading">Military access</h3>
        <p class="trigger-note" data-mil-note>Military aircraft are behind a passcode. Ask whoever runs the game.</p>
        <div class="code-row">
          <input type="text" data-mil-code placeholder="Passcode" maxlength="20">
          <button data-mil-enter>Enter</button>
        </div>

        <h3 class="fail-heading">Got a code?</h3>
        <div class="code-row">
          <input type="text" data-code placeholder="Ask the CEO" maxlength="80" autocomplete="off" autocapitalize="off" spellcheck="false">
          <button data-redeem>Redeem</button>
        </div>
        <p class="hint tiny" data-code-msg>Codes pay out once each.</p>

        <h3 class="fail-heading">Dev mode</h3>
        <p class="trigger-note" data-dev-note>Things that are built but not finished. Behind a passcode, because they are not ready for everybody yet.</p>
        <div class="code-row" data-dev-entry>
          <input type="text" data-dev-code placeholder="Passcode" maxlength="20">
          <button data-dev-enter>Enter</button>
        </div>
        <div class="dev-panel" data-dev-panel hidden>
          <p class="hint tiny">Work in progress. It changes what crashing means, so scores set with it on are not comparable with the rest.</p>
          <!--
            The other build.
            ChatGPT delivered a whole rebuilt tree on 20 September. Most of it
            was taken into this one, but two things were not — its Kestrel,
            where the approach cut was removed by removing the island, and its
            Fenwick street heights, which disagreed at the crossings. Rather
            than describe the difference, keep the build and let it be flown.
            It is behind the passcode because it is a comparison, not a game
            anybody should be given by accident, and it has no service worker
            of its own so it cannot touch what is stored for this one.
          -->
          <p class="hint tiny">ChatGPT's build of 20 September, complete and unaltered apart from its
          service worker. Its Kestrel is flat and its town streets step at the crossings; everything
          else in it is in this game already.</p>
          <div class="dev-ext" data-dev-ext></div>
          <a class="ghost" data-dev-compare href="compare.html" target="_blank" rel="noopener">Fly both side by side</a>
          <a class="ghost" data-dev-gpt href="gpt/index.html" target="_blank" rel="noopener">Open ChatGPT's build on its own</a>
          <button class="ghost" data-dev-leave>Leave dev mode</button>
        </div>

        <h3 class="fail-heading">More games</h3>
        <p class="trigger-note">Other things built by the same person. The ones marked
        <em>not yet</em> do not exist — a link to nothing is worse than an honest gap.</p>
        <div class="games-grid" data-games></div>
        </div>
      </section>
    `);

    /*
     * The other games.
     *
     * A boat, a helicopter and a car sim were asked for; each is its own game
     * rather than a feature of this one, so they are listed honestly as not
     * built rather than linked to a dead page. Anything with a `url` opens in
     * a new tab; anything without simply says so.
     */
    /*
     * The other games — in this world rather than three copies of it.
     *
     * A boat sim needs an ocean and islands; a car sim needs roads and ground;
     * a helicopter sim needs terrain to hover over. All three already exist
     * here, so building them as separate games would have meant duplicating
     * the entire engine three times to end up somewhere less interesting than
     * being able to fly to the coast and take the boat out.
     */
    const GAMES = [
      { name: 'Flight Simulator', blurb: 'You are here', here: true },
      { name: 'Helicopter', blurb: 'Skyhook H-3 — it hovers. In the hangar.', drive: null },
      { name: 'Boat', blurb: 'Kestrel Launch — take her out of the bay', drive: 'boat' },
      { name: 'Car', blurb: 'Airfield Runabout — around the apron', drive: 'car' },
    ];
    const games = s.querySelector('[data-games]');
    games.innerHTML = GAMES.map((g) => {
      const cls = g.here ? 'game-card is-here' : g.url ? 'game-card' : 'game-card is-soon';
      const inner = `<strong>${g.name}</strong><em>${g.blurb}</em>`;
      if (g.drive) return `<button class="${cls}" data-drive="${g.drive}">${inner}</button>`;
      return g.url && !g.here
        ? `<a class="${cls}" href="${g.url}" target="_blank" rel="noopener">${inner}</a>`
        : `<div class="${cls}">${inner}</div>`;
    }).join('');

    const render = () => {
      const p = this.prog || Prog.load();
      const rank = Prog.rankFor(p);
      const next = Prog.nextRank(p);
      s.querySelector('[data-rank-name]').textContent = rank.name;
      s.querySelector('[data-credits]').textContent = p.credits.toLocaleString();
      s.querySelector('[data-earned]').textContent = p.earned.toLocaleString();
      s.querySelector('[data-rank-fill]').style.width = next
        ? `${Math.max(2, Math.min(100, (next.into / next.span) * 100))}%`
        : '100%';
      s.querySelector('[data-rank-next]').textContent = next
        ? `${next.need.toLocaleString()} more to ${next.rank.name} — ${next.rank.blurb}`
        : `${rank.blurb}`;

      const dev = Prog.isDev(p);
      // The damage switch used to live in here. It is an ordinary setting now,
      // on by default, and the normal settings sync handles it.
      s.querySelector('[data-dev-panel]').hidden = !dev;
      /*
       * Buttons the plug-in features offer, listed here rather than written
       * into this file so that adding one never means editing the menus.
       */
      const extBox = s.querySelector('[data-dev-ext]');
      if (extBox) {
        const acts = dev ? extDevActions() : [];
        extBox.innerHTML = acts.map((a, i) =>
          `<button class="ghost" data-dev-ext-run="${i}" title="${(a.hint || '').replace(/"/g, '&quot;')}">${a.label}</button>`
        ).join('');
        this._devExt = acts;
      }
      s.querySelector('[data-dev-entry]').hidden = dev;
      s.querySelector('[data-dev-note]').textContent = dev
        ? 'The workbench is open. Everything here is unfinished on purpose.'
        : 'Things that are built but not finished. Behind a passcode, because they are not ready for everybody yet.';
      const milOpen = !!p.militaryUnlocked;
      s.querySelector('[data-mil-note]').textContent = milOpen
        ? 'Access granted. The military hangar is open.'
        : 'Military aircraft are behind a passcode. Ask whoever runs the game.';
      /*
       * The same five headings as the Free Flight picker, so an aeroplane is
       * in the same place on both screens. Each heading says how many of its
       * row are already yours — "1 of 3" is the reason to fly another mission.
       */
      const shown = AIRCRAFT.filter((a) => milOpen || !a.military);
      s.querySelector('[data-unlocks]').innerHTML = groupByCategory('aircraft', shown, aircraftCategory).map((g) => {
        const mine = g.items.filter((a) => Prog.isUnlocked(p, a.id)).length;
        const buttons = g.items.map((a) => {
          const owned = Prog.isUnlocked(p, a.id);
          const cost = Prog.costOf(a.id);
          // Unpriced is not free: a 0-credit aeroplane was lit "can buy" and
          // then refused with "Not for sale" when pressed.
          const afford = !!cost && p.credits >= cost;
          return `<button class="unlock${owned ? ' is-owned' : afford ? ' can-buy' : ' is-locked'}" data-buy="${a.id}" data-cat-item data-cat="${g.def.id}">
          <strong>${a.name}</strong>
          <em>${owned ? 'Yours' : cost ? `${cost.toLocaleString()} credits` : 'Not in the shop yet'}</em>
        </button>`;
        }).join('');
        return `<div class="unlock-group" data-cat-group="${attr(g.def.id)}" data-cat-kind="hangar" style="${catStyle(g.def)}">
          <h4 class="unlock-head"><span class="cat-badge is-small">${catIcon(g.def.icon, 16)}</span>
            <span class="unlock-title">${g.def.label}</span>
            <span class="unlock-tally${mine === g.items.length ? ' is-all' : ''}">${mine} of ${g.items.length} yours</span></h4>
          <div class="unlock-grid">${buttons}</div>
        </div>`;
      }).join('');

      const board = p.best || [];
      s.querySelector('[data-board]').innerHTML = board.length
        ? board.map((b, i) => `<div class="board-row"><span class="board-pos">${i + 1}</span><span class="board-name">${b.label}</span><span class="board-score">${b.score}</span><span class="board-date">${b.date}</span></div>`).join('')
        : '<p class="hint tiny">Fly something and it will show up here.</p>';
    };
    this.syncProgression = (p) => {
      if (p) this.prog = p;
      render();
      this.syncMore && this.syncMore();
      this.syncBar && this.syncBar();
      this.showcaseUi && this.showcaseUi.sync();
    };

    s.addEventListener('change', (e) => {
      const box = e.target.closest('[data-dev-set]');
      if (!box) return;
      // Same rule: the panel being invisible is not the gate, dev mode is.
      if (!Prog.isDev(this.prog || Prog.load())) {
        box.checked = false;
        return;
      }
      this.hooks.onSetting(box.dataset.devSet, box.checked);
    });

    s.addEventListener('click', (e) => {
      // Back to wherever the hangar was opened from: the front page, More,
      // Free Flight's picker or the pause card.
      if (e.target.closest('[data-back]')) return this.show(this.showcaseUi ? this.showcaseUi.backTo() : 'main');
      if (e.target.closest('[data-hs-codes]')) {
        const box = s.querySelector('[data-code]');
        if (box) {
          box.scrollIntoView({ behavior: 'smooth', block: 'center' });
          setTimeout(() => box.focus({ preventScroll: true }), 350);
        }
        return;
      }
      const buy = e.target.closest('[data-buy]');
      // In the full list, a press puts it on the podium, where it can be
      // looked at before it is bought — and bought there, with its price.
      if (buy && this.showcaseUi && buy.closest('[data-unlocks]')) {
        this.showcaseUi.view(buy.dataset.buy);
        return;
      }
      if (buy) {
        const p = this.prog || Prog.load();
        const r = Prog.buy(p, buy.dataset.buy);
        s.querySelector('[data-code-msg]').textContent = r.ok ? 'Unlocked — it is in the hangar now.' : r.why;
        render();
        this.syncBar();
        this.syncFleetLocks && this.syncFleetLocks();
        return;
      }
      const drive = e.target.closest('[data-drive]');
      if (drive) {
        this.hooks.startDrive && this.hooks.startDrive(drive.dataset.drive);
        return;
      }
      if (e.target.closest('[data-dev-enter]')) {
        const p = this.prog || Prog.load();
        const r = Prog.enterDevCode(p, s.querySelector('[data-dev-code]').value);
        s.querySelector('[data-code-msg]').textContent = r.ok
          ? r.warn || 'Dev mode on — the workbench is at the bottom of this page.'
          : r.why;
        if (r.ok) s.querySelector('[data-dev-code]').value = '';
        render();
        return;
      }
      const extRun = e.target.closest('[data-dev-ext-run]');
      if (extRun) {
        const a = (this._devExt || [])[+extRun.dataset.devExtRun];
        if (a && this.hooks.runDevAction) this.hooks.runDevAction(a);
        return;
      }
      if (e.target.closest('[data-dev-leave]')) {
        const p = this.prog || Prog.load();
        Prog.leaveDev(p);
        s.querySelector('[data-code-msg]').textContent = 'Dev mode off.';
        render();
        return;
      }
      if (e.target.closest('[data-mil-enter]')) {
        const p = this.prog || Prog.load();
        const r = Prog.enterPasscode(p, s.querySelector('[data-mil-code]').value);
        s.querySelector('[data-code-msg]').textContent = r.ok
          ? r.warn || 'Access granted — the military hangar is open, and stays open.'
          : r.why;
        if (r.ok) s.querySelector('[data-mil-code]').value = '';
        render();
        this.syncFleetLocks && this.syncFleetLocks();
        this.syncMissionLocks && this.syncMissionLocks();
        this.syncMapLocks && this.syncMapLocks();
        // The start screen's "N missions" denominator excludes hidden ones, so
        // it has to be recomputed too or it keeps advertising the old total.
        this._lastProgress && this.syncProgress(this._lastProgress);
        return;
      }
      if (e.target.closest('[data-redeem]')) {
        const box = s.querySelector('[data-code]');
        const msg = s.querySelector('[data-code-msg]');
        const typed = box.value;
        const here = () => {
          const p = this.prog || Prog.load();
          const r = Prog.redeem(p, typed);
          msg.textContent = r.ok
            ? `${r.note}${r.credits ? ` — ${r.credits} credits` : ''}${r.rank ? ` — you are now ${r.rank}` : ''}`
            : r.why;
          if (r.ok && box.value === typed) box.value = '';
          render();
          this.syncBar();
          this.syncFleetLocks && this.syncFleetLocks();
        };
        // A feature's code first — multiplayer's admin code (extensions.js extCode) — then the hangar's own.
        extCode(null, typed).then((r) => {
          if (!r) return here();
          msg.textContent = r.note;
          if (box.value === typed) box.value = '';
          return undefined;
        }, here);
      }
    });

    render();
    this.screens.hangar = s;
    installHangarShowcase(this, s, { catIcon, catStyle, aircraftCategory, groupByCategory, aircraftThumbnail });
    return s;
  }

  buildCredits() {
    const s = h(`
      <section class="screen screen-list" data-screen="credits" hidden>
        <header class="screen-head">
          <button class="ghost" data-back>← Back</button>
          <h2>Credits &amp; licences</h2>
          <span></span>
        </header>
        <div class="credits">${CREDITS_HTML}</div>
      </section>
    `);
    s.addEventListener('click', (e) => {
      if (e.target.closest('[data-back]')) this.show('main');
    });
    this.screens.credits = s;
    return s;
  }

  /**
   * The pause card.
   *
   * Two things live here that used to have nowhere to go: the realistic
   * cockpit view, and the triggers panel — a way to break something on purpose
   * and practise dealing with it. Triggers only appear in Free Flight, because
   * an engine failure in the middle of a tutorial is not a lesson, it is a bug
   * report.
   */
  buildPause() {
    const triggers = [
      { id: 'engine', label: 'Engine failure', hint: 'It stops, and it will not restart' },
      { id: 'fuelLeak', label: 'Fuel leak', hint: 'Tanks empty in about four minutes' },
      { id: 'elevator', label: 'Jammed elevator', hint: 'Pitch sticks — fly it on power' },
      { id: 'icing', label: 'Icing', hint: 'More drag, less lift, earlier stall' },
      { id: 'gear', label: 'Undercarriage jammed', hint: 'Stays wherever it is now' },
      { id: 'brakes', label: 'Brake failure', hint: 'No wheel braking at all' },
      { id: 'roughEngine', label: 'Running rough', hint: 'Part power only — you can still fly, just not far' },
      { id: 'tyre', label: 'Burst tyre', hint: 'Drags to one side the moment you touch down' },
    ]
      .map(
        (t) => `
        <button class="trigger-btn" data-trigger="${t.id}">
          ${icon('warning', 18)}
          <span>${t.label}<small>${t.hint}</small></span>
        </button>`
      )
      .join('');

    const eventTriggers = SELECTABLE_EVENTS.map(
      (e) => `
        <button class="trigger-btn" data-natural="${e.id}">
          ${icon('cloud', 18)}
          <span>${e.name}<small>${e.hint}</small></span>
        </button>`
    ).join('');

    const s = h(`
      <section class="screen screen-pause" data-screen="pause" hidden>
        <div class="pause-card">
          <h2>Paused</h2>
          <div class="pause-info" data-pause-info></div>
          <div class="pause-actions">
            <button class="primary" data-act="resume">${icon('play', 18)}<span>Resume flight</span></button>
            <button data-act="restart">${icon('restart', 18)}<span>Restart</span></button>
            <button data-act="airport">${icon('tower', 18)}<span>Return to the airfield</span></button>
            <button data-act="settings">${icon('gear', 18)}<span>Settings</span></button>
            <button data-act="quit">${icon('chevronLeft', 18)}<span>Quit to menu</span></button>
          </div>

          <details class="pause-fold">
            <summary>${icon('autopilot', 16)} Autopilot</summary>
            <div class="start-grid">
              ${AP_MODES.map((m, i) => `
                <button class="start-opt${i === 0 ? ' is-on' : ''}" data-apmode="${m.id}">
                  ${icon('autopilot', 18)}
                  <span><strong>${m.label}</strong><em>${m.hint}</em></span>
                </button>`).join('')}
            </div>
            <label class="field ap-alt">
              <span>Climb or descend to <b data-apalt-val>2,000</b> ft</span>
              <input type="range" min="500" max="12000" step="250" value="2000" data-apalt>
            </label>
            <label class="field ap-alt">
              <span>Heading <b data-aphdg-val>090</b>°</span>
              <input type="range" min="0" max="355" step="5" value="90" data-aphdg>
            </label>
            <label class="field ap-alt">
              <span>Speed <b data-apspd-val>95</b> kt</span>
              <input type="range" min="55" max="260" step="5" value="95" data-apspd>
            </label>
            <label class="field ap-alt">
              <span>Climb and descend at <b data-apvs-val>900</b> ft/min</span>
              <input type="range" min="200" max="2000" step="50" value="900" data-apvs>
            </label>
            <p class="hint tiny">All four can be changed while it is flying — it will not disconnect.
            Heading only applies to <b>hold</b> and <b>climb or descend</b>; returning to the field and
            lining up with the runway work out their own heading and height every moment.</p>
          </details>

          <details class="pause-fold">
            <summary>${icon('camera', 16)} View</summary>
            <div class="pause-actions">
              <button data-act="freelook" data-freelook>Free look: off</button>
              <button data-act="realistic" data-realistic>Realistic cockpit: off</button>
            </div>
          </details>

          <details class="pause-fold" data-triggers hidden>
            <summary>${icon('warning', 16)} Break something</summary>
            <p class="trigger-note">
              Practise dealing with it. Press one again to put it right.
            </p>
            <div class="trigger-grid">${triggers}</div>
          </details>

          <details class="pause-fold" data-natural-fold hidden>
            <summary>${icon('cloud', 16)} Disasters</summary>
            <p class="trigger-note">These run their course and stop on their own.</p>
            <div class="trigger-grid">${eventTriggers}</div>
          </details>

          <p class="tiny">Esc resumes · C changes camera · H shows the controls</p>
        </div>
      </section>
    `);
    // The height selector: tell it to climb or descend while it holds.
    s.addEventListener('input', (e) => {
      if (e.target.matches('[data-aphdg]')) {
        const v = Number(e.target.value);
        s.querySelector('[data-aphdg-val]').textContent = String(v).padStart(3, '0');
        this.hooks.onAutopilotHeading && this.hooks.onAutopilotHeading(v);
        return;
      }
      if (e.target.matches('[data-apspd]')) {
        const v = Number(e.target.value);
        s.querySelector('[data-apspd-val]').textContent = v;
        this.hooks.onAutopilotSpeed && this.hooks.onAutopilotSpeed(v);
        return;
      }
      if (e.target.matches('[data-apvs]')) {
        const v = Number(e.target.value);
        s.querySelector('[data-apvs-val]').textContent = v.toLocaleString();
        this.hooks.onAutopilotVs && this.hooks.onAutopilotVs(v);
        return;
      }
      if (!e.target.matches('[data-apalt]')) return;
      const ft = Number(e.target.value);
      s.querySelector('[data-apalt-val]').textContent = ft.toLocaleString();
      this.hooks.onAutopilotAlt && this.hooks.onAutopilotAlt(ft);
    });

    s.addEventListener('click', (e) => {
      const ap = e.target.closest('[data-apmode]');
      if (ap) {
        this.hooks.onAutopilotMode && this.hooks.onAutopilotMode(ap.dataset.apmode);
        return;
      }
      const nat = e.target.closest('[data-natural]');
      if (nat) {
        this.hooks.onNatural && this.hooks.onNatural(nat.dataset.natural);
        return;
      }
      const t = e.target.closest('[data-trigger]');
      if (t) {
        this.hooks.onTrigger && this.hooks.onTrigger(t.dataset.trigger);
        return;
      }
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const act = b.dataset.act;
      if (act === 'settings') {
        this.settingsReturn = 'pause';
        this.show('settings');
      } else {
        this.hooks.onPauseAction(act);
      }
    });
    this.screens.pause = s;
    return s;
  }

  /** Show the triggers panel only where it belongs. */
  syncTriggers(show, failures) {
    const nat = this.screens.pause && this.screens.pause.querySelector('[data-natural-fold]');
    if (nat) nat.hidden = !show;
    const host = this.screens.pause && this.screens.pause.querySelector('[data-triggers]');
    if (!host) return;
    host.hidden = !show;
    if (!failures) return;
    host.querySelectorAll('[data-trigger]').forEach((b) => {
      const on = !!failures[b.dataset.trigger];
      b.classList.toggle('is-on', on);
      // A tinted border was too easy to miss, so it says so as well.
      let tag = b.querySelector('.trigger-state');
      if (!tag) {
        tag = document.createElement('span');
        tag.className = 'trigger-state';
        b.appendChild(tag);
      }
      tag.textContent = on ? 'ON' : '';
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  /**
   * Light the natural-disaster buttons that are currently running.
   *
   * Unlike the failures these are not toggles — weather happens and then it is
   * over — so they light up for as long as the event lasts and count down,
   * rather than staying on until you press them again.
   */
  /**
   * Show whether the autopilot is engaged, and in what.
   *
   * The mode buttons used to light up when you picked one and stay lit after
   * you took the controls back, which reads as "still flying it" when it is
   * very much not. Nothing is lit unless it is actually flying the aeroplane.
   */
  syncAutopilot(engaged, mode) {
    const host = this.screens.pause;
    if (!host) return;
    host.querySelectorAll('[data-apmode]').forEach((b) => {
      const on = !!engaged && b.dataset.apmode === mode;
      b.classList.toggle('is-on', on);
      let tag = b.querySelector('.ap-state');
      if (!tag) {
        tag = document.createElement('span');
        tag.className = 'ap-state';
        b.appendChild(tag);
      }
      tag.textContent = on ? 'FLYING' : '';
    });
  }

  syncNatural(active) {
    const host = this.screens.pause;
    if (!host) return;
    host.querySelectorAll('[data-natural]').forEach((b) => {
      const left = active && active[b.dataset.natural];
      const on = left > 0;
      b.classList.toggle('is-on', on);
      let tag = b.querySelector('.trigger-state');
      if (!tag) {
        tag = document.createElement('span');
        tag.className = 'trigger-state';
        b.appendChild(tag);
      }
      tag.textContent = on ? (left > 3 ? `${Math.ceil(left)}s` : 'ON') : '';
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  syncRealisticCockpit(on) {
    const b = this.screens.pause && this.screens.pause.querySelector('[data-realistic]');
    if (b) b.textContent = `Realistic cockpit: ${on ? 'on' : 'off'}`;
  }

  buildDebrief() {
    const s = h(`
      <section class="screen screen-pause" data-screen="debrief" hidden>
        <div class="pause-card debrief-card">
          <h2 data-title>Mission complete</h2>
          <div class="debrief-body" data-body></div>
          <div class="pause-actions" data-actions></div>
        </div>
      </section>
    `);
    this.screens.debrief = s;
    return s;
  }

  /* ------------------------------------------------------------------ */

  /*
   * The key map: every action in every game, one group per game (the one you
   * are playing first, and open), each with its own Reset. Click a key cap,
   * press the new key — Esc cancels. A key that already does something else
   * in the same game asks "swap them?" instead of quietly stealing it; a
   * clash that is there anyway (from an old save) is marked on both rows.
   */
  renderKeymap() {
    const host = this.screens.settings && this.screens.settings.querySelector('[data-keymap]');
    if (!host) return;
    const h = this.hooks;
    const bindings = h.getBindings();
    const clashes = h.keyConflicts ? h.keyConflicts() : {};
    const first = h.keyGroup ? h.keyGroup() : null;
    const groups = groupedActions();
    if (first) groups.sort((a, b) => (a.id === first ? -1 : b.id === first ? 1 : 0));
    if (!this._keymapOpen || this._keymapFirst !== first) {
      this._keymapOpen = new Set(first ? [first] : [groups[0] && groups[0].id]);
      this._keymapFirst = first;
    }
    const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const caps = (id) => (bindings[id] || []).map(keyLabel).join(' / ') || '—';
    host.innerHTML = groups
      .map((g) => {
        const n = g.items.filter((i) => clashes[i.key]).length;
        const rows = g.items
          .map((i) => {
            const c = clashes[i.key];
            const also = c
              ? `<em class="keymap-also">${c.map((x) => `${esc(keyLabel(x.code))} also does: ${x.with.map((w) => esc(w.label)).join(', ')}`).join(' · ')}</em>`
              : '';
            return `<div class="keymap-row${c ? ' is-clash' : ''}"><span>${esc(i.label)}${also}</span>
                <button class="keycap" data-bind="${i.key}" title="Click, then press the new key">${esc(caps(i.key))}</button></div>`;
          })
          .join('');
        return `<details class="keymap-group" data-keygroup="${esc(g.id)}"${this._keymapOpen.has(g.id) ? ' open' : ''}>
          <summary><span class="keymap-gname">${esc(g.id)}</span>${g.id === first ? '<small class="keymap-now">playing now</small>' : ''}${
            n ? `<b class="keymap-warn">${n} clash${n === 1 ? '' : 'es'}</b>` : ''}</summary>
          <div class="keymap-rows">${rows}</div>
          <button class="ghost keymap-reset" data-reset-group="${esc(g.id)}">Reset ${esc(g.id)} keys</button>
        </details>`;
      })
      .join('');

    host.querySelectorAll('details[data-keygroup]').forEach((d) => {
      d.addEventListener('toggle', () => {
        if (d.open) this._keymapOpen.add(d.dataset.keygroup);
        else this._keymapOpen.delete(d.dataset.keygroup);
      });
    });
    host.querySelectorAll('[data-reset-group]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (h.cancelListen) h.cancelListen();
        this.askKey(null);
        h.resetKeys(btn.dataset.resetGroup);
        this.renderKeymap();
      });
    });
    host.querySelectorAll('[data-bind]').forEach((btn) => {
      btn.addEventListener('click', () => this.listenForKey(btn));
    });
  }

  /** "Press a key…" on one key cap; what happens with the key it gets. */
  listenForKey(btn) {
    const h = this.hooks;
    const action = btn.dataset.bind;
    this.askKey(null);
    const host = this.screens.settings.querySelector('[data-keymap]');
    host.querySelectorAll('.keycap.is-listening').forEach((b) => {
      b.classList.remove('is-listening');
      b.textContent = (h.getBindings()[b.dataset.bind] || []).map(keyLabel).join(' / ') || '—';
    });
    btn.textContent = 'press a key…';
    btn.classList.add('is-listening');
    // Short names for the question: "Self-destruct", not its whole how-to in brackets.
    const short = (t) => String(t).replace(/\s*\([^)]*\)/g, '').trim();
    const label = short((ACTIONS[action] && ACTIONS[action].label) || action);
    const done = (code) => {
      if (!code) {
        // Esc: nothing changes.
        this.renderKeymap();
        return;
      }
      const now = h.getBindings()[action] || [];
      if (now.length === 1 && now[0] === code) {
        this.renderKeymap();
        return;
      }
      const clash = h.keyClashes ? h.keyClashes(action, code) : [];
      if (!clash.length) {
        h.bindKey(action, code);
        this.renderKeymap();
        this.askKey(`<b>${keyLabel(code)}</b> is now <b>${label}</b>.`, null, 'good');
        return;
      }
      // Kid-simple: one question, two buttons.
      const what = clash.map((c) => `<b>${short(c.label)}</b>${c.group !== ACTIONS[action].group ? ` (${c.group})` : ''}`).join(' and ');
      // What the other one(s) would get — worked out first, nothing changed yet.
      const plan = h.bindKey(action, code, { swap: true, dryRun: true }) || [];
      const gets = (p) => (p.gets ? `<b>${short(p.label)}</b> will get <b>${keyLabel(p.gets)}</b>` : `<b>${short(p.label)}</b> will have no key — click it after to give it one`);
      this.renderKeymap();
      const listening = host.querySelector(`[data-bind="${action}"]`);
      if (listening) {
        listening.textContent = keyLabel(code);
        listening.classList.add('is-listening');
      }
      this.askKey(
        `This key already does ${what} — swap them? <span class="keymap-swapnote">(<b>${keyLabel(code)}</b> will be <b>${label}</b>; ${plan.map(gets).join('; ')})</span>`,
        [
          {
            label: 'Swap them',
            primary: true,
            run: () => {
              const did = h.bindKey(action, code, { swap: true }) || [];
              this.renderKeymap();
              const lost = did.filter((p) => !p.gets);
              this.askKey(`Swapped: <b>${label}</b> is on <b>${keyLabel(code)}</b> now${did.filter((p) => p.gets).map((p) => `, <b>${short(p.label)}</b> on <b>${keyLabel(p.gets)}</b>`).join('')}.${
                lost.length ? ` ${lost.map((p) => `<b>${short(p.label)}</b>`).join(' and ')} ha${lost.length === 1 ? 's' : 've'} no key now — click ${lost.length === 1 ? 'it' : 'them'} to pick one.` : ''}`, null, lost.length ? 'warn' : 'good');
            },
          },
          { label: 'Cancel', run: () => { this.askKey(null); this.renderKeymap(); } },
        ],
        'warn'
      );
    };
    h.listenKey(done);
  }

  /** The question (or the "done") line above the key map. null hides it. */
  askKey(html, buttons = null, tone = 'info') {
    const el = this.screens.settings && this.screens.settings.querySelector('[data-keymap-ask]');
    if (!el) return;
    if (!html) {
      el.hidden = true;
      el.innerHTML = '';
      return;
    }
    el.hidden = false;
    el.className = `keymap-ask is-${tone}`;
    el.innerHTML = `<span>${html}</span>${(buttons || []).map((b, i) => `<button class="${b.primary ? 'primary' : 'ghost'}" data-ask="${i}">${b.label}</button>`).join('')}`;
    el.querySelectorAll('[data-ask]').forEach((b) => {
      b.addEventListener('click', () => buttons[Number(b.dataset.ask)].run());
    });
  }

  syncSettings(settings) {
    // The settings difficulty changes what every mission pays.
    this.syncPayLines && this.syncPayLines();
    const s = this.screens.settings;
    const get = (path) => path.split('.').reduce((o, k) => (o ? o[k] : undefined), settings);
    s.querySelectorAll('[data-set]').forEach((node) => {
      const v = get(node.dataset.set);
      if (v === undefined) return;
      if (node.type === 'checkbox') node.checked = !!v;
      else node.value = v;
      const out = s.querySelector(`[data-out="${node.dataset.set}"]`);
      if (out) out.textContent = node.type === 'range' && Number(v) <= 1 ? `${Math.round(v * 100)}%` : v;
    });
    // Free-flight defaults follow the saved weather.
    if (this.freeControls && settings.weather) {
      this.freeControls.time.value = settings.weather.time;
      this.freeControls.cond.value = settings.weather.condition;
      this.freeControls.wind.value = settings.weather.windSpeedKts;
      this.freeControls.dir.value = Math.round(settings.weather.windDirDeg / 10) * 10;
      this.refreshFree();
    }
  }

  syncProgress(progress) {
    this._lastProgress = progress;
    const stats = this.screens.main.querySelector('[data-stats]');
    const done = Object.values(progress.missions).filter((m) => m.complete).length;
    const best = progress.bestLanding;
    stats.innerHTML = `
      <span><b>${done}</b>/${MISSIONS.filter((m) => !Prog.needsPasscode(this.prog, m)).length} missions</span>
      <span><b>${progress.landings}</b> landings</span>
      ${best ? `<span>Best landing <b>${best.score}</b>/100</span>` : '<span>No landings yet</span>'}
      ${progress.tutorialComplete ? '<span class="ok">Flight school ✓</span>' : ''}
    `;
    for (const m of MISSIONS) {
      const node = this.screens.missions.querySelector(`[data-best="${m.id}"]`);
      const rec = progress.missions[m.id];
      if (node) {
        node.innerHTML = rec && rec.complete
          ? `<span class="ok">Completed ✓</span> best ${rec.bestScore}/100`
          : 'Not flown yet';
      }
    }
  }

  /**
   * Reflect the mute state on the start-screen button and on Settings' "Mute
   * everything". The box was painted once at boot, when sound starts off, so
   * after the button turned sound on it still read ticked — and ticking it
   * "again" to mute actually unticked it and left the sound on.
   */
  syncSound(muted) {
    const box = this.screens.settings && this.screens.settings.querySelector('[data-set="muted"]');
    if (box) box.checked = !!muted;
    const btn = this.screens.main.querySelector('[data-sound]');
    if (!btn) return;
    btn.textContent = muted ? '🔇 Sound is off — turn it on' : '🔊 Sound is on — turn it off';
    btn.classList.toggle('is-live', !muted);
  }

  showInstall(canInstall) {
    const btn = this.screens.main.querySelector('[data-install]');
    btn.hidden = !canInstall;
  }

  setInstalled() {
    const btn = this.screens.main.querySelector('[data-install]');
    btn.hidden = false;
    btn.textContent = '✓ Installed — playable offline';
    btn.disabled = true;
  }

  setZipAvailable(ok) {
    const a = this.screens.main.querySelector('[data-zip]');
    if (!ok) a.remove();
  }

  updateFps(fps) {
    const n = this.screens.settings.querySelector('[data-fps]');
    if (n) n.textContent = fps;
  }

  setPauseInfo(html) {
    this.screens.pause.querySelector('[data-pause-info]').innerHTML = html;
  }

  showDebrief({ title, kind, body, actions }) {
    const s = this.screens.debrief;
    s.querySelector('[data-title]').textContent = title;
    s.querySelector('[data-title]').className = `debrief-title is-${kind}`;
    s.querySelector('[data-body]').innerHTML = body;
    const host = s.querySelector('[data-actions]');
    host.innerHTML = '';
    for (const a of actions) {
      const b = document.createElement('button');
      b.textContent = a.label;
      if (a.primary) b.className = 'primary';
      b.addEventListener('click', a.onClick);
      host.appendChild(b);
    }
    this.show('debrief');
  }

  /* ---------------------------------------------------------------- */
  /* Category headings, chips and search, for the missions and the fleet. */

  /** What each grouped list is filtered to: a chip ('all' or an id) and the search text. */
  catState(kind) {
    if (!this._catStates) this._catStates = {};
    if (!this._catStates[kind]) this._catStates[kind] = { cat: 'all', q: '' };
    return this._catStates[kind];
  }

  catHost(kind) {
    return kind === 'fleet' ? this.screens.free : this.screens.missions;
  }

  /**
   * The grid under one heading, creating the heading if this is the first
   * thing to go under it. For cards added after build — game-ui.js's
   * registerMissions() — so a mission nobody wrote into MISSIONS still gets
   * a heading of its own rather than being dropped at the bottom of another.
   */
  catGridFor(kind, id) {
    const host = this.catHost(kind);
    const list = host && host.querySelector(`[data-cat-list="${kind}"]`);
    if (!list) return null;
    let group = [...list.children].find((g) => g.dataset.catGroup === id);
    if (!group) {
      group = h(catGroupHtml(kind, categoryDef(kind, id), '', kind === 'fleet' ? 'fleet-grid' : 'mission-grid'));
      const rank = categoryRank(kind, id);
      const next = [...list.children].find((g) => categoryRank(kind, g.dataset.catGroup) > rank);
      list.insertBefore(group, next || null);
    }
    return group.querySelector('[data-cat-grid]');
  }

  /** Wire the chips, the search box and "Show them all" on one screen. */
  bindCategoryBar(screen, kind) {
    const bar = screen.querySelector(`[data-cat-bar="${kind}"]`);
    if (!bar) return;
    const st = this.catState(kind);
    const input = bar.querySelector('[data-cat-search]');
    if (input) {
      input.addEventListener('input', () => {
        st.q = input.value;
        this.syncCategories(kind);
      });
      // Esc in the box empties it, and goes no further — it is not "back".
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && input.value) {
          e.stopPropagation();
          input.value = '';
          st.q = '';
          this.syncCategories(kind);
        }
      });
    }
    screen.addEventListener('click', (e) => {
      const chip = e.target.closest('[data-cat-chip]');
      if (chip && bar.contains(chip)) {
        st.cat = chip.dataset.catChip;
        this.syncCategories(kind);
        this.hooks.onClick && this.hooks.onClick('category');
        return;
      }
      const clear = e.target.closest('[data-cat-clear]');
      if (clear && clear.closest(`[data-cat-empty="${kind}"]`)) this.resetCategoryFilter(kind);
    });
  }

  /** Back to every heading and an empty search box. */
  resetCategoryFilter(kind) {
    const st = this.catState(kind);
    st.cat = 'all';
    st.q = '';
    const host = this.catHost(kind);
    const input = host && host.querySelector(`[data-cat-bar="${kind}"] [data-cat-search]`);
    if (input) input.value = '';
    this.syncCategories(kind);
  }

  /**
   * Repaint one grouped list: which headings show, their counts, the chips,
   * and the "nothing called that" line.
   *
   * Everything that hides a card — the passcode, the game filter in
   * game-ui.js, the car's job board — sets `card.hidden` and nothing else,
   * and this reads it afterwards. The search never touches `hidden`: it uses
   * a class of its own, so clearing the search box can never un-hide a
   * military mission the passcode hid. That separation is the whole design:
   * the passcode, the game and the search each have one lever, and none of
   * them can undo what another one did.
   *
   * A heading is shown when at least one card under it is. Counts are what
   * you can see, so "Rescue 6" on the boat means six cards on the screen.
   */
  syncCategories(kind) {
    const host = this.catHost(kind);
    const list = host && host.querySelector(`[data-cat-list="${kind}"]`);
    if (!list) return;
    const st = this.catState(kind);
    const words = fold(st.q).split(' ').filter(Boolean);
    const groups = [...list.querySelectorAll(':scope > [data-cat-group]')];
    const present = [];
    let total = 0;
    let totalAll = 0;
    for (const group of groups) {
      let shown = 0;
      let all = 0;
      for (const item of group.querySelectorAll('[data-cat-item]')) {
        const find = item.dataset.find || '';
        const miss = words.length > 0 && !words.every((w) => find.includes(w));
        item.classList.toggle('is-filtered', miss);
        if (item.hidden) continue;
        all++;
        if (!miss) shown++;
      }
      group.dataset.catShown = String(shown);
      const count = group.querySelector('[data-cat-count]');
      if (count) count.textContent = String(shown);
      if (all) present.push({ def: categoryDef(kind, group.dataset.catGroup), shown });
      total += shown;
      totalAll += all;
    }
    // A chip for a heading this game does not have (the boat has no Military)
    // falls back to All rather than leaving an empty screen.
    if (st.cat !== 'all' && !present.some((p) => p.def.id === st.cat)) st.cat = 'all';
    for (const group of groups) {
      const shown = Number(group.dataset.catShown) || 0;
      group.hidden = shown === 0 || (st.cat !== 'all' && st.cat !== group.dataset.catGroup);
    }
    const visible = st.cat === 'all' ? total : (present.find((p) => p.def.id === st.cat) || { shown: 0 }).shown;

    const bar = host.querySelector(`[data-cat-bar="${kind}"]`);
    if (bar) {
      const chips = bar.querySelector('[data-cat-chips]');
      if (chips) {
        const hadFocus = chips.contains(document.activeElement) ? document.activeElement.dataset.catChip : null;
        const scroll = chips.scrollLeft;
        const chip = (id, label, n, style) =>
          `<button type="button" class="cat-chip${st.cat === id ? ' is-on' : ''}" data-cat-chip="${attr(id)}" ` +
          `aria-pressed="${st.cat === id ? 'true' : 'false'}"${style ? ` style="${style}"` : ''}>` +
          `${id === 'all' ? '' : '<i class="cat-dot" aria-hidden="true"></i>'}<span>${label}</span><b>${n}</b></button>`;
        chips.innerHTML =
          chip('all', 'All', total) + present.map((p) => chip(p.def.id, p.def.label, p.shown, catStyle(p.def))).join('');
        chips.scrollLeft = scroll;
        // One heading needs no chips: "All 6 · Rescue 6" is two ways of saying the same thing.
        chips.hidden = present.length < 2;
        if (hadFocus) {
          const again = chips.querySelector(`[data-cat-chip="${hadFocus}"]`);
          if (again) again.focus({ preventScroll: true });
        }
      }
      // Search only earns its space on a list long enough to lose something in.
      const wrap = bar.querySelector('[data-cat-search-wrap]');
      if (wrap) wrap.hidden = totalAll <= 6 && !st.q;
      bar.hidden = (!chips || chips.hidden) && (!wrap || wrap.hidden);
    }

    const empty = host.querySelector(`[data-cat-empty="${kind}"]`);
    if (empty) {
      empty.hidden = visible > 0 || totalAll === 0;
      const text = empty.querySelector('[data-cat-empty-text]');
      if (text && visible === 0) {
        const where = st.cat !== 'all' ? ` under ${categoryDef(kind, st.cat).label}` : '';
        text.textContent = st.q ? `Nothing called “${st.q.trim()}”${where}.` : `Nothing${where} here.`;
      }
    }
  }

  show(name) {
    const prev = this.current;
    this.layer.hidden = false;
    for (const key in this.screens) this.screens[key].hidden = key !== name;
    this.current = name;
    // The hangar's podium starts and stops with its screen.
    if (this.showcaseUi) this.showcaseUi.onScreen(name, prev);
    // Credits and the lit game can both have changed since this screen was
    // last open — a flight paid out, a code was redeemed, the boat went back.
    this.syncBar && this.syncBar();
    if (name === 'settings') {
      this.askKey(null);
      this.renderKeymap();
    } else if (this.hooks.cancelListen) {
      // Left Settings with a key cap still waiting: the next key is the game's again.
      this.hooks.cancelListen();
    }
    // Repaint the hub and the mission gate on open, so they are right whatever
    // changed them — a code, a flight, a passcode entered somewhere else.
    if (name === 'more') this.syncMore && this.syncMore();
    if (name === 'missions') this.syncMissionLocks && this.syncMissionLocks();
    if (name === 'missions') this.syncPayLines && this.syncPayLines();
    // The Missions card counts what you can fly, which a passcode changes.
    if (name === 'main') this.refreshMissionsLine && this.refreshMissionsLine();
    // Whoever opened it may want to repaint it for the island we are on.
    if (this.hooks.onScreen) this.hooks.onScreen(name);
    if (name === 'pause') this.syncFreeLook();
    if (name !== 'settings') this.settingsReturn = null;
    // Move focus for keyboard users.
    const focusable = this.screens[name].querySelector('button, select, input, a');
    if (focusable) setTimeout(() => focusable.focus({ preventScroll: true }), 30);
  }



  /**
   * Draw the hand-inked frames for whatever is on screen. Called on every
   * screen change because the shapes are sized to their elements, and an
   * element that was hidden has no size to measure.
   */
  /** Show whether free look is on, on the pause-menu button. */
  syncFreeLook(on) {
    const btn = this.root.querySelector('[data-freelook]');
    if (!btn) return;
    const state = on === undefined ? this._freeLook : !!on;
    this._freeLook = state;
    btn.textContent = `Free look: ${state ? 'on' : 'off'}`;
    btn.classList.toggle('is-live', state);
  }



  /** Tell the bar which of the four is running, so it lights the right one. */
  setGame(id) {
    this.currentGame = id;
    this.syncBar && this.syncBar();
  }

  hide() {
    const prev = this.current;
    this.layer.hidden = true;
    this.current = null;
    if (this.showcaseUi) this.showcaseUi.onScreen(null, prev);
    for (const key in this.screens) this.screens[key].hidden = true;
    // Hand the keyboard back to the aeroplane. A slider or dropdown that keeps
    // focus after the menu closes swallows key presses meant for flying.
    const el = document.activeElement;
    if (el && el !== document.body && this.root.contains(el) && el.blur) el.blur();
  }

  get isOpen() {
    return !this.layer.hidden;
  }

  /**
   * main.js loop(): draw the hangar's podium instead of the world, while the
   * hangar is open. True means "drawn — do not draw the island as well".
   */
  drawView(renderer, dt) {
    return !!(this.showcaseUi && this.showcaseUi.draw(renderer, dt));
  }
}
