/**
 * The hangar's shelves: how forty aircraft are put away so one can be found.
 *
 * Owner (v71 wishlist): "organize hangar A LOT more". The five picker headings
 * (menus.js AIRCRAFT_CATEGORIES) are the contract every aircraft team builds
 * against and every other screen files by, so they stay exactly as they are.
 * The hangar lays the same fleet out on eight shelves instead — Airliners
 * split into the mainline jets, the regional turboprops and the giant
 * freighters, and a Business jets shelf waiting for the first one — plus a
 * search box, sorts and filters, favourites and a "recently flown" row.
 *
 * Everything in this file is pure: no DOM, no three.js, no imports from the
 * roster. The screen (hangar-showcase-ui.js) hands in the types and the two
 * callbacks it already has, and tests/features/hangar.mjs drives it in Node
 * with the real roster behind the ten-line DOM stub menus.mjs uses.
 */

/* ---------------- the shelves ---------------- */

/**
 * In the order a child meets them on the chip row: what they fly first, what
 * they have flown on, the big and odd ones, then the gated and the rotary.
 * `icon` names a CAT_ICONS entry in menus.js (handed in as kit.catIcon).
 */
export const SHELVES = Object.freeze([
  { id: 'light', label: 'Light', blurb: 'Small, slow and friendly — the ones to learn in', colour: '#7ee8b2', icon: 'light' },
  { id: 'airliners', label: 'Airliners', blurb: 'The jets you have probably flown on', colour: '#58c6ff', icon: 'airliner' },
  { id: 'regional', label: 'Regional', blurb: 'Short hops, fewer seats, propellers', colour: '#64d8c8', icon: 'airliner' },
  { id: 'giants', label: 'Giants & Cargo', blurb: 'The biggest things that fly — built to carry', colour: '#ffd166', icon: 'delivery' },
  { id: 'business', label: 'Business jets', blurb: 'Fast, small and private', colour: '#f0a6c8', icon: 'airline' },
  { id: 'military', label: 'Military', blurb: 'Behind the passcode — very fast, very twitchy', colour: '#b9cf8f', icon: 'military' },
  { id: 'helicopters', label: 'Helicopters', blurb: 'They hover — nothing else here does', colour: '#ff9d6a', icon: 'heli' },
  { id: 'special', label: 'Special', blurb: 'The odd ones out', colour: '#c39bff', icon: 'special' },
]);

export const SHELF_IDS = SHELVES.map((s) => s.id);

export function shelfDef(id) {
  return SHELVES.find((s) => s.id === id) || SHELVES[SHELVES.length - 1];
}

/*
 * The Meridian 220 is a forty-seat jet: a regional by any airline's reckoning,
 * but it carries no flag that says so and its class is plain "Airliner". The
 * Q400 does not need a row here — it is a turboprop, and the rule below reads
 * the propellers off its shape.
 */
const REGIONAL_IDS = new Set(['meridian']);

const BUSINESS_RE = /business|executive|bizjet|biz jet|corporate|private jet/;
const REGIONAL_RE = /regional|turboprop|commuter/;

/**
 * Which shelf an aircraft goes on. Always exactly one of the eight.
 *
 * `catOf` is menus.js aircraftCategory: the five-way heading the rest of the
 * game already agrees on. A shelf never contradicts it — Military stays
 * Military (the passcode's door is one door), Helicopters stay Helicopters
 * whatever they are armed with — it only splits Airliners three ways and
 * gives a business jet, from whatever heading, a shelf of its own.
 */
export function shelfOf(type, catOf) {
  if (!type) return 'special';
  const cat = catOf(type);
  if (cat === 'military') return 'military';
  if (cat === 'helicopter') return 'helicopters';
  const cls = String(type.class || '').toLowerCase();
  if (BUSINESS_RE.test(cls)) return 'business';
  if (cat === 'airliner') {
    if (type.freighter) return 'giants';
    const prop = !!(type.shape && type.shape.power && type.shape.power.kind === 'prop');
    if (REGIONAL_IDS.has(type.id) || prop || REGIONAL_RE.test(cls)) return 'regional';
    return 'airliners';
  }
  if (cat === 'light') return 'light';
  return 'special';
}

