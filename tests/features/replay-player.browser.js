/**
 * The instant replay's player (src/features/breakup/replay-player.js) and its
 * video (src/features/breakup/replay-video.js), on the real game:
 *
 *   - the player bar comes up with the replay: play / pause, ±5 s, a
 *     timeline with the impact marked, the four speeds, the camera, hide,
 *     video and close — every one a thumb's 44 px;
 *   - the timeline scrubs (a finger), the speeds change the pace, the skips
 *     skip, the keys do what the buttons do;
 *   - the five cameras: chase behind, cockpit in the seat, tower standing
 *     still, free look turned by a drag (a drag in the orbit turns into free
 *     look);
 *   - with Reduce flashing on, the near cameras stand back for the crash (the
 *     cockpit steps outside) and a pace faster than real time has no flashes;
 *     each camera under the flicker probe comes in under the crash line;
 *   - hide the controls and bring them back (a tap, the key);
 *   - a 3-second section recorded makes a non-empty video Blob, with a
 *     sensible name and a Save link; a cancelled one makes none;
 *   - a browser without MediaRecorder is told so, and nothing is recorded.
 */

const say0 = () => {};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export async function check(sim, r, say = say0) {
  let bu;
  let cr;
  let THREE;
  try {
    bu = await import('../../src/features/breakup.js');
    cr = await import('../../src/features/crashes.js');
    THREE = await import('../../src/vendor/three.module.js');
    await bu.loadReplayPlayer();
  } catch (err) {
    r.ok('replay player: the modules load', false, String((err && err.message) || err));
    return;
  }
  const D = () => bu.breakupDebug();
  const PD = () => D().player();
  const P = await import('../../src/features/breakup/replay-player.js');
  const autoWas = sim.autoPauseOnHide;
  const reduceWas = sim.settings.reduceFlashing;
  const slowWas = sim.settings.crashSlowMo;
  sim.autoPauseOnHide = false;
  const key = (code) => {
    window.dispatchEvent(new KeyboardEvent('keydown', { code, key: code, bubbles: true, cancelable: true }));
    window.dispatchEvent(new KeyboardEvent('keyup', { code, key: code, bubbles: true, cancelable: true }));
  };
  const I = await import('../../src/flight/input.js');
  const code = (id) => I.codesFor(id, sim)[0];

  async function crash(type = 'skylark', kind = 'cartwheel', reduce = true) {
    if (sim.settings.reduceFlashing !== reduce) sim.applySetting('reduceFlashing', reduce);
    sim.settings.crashSlowMo = true;
    await sim.startMode('free', { airborne: true, time: 'day', condition: 'clear', windSpeedKts: 0, windDirDeg: 0, aircraft: type });
    for (let i = 0; i < 60; i++) sim.update(1 / 30);
    cr.stageCrash(sim, kind);
    for (let i = 0; i < 200 && D().S.rec && !D().S.rec.done; i++) {
      sim.update(1 / 30);
      clearTimeout(sim._crashDebriefT);
    }
    clearTimeout(sim._crashDebriefT);
  }

  try {
    PD().reset();
    say('replay player: a crash to watch');
    await crash('skylark', 'cartwheel', true);
    r.ok('replay player: there is a replay to watch', D().canReplay, JSON.stringify(D().recording));
    const started = bu.startReplay(sim, false);
    sim.update(1 / 30);
    const R = D().S.replay;
    const bar = document.querySelector('.breakup-replay-bar');
    const btn = (k) => bar && bar.querySelector(`[data-replay="${k}"]`);
    r.ok('replay player: the replay opens with the new player bar', started && !!R && !!bar && bar.style.display !== 'none' && bar.classList.contains('rp-bar'), bar ? bar.className : 'no bar');
    const want = ['back', 'pause', 'fwd', 'track', 'speed', 'camera', 'hide', 'video', 'close'];
    const missing = want.filter((k) => !btn(k));
    r.ok('replay player: play / pause, ±5 s, the timeline, the speeds, the camera, hide, video and close are all on it', missing.length === 0 && bar.querySelectorAll('[data-replay="speed"]').length === 4, missing.join(', ') || [...bar.querySelectorAll('[data-replay="speed"]')].map((b) => b.textContent).join(' '));
    const small = [...bar.querySelectorAll('button')].filter((b) => {
      const rc = b.getBoundingClientRect();
      return rc.width < 44 || rc.height < 44;
    });
    r.ok('replay player: every button on the bar is a thumb\'s 44 px or more (touch)', small.length === 0, small.map((b) => `${b.dataset.replay} ${Math.round(b.getBoundingClientRect().width)}x${Math.round(b.getBoundingClientRect().height)}`).join(', '));
    const hitMark = bar.querySelector('.rp-mark.is-hit');
    const track = btn('track');
    const rail = track.firstElementChild;
    const rr = rail.getBoundingClientRect();
    const hm = hitMark ? hitMark.getBoundingClientRect() : null;
    const hitK = (0 - R.start) / (R.end - R.start);
    r.ok('replay player: the impact is marked on the timeline where it happens', !!hm && Math.abs((hm.left + hm.width / 2 - rr.left) / rr.width - hitK) < 0.03, hm ? `${(((hm.left + hm.width / 2 - rr.left) / rr.width) * 100).toFixed(1)}% vs ${(hitK * 100).toFixed(1)}%` : 'no mark');
    const tag = document.querySelector('.breakup-replay-label');
    r.ok('replay player: the INSTANT REPLAY tag says the camera and the pace', !!tag && tag.style.display !== 'none' && /Orbit camera · 0\.5×/.test(tag.textContent), tag ? tag.textContent : 'no tag');

    /* ---- scrub, by a finger ---- */
    const ev = (type, k, target = track) => target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 21, pointerType: 'touch', isPrimary: true, clientX: rr.left + rr.width * k, clientY: rr.top + rr.height / 2 }));
    ev('pointerdown', 0.5);
    ev('pointermove', 0.8);
    const t8 = R.t;
    ev('pointerup', 0.8);
    const now = bar.querySelector('.rp-now').textContent;
    const w8 = R.start + 0.8 * (R.end - R.start);
    r.ok('replay player: a finger on the timeline scrubs to where it is, and the time shown follows', Math.abs(t8 - w8) < 0.05 && now.includes(Math.abs(t8).toFixed(1)), `${t8.toFixed(2)} (want ${w8.toFixed(2)}), shows ${now}`);

    /* ---- skip ±5 s ---- */
    bu.seekReplay(sim, R.start);
    btn('fwd').click();
    const tf = R.t;
    btn('back').click();
    const tb = R.t;
    r.ok('replay player: the skip buttons jump 5 s forward and back (clamped)', bu.REPLAY_STEP === 5 && Math.abs(tf - Math.min(R.end, R.start + 5)) < 1e-6 && Math.abs(tb - Math.max(R.start, tf - 5)) < 1e-6, `${R.start.toFixed(2)} → ${tf.toFixed(2)} → ${tb.toFixed(2)}`);

    /* ---- speed ---- */
    const pace = (s) => {
      bar.querySelector(`[data-replay="speed"][data-speed="${s}"]`).click();
      bu.pauseReplay(sim, false);
      bu.seekReplay(sim, -1.2);
      const a = R.t;
      for (let i = 0; i < 6; i++) sim.update(1 / 30);
      return (R.t - a) / (6 / 30);
    };
    const p2 = pace(2);
    const p025 = pace(0.25);
    const p1 = pace(1);
    r.ok('replay player: the speed buttons set the pace — 2×, 0.25×, 1× real time', Math.abs(p2 - 2) < 0.02 && Math.abs(p025 - 0.25) < 0.01 && Math.abs(p1 - 1) < 0.01, `${p2.toFixed(3)}, ${p025.toFixed(3)}, ${p1.toFixed(3)}`);
    key(code('replayFaster'));
    const kf = R.speed;
    key(code('replaySlower'));
    key(code('replaySlower'));
    const ks = R.speed;
    r.ok('replay player: the speed keys step it (. faster, , slower)', kf === 2 && ks === 0.5, `${kf}, ${ks}`);
    const onBtn = bar.querySelector('[data-replay="speed"].is-on');
    r.ok('replay player: the bar shows the pace chosen', !!onBtn && onBtn.dataset.speed === '0.5', onBtn ? onBtn.dataset.speed : 'none');

    /* ---- 2x with Reduce flashing: no flashes ---- */
    P.setSpeed(2);
    bu.seekReplay(sim, -0.1);
    bu.pauseReplay(sim, false);
    for (let i = 0; i < 3; i++) sim.update(1 / 30);
    const quiet2 = { quiet: R.quiet, scale: R.wreck ? R.wreck.flashScale : 0, t: R.t };
    P.setSpeed(0.5);
    r.ok('replay player: faster than real time with Reduce flashing on, the crash plays without its flashes (the light and the pops\' flare)', quiet2.quiet && quiet2.scale === 0 && quiet2.t > 0, JSON.stringify(quiet2));

    /* ---- the cameras ---- */
    const pos = new THREE.Vector3();
    const cam = sim.camera;
    const camAt = (id, t, frames = 4) => {
      btn('camera').click();
      const menu = document.querySelector(`.rp-cam[data-cam="${id}"]`);
      const shown = !!menu && menu.getBoundingClientRect().height >= 44;
      if (menu) menu.click();
      bu.seekReplay(sim, t);
      bu.pauseReplay(sim, true);
      for (let i = 0; i < frames; i++) sim.update(1 / 30);
      D().S.rec && pos.copy(D().S.rec.model.position);
      return { shown, d: cam.position.distanceTo(pos), p: cam.position.clone(), now: PD().camNow, near: R.near };
    };
    sim.applySetting('reduceFlashing', false);
    const ch = camAt('chase', -1.0);
    const L = (sim.aircraftType && sim.aircraftType.aero && sim.aircraftType.aero.wingSpan) || 11;
    r.ok('replay player: the camera menu lists each camera on a 44 px button, and Chase follows close behind the aeroplane', ch.shown && PD().cam === 'chase' && ch.d > 4 && ch.d < L * 2.5 + 20, `${ch.d.toFixed(1)} m (span ${L})`);
    const ck = camAt('cockpit', -1.0);
    r.ok('replay player: Cockpit puts the camera in the pilot\'s seat (Reduce flashing off)', ck.now === 'cockpit' && ck.d < 4 && sim.cockpit && sim.cockpit.visible, `${ck.d.toFixed(2)} m from the airframe, cockpit drawn ${sim.cockpit && sim.cockpit.visible}`);
    const tw = camAt('tower', -1.2);
    bu.pauseReplay(sim, false);
    for (let i = 0; i < 10; i++) sim.update(1 / 30);
    const twMoved = cam.position.distanceTo(tw.p);
    r.ok('replay player: Tower stands still on the ground while the aeroplane goes by', tw.now === 'tower' && twMoved < 0.01 && tw.d > 30, `moved ${twMoved.toFixed(3)} m, ${tw.d.toFixed(0)} m off`);
    const fr = camAt('free', 2.0);
    const surf = document.querySelector('[data-replay="look"]');
    const sr = { x: innerWidth * 0.5, y: innerHeight * 0.35 };
    const sev = (type, dx) => surf.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 31, pointerType: 'touch', isPrimary: true, clientX: sr.x + dx, clientY: sr.y }));
    sev('pointerdown', 0);
    sev('pointermove', 40);
    sev('pointermove', 160);
    sev('pointerup', 160);
    sim.update(1 / 30);
    const turned = cam.position.distanceTo(fr.p);
    r.ok('replay player: Free look turns round the wreck with a finger dragged on the picture', fr.now === 'free' && turned > 2, `${turned.toFixed(1)} m round`);
    P.setCamera('orbit');
    sim.update(1 / 30);
    sev('pointerdown', 0);
    sev('pointermove', 30);
    sev('pointermove', 90);
    sev('pointerup', 90);
    r.ok('replay player: a drag in the orbit turns into free look from where it stood', PD().cam === 'free', PD().cam);

    /* ---- Reduce flashing: the near cameras stand back for the crash ---- */
    sim.applySetting('reduceFlashing', true);
    const ckR = camAt('cockpit', 0.4);
    r.ok('replay player: with Reduce flashing on, the cockpit view steps outside for the crash, as far back as the orbit, and says so', ckR.now === 'chase' && ckR.d > R.radius * 0.8 && !ckR.near && /Reduce flashing/.test(tag.textContent), `${ckR.now}, ${ckR.d.toFixed(0)} m (orbit ${R.radius.toFixed(0)} m), "${tag.textContent}"`);
    const ckPre = camAt('cockpit', -1.2);
    r.ok('replay player: …and is back in the seat before it (nothing flashes then)', ckPre.now === 'cockpit' && ckPre.d < 4, `${ckPre.now}, ${ckPre.d.toFixed(1)} m`);
    const chR = camAt('chase', 0.3);
    const frR = camAt('free', 0.3);
    if (PD().C.free) PD().C.free.dist = 5;
    sim.update(1 / 30);
    const frD = cam.position.distanceTo(pos);
    r.ok('replay player: with Reduce flashing on, chase and free look stand back to the orbit\'s distance for the crash', chR.d > R.radius * 0.8 && frR.d > R.radius * 0.8 && frD > R.radius * 0.8, `chase ${chR.d.toFixed(0)} m, free ${frR.d.toFixed(0)} m, free pinched in ${frD.toFixed(0)} m; orbit ${R.radius.toFixed(0)} m`);

    /* ---- the cameras under the flicker probe (Reduce flashing on) ---- */
    say('replay player: the cameras under the flicker probe');
    {
      const isStub = /^\(\)=>\{\}$/.test(String(sim.renderer.render).replace(/\s/g, ''));
      const real = (typeof window !== 'undefined' && window.__realRender) || (isStub ? null : sim.renderer.render);
      const stub = sim.renderer.render;
      const FP = await import('../flicker-probe.js');
      if (real) sim.renderer.render = real;
      const res = [];
      try {
        for (const id of ['chase', 'cockpit', 'tower', 'free']) {
          P.setCamera(id);
          P.setSpeed(0.5);
          bu.seekReplay(sim, -0.6);
          bu.pauseReplay(sim, false);
          const m = await FP.measure(sim, { frames: 60, fps: 30, warm: 0, raycast: false });
          res.push({ id, w: m.wcagWindow, drawn: m.meanLum.max > 0.01, live: !!D().S.replay });
          if (!D().S.replay) break;
        }
      } finally {
        sim.renderer.render = stub;
      }
      r.ok('replay player: each camera\'s view of the crash flashes over under 20% of any 10-degree field (WCAG\'s line is 25%; Reduce flashing on)',
        !!real && res.length === 4 && res.every((x) => x.drawn && x.live && x.w < 0.2),
        res.map((x) => `${x.id} ${(x.w * 100).toFixed(1)}%${x.drawn ? '' : ' NOT drawn'}${x.live ? '' : ' ended'}`).join(', ') || 'not measured');
    }
    if (!D().S.replay) bu.startReplay(sim, false);

    /* ---- the camera key, hide the controls ---- */
    P.setCamera('orbit');
    key(code('replayCamera'));
    r.ok('replay player: the camera key goes to the next camera', PD().cam === 'chase', PD().cam);
    P.setCamera('orbit');
    btn('hide').click();
    const dock = bar.parentElement;
    const hidden = document.documentElement.classList.contains('replay-clean') && getComputedStyle(dock).visibility === 'hidden';
    const unhide = document.querySelector('[data-replay="unhide"]');
    const chip = unhide && getComputedStyle(unhide).display !== 'none';
    sev('pointerdown', 0);
    sev('pointerup', 0);
    const back1 = !document.documentElement.classList.contains('replay-clean') && getComputedStyle(dock).visibility !== 'hidden';
    key(code('replayHideUi'));
    const viaKey = PD().clean;
    key(code('replayClose'));
    const escBack = !PD().clean && !!D().S.replay;
    r.ok('replay player: hide the controls for a clean picture; a tap on it, or Show controls, brings them back; H hides, Esc shows them first', hidden && chip && back1 && viaKey && escBack, `hidden ${hidden}, chip ${chip}, tap back ${back1}, key ${viaKey}, esc ${escBack}`);

    /* ---- the video ---- */
    say('replay player: a video');
    key(code('replayVideo'));
    const vp = document.querySelector('.rp-video');
    await PD().loadVideo();
    sim.update(1 / 30);
    const sup = PD().support;
    r.ok('replay player: the video panel opens (V or the Video button) and finds a recorder here', PD().panel && vp && vp.style.display !== 'none' && sup && sup.ok && /^video\/(webm|mp4)/.test(sup.mime), sup ? JSON.stringify(sup) : 'no support');
    key(code('replayClose'));
    r.ok('replay player: Esc shuts the video panel before it closes the replay', !PD().panel && !!D().S.replay);
    btn('video').click();
    P.setSpeed(1);
    bu.seekReplay(sim, -1.0);
    vp.querySelector('[data-replay="in"]').click();
    bu.seekReplay(sim, 2.0);
    vp.querySelector('[data-replay="out"]').click();
    const sect = PD().section;
    const shade = bar.querySelector('.rp-section');
    r.ok('replay player: Start here / End here choose a 3-second section, shaded on the timeline', !!sect && Math.abs(sect[0] + 1) < 1e-6 && Math.abs(sect[1] - 2) < 1e-6 && shade.style.display !== 'none', JSON.stringify(sect));
    const isStub = /^\(\)=>\{\}$/.test(String(sim.renderer.render).replace(/\s/g, ''));
    const real = (typeof window !== 'undefined' && window.__realRender) || (isStub ? null : sim.renderer.render);
    const stub = sim.renderer.render;
    if (real) sim.renderer.render = real;
    let video = null;
    let progress = [];
    let wall = 0;
    try {
      vp.querySelector('[data-replay="record"]').click();
      await wait(0);
      const done = PD().P.rec ? PD().P.rec.done : Promise.resolve(null);
      const t0 = performance.now();
      let finished = false;
      done.then((v) => {
        finished = true;
        video = v;
      });
      for (let i = 0; i < 400 && !finished && performance.now() - t0 < 12000; i++) {
        sim.step(1 / 30);
        if (PD().recording) progress.push(PD().recording.progress);
        await wait(25);
      }
      if (!finished) await Promise.race([done, wait(3000)]);
      wall = (performance.now() - t0) / 1000;
    } finally {
      sim.renderer.render = stub;
    }
    const last = PD().last;
    const blob = PD().lastBlob;
    r.ok('replay player: recording the 3-second section makes a non-empty video Blob', !!video && !!blob && blob.size > 1000 && /^video\/(webm|mp4)/.test(blob.type), blob ? `${blob.type}, ${blob.size} B in ${wall.toFixed(1)} s` : `no video (${PD().msg})`);
    const rising = progress.length > 3 && progress[progress.length - 1] > progress[0] && progress.every((p, i) => i === 0 || p >= progress[i - 1] - 1e-6);
    r.ok('replay player: …it played in real time with a progress bar that went up', rising && wall >= 2.5, `${progress.length} frames, ${(progress[0] || 0).toFixed(2)} → ${(progress[progress.length - 1] || 0).toFixed(2)}, ${wall.toFixed(1)} s`);
    const save = vp.querySelector('[data-replay="save"]');
    const tName = (sim.aircraftType && sim.aircraftType.id) || 'aircraft';
    r.ok('replay player: …named island-flight-<aircraft>-<date>, with a Save link for it', !!last && new RegExp(`^island-flight-${tName}-\\d{4}-\\d\\d-\\d\\d-\\d{4}\\.(webm|mp4)$`).test(last.name) && save.style.display !== 'none' && save.download === last.name && /^blob:/.test(save.href), last ? `${last.name} → ${save.download}` : 'none');
    r.ok('replay player: …and the replay holds at the end of the section for it to be saved', !!D().S.replay && D().S.replay.paused && Math.abs(D().S.replay.t - 2) < 0.2, D().S.replay ? `t ${D().S.replay.t.toFixed(2)}` : 'ended');

    // A recording cancelled makes nothing.
    vp.querySelector('[data-replay="record"]').click();
    await wait(0);
    const p2rec = PD().P.rec ? PD().P.rec.done : Promise.resolve('none');
    sim.update(1 / 30);
    vp.querySelector('[data-replay="cancel"]').click();
    const cancelled = await Promise.race([p2rec, wait(2000).then(() => 'timeout')]);
    r.ok('replay player: Cancel stops a recording and keeps nothing', cancelled === null && !PD().recording && !PD().last, `${cancelled}, last ${!!PD().last}`);

    /* ---- the can't-record path ---- */
    const MRwas = window.MediaRecorder;
    let why = '';
    let refused = 'not run';
    try {
      window.MediaRecorder = undefined;
      PD().P.cache = {};
      sim.update(1 / 30);
      why = vp.querySelector('.rp-msg').textContent;
      const recBtn = vp.querySelector('[data-replay="record"]');
      refused = recBtn.disabled ? await P.startRecording() : 'enabled';
    } finally {
      window.MediaRecorder = MRwas;
    }
    r.ok('replay player: a browser that can\'t record is told so plainly, and Record is off', /can't record video/.test(why) && refused === null && !PD().recording, `"${why}" → ${refused}`);

    /* ---- close ---- */
    btn('close').click();
    const tagGone = !tag || tag.style.display === 'none';
    r.ok('replay player: ✕ closes the replay, the bar, the tag and the video panel', !D().S.replay && bar.style.display === 'none' && tagGone && vp.style.display === 'none' && !document.documentElement.classList.contains('is-replaying') && !document.documentElement.classList.contains('replay-clean'));
  } catch (err) {
    r.ok('replay player: the check ran', false, String((err && err.stack) || err).slice(0, 400));
  } finally {
    try {
      if (D().S.replay) bu.endReplay(sim, false);
      PD().reset();
    } catch (e) {
      /* fine */
    }
    sim.autoPauseOnHide = autoWas;
    if (sim.settings.reduceFlashing !== reduceWas) sim.applySetting('reduceFlashing', reduceWas !== false);
    sim.settings.crashSlowMo = slowWas;
  }
}
