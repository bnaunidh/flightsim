/**
 * Browser check for the control zones (src/features/livemap/airspace.js):
 *
 *   node .claude/devtools/briefs/one-check.mjs <url> ./tests/features/airspace.browser.js check "" 1
 *
 *   - on Kestrel, starting inside the field's zone says nothing
 *   - flying out of it: LEAVING AIRSPACE, and "frequency change approved"
 *   - flying into Mango Strip's: ENTERING AIRSPACE / MANGO APPROACH · freq
 *     under the heading tape, your check-in as a note, the approach
 *     controller answering under a MANGO APPROACH subtitle
 *   - the radio card (Z) shows the frequency
 * Free Flight is put back afterwards.
 */

export const id = 'airspace';

export async function check(sim, r, say) {
  say && say('airspace: the control zones');
  const wasAutoPause = sim.autoPauseOnHide;
  sim.autoPauseOnHide = false;
  const run = (s) => {
    const n = Math.max(1, Math.round(s * 60));
    for (let i = 0; i < n; i++) sim.step(1 / 60);
  };
  const toasts = () => [...document.querySelectorAll('.hud-toast')].map((x) => x.textContent).join(' | ');
  const subtitle = () => {
    const s = document.querySelector('.hud-subtitle');
    return s ? s.textContent : '';
  };
  const said = [];
  const speak = sim.speak.bind(sim);
  sim.speak = (text, voice, u) => {
    said.push({ text, voice });
    return speak(text, voice, u);
  };
  try {
    await sim.startMode('free', { loadingScreen: false, airborne: true, aircraft: 'skylark' });
    if (sim.state === 'paused') sim.resume();
    run(1);
    const AS = sim.airspace;
    const P = sim.liveMap.places();
    const home = P.zones[0];
    const start = AS.current();
    const shown0 = sim.location.shown().length;
    run(2);
    r.ok(`airspace: starting inside ${home.name} says nothing`, start && start.id === home.id && sim.location.shown().length === shown0 && !said.some((s) => /radar contact/.test(s.text)),
      `in ${start && start.name}`);
    const ac = sim.aircraft;
    if (sim.atc) sim.atc.cool = 0;
    ac.pos.set(home.x - home.r * 2.5, Math.max(ac.pos.y, 600), home.z);
    // The tower may be mid-call: the answer waits its turn on the frequency.
    for (let i = 0; i < 20 && !said.some((s) => /frequency change approved/.test(s.text)); i++) run(0.5);
    const left = said.find((s) => /frequency change approved/.test(s.text));
    r.ok('airspace: flying out of it — LEAVING AIRSPACE, and "frequency change approved"', !!left && !AS.current() && sim.location.shown().some((s) => s.title === 'LEAVING AIRSPACE'),
      `${left ? left.text : 'nothing said'} · ${JSON.stringify(sim.location.shown().map((s) => s.title))}`);
    const mz = P.zones.find((z) => /MANGO/.test(z.name)) || P.zones[1];
    if (!mz) {
      r.ok('airspace: a second zone on this map', false, P.zones.map((z) => z.name).join(', '));
      return;
    }
    run(5);
    if (sim.atc) sim.atc.cool = 0;
    ac.pos.set(mz.x - mz.r * 0.6, Math.max(ac.pos.y, 600), mz.z);
    run(1.6);
    const banner = sim.location.shown().find((s) => s.title === 'ENTERING AIRSPACE');
    const note = toasts();
    const word = mz.name.split(' ')[0];
    const theirs = new RegExp(`${word.charAt(0)}${word.slice(1).toLowerCase()} Approach, radar contact`);
    for (let i = 0; i < 20 && !said.some((s) => theirs.test(s.text)); i++) run(0.5);
    const answer = said.find((s) => theirs.test(s.text));
    r.ok(`airspace: flying into ${mz.name}: ENTERING AIRSPACE / ${mz.name} · ${mz.freq}, your check-in, the controller's answer`,
      AS.current() && AS.current().id === mz.id && banner && banner.name === `${mz.name} · ${mz.freq}` && new RegExp(`You: "${word.charAt(0)}${word.slice(1).toLowerCase()} Approach, .*(level|through) [\\d,]+`).test(note)
        && !!answer && answer.voice === 'approach' && new RegExp(`${word.charAt(0)}${word.slice(1).toLowerCase()} Approach, radar contact`).test(answer.text),
      `${banner ? banner.name : 'no banner'} · "${(note.match(/You: "[^"]+"/) || [''])[0]}" · ${answer ? answer.text : 'no answer'} · subtitle "${subtitle().slice(0, 80)}"`);
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyZ', bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyZ', bubbles: true }));
    run(0.2);
    const fq = document.querySelector('.ps-radio .ps-freq');
    r.ok('airspace: the radio card shows the frequency you are on', !!fq && !fq.hidden && fq.textContent === `${mz.name} ${mz.freq}`, fq ? `"${fq.textContent}" hidden ${fq.hidden}` : 'no card');
    const close = document.querySelector('.ps-radio .ps-close');
    if (close) close.click();
  } catch (err) {
    r.ok('airspace: the check ran to the end', false, String((err && err.stack) || err).slice(0, 400));
  } finally {
    sim.speak = speak;
    sim.autoPauseOnHide = wasAutoPause;
  }
}
