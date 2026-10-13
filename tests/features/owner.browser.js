/**
 * Browser checks for the owner's fan on the main page (../../src/features/owner.js).
 *
 * In the page, with the game's own menus, and leaving nothing behind (no
 * pass, no tries, no box):
 *
 *   - the fan is in the main menu's brand mark, can be focused, and nothing
 *     else is there before it is pressed: no box, no chip, no counter;
 *   - nine presses open nothing; ten inside the window open the box — by
 *     mouse, by touch, and by Enter on the focused fan; a right-click is no
 *     press; ten spread over more than the window open nothing;
 *   - the box is a password box with the cursor in it; a wrong code is told
 *     "Not that one" and nobody is the owner; Escape shuts it, and once shut
 *     it is out of the page;
 *   - the chip's minutes: rounded up, so it never says 0 while it is on.
 *
 * Every import is dynamic and wrapped: a static import of a name that is
 * missing takes down the page, not the test.
 */

export const id = 'owner';

export async function check(sim, r, say) {
  say && say('owner: the fan on the main page');
  let F;
  let O;
  try {
    F = await import('../../src/features/owner.js');
    O = await import('../../src/features/multiplayer/owner.js');
  } catch (err) {
    r.ok('owner: the modules load', false, String(err));
    return;
  }
  const feat = F.ownerFeature;
  const menus = sim && sim.menus;
  const fan = menus && menus.screens && menus.screens.main && menus.screens.main.querySelector('[data-fan]');
  r.ok('owner: the fan is in the main menu’s brand mark, can be focused, and is wired', !!fan && fan.tabIndex === 0 && !!fan.closest('.brand') && fan._ownerWired === true && feat.installed);
  if (!fan) return;
  const hadPass = O.owner.active;
  r.ok('owner: before any press there is no box and no chip in the page, and the menus keep their usual room',
    !document.querySelector('[data-owner-box]') && (hadPass || (!document.querySelector('[data-owner-chip]') && !document.documentElement.hasAttribute('data-owner-on'))));

  const box = () => document.querySelector('[data-owner-box]');
  const reset = () => {
    feat.closeBox();
    feat.taps = [];
  };
  const press = (n, kind) => {
    for (let i = 0; i < n; i++) {
      if (kind === 'key') fan.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
      else fan.dispatchEvent(new PointerEvent('pointerdown', { pointerType: kind === 'right' ? 'mouse' : kind, button: kind === 'right' ? 2 : 0, bubbles: true, cancelable: true }));
    }
  };
  /*
   * One press somewhere else first, as a player's first press anywhere: it
   * starts the game's sound, which can hold the page for seconds on a busy
   * machine — and these presses are synthetic, so they carry the time they
   * were handled, not when they "happened" (a real press carries its own).
   */
  document.body.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'mouse', button: 0, bubbles: true }));
  await new Promise((res) => setTimeout(res, 50));
  reset();
  const out = {};
  for (const kind of ['mouse', 'touch', 'pen', 'key']) {
    press(9, kind);
    const nine = !!box();
    press(1, kind);
    out[kind] = { nine, ten: !!box() };
    reset();
  }
  r.ok('owner: nine presses open nothing, ten open the box — mouse, touch, pen and Enter on the fan',
    Object.values(out).every((o) => !o.nine && o.ten), JSON.stringify(out));
  press(12, 'right');
  const right = !!box();
  reset();
  /*
   * Ten spread over MORE than the window: nine gaps that put the first and
   * the tenth 1.2 windows apart — clearly outside it, never on its edge. (An
   * earlier version put them exactly one window apart, and passed or failed
   * on the floating-point rounding of performance.now(): v50's full self-test
   * caught it failing.) Then ten quick ones, a twentieth of the window apart,
   * open the box: the slow ones were forgotten, not held against them.
   */
  const t0 = performance.now();
  let slow = false;
  for (let i = 0; i < 12; i++) slow = feat.tap(t0 + i * ((F.TAP_WINDOW_MS * 1.2) / 9)) || slow;
  const spread = !!box();
  reset();
  const t1 = performance.now();
  let quick = false;
  for (let i = 0; i < 10; i++) quick = feat.tap(t1 + i * (F.TAP_WINDOW_MS / 20)) || quick;
  const quickBox = !!box();
  reset();
  r.ok('owner: a right-click is no press, and ten spread over more than the window open nothing', !right && !slow && !spread,
    JSON.stringify({ right, slow, spread }));
  r.ok('owner: ten quick presses, a quarter of a second apart, open the box', quick && quickBox, JSON.stringify({ quick, quickBox }));

  // The box: a password box, the cursor in it; a wrong code is "Not that one"; Escape shuts it and takes it out of the page.
  press(10, 'mouse');
  await new Promise((res) => setTimeout(res, 30));
  const b = box();
  const input = b && b.querySelector('[data-owner-code]');
  const focused = !!input && document.activeElement === input;
  O.clearTries();
  let msg = null;
  if (input) {
    input.value = 'certainly not the code';
    b.dispatchEvent(new Event('submit', { cancelable: true }));
    msg = b.querySelector('[data-owner-msg]').textContent;
  }
  const wrong = { type: input && input.type, focused, msg, emptied: !!input && input.value === '', owner: O.owner.active };
  /*
   * The box is a text field, and the game's keys are a registry
   * (flight/input.js): a key typed into it must reach no game action — the
   * registry leaves typing alone — and is no press of the fan. Space, which
   * is a game key (brakes), typed in the box: not held; on the page: held.
   */
  let typed = null;
  if (input) {
    const keys = sim && sim.input && sim.input.keys;
    const kb = (el, type) => el.dispatchEvent(new KeyboardEvent(type, { code: 'Space', key: ' ', bubbles: true, cancelable: true }));
    kb(input, 'keydown');
    const inBox = keys ? keys.has('Space') : null;
    kb(input, 'keyup');
    kb(document.body, 'keydown');
    const onPage = keys ? keys.has('Space') : null;
    kb(document.body, 'keyup');
    typed = { inBox, onPage, taps: feat.taps.length, boxOpen: !!box() };
  }
  r.ok('owner: a key typed into the code box reaches no game key (the registry leaves a text field alone) and is no press of the fan',
    !!typed && typed.inBox === false && typed.onPage === true && typed.taps === 0 && typed.boxOpen, JSON.stringify(typed));
  if (input) input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  r.ok('owner: the box is a password box with the cursor in it; a wrong code is “Not that one” and nobody is the owner; Escape shuts it',
    wrong.type === 'password' && wrong.msg === 'Not that one' && wrong.emptied && wrong.owner === hadPass && !box() && !document.querySelector('[data-owner-code]'),
    JSON.stringify(wrong));
  O.clearTries();
  reset();

  r.ok('owner: the chip’s minutes round up — 60 at the start, 1 in the last minute, never 0',
    F.minutesLeft(O.OWNER_MS) === 60 && F.minutesLeft(O.OWNER_MS - 1000) === 60 && F.minutesLeft(61000) === 2 && F.minutesLeft(1) === 1 && F.minutesLeft(0) === 1);
}
