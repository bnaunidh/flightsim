/**
 * The airlines' lettering: sixteen OFL typefaces, bundled (assets/fonts/).
 *
 * The owner, on the titling: "not the same font". Every airline wore the
 * same Helvetica, which is the one thing no two real airlines ever share —
 * the wordmark is half of what makes a scheme read as THAT airline from the
 * apron. So each parody airline (aircraft/liveries.js `style.titleFont`)
 * names a face whose FEEL is closest to the lettering of the airline it is
 * styled after: a bold geometric sans, an elegant high-contrast serif, a
 * condensed cargo face, a sporty italic. Never the real airline's own
 * typeface (most are custom and trademarked); the nearest free cousin.
 *
 * All SIL Open Font License 1.1 (assets/fonts/FONTS.md), latin subset woff2
 * from Fontsource, about 300 kB in all, precached by sw.js so they are there
 * offline. Credited in the Credits screen (ui/credits.js).
 *
 * HOW IT LOADS. The faces are declared once as @font-face rules (a <style>
 * the first call adds), and loadAirlineFonts() asks document.fonts for every
 * one, so the files are fetched and decoded before anything letters a canvas
 * — main.js waits for it (capped) before the world and the first aircraft
 * are built. A canvas drawn before then (a slow disk, the cap ran out) uses
 * the fallback stack, and registers itself with whenFontsLoaded() to be
 * drawn again, in the right face, the moment the files are in.
 *
 * PURE where it can be: with no document (node, the tests) nothing loads,
 * fontsLoaded() stays false, and every caller falls back to the stack it had.
 */

/**
 * Every face, by family, weight and style. `serif` picks the fallback stack. `file` is the
 * Fontsource name, <family>-<weight>-<style>.woff2 (one rule, so a face is one line here).
 */
export const AIRLINE_FONTS = Object.freeze([
  ['Montserrat', 700], ['Montserrat', 800], ['Jost', 600], ['Jost', 700], ['League Spartan', 700],
  ['Playfair Display', 700, 'serif'], ['Cinzel', 700, 'serif'], ['Oswald', 600, 'condensed'], ['Barlow Condensed', 700, 'condensed'],
  ['Exo 2', 700, 'italic'], ['Titillium Web', 700], ['Archivo Black', 400], ['Kanit', 600], ['Lora', 600, 'italic', 'serif'],
  // Owner-approved 2026-11-09, closer to four airlines' lettering (assets/fonts/FONTS.md):
  ['Rubik', 900], ['Cormorant Garamond', 700, 'serif'], ['Josefin Sans', 600], ['Nunito Sans', 600],
].map(([family, weight, ...tags]) => {
  const style = tags.includes('italic') ? 'italic' : 'normal';
  const f = { family, weight, style, file: `${family.toLowerCase().replace(/ /g, '-')}-${weight}-${style}.woff2` };
  if (tags.includes('serif')) f.serif = true;
  if (tags.includes('condensed')) f.condensed = true;
  return Object.freeze(f);
}));

/** The fallback a canvas uses before (or without) the face: the stack the titling always had. */
const SANS = '"Helvetica Neue", Helvetica, Arial, sans-serif';
const SERIF = 'Georgia, "Times New Roman", serif';
const CONDENSED = '"Arial Narrow", "Helvetica Neue", Arial, sans-serif';

/** The bundled face for a { family, weight, style }, or null if it is not one of ours. */
export function faceFor(font) {
  if (!font || typeof font.family !== 'string') return null;
  const style = font.style === 'italic' ? 'italic' : 'normal';
  const w = Number(font.weight) || 400;
  return AIRLINE_FONTS.find((f) => f.family === font.family && f.weight === w && f.style === style) || null;
}

/** A CSS font-family list: the face first, then a fallback of the same kind. */
export function fontStack(font) {
  const face = faceFor(font) || (font && AIRLINE_FONTS.find((f) => f.family === font.family)) || null;
  if (!face) return SANS;
  const back = face.serif ? SERIF : face.condensed ? CONDENSED : SANS;
  return `"${face.family}", ${back}`;
}

/** The canvas `font` shorthand for a face at `px` pixels. */
export function canvasFont(font, px) {
  const face = faceFor(font);
  const style = face && face.style === 'italic' ? 'italic ' : '';
  const weight = face ? face.weight : Math.max(100, Math.min(900, Math.round(Number(font && font.weight) || 600)));
  return `${style}${weight} ${Math.max(1, Math.round(px * 100) / 100)}px ${fontStack(font)}`;
}

