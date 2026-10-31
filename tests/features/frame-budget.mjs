/**
 * THE FRAME BUDGET (ui/frame-budget.js), from the repo root:
 *   node tests/features/frame-budget.mjs
 *
 *   - the rates: the HUD's numbers at 10-20 Hz, the minimap at 20 Hz or
 *     under, and RateGate's arithmetic (every frame when not live, never a
 *     burst after a long frame);
 *   - a static scan of the per-frame paths: no element lookup and no layout
 *     read on a path the frame runs every time — the race's quiet(), the
 *     fps counter, the minimap's rate, the autopilot chip's writes, the
 *     right-hand stack's observer and the lanes' observer, the carrier
 *     deck's far gate; and the frame loop marks a live frame.
 * Every check here fails on v75.8.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const src = (p) => readFileSync(resolve(ROOT, p), 'utf8');
let passed = 0, failed = 0;
const ok = (name, pass, detail = '') => { if (pass) passed++; else failed++; console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ` -- ${detail}` : ''}`); };

const FB = await import(new URL('../../src/ui/frame-budget.js', import.meta.url).href);

ok('frame budget: the HUD\'s numbers are written at 10-20 Hz', FB.HUD_TEXT_HZ >= 10 && FB.HUD_TEXT_HZ <= 20, String(FB.HUD_TEXT_HZ));
ok('frame budget: the minimap is drawn at 20 Hz or under, and no slower than 10', FB.MINIMAP_HZ >= 10 && FB.MINIMAP_HZ <= 20, String(FB.MINIMAP_HZ));
ok('frame budget: the lanes and the stack have a slow fallback of a second or more', FB.LANE_FALLBACK_S >= 1 && FB.STACK_FALLBACK_S >= 1);

{
  const g = new FB.RateGate(20);
  let n = 0;
  for (let i = 0; i < 60; i++) if (g.due(1 / 60, true)) n++;
  ok('frame budget: RateGate(20) says yes 20 times in 60 frames at 60 Hz', n >= 19 && n <= 21, String(n));
  const g2 = new FB.RateGate(20);
  n = 0;
  for (let i = 0; i < 60; i++) if (g2.due(1 / 60, false)) n++;
  ok('frame budget: ...and on every frame that is not live (a driven check)', n === 60, String(n));
  const g3 = new FB.RateGate(20);
  g3.due(1, true);
  const burst = [g3.due(1 / 60, true), g3.due(1 / 60, true)];
  ok('frame budget: a long frame counts as one update, not a burst', burst[0] === false && burst[1] === false, JSON.stringify(burst));
  const g4 = new FB.RateGate(20);
  g4.due(1 / 60, true);
  g4.poke();
  ok('frame budget: poke() makes the next frame due', g4.due(0, true) === true);
}

/* ---- the per-frame paths, statically ---- */
const main = src('src/main.js');
const hud = src('src/ui/hud.js');
const stack = src('src/ui/hud-stack.js');
const minimap = src('src/ui/minimap.js');
const race = src('src/features/race.js');
const menus = src('src/ui/menus.js');
const carrier = src('src/features/carrier-ops.js');

