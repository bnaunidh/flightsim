/**
 * The H card (owner, 2026-11-05: "make controls less hard to comprehend"): each vehicle opens on its few keys in plain
 * words, the full list folded under "All keys". `check(sim, r, say)` — r.ok(name, pass, detail) per assertion.
 */
export const id = 'controls-card';

export async function check(sim, r) {
  const INP = await import('../../src/flight/input.js');
  const hud = sim.hud;
  const card = hud.controlsCard;
  for (const [ctx, title, max] of [['plane', 'Flying a plane', 13], ['heli', 'Flying a helicopter', 9], ['boat', 'Driving a boat', 7], ['car', 'Driving', 7]]) {
    hud.showControls(sim.input.bindings, INP.keyLabel, INP.actionsFor(ctx));
    const head = card.querySelector('.cc-head').textContent;
    const rows = [...card.querySelectorAll('.cc-basics .cc-row')];
    r.ok(`controls card ${ctx}: says what you are in`, head === title, head);
    r.ok(`controls card ${ctx}: a short list, every line with a key`, rows.length >= 4 && rows.length <= max && rows.every((x) => x.querySelector('kbd')), `${rows.length} rows`);
    const more = card.querySelector('details.cc-more');
    r.ok(`controls card ${ctx}: the rest is folded away, not gone`, !!more && !more.open && more.querySelectorAll('.cc-row').length > rows.length);
    r.ok(`controls card ${ctx}: no jargon up front`, !/cyclic|collective|pitch|roll\b|yaw/i.test(card.querySelector('.cc-basics').textContent));
    hud.hideControls();
  }
  hud.showControls(sim.input.bindings, INP.keyLabel, INP.actionsFor('foot'));
  r.ok('controls card on foot: no basics, the plain list', !card.querySelector('.cc-basics') && card.querySelectorAll('.cc-row').length > 0);
  hud.hideControls();
  // The owner, 2026-10-17: "no hijacking": no card on the mission list.
  sim.menus.syncMissionLocks && sim.menus.syncMissionLocks();
  const screen = sim.menus.screens.missions;
  for (const id of ['event-hijack', 'event-hijack-real']) {
    const c = screen && screen.querySelector(`[data-mission="${id}"]`);
    r.ok(`no card for ${id} without the Dev code`, !c || c.style.display === 'none');
  }
}