/** The shelves with something on them, in shelf order, each with its items in roster order. */
export function shelve(types, catOf) {
  const byShelf = new Map();
  for (const t of types) {
    const id = shelfOf(t, catOf);
    if (!byShelf.has(id)) byShelf.set(id, []);
    byShelf.get(id).push(t);
  }
  return SHELVES.filter((s) => byShelf.has(s.id)).map((s) => ({ def: s, items: byShelf.get(s.id) }));
}

/* ---------------- "New" ---------------- */

/**
 * Types added after v70 (sw.js CACHE_VERSION 'island-flight-v70', 2026-10-21,
 * which already carried the C-17, the A-10, the seven popular airliners, the
 * giants and the Lancer). The helicopter wave came after it. When the next
 * release lands, move the line: everything a release introduces is "New"
 * until the release after that.
 */
export const NEW_SINCE_V70 = Object.freeze(['bell407', 'h145', 'r44', 'aw139', 'uh60', 'ch47', 'ah64', 'vh3d']);
const NEW_SET = new Set(NEW_SINCE_V70);

export function isNew(id) {
  return NEW_SET.has(id);
}

/* ---------------- search ---------------- */

/** Lower-case, accents off, one space between words: what the search box compares. */
export function fold(s) {
  return String(s == null ? '' : s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** The words the search box looks through for one aircraft. */
export function searchText(type, shelfLabel = '') {
  return fold(`${type.name} ${type.id} ${type.class || ''} ${type.blurb || ''} ${shelfLabel} ${isNew(type.id) ? 'new' : ''}`);
}

/** Does this aircraft answer to `query`? Every typed word has to appear somewhere. */
export function matches(type, query, shelfLabel = '') {
  const q = fold(query);
  if (!q) return true;
  const hay = ` ${searchText(type, shelfLabel)} `;
  // "747" should find the Boeing 747 and the Dreamlifter; "f 22" the F-22.
  return q.split(' ').every((w) => hay.includes(w) || hay.replace(/ /g, '').includes(w));
}

/* ---------------- the numbers on a card ---------------- */

/**
 * The three numbers a card has room for: how fast, how big, how long it flies.
 * `perf` is performanceFor(type.id) — handed in so this file stays free of the
 * roster. The size reads the drawn plan when there is one (the airliners), the
 * shape otherwise, exactly as the showroom's bars do.
 */
export function keyStats(type, perf) {
  const p = perf || {};
  const plan = type.plan || {};
  const shape = type.shape || {};
  const span = plan.span || (shape.halfSpan ? shape.halfSpan * 2 * (shape.scale || 1) : 0);
  const length = plan.tail != null && plan.nose != null ? plan.tail - plan.nose : span;
  const rotor = !!(shape.power && shape.power.rotor);
  const vne = p.vne || 0;
  const endur = p.enduranceMin || 0;
  const hrs = Math.floor(endur / 60);
  const mins = endur % 60;
  const fuel = endur ? (hrs ? `${hrs} h${mins ? ` ${mins}` : ''}` : `${mins} min`) : '—';
  return {
    speed: { label: 'Top', value: vne ? `${Math.round(vne)} kt` : '—', n: vne },
    size: { label: rotor ? 'Rotor' : 'Span', value: span ? `${span.toFixed(span < 20 ? 1 : 0)} m` : '—', n: Math.max(span, length) },
    fuel: { label: 'Fuel', value: fuel, n: endur },
  };
}

/* ---------------- sort ---------------- */

export const SORTS = Object.freeze([
  { id: 'shelf', label: 'Shelf order' },
  { id: 'size', label: 'Biggest first' },
  { id: 'speed', label: 'Fastest first' },
  { id: 'price', label: 'Cheapest first' },
  { id: 'newest', label: 'Newest first' },
  { id: 'name', label: 'A to Z' },
]);

export const SORT_IDS = SORTS.map((s) => s.id);

/**
 * Sort a list of types. `ctx` carries the lookups: perfFor(id), costOf(id),
 * owned(id), rosterIndex(id). Stable: ties keep the order they came in, which
 * for the default is shelf order.
 */
export function sortFleet(items, sort, ctx) {
  const list = items.map((t, i) => ({ t, i }));
  const perf = (t) => (ctx.perfFor ? ctx.perfFor(t.id) : {}) || {};
  const size = (t) => keyStats(t, perf(t)).size.n;
  const speed = (t) => perf(t).vne || 0;
  // Yours first, cheapest next; what is not for sale at all goes last.
  const price = (t) => (ctx.owned && ctx.owned(t.id) ? -1 : ctx.costOf(t.id) || Infinity);
  const roster = (t) => (ctx.rosterIndex ? ctx.rosterIndex(t.id) : 0);
  const by = {
    shelf: () => 0,
    size: (a, b) => size(b) - size(a),
    speed: (a, b) => speed(b) - speed(a),
    price: (a, b) => price(a) - price(b),
    newest: (a, b) => Number(isNew(b.id)) - Number(isNew(a.id)) || roster(b) - roster(a),
    name: (a, b) => String(a.name).localeCompare(String(b.name)),
  };
  const cmp = by[sort] || by.shelf;
  list.sort((x, y) => cmp(x.t, y.t) || x.i - y.i);
  return list.map((x) => x.t);
}

/* ---------------- filter ---------------- */

export const FILTERS = Object.freeze([
  { id: 'all', label: 'All' },
  { id: 'owned', label: 'Yours' },
  { id: 'locked', label: 'Locked' },
  { id: 'afford', label: 'Can afford' },
]);

export const FILTER_IDS = FILTERS.map((f) => f.id);

/** `ctx`: owned(id), costOf(id), credits. "Can afford" is locked, for sale, and within your credits. */
export function passesFilter(type, filter, ctx) {
  const mine = !!(ctx.owned && ctx.owned(type.id));
  const cost = ctx.costOf ? ctx.costOf(type.id) : 0;
  switch (filter) {
    case 'owned':
      return mine;
    case 'locked':
      return !mine;
    case 'afford':
      return !mine && cost > 0 && (ctx.credits || 0) >= cost;
    default:
      return true;
  }
}

/**
 * The whole pipeline, in one place so the screen and the tests agree:
 * shelf (or 'all') → search → filter → sort. Returns the visible types.
 */
export function visibleFleet(types, { shelf = 'all', query = '', filter = 'all', sort = 'shelf' }, ctx) {
  const shelved = shelve(types, ctx.catOf);
  const ordered = shelved.flatMap((g) => g.items.map((t) => ({ t, label: g.def.label, shelf: g.def.id })));
  const kept = ordered
    .filter((x) => shelf === 'all' || x.shelf === shelf)
    .filter((x) => matches(x.t, query, x.label))
    .filter((x) => passesFilter(x.t, filter, ctx))
    .map((x) => x.t);
  return sortFleet(kept, sort, ctx);
}

/* ---------------- what is remembered ---------------- */

/**
 * A short list of ids kept in web storage: the favourites, the recently flown,
 * the chosen sort. `storage` is anything with getItem/setItem (localStorage,
 * or a Map-backed stand-in for the tests); every read and write is fenced,
 * because a locked-down school profile or a private window throws on both.
 */
export function idList(key, storage, max = 12) {
  const read = () => {
    try {
      const raw = storage && storage.getItem(key);
      const v = raw ? JSON.parse(raw) : [];
      return Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, max) : [];
    } catch (e) {
      return [];
    }
  };
  const write = (list) => {
    try {
      storage && storage.setItem(key, JSON.stringify(list.slice(0, max)));
      return true;
    } catch (e) {
      return false;
    }
  };
  return {
    key,
    get: read,
    has: (id) => read().includes(id),
    /** Add or remove one; answers whether it is in now. */
    toggle(id) {
      const list = read();
      const i = list.indexOf(id);
      if (i >= 0) list.splice(i, 1);
      else list.unshift(id);
      write(list);
      return i < 0;
    },
    /** Move (or add) one to the front: what "most recent" means. */
    bump(id) {
      const list = read().filter((x) => x !== id);
      list.unshift(id);
      write(list);
      return list;
    },
    set: (list) => write([...new Set(list)]),
    clear: () => write([]),
  };
}

export const STORE_KEYS = Object.freeze({
  favourites: 'islandsim.hangar.favourites.v1',
  recent: 'islandsim.hangar.recent.v1',
  sort: 'islandsim.hangar.sort.v1',
});