/** The body of a method or function named `name` in `code` (first match), by brace matching. */
function body(code, name) {
  const re = new RegExp(`(?:^|\\n)\\s*(?:async\\s+)?(?:function\\s+)?${name}\\s*\\([^)]*\\)\\s*\\{`);
  const m = re.exec(code);
  if (!m) return null;
  let i = m.index + m[0].length;
  let depth = 1;
  for (; i < code.length && depth > 0; i++) {
    const ch = code[i];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
  }
  return code.slice(m.index, i);
}
const LOOKUP = /\b(querySelector|querySelectorAll|getElementById|getElementsByClassName|closest)\s*\(/;
const LAYOUT = /\b(getBoundingClientRect|getClientRects|offsetWidth|offsetHeight|offsetTop|clientWidth|clientHeight|getComputedStyle|scrollHeight)\b/;

ok('frame budget: behind a menu, the pause card or the debrief the island is drawn at MENU_RENDER_HZ (30), every frame in a flight', FB.MENU_RENDER_HZ === 30 && /coveredFrameSkipped\(dt\)/.test(body(main, 'loop')) && /1 \/ MENU_RENDER_HZ/.test(body(main, 'coveredFrameSkipped')) && /this\.state !== 'flying'/.test(body(main, 'coveredFrameSkipped')));
const loop = body(main, 'loop');
ok('frame budget: the frame loop marks a live frame for the HUD\'s rate gate', !!loop && /_liveFrame = true/.test(loop) && /_liveFrame = false/.test(loop));
ok('frame budget: Game.update looks nothing up and reads no layout', (() => { const b = body(main, 'update'); return !!b && !LOOKUP.test(b) && !LAYOUT.test(b); })());

const hudUpdate = body(hud, 'update');
ok('frame budget: Hud.update looks nothing up and reads no layout, and gates the numbers at HUD_TEXT_HZ', !!hudUpdate && !LOOKUP.test(hudUpdate) && !LAYOUT.test(hudUpdate) && /RateGate\(HUD_TEXT_HZ\)/.test(hudUpdate) && /_liveFrame/.test(hudUpdate));
const overlays = body(hud, 'updateOverlays');
ok('frame budget: Hud.updateOverlays measures the lanes only when the tree changed (or on the fallback clock)', !!overlays && /_laneDirty/.test(overlays) && /LANE_FALLBACK_S/.test(overlays) && !LOOKUP.test(overlays) && !LAYOUT.test(overlays));
ok('frame budget: the lanes watch the tree with a MutationObserver and keep their node lists', /watchLanes\(\)\s*\{[\s\S]*MutationObserver/.test(hud) && /laneNodes\(\)/.test(hud) && !/document\.querySelectorAll\(LANE\)/.test(hud));
const keyHint = body(hud, 'syncKeyHint');
ok('frame budget: syncKeyHint finds its <kbd>s only when the line changed', !!keyHint && /_keyHintKbds/.test(keyHint));
const setAp = body(hud, 'setAutopilot');
ok('frame budget: setAutopilot writes the chip only when its word changed', !!setAp && /_apText/.test(setAp));
const bugs = body(hud, 'setAutopilotBugs');
ok('frame budget: ...and the HDG / SPD / VS bugs likewise', !!bugs && /_apBugText/.test(bugs));

const tick = body(stack, 'tick');
ok('frame budget: the right-hand stack refreshes when dirty or on its fallback clock, not every quarter second', !!tick && /fallbackT/.test(tick) && /STACK_FALLBACK_S/.test(tick) && /if \(!this\.dirty && !fallback\) return;/.test(tick));
ok('frame budget: ...with each card\'s size from the ResizeObserver (noteSizes), the layout asked only on the fallback pass', /noteSizes\(entries\)/.test(stack) && /shown\(c, exact = false\)/.test(stack) && /if \(!exact && c\.roSeen\) return c\.roOn;/.test(stack));
ok('frame budget: the stack asks matchMedia once, not four times a second', /let REDUCED = null;/.test(stack) && !/function live\(\)[\s\S]{0,400}matchMedia\(/.test(stack));

const mmUpdate = body(minimap, 'update');
ok('frame budget: the minimap draws at MINIMAP_HZ, not 31 Hz', !!mmUpdate && /1 \/ MINIMAP_HZ/.test(mmUpdate) && !/1 \/ 31/.test(mmUpdate));

const quiet = body(race, 'quiet');
ok('frame budget: the race\'s quiet() (every frame) finds #ui once', !!quiet && /G\.ui/.test(quiet) && !/^[\s\S]*const ui = document\.getElementById\('ui'\);/.test(quiet));
const fps = body(menus, 'updateFps');
ok('frame budget: the fps counter keeps its element and writes only a new number', !!fps && /_fpsEl/.test(fps) && /isConnected/.test(fps));

const carrierUpdate = body(carrier, 'update');
ok('frame budget: the carrier deck is dressed four times a second from far away, every frame near the ship', !!carrierUpdate && /FAR_M/.test(carrierUpdate) && /drawAcc/.test(carrierUpdate) && /const FAR_M = \d+/.test(carrier));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
