/**
 * Features that plug into the game without editing main.js.
 *
 * Nineteen things were asked for at once — new aeroplanes, a warning system,
 * getting out and walking about, traffic that lands and parks, a meteor mode —
 * and every one of them wants to hook the same four places in main.js: when
 * the world is built, every frame, when a flight starts and when it ends.
 * Nineteen hands in one 4,000-line file at the same time is how a game stops
 * booting. So main.js calls these hooks once, here, and each feature is its
 * own module that registers itself.
 *
 * TWO RULES THAT ARE THE POINT OF THIS FILE:
 *
 * 1. A feature that throws is switched off, not allowed to take the game with
 *    it. Every hook is called inside its own try/catch; the first error logs
 *    once, names the feature, and disables it for the rest of the session.
 *    The game is played by a class on school laptops. One half-finished
 *    feature must never be the reason nobody can fly.
 *
 * 2. Nothing here knows what any feature does. It passes the game object and
 *    gets out of the way.
 *
 * A feature is a plain object:
 *
 *   registerExtension({
 *     id: 'warnings',                 // unique, used in error messages
 *     install(sim) {},                // once, after boot
 *     buildWorld(sim, group) {},      // every world (re)build; add objects to `group`,
 *                                     //   which is disposed with the world
 *     startMode(sim, mode, opts) {},  // a flight or a drive has just started
 *     stop(sim, why) {},              // back to the menu, or back to the runway
 *     update(sim, dt) {},             // every frame the game is running
 *     camera(sim, dt, camera) {},     // return true to own the camera this frame
 *     key(sim, code, down, e) {},     // raw keys while flying; return true to
 *                                     //   consume them so the aeroplane never sees them
 *     devActions: [{ label, hint, run(sim) }],   // buttons in the Dev mode panel
 *   });
 *
 * Every field is optional except `id`.
 */

const EXTENSIONS = [];
const broken = new Set();
let layerEl = null;

export function registerExtension(ext) {
  if (!ext || !ext.id) throw new Error('registerExtension: an extension needs an id');
  if (EXTENSIONS.some((e) => e.id === ext.id)) {
    console.warn(`[ext] ${ext.id} registered twice; keeping the first`);
    return;
  }
  EXTENSIONS.push(ext);
}

export function extensions() {
  return EXTENSIONS.filter((e) => !broken.has(e.id));
}

/** Call one hook on every live extension, fencing each off from the others. */
function each(hook, fn) {
  for (const e of EXTENSIONS) {
    if (broken.has(e.id) || typeof e[hook] !== 'function') continue;
    try {
      const out = fn(e);
      if (out === true) return true;
    } catch (err) {
      broken.add(e.id);
      console.error(`[ext] "${e.id}" threw in ${hook}() and has been switched off for this session:`, err);
    }
  }
  return false;
}

/**
 * A layer over the canvas for a feature's own on-screen bits — a warning
 * banner, a "press F to get out" prompt. Created on first ask; pointer events
 * off by default so it never swallows a click meant for the game.
 */
export function extLayer() {
  if (layerEl) return layerEl;
  layerEl = document.createElement('div');
  layerEl.id = 'ext-layer';
  Object.assign(layerEl.style, {
    position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: '30',
  });
  document.body.appendChild(layerEl);
  return layerEl;
}

export function extInstall(sim) {
  each('install', (e) => e.install(sim));
  /*
   * One key listener for all of them, in the CAPTURE phase so it runs before
   * the game's own input. That is what lets a feature take the keys over —
   * walking about on foot uses W, A, S and D, and the parked aeroplane must
   * not taxi off because you walked forwards.
   */
  const onKey = (down) => (ev) => {
    if (!sim || sim.state !== 'flying') return;
    const t = ev.target;
    if (t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return;
    const consumed = each('key', (e) => e.key(sim, ev.code, down, ev));
    if (consumed) {
      ev.preventDefault();
      ev.stopImmediatePropagation();
    }
  };
  window.addEventListener('keydown', onKey(true), true);
  window.addEventListener('keyup', onKey(false), true);
}

/** Returns the groups the features built, for the world to dispose later. */
export function extBuildWorld(sim, THREE) {
  const groups = [];
  each('buildWorld', (e) => {
    const g = new THREE.Group();
    g.name = `ext:${e.id}`;
    sim.scene.add(g);
    groups.push(g);
    e.buildWorld(sim, g);
  });
  return groups;
}

export function extStartMode(sim, mode, opts) {
  each('startMode', (e) => e.startMode(sim, mode, opts || {}));
}

export function extStop(sim, why) {
  each('stop', (e) => e.stop(sim, why));
}

export function extUpdate(sim, dt) {
  each('update', (e) => e.update(sim, dt));
}

/** True if a feature placed the camera itself this frame. */
export function extCamera(sim, dt) {
  return each('camera', (e) => e.camera(sim, dt, sim.camera));
}

/** Every Dev-mode action any feature offers, for the settings panel. */
export function extDevActions() {
  const out = [];
  for (const e of extensions()) {
    for (const a of e.devActions || []) out.push({ ...a, ext: e.id });
  }
  return out;
}

/** For the tests and the console: who is loaded and who has been switched off. */
export function extStatus() {
  return EXTENSIONS.map((e) => ({ id: e.id, live: !broken.has(e.id) }));
}
