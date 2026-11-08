/**
 * The instruments giving out deep in the Farlands, in the game
 * (features/far-glitch.js):
 *
 *   node .claude/devtools/briefs/one-check.mjs '<url>?mute=1' ./tests/features/far-glitch.browser.js check "" 1
 *
 * At Low, a Free Flight in a Skylark on the World Map, put down along a line
 * east through the ring:
 *   - before the quarter mark the panel is honest and the look untouched
 *   - at about 0.3 the compass wanders but the altimeter is still honest
 *   - at about 0.7 the numbers are wrong, a readout dashes now and then, the
 *     clock is wrong, the minimap is in static, the autopilot will not stay in
 *   - further out is wronger than nearer in
 *   - in the void: frozen, dashes, the map all noise
 *   - the physics never saw any of it; the aeroplane is where it says
 *   - no picked change faster than three a second (the module's tick and a
 *     watch on the style writes)
 *   - home again: honest, the hooks gone, nothing left on the elements
 *   - on another map: nothing, however far out the numbers
 *   - no console error
 * The map is left on Kestrel, as farlands.browser.js leaves it.
 */
export const id = 'far-glitch';

const wait = (ms) => new Promise((res) => setTimeout(res, ms));
const digits = (s) => Number(String(s).replace(/[^\d-]/g, ''));

