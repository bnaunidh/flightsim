/**
 * The desktop ATC window (owner, 2026-11-11: "make a button for atc which makes a pop up you can
 * drag anywhere on screen and decrease ... only on desktop"). features/pilot-systems.js.
 *   - an ATC button on screen while flying (desktop), opening and closing the radio window;
 *   - the window floats, is dragged by its title, shrinks to it, and comes back where you left it;
 *   - touch keeps the old RADIO sheet card (no button, no floating window).
 * `check(sim, r)`, as tests/features/index.js expects.
 */
export async function check(sim, r) {
  try {
    await sim.startMode('free', { aircraft: 'b737', time: 'day', condition: 'clear' });
    sim.step(0.5);
    sim.rig.setMode('chase');
    for (let i = 0; i < 6; i++) sim.update(1 / 30);
    try { localStorage.removeItem('islandsim.atcPopup'); } catch (e) { void e; }
    const btn = document.querySelector('.ps-atc-btn');
    const touch = document.documentElement.classList.contains('is-touch-device') || matchMedia('(pointer: coarse)').matches;
    if (touch) {
      r.ok('atc-popup: on a touch device there is no desktop ATC button', !btn || getComputedStyle(btn).display === 'none');
      return;
    }
    r.ok('atc-popup: an ATC button is on screen while flying', !!btn && getComputedStyle(btn).display !== 'none');
    btn.click();
    sim.update(1 / 30);
    const win = document.querySelector('.ps-radio');
    r.ok('atc-popup: the button opens the radio as a floating window', win.classList.contains('is-shown') && win.classList.contains('is-float') && getComputedStyle(win).position === 'fixed');
    // Drag by the title (pointer events, as a mouse sends them).
    const head = win.querySelector('.ps-head');
    const h = head.getBoundingClientRect();
    const x0 = h.left + 40;
    const y0 = h.top + 8;
    const ev = (type, x, y) => head.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 7, button: 0, buttons: 1, clientX: x, clientY: y }));
    ev('pointerdown', x0, y0);
    ev('pointermove', x0 - 300, y0 + 200);
    ev('pointerup', x0 - 300, y0 + 200);
    const moved = win.getBoundingClientRect();
    r.ok('atc-popup: dragged by its title, it goes where it is dropped', Math.abs(moved.left - (h.left - 300)) < 3 && Math.abs(moved.top - (h.top + 200)) < 3, `${Math.round(moved.left)},${Math.round(moved.top)}`);
    const full = win.getBoundingClientRect().height;
    win.querySelector('.ps-mini').click();
    const small = win.getBoundingClientRect().height;
    r.ok('atc-popup: the – button shrinks it to its title bar', win.classList.contains('is-mini') && small < full * 0.6, `${Math.round(full)} -> ${Math.round(small)} px`);
    btn.click();
    sim.update(1 / 30);
    const closed = !win.classList.contains('is-shown');
    btn.click();
    sim.update(1 / 30);
    const again = win.getBoundingClientRect();
    r.ok('atc-popup: closed and opened again, it is where you left it, still shrunk', closed && Math.abs(again.left - moved.left) < 3 && Math.abs(again.top - moved.top) < 3 && win.classList.contains('is-mini'));
    win.querySelector('.ps-mini').click();
    btn.click();
  } catch (e) {
    r.ok('atc-popup: the checks ran', false, String((e && e.stack) || e).slice(0, 300));
  }
}