/** A short key for a texture cache: '' for no face, else 'family/weight/style'. */
export function fontKey(font) {
  const f = faceFor(font);
  return f ? `${f.family}/${f.weight}/${f.style}` : '';
}

/* ------------------------------------------------------------------ */
/* Loading                                                             */
/* ------------------------------------------------------------------ */

const L = { styled: false, promise: null, loaded: false, failed: [], waiting: [], ms: 0 };

function fontUrl(file) {
  try {
    return new URL(`../../assets/fonts/${file}`, import.meta.url).href;
  } catch (e) {
    return `assets/fonts/${file}`;
  }
}

/** The @font-face rules, once. font-display: block — a canvas is redrawn anyway. */
function declareFaces() {
  if (L.styled) return true;
  if (typeof document === 'undefined' || !document.head || typeof document.createElement !== 'function') return false;
  const css = AIRLINE_FONTS.map(
    (f) => `@font-face{font-family:"${f.family}";font-style:${f.style};font-weight:${f.weight};font-display:block;src:url("${fontUrl(f.file)}") format("woff2");}`,
  ).join('\n');
  try {
    const el = document.createElement('style');
    el.id = 'airline-fonts';
    el.textContent = css;
    document.head.appendChild(el);
    L.styled = true;
  } catch (e) {
    return false;
  }
  return true;
}

function fontSet() {
  return typeof document !== 'undefined' && document.fonts && typeof document.fonts.load === 'function' ? document.fonts : null;
}

/**
 * Fetch and decode every face. Resolves (never rejects) to { ok, failed, ms }
 * once all of them have answered; a face that will not load is listed in
 * `failed` and its airline keeps the fallback stack.
 */
export function loadAirlineFonts() {
  if (L.promise) return L.promise;
  const set = fontSet();
  if (!declareFaces() || !set) {
    L.promise = Promise.resolve({ ok: false, failed: AIRLINE_FONTS.map((f) => f.family), ms: 0 });
    return L.promise;
  }
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  L.promise = Promise.all(
    AIRLINE_FONTS.map(async (f) => {
      try {
        const got = await set.load(`${f.style === 'italic' ? 'italic ' : ''}${f.weight} 32px "${f.family}"`, 'AIRWAYS');
        if (!got || !got.length) L.failed.push(`${f.family} ${f.weight}${f.style === 'italic' ? 'i' : ''}`);
      } catch (e) {
        L.failed.push(`${f.family} ${f.weight}${f.style === 'italic' ? 'i' : ''}`);
      }
    }),
  ).then(() => {
    L.ms = (typeof performance !== 'undefined' ? performance.now() : 0) - t0;
    // Never silently: a face that did not load is a fallback on an aeroplane.
    if (L.failed.length) console.warn(`Airline faces missing, fallback lettering: ${L.failed.join(', ')}`);
    letterAgain();
    return { ok: L.failed.length === 0, failed: L.failed.slice(), ms: L.ms };
  });
  return L.promise;
}

function letterAgain() {
  L.loaded = true;
  for (const fn of L.waiting.splice(0)) {
    try {
      fn();
    } catch (e) {
      /* a canvas that cannot be redrawn keeps the fallback lettering */
    }
  }
}

/** Tests: as if the faces had not landed yet. The function returned lands them. */
export function holdFonts() {
  L.loaded = false;
  return letterAgain;
}

/** True once every face has answered (loaded or not). */
export const fontsLoaded = () => L.loaded;

/**
 * Is this face ready to draw with right now? False before the load, in node,
 * and for a face that failed. Only ever true for one of the bundled faces.
 */
export function fontReady(font) {
  const f = faceFor(font);
  if (!f) return false;
  const set = fontSet();
  if (!set || typeof set.check !== 'function') return false;
  try {
    return set.check(`${f.style === 'italic' ? 'italic ' : ''}${f.weight} 32px "${f.family}"`, 'AIRWAYS') && L.loaded;
  } catch (e) {
    return false;
  }
}

/**
 * Run `fn` once the faces are in: at once if they already are (returns
 * false: nothing was queued), else after loadAirlineFonts() settles (true).
 * A canvas lettered early uses this to letter itself again.
 */
export function whenFontsLoaded(fn) {
  if (typeof fn !== 'function') return false;
  if (L.loaded || !fontSet()) return false;
  L.waiting.push(fn);
  // Nobody has asked for them yet (a test, a page without main.js): ask now.
  loadAirlineFonts();
  return true;
}

/** For the tests and the console. */
export function airlineFontsState() {
  return { declared: L.styled, loaded: L.loaded, failed: L.failed.slice(), waiting: L.waiting.length, ms: Math.round(L.ms) };
}
