/**
 * Photo mode hides everything laid over the picture (owner, 2026-11-11: "in photo view these remain",
 * "remove crosshair"): the HUD's own panels AND the features' widgets — the smoke-trail chip, the
 * missile panel, seeker and lock, the gunsight crosshair and its buttons, the F-35B's HOVER chip, the
 * ATC button (styles/main.css html.hud-photo). Checked in an armed F-35B, from the seat and the chase.
 * `check(sim, r)`, as tests/features/index.js expects.
 */
export async function check(sim, r) {
  const SEL = ['.fun-chip', '.hsk-panel', '.hsk-seeker', '.hsk-lock', '.gsk-root', '.stovl-btn', '.ps-atc-btn', '#ui .minimap'];
  const shown = () => SEL.filter((s) => [...document.querySelectorAll(s)].some((el) => {
    for (let p = el; p && p !== document.documentElement; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (cs.display === 'none' || cs.visibility === 'hidden' || p.hidden) return false;
    }
    const b = el.getBoundingClientRect();
    return b.width > 0 && b.height > 0;
  }));
  try {
    await sim.startMode('free', { aircraft: 'f35b', time: 'day', condition: 'clear' });
    sim.step(1);
    for (const view of ['cockpit', 'chase']) {
      sim.rig.setMode(view);
      for (let i = 0; i < 10; i++) sim.update(1 / 30);
      sim.hud.setDensity('photo');
      for (let i = 0; i < 4; i++) sim.update(1 / 30);
      const left = shown();
      r.ok(`photo-mode (${view}): nothing of the HUD's or the features' widgets left over the picture`, left.length === 0, left.join(', ') || 'clean');
      sim.hud.setDensity('clean');
      for (let i = 0; i < 4; i++) sim.update(1 / 30);
    }
    r.ok('photo-mode: back out of it, the HUD is back', !document.documentElement.classList.contains('hud-photo'));
  } catch (e) {
    r.ok('photo-mode: the checks ran', false, String((e && e.stack) || e).slice(0, 300));
  }
}
