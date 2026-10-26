/**
 * REAL MODELS in the real game (src/aircraft/real-models.js).
 *
 *   1. Picking a type with a real model fetches it and puts it on: the skin
 *      drawn, the procedural outside on the hidden layer, the gear in view,
 *      and a frame renders with no console errors.
 *   2. The cockpit view draws the procedural flight deck (the skin steps
 *      aside on the same frame), and the follow view brings it back.
 *   3. A crash is drawn in the procedural model's breakup pieces: the skin
 *      is off from the crash frame.
 *   4. The hangar puts the real model on the podium (one already loaded at
 *      once; one not yet loaded when its file arrives), locked as a silhouette.
 *   5. A file that cannot be fetched: the built-in model, the flight goes on,
 *      no console error.
 *   6. Low: drawing the player's aeroplane in its real model costs no more
 *      than 5% over the built-in one (median of timed frames, same view).
 *
 * `check(sim, r, say)`, as tests/features/index.js expects; every step fenced.
 */

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

export async function check(sim, r, say = () => {}) {
  let R;
  let THREE;
  try {
    R = await import('../../src/aircraft/real-models.js');
    THREE = await import('../../src/vendor/three.module.js');
  } catch (e) {
    r.ok('real models: modules load', false, String(e && e.message));
    return;
  }
  const errors = [];
  const realError = console.error;
  console.error = (...a) => {
    errors.push(a.map((x) => (x && x.message) || String(x)).join(' ').slice(0, 200));
    realError.apply(console, a);
  };
  const onErr = (e) => errors.push(`uncaught: ${(e && e.message) || e}`.slice(0, 200));
  window.addEventListener('error', onErr);
  const autoPause = sim.autoPauseOnHide;
  sim.autoPauseOnHide = false;
  const qualityWas = sim.settings.quality;
  const noDebrief = () => clearTimeout(sim._crashDebriefT);
  const waitOn = async (model, ms = 15000) => {
    const t0 = performance.now();
    while (performance.now() - t0 < ms) {
      const rm = model && model.userData.realModel;
      if (rm && (rm.state === 'on' || rm.state === 'failed')) return rm;
      await sleep(40);
    }
    return model && model.userData.realModel;
  };
  const fly = async (id, extra = {}) => {
    await sim.startMode('free', { aircraft: id, time: 'day', condition: 'clear', windSpeedKts: 0, windDirDeg: 90, ...extra });
    sim.step(0.2);
  };
  try {
    /* 1. picked: fetched and worn */
    say('real models: the 737 picked');
    const e0 = errors.length;
    await fly('b737');
    let rm = await waitOn(sim.model);
    sim.step(0.2);
    const hiddenOk = rm && rm.hidden.length > 10 && rm.hidden.every(([o]) => (o.layers.isEnabled(31) && !o.layers.isEnabled(0)) || (rm.flaps.includes(o) && rm.flapsOut));
    let gear = 0;
    sim.model.traverse((o) => {
      if (o.isMesh && /landing gear|twin tyres/i.test(o.name + ' ' + (o.parent && o.parent.name)) && o.layers.mask === 1) gear++;
    });
    sim.renderer.render(sim.scene, sim.camera);
    r.ok('real models: the 737 picked wears its real model, the procedural outside hidden, the gear in view',
      !!rm && rm.state === 'on' && rm.on && rm.skin.visible && hiddenOk && gear > 0, rm ? `${rm.state}, ${rm.hidden.length} hidden, ${gear} gear meshes` : 'no real model');
    r.ok('real models: a frame draws with no console errors', errors.length === e0, errors.slice(e0, e0 + 2).join(' | '));

    /* 2. the cockpit view */
    say('real models: cockpit view');
    sim.rig.setMode('cockpit');
    sim.update(1 / 60);
    const inSeat = rm && !rm.on && !rm.skin.visible;
    sim.rig.setMode('chase');
    sim.update(1 / 60);
    sim.update(1 / 60);
    r.ok('real models: from the seat the procedural flight deck is drawn; the follow view brings the skin back', inSeat && rm.on && rm.skin.visible);

    /* 3. a crash */
    say('real models: a crash');
    {
      const ac = sim.aircraft;
      ac.reset({ pos: ac.pos.clone(), headingDeg: 90, speed: 60, altAGL: 40, engineOn: true, gearDown: false });
      ac.quat.setFromEuler(new THREE.Euler((-35 * Math.PI) / 180, -Math.PI / 2, 0, 'YXZ'));
      ac.vel.copy(new THREE.Vector3(0, 0, -1).applyQuaternion(ac.quat).multiplyScalar(60));
      sim.override = { pitch: -0.5, roll: 0, yaw: 0, throttle: 0 };
      let skinAtCrash = null;
      for (let i = 0; i < 900 && !ac.crashed; i++) {
        sim.update(1 / 60);
        noDebrief();
      }
      sim.update(1 / 60);
      noDebrief();
      skinAtCrash = rm ? rm.on || rm.skin.visible : null;
      sim.override = null;
      r.ok('real models: a crash is drawn in the procedural breakup pieces (skin off)', ac.crashed && skinAtCrash === false, `crashed ${ac.crashed} (${ac.crashReason || ''}), skin ${skinAtCrash}`);
      noDebrief();
    }

    /* 5. a file that cannot be fetched */
    say('real models: offline');
    {
      const id = ['concorde', 'b777', 'a321', 'q400'].find((k) => !R.realModelReady(k));
      if (id) {
        const e1 = errors.length;
        R.setRealModelLoader(() => Promise.reject(new Error('offline (test)')));
        await fly(id);
        await sleep(300);
        sim.step(1);
        const m = sim.model;
        const rm2 = m.userData.realModel;
        sim.renderer.render(sim.scene, sim.camera);
        r.ok(`real models: ${id} with its file unreachable flies the built-in model, no console error`,
          !m.getObjectByName('Real model') && (!rm2 || rm2.state === 'failed') && !sim.aircraft.crashed && errors.length === e1,
          `${rm2 ? rm2.state : 'none'}; ${errors.slice(e1, e1 + 2).join(' | ')}`);
        R.setRealModelLoader(null);
      } else r.ok('real models: offline case (every type already loaded; skipped)', true);
    }

    /* 4. the hangar */
    say('real models: the hangar');
    {
      const menus = sim.menus;
      const ui = menus && menus.showcaseUi;
      if (!ui) r.ok('real models: the hangar showroom is there', false);
      else {
        menus.setGame && menus.setGame('flight');
        menus.show('hangar');
        if (ui.loading) await ui.loading.catch(() => {});
        for (let i = 0; i < 100 && !ui.showcase && !ui.failed; i++) await sleep(50);
        const sc = ui.showcase;
        const pump = (n) => {
          for (let i = 0; i < n; i++) menus.drawView(sim.renderer, 1 / 30);
        };
        if (!sc) r.ok('real models: the hangar showroom loads', false);
        else {
          ui.select('b737', 0);
          pump(10);
          const cur = sc.current;
          const crm = cur && cur.model.userData.realModel;
          r.ok('real models: the hangar shows the 737 in its real model', !!crm && crm.on && cur.id === 'b737', crm ? crm.state : 'none');
          const later = ['a350', 'b787', 'a380', 'belugaxl'].find((k) => !R.realModelReady(k)) || 'a350';
          ui.select(later, 0);
          pump(4);
          const e2 = sc.current;
          await waitOn(e2 && e2.model);
          pump(4);
          const lrm = e2 && e2.model.userData.realModel;
          let silhouetted = true;
          if (lrm && lrm.skin && e2.silhouette) lrm.skin.traverse((o) => { if (o.isMesh && o.material !== sc.silMat) silhouetted = false; });
          r.ok(`real models: the hangar shows the ${later} once its file arrives${e2 && e2.silhouette ? ' (locked: as a silhouette)' : ''}`,
            !!lrm && lrm.on && silhouetted, lrm ? `${lrm.state}${e2.silhouette ? `, silhouette ${silhouetted}` : ''}` : 'none');
          menus.show('main');
        }
      }
    }

    /* 6. Low: no dearer than the built-in model */
    say('real models: Low cost');
    {
      sim.applySetting('quality', 'low');
      await sleep(200);
      const time = async () => {
        await fly('b737');
        await waitOn(sim.model);
        sim.rig.setMode('chase');
        sim.step(0.5);
        for (let i = 0; i < 10; i++) sim.renderer.render(sim.scene, sim.camera);
        const t = [];
        for (let k = 0; k < 9; k++) {
          const t0 = performance.now();
          for (let i = 0; i < 6; i++) sim.renderer.render(sim.scene, sim.camera);
          sim.renderer.getContext().finish();
          t.push((performance.now() - t0) / 6);
        }
        t.sort((a, b) => a - b);
        return t[4];
      };
      R.setRealModels(true);
      const on1 = await time();
      const realOn = !!(sim.model.userData.realModel && sim.model.userData.realModel.on);
      R.setRealModels(false);
      const off = await time();
      R.setRealModels(true);
      const on2 = await time();
      const on = Math.min(on1, on2);
      r.ok('real models: on Low the real 737 costs no more than 5% over the built-in one (render ms, median)', realOn && on <= off * 1.05,
        `real ${on.toFixed(2)} ms (${on1.toFixed(2)}, ${on2.toFixed(2)}), built-in ${off.toFixed(2)} ms`);
    }
  } catch (e) {
    r.ok('real models: the checks ran', false, String((e && e.stack) || e).slice(0, 300));
  } finally {
    sim.override = null;
    R.setRealModelLoader(null);
    R.setRealModels(sim.settings.realModels !== false);
    if (sim.settings.quality !== qualityWas) sim.applySetting('quality', qualityWas);
    sim.autoPauseOnHide = autoPause;
    console.error = realError;
    window.removeEventListener('error', onErr);
  }
}