export async function check(sim, r, say) {
  say && say('far-glitch: the instruments deep in the Farlands');
  const wp = sim.worldPreview;
  if (!wp) {
    r.ok('far-glitch: the World Map preview is installed', false, 'sim.worldPreview missing');
    return;
  }
  const before = { quality: sim.settings.quality };
  const errors = [];
  const oe = console.error;
  console.error = (...a) => {
    errors.push(a.map(String).join(' ').slice(0, 300));
    oe.apply(console, a);
  };
  sim.autoPauseOnHide = false;
  try {
    sim.settings.quality = 'low';
    let done = wp.whenBuilt();
    wp.choose('haven');
    await Promise.race([done, wait(180000)]);
    if (sim.qualityBuilt !== 'low') {
      done = wp.whenBuilt();
      sim.applyQualityNow('low');
      await Promise.race([done, wait(180000)]);
    }
    await sim.startMode('free', { loadingScreen: false, airborne: true, aircraft: 'skylark', time: 'day', condition: 'clear' });
    if (sim.state === 'paused') sim.resume();
    const F = await import('../../src/world/worldmap/farlands.js');
    const HR = await import('../../src/features/hud-readouts.js');
    const realClock = () => {
      const p = HR.clockParts(HR.__readouts.R.whole / 3600);
      return `${p.hm}:${String(p.s).padStart(2, '0')}`;
    };
    const shownClock = () => {
      const spans = hud.wrap.querySelectorAll('.fc-time > span');
      return spans.length ? `${spans[0].textContent}${spans[1].textContent}` : '';
    };
    // The ring arrives on its own promise; the glitch module after it.
    let G = null;
    for (let i = 0; i < 100 && !G; i++) {
      try {
        G = await import('../../src/features/far-glitch.js');
      } catch (e) {
        await wait(100);
      }
    }
    r.ok('far-glitch: the module came with the ring', !!wp.farlands() && !!G && typeof G.__farGlitch === 'object', G ? '' : 'no module');
    if (!G) return;
    const { glitchIntensity, START_D, K: KK } = G;
    const stats = () => G.__farGlitch.stats();
    const { SEA_HALF: SH, EDGE_D } = F;
    const ac = sim.aircraft;
    const hud = sim.hud;
    const put = (x, y, z, hdg = 90) => {
      ac.crashed = false;
      const rad = (hdg * Math.PI) / 180;
      ac.pos.set(x, y, z);
      ac.vel.set(Math.sin(rad) * 62, 0, -Math.cos(rad) * 62);
      ac.setAttitude ? ac.setAttitude(hdg, 0, 0) : ac.quat.setFromAxisAngle({ x: 0, y: 1, z: 0 }, -rad);
      ac.omega.set(0, 0, 0);
      ac.engineOn = true;
      ac.controls.throttle = 0.8;
      if (sim.input) sim.input.throttleTarget = 0.8;
      sim.state = 'flying';
    };
    const hold = (x, y, z, s, hdg = 90, each = null) => {
      for (let i = 0; i < Math.round(s * 60); i++) {
        put(x, y, z, hdg);
        sim.step(1 / 60);
        if (Math.hypot(sim.camera.position.x - x, sim.camera.position.z - z) > 400) {
          sim.camera.position.set(x, y + 4, z + 14);
          if (sim.rig.chasePos) sim.rig.chasePos.copy(ac.pos);
          sim.step(1 / 60);
        }
        if (each) each(i);
      }
    };
    /** The D where the curve reads k (bisection). */
    const dFor = (k) => {
      let lo = START_D;
      let hi = EDGE_D;
      for (let i = 0; i < 50; i++) {
        const mid = (lo + hi) / 2;
        if (glitchIntensity(mid) < k) lo = mid;
        else hi = mid;
      }
      return (lo + hi) / 2;
    };
    const realIas = () => Math.round(ac.ias * 1.94384);
    const realAlt = () => Math.round((ac.alt * 3.28084) / 10) * 10;
    const realHdg = () => Math.round(ac.heading) % 360;
    const shownIas = () => digits(hud.speedValue.textContent);
    const shownAlt = () => digits(hud.altValue.textContent);
    const shownHdg = () => digits(hud.hdgValue.textContent);
    const overlay = () => sim.minimap.el.querySelector('.fg-static');
    const wrapOn = () => hud.wrap.classList.contains('is-farglitch');
    // The ring's peaks reach PEAK_MAX (12 km): every hold out there is above them, or the aeroplane is in the ground.
    const y = F.PEAK_MAX + 600;

    /* ---- before the quarter mark: honest ---- */
    hold(SH + START_D - 8000, y, 0, 4);
    r.ok('far-glitch: before the quarter mark the intensity is 0', stats().k === 0 && stats().target === 0, `k ${stats().k}`);
    r.ok('far-glitch: and the panel is honest', Math.abs(shownIas() - realIas()) <= 1 && Math.abs(shownAlt() - realAlt()) <= 10 && Math.abs(((shownHdg() - realHdg() + 540) % 360) - 180) <= 1, `${shownIas()}/${realIas()} kt, ${shownAlt()}/${realAlt()} ft, ${shownHdg()}/${realHdg()}°`);
    r.ok('far-glitch: nothing on the elements', !wrapOn() && !Object.prototype.hasOwnProperty.call(hud, 'update') && !(overlay() && Number(overlay().style.opacity) > 0), `class ${wrapOn()}`);

    /* ---- about 0.3: the compass wanders, the altimeter does not ---- */
    {
      const x = SH + dFor(0.3);
      let hdgOff = 0;
      let altOff = 0;
      hold(x, y, 0, 2);
      hold(x, y, 0, 4, 90, () => {
        hdgOff = Math.max(hdgOff, Math.abs(((shownHdg() - realHdg() + 540) % 360) - 180));
        altOff = Math.max(altOff, Math.abs(shownAlt() - realAlt()));
      });
      const s = stats();
      r.ok('far-glitch: at 0.3 the intensity reads about 0.3', Math.abs(s.k - 0.3) < 0.03 && s.on, `k ${s.k.toFixed(3)}`);
      r.ok('far-glitch: at 0.3 the compass wanders', hdgOff >= 2 && hdgOff <= 20, `${hdgOff.toFixed(1)}° off at most`);
      r.ok('far-glitch: at 0.3 the altimeter is still honest, the dashes not yet', altOff <= 20 && s.dash === 0, `${altOff} ft off at most`);
      r.ok('far-glitch: the look is on, lightly', wrapOn() && sim.minimap.el.classList.contains('is-farglitch') && Number(overlay().style.opacity) < 0.1, `overlay ${overlay() && overlay().style.opacity}`);
      r.ok('far-glitch: the HUD and the cockpit are hooked, nothing else', Object.prototype.hasOwnProperty.call(hud, 'update') && (!sim.cockpit || typeof sim.cockpit.userData._fgOwn === 'function'));
    }

    /* ---- about 0.7: wrong numbers, dashes, the clock, the map, the autopilot ---- */
    let score7 = 0;
    {
      const x = SH + dFor(0.7);
      hold(x, y, 0, 3);
      let altOff = 0;
      let iasOff = 0;
      let dashes = 0;
      let frames = 0;
      let sum = 0;
      const t0 = stats().ticks;
      const s0 = stats().t;
      // Frames on which a style changed: a flash needs a change, and a change is a frame, not a property.
      const styleWrites = { wrap: 0, overlay: 0 };
      let lastWrap = hud.wrap.getAttribute('style');
      let lastOv = overlay().getAttribute('style');
      hold(x, y, 0, 6, 90, () => {
        frames++;
        const w = hud.wrap.getAttribute('style');
        const o = overlay().getAttribute('style');
        if (w !== lastWrap) styleWrites.wrap++;
        if (o !== lastOv) styleWrites.overlay++;
        lastWrap = w;
        lastOv = o;
        const da = Math.abs(shownAlt() - realAlt());
        const di = Math.abs(shownIas() - realIas());
        if (/---/.test(hud.speedValue.textContent + hud.altValue.textContent + hud.vsValue.textContent + hud.hdgValue.textContent)) dashes++;
        else {
          altOff = Math.max(altOff, da);
          iasOff = Math.max(iasOff, di);
          sum += da / 10 + di;
        }
      });
      const ticks = stats().ticks - t0;
      const secs = stats().t - s0;
      score7 = sum / Math.max(1, frames);
      const s = stats();
      r.ok('far-glitch: at 0.7 the intensity reads about 0.7', Math.abs(s.k - 0.7) < 0.03, `k ${s.k.toFixed(3)}`);
      r.ok('far-glitch: at 0.7 the altimeter and the airspeed read wrong', altOff > 100 && iasOff > 5, `${altOff} ft, ${iasOff} kt off at most`);
      r.ok('far-glitch: at 0.7 a readout dashes now and then, not all the time', dashes > 0 && dashes < frames * 0.7, `${dashes} of ${frames} frames`);
      r.ok('far-glitch: at 0.7 the clock is wrong', shownClock() !== realClock(), `${shownClock()} v ${realClock()}`);
      r.ok('far-glitch: at 0.7 the minimap is in static', Number(overlay().style.opacity) > 0.25 && Number(overlay().style.opacity) < 0.9, `opacity ${overlay().style.opacity}`);
      r.ok('far-glitch: the ticks come under three a second', ticks <= secs * 3 + 1 && ticks >= secs * 2 - 1, `${ticks} ticks in ${secs.toFixed(1)} s`);
      r.ok('far-glitch: the style writes come under three a second (no flashing)', styleWrites.wrap <= secs * 3 + 1 && styleWrites.overlay <= secs * 3 + 1, `${styleWrites.wrap} frames on the HUD, ${styleWrites.overlay} on the map, in ${secs.toFixed(1)} s`);
      // The physics saw none of it.
      r.ok('far-glitch: the aeroplane itself is untouched', !s.swapped && Math.abs(ac.alt - ac.pos.y) < 1e-6 && Math.abs(ac.pos.x - x) < 5, `swapped ${s.swapped}, alt ${ac.alt.toFixed(1)} v y ${ac.pos.y.toFixed(1)}`);
      // The autopilot: in, and out again with a caution.
      const toasts0 = hud.wrap.querySelectorAll('.hud-toast').length;
      sim.toggleAutopilot(true);
      const wasIn = sim.autopilot.engaged;
      let outAt = -1;
      hold(x, y, 0, 10, 90, (i) => {
        if (outAt < 0 && !sim.autopilot.engaged) outAt = i / 60;
      });
      const toastText = [...hud.wrap.querySelectorAll('.hud-toast')].map((t) => t.textContent).join(' | ');
      r.ok('far-glitch: the autopilot goes in, then drops out within a few seconds, with a caution', wasIn && outAt > 0.5 && outAt < 9 && /cannot be trusted/.test(toastText), `in ${wasIn}, out at ${outAt.toFixed(1)} s, ${hud.wrap.querySelectorAll('.hud-toast').length - toasts0} toasts: ${toastText.slice(0, 160)}`);
      if (sim.autopilot.engaged) sim.toggleAutopilot(false);
      // The radio.
      hud.setSubtitle('Skylark two one, cleared to land runway zero nine, wind calm', 'Tower', 4);
      const sub = hud.subtitleText.textContent;
      r.ok('far-glitch: at 0.7 the radio garbles', sub !== 'Skylark two one, cleared to land runway zero nine, wind calm' && sub.length === 60, sub);
    }

    /* ---- further out is wronger ---- */
    {
      const x = SH + dFor(0.92);
      hold(x, y, 0, 3);
      let frames = 0;
      let sum = 0;
      let spin = 0;
      hold(x, y, 0, 6, 90, () => {
        frames++;
        if (!/---/.test(hud.speedValue.textContent + hud.altValue.textContent)) sum += Math.abs(shownAlt() - realAlt()) / 10 + Math.abs(shownIas() - realIas());
        if (!/---/.test(hud.hdgValue.textContent)) spin = Math.max(spin, Math.abs(((shownHdg() - realHdg() + 540) % 360) - 180));
      });
      const score9 = sum / Math.max(1, frames);
      r.ok('far-glitch: at 0.9 the numbers are wronger than at 0.7', score9 > score7 * 1.3, `${score9.toFixed(1)} v ${score7.toFixed(1)}`);
      r.ok('far-glitch: at 0.9 the compass has turned well away', spin > 20, `${spin.toFixed(0)}° off at most`);
    }

    /* ---- the void: frozen ---- */
    {
      hold(SH + EDGE_D + 15000, y, 0, 6);
      const s = stats();
      r.ok('far-glitch: in the void the intensity is 1 and the panel frozen', s.k === 1 && s.frozen, `k ${s.k}, frozen ${s.frozen}`);
      r.ok('far-glitch: in the void the readouts are dashes', hud.speedValue.textContent === '---' && hud.altValue.textContent === '----' && hud.vsValue.textContent === '---', `${hud.speedValue.textContent} ${hud.altValue.textContent} ${hud.vsValue.textContent}`);
      r.ok('far-glitch: in the void the map is all static, the clock gone, seconds too', Number(overlay().style.opacity) >= 0.9 && shownClock() === '--:--', `opacity ${overlay().style.opacity}, ${shownClock()}`);
      const h0 = hud.hdgValue.textContent;
      hold(SH + EDGE_D + 15000, y, 0, 2, 180);
      r.ok('far-glitch: in the void the compass is stuck', hud.hdgValue.textContent === h0, `${h0} then ${hud.hdgValue.textContent}`);
      r.ok('far-glitch: still flying, the game never took the aeroplane', sim.state === 'flying' && !ac.crashed, sim.state);
    }

    /* ---- back in to 0.3: the spin it picked up unwinds, the compass comes round ---- */
    {
      const x = SH + dFor(0.3);
      hold(x, y, 0, 14);
      let off = 0;
      hold(x, y, 0, 2, 90, () => {
        if (!/---/.test(hud.hdgValue.textContent)) off = Math.max(off, Math.abs(((shownHdg() - realHdg() + 540) % 360) - 180));
      });
      r.ok('far-glitch: back at 0.3 from the void, the compass has come round to a wander', stats().spin === 0 && off <= 20 && !stats().frozen, `spin ${stats().spin.toFixed(1)}, ${off.toFixed(1)}° off at most`);
    }

    /* ---- home: honest again, nothing left behind ---- */
    {
      hold(0, 3000, 0, 5);
      const s = stats();
      r.ok('far-glitch: home, the intensity eases back to 0', s.k === 0 && !s.on, `k ${s.k}`);
      r.ok('far-glitch: home, the panel is honest again', Math.abs(shownIas() - realIas()) <= 1 && Math.abs(shownAlt() - realAlt()) <= 10 && Math.abs(((shownHdg() - realHdg() + 540) % 360) - 180) <= 1, `${shownIas()}/${realIas()} kt, ${shownAlt()}/${realAlt()} ft, ${shownHdg()}/${realHdg()}°`);
      r.ok('far-glitch: home, the clock is right again', shownClock() === realClock(), `${shownClock()} v ${realClock()}`);
      r.ok('far-glitch: home, the hooks are gone and the look is off', !Object.prototype.hasOwnProperty.call(hud, 'update') && !Object.prototype.hasOwnProperty.call(hud, 'setSubtitle') && !(sim.cockpit && sim.cockpit.userData._fgOwn) && !wrapOn() && Number(overlay().style.opacity) === 0 && !hud.wrap.style.getPropertyValue('--fg-tx1'));
      hud.setSubtitle('Skylark two one, cleared to land runway zero nine, wind calm', 'Tower', 4);
      r.ok('far-glitch: home, the radio is clear', hud.subtitleText.textContent === 'Skylark two one, cleared to land runway zero nine, wind calm');
    }

    /* ---- another map: nothing, however far ---- */
    {
      done = sim.menus.hooks.chooseMap('kestrel');
      await wait(100);
      const t0 = performance.now();
      while (sim.settings.map !== 'kestrel' && performance.now() - t0 < 10000) await wait(50);
      await wait(1500);
      await sim.startMode('free', { loadingScreen: false, airborne: true, aircraft: 'skylark' });
      if (sim.state === 'paused') sim.resume();
      const ac2 = sim.aircraft;
      for (let i = 0; i < 180; i++) {
        ac2.pos.set(SH + 120000, 6000, 0);
        sim.step(1 / 60);
      }
      const s = stats();
      r.ok('far-glitch: on Kestrel, far out by the numbers, nothing', s.k === 0 && s.target === 0 && !sim.hud.wrap.classList.contains('is-farglitch') && !Object.prototype.hasOwnProperty.call(sim.hud, 'update'), `k ${s.k}`);
    }

    r.ok('far-glitch: nothing threw', errors.length === 0, errors.slice(0, 3).join(' || '));
  } catch (e) {
    r.ok('far-glitch: the run finished', false, `${e.message} ${e.stack ? e.stack.split('\n')[1] : ''}`);
  } finally {
    console.error = oe;
    sim.settings.quality = before.quality;
  }
}
