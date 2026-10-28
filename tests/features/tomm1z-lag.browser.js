/**
 * Browser check for the Tomm1z video pass, item 1 — LAG, in the real game
 * (page muted; .claude/devtools/briefs/tomm1z-video.md, the owner: "there
 * was a lot of lag"): shader info logs are off in play; a flight start warms
 * the aeroplane's and the cockpit's programs in the background and leaves
 * the cockpit hidden; the AudioContext exists before any key; the
 * controllers panel's timer forces no layout while Settings is hidden (560 ms
 * in one tick while the hangar opened, before).
 *
 *   node .claude/devtools/briefs/one-check.mjs <url>?mute=1 ./tests/features/tomm1z-lag.browser.js check "" 1
 */

export const id = 'tomm1z-lag';

export async function check(sim, r, say = () => {}) {
  const ok = (name, pass, detail = '') => r.ok(`tomm1z-lag: ${name}`, !!pass, detail);
  const autoPause = sim.autoPauseOnHide;
  sim.autoPauseOnHide = false;
  try {
    say('tomm1z-lag: shader warm-up and the audio context');
    ok('shader info logs are off in play (the sync point under every hitch)', sim.renderer.debug.checkShaderErrors === false, String(sim.renderer.debug.checkShaderErrors));
    let W = null;
    try {
      W = await import('../../src/render/shader-warm.js');
    } catch (e) {
      /* reported below */
    }
    ok('render/shader-warm.js loads', !!W);
    const before = W ? W.shaderWarmStats().warms : 0;
    await sim.startMode('free', { aircraft: 'courier', time: 'day', condition: 'clear', windSpeedKts: 0, windDirDeg: 90 });
    sim.step(0.5);
    const after = W ? W.shaderWarmStats() : null;
    ok('a flight start warms the aeroplane and its cockpit in the background', after && after.warms > before, JSON.stringify(after));
    ok('...and the cockpit is not left visible by the warm-up', sim.cockpit && sim.cockpit.visible === false);
    ok('the AudioContext exists (made at boot, not on the first key)', !!(sim.audio.mixer && sim.audio.mixer.ctx), sim.audio.mixer && sim.audio.mixer.ctx && sim.audio.mixer.ctx.state);
    // The controllers panel's timer while Settings is hidden: no layout asked for.
    sim.quitToMenu('main');
    sim.step(0.2);
    const host = sim.menus.screens.settings && sim.menus.screens.settings.querySelector('[data-controllers]');
    const panel = sim.controllersPanel;
    let layouts = 0;
    const real = host && host.getClientRects;
    if (host) {
      host.getClientRects = function () {
        layouts++;
        return real.call(this);
      };
    }
    try {
      if (panel && panel.tick) panel.tick(0.15);
    } finally {
      if (host) host.getClientRects = real;
    }
    ok('the controllers panel\'s timer forces no layout while Settings is hidden', !!panel && !!host && layouts === 0 && sim.menus.screens.settings.hidden === true, `panel ${!!panel} host ${!!host} layouts ${layouts}`);

    say('tomm1z-lag: a new aeroplane is drawn only once its programs are ready');
    // The warm is held open by hand, so the gate can be seen: a LIVE frame
    // (the loop's) leaves the new model out, a step() frame draws it, and
    // startMode() waits for the warm before the flight begins.
    sim.quitToMenu('main');
    sim.step(0.2);
    const warmWas = sim.warmShaders;
    let release = null;
    sim.warmShaders = () => new Promise((res) => (release = res));
    const realRender = sim.renderer.render;
    const seenLive = [];
    const seenStep = [];
    let bucket = seenLive;
    // What a draw would see of the model: how many of its meshes are on a layer the camera draws, and its lights.
    const seen = () => {
      let meshes = 0;
      let lights = 0;
      if (sim.model) sim.model.traverse((o) => {
        if (o.isMesh && o.layers.test(sim.camera.layers)) meshes++;
        if (o.isLight && o.layers.test(sim.camera.layers)) lights++;
      });
      return { visible: sim.model ? sim.model.visible : null, meshes, lights };
    };
    sim.renderer.render = function (scene, cam) {
      bucket.push(seen());
      return realRender.call(this, scene, cam);
    };
    let started = false;
    let p;
    try {
      p = sim.startMode('free', { aircraft: 'b747', airborne: true, time: 'day', condition: 'clear', windSpeedKts: 0, windDirDeg: 90 }).then(() => (started = true));
      // The warm starts from a live frame once the lights have settled, or (a frozen loop) after a liveness probe.
      for (let i = 0; i < 60 && !release; i++) await new Promise((res) => setTimeout(res, 50));
      ok('while its programs compile, the new aeroplane is the one being warmed (modelWarming)', typeof sim.modelWarming === 'function' && sim.modelWarming() === sim.model && sim.aircraftType.id === 'b747', `${sim.aircraftType && sim.aircraftType.id} warming ${!!(sim.modelWarming && sim.modelWarming())}`);
      ok('...and startMode() has not finished (it waits for the warm)', started === false);
      sim.renderFrame(true);
      const after = seen();
      ok('...a live frame draws the world WITHOUT its meshes (the compile is not paid for on the main thread)', seenLive.length >= 1 && seenLive.every((v) => v.meshes === 0 && v.visible === true) && after.meshes > 20, `during: ${JSON.stringify(seenLive[0])}; after: ${JSON.stringify(after)}`);
      ok('...but WITH its lights (a light more or less would recompile the whole world)', seenLive.every((v) => v.lights >= 1 && v.lights === after.lights), `during: ${JSON.stringify(seenLive[0])}; after: ${JSON.stringify(after)}`);
      bucket = seenStep;
      sim.renderFrame();
      ok('...a step() frame (a check) still draws it', seenStep.length >= 1 && seenStep.every((v) => v.meshes === after.meshes), JSON.stringify(seenStep[0]));
      release(true);
      await p;
      ok('the warm done: startMode() finishes and the aeroplane is drawn from now on', started === true && sim.modelWarming() === null && sim.state === 'flying');
    } finally {
      sim.renderer.render = realRender;
      sim.warmShaders = warmWas;
      if (release) release(true);
    }
    // A warm that never finishes: the flight still starts, inside MODEL_WARM_MAX_MS.
    sim.quitToMenu('main');
    sim.step(0.2);
    sim.warmShaders = () => new Promise(() => {});
    try {
      const M = await import('../../src/main.js');
      // Timed round the wait itself: setAircraft's own build (a second or more of a big cockpit) is not the cap's.
      const awaitWas = sim.awaitModelWarm;
      let took = -1;
      sim.awaitModelWarm = async function () {
        const t0 = performance.now();
        const r = await awaitWas.call(this);
        took = performance.now() - t0;
        return r;
      };
      try {
        await sim.startMode('free', { aircraft: 'a321', airborne: true, time: 'day', condition: 'clear', windSpeedKts: 0, windDirDeg: 90 });
      } finally {
        sim.awaitModelWarm = awaitWas;
      }
      ok(`a warm that never finishes: the flight starts anyway within ${M.MODEL_WARM_MAX_MS} ms (+ slack)`, sim.state === 'flying' && took >= 0 && took < M.MODEL_WARM_MAX_MS + 1000 && sim.modelWarming() === null, `${Math.round(took)} ms`);
    } finally {
      sim.warmShaders = warmWas;
    }

    say('tomm1z-lag: the hangar draws nothing until the studio\'s programs are ready');
    sim.quitToMenu('main');
    sim.step(0.2);
    sim.menus.show('hangar');
    const ui = sim.menus.showcaseUi;
    for (let i = 0; i < 40 && !(ui && ui.showcase); i++) await new Promise((res) => setTimeout(res, 100));
    const sc = ui && ui.showcase;
    ok('the hangar\'s showcase is up', !!sc);
    if (sc) {
      const H = await import('../../src/ui/hangar-showcase.js');
      const draws = [];
      const r2 = sim.renderer.render;
      const others = new Map();
      sim.renderer.render = function (scene, cam) {
        if (scene === sc.scene) draws.push('studio');
        else {
          // Something else drawing with the renderer (the cards' thumbnails?): who.
          const who = String((new Error().stack || '').split('\n')[2] || '').trim().replace(/^at /, '').replace(/\(?https?:\/\/[^/]+\//, '');
          others.set(who, (others.get(who) || 0) + 1);
        }
        return r2.call(this, scene, cam);
      };
      const othersStr = () => [...others].map(([k, v]) => `${v}× ${k}`).join('; ');
      try {
        sim.menus.drawView(sim.renderer, 1 / 60);
        ok('the first frame of the hangar starts the studio warm and draws nothing (a clear only)', !!sc._sceneWarm && draws.length === 0 && sc.counters.warming >= 1, `studio draws ${draws.length} warming ${sc.counters.warming}; other draws: ${othersStr() || 'none'}`);
        await Promise.race([sc._sceneWarm, new Promise((res) => setTimeout(res, H.WARM_MAX_MS + 500))]);
        ok('...the studio warm resolves (sceneWarmed)', sc.sceneWarmed === true);
        const cur = sc.current;
        ok('...and the aeroplane on the podium has its own warm, started when it was built', !!(cur && cur.warm), cur && String(cur.warmed));
        if (cur) await Promise.race([cur.warm, new Promise((res) => setTimeout(res, H.WARM_MAX_MS + 500))]);
        sim.menus.drawView(sim.renderer, 1 / 60);
        ok('...then the studio is drawn with the aeroplane in it', draws.length === 1 && cur && cur.warmed === true && cur.holder.visible === true, `studio draws ${draws.length} warmed ${cur && cur.warmed} visible ${cur && cur.holder.visible}`);
      } finally {
        sim.renderer.render = r2;
      }
    }
  } finally {
    sim.autoPauseOnHide = autoPause;
    try {
      sim.quitToMenu('main');
    } catch (e) {
      void e;
    }
  }
}
