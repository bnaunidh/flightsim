/**
 * Browser checks for the smoke cloud and the smoke tank, in the real game.
 * tests/features/smoke-clouds.mjs checks the numbers in node (the tank's 20 s
 * and 30 s, a puff's life and fade, the wind's bookkeeping, the pool); this
 * is what node cannot see:
 *
 *   1. The tank in the game: the small bar beside the 💨 button drains while
 *      smoke comes out, the smoke stops BY ITSELF when it is dry (and says
 *      so, calmly), T on an empty tank waits instead of stuttering, it fills
 *      in about 30 s while not smoking, and T and the button still just toggle.
 *   2. The same smoke from Air Massimo, and from T-pose Harrison by the button
 *      (T is his spin).
 *   3. A loop flown with smoke, drawn by the real renderer and compared pixel
 *      for pixel with the same frame drawn without the smoke: the shape is
 *      still there 30 s after the loop and gone by about 90 s, wearing off
 *      gradually and never in a jump; and it has been carried the way the
 *      game's wind blows.
 *   4. Seizure safety: the flicker probe (the owner's measure) on the real
 *      renderer with smoke streaming, in white by day and in Rainbow at sunset.
 *   5. The cost: the smoke's own work per frame with the pool full of old and
 *      new smoke, and what drawing a full trail plus an old cloud adds to a
 *      frame (the same frame with the smoke drawn and hidden).
 *
 * Puts the player's map, weather and the game back as it found them.
 * `check(sim, r, say)` — r.ok(name, pass, detail) per assertion.
 */

export async function check(sim, r, say = () => {}) {
  let fun;
  let P;
  let THREE;
  let FX;
  let ext;
  try {
    fun = await import('../../src/features/fun.js');
    FX = await import('../../src/features/fun/fx.js');
    ext = await import('../../src/game/extensions.js');
    THREE = await import('../../src/vendor/three.module.js');
    P = await import('../flicker-probe.js');
  } catch (err) {
    r.ok('smoke clouds: the modules load', false, String(err && err.message));
    return r;
  }
  const F = fun.__test.F;
  const origAuto = sim.autoPauseOnHide;
  sim.autoPauseOnHide = false;
  const colour0 = F.data && F.data.smoke ? F.data.smoke.color : 'white';
  const reduce0 = sim.settings.reduceFlashing;
  const stub = sim.renderer.render;
  // The suite stubs the renderer for speed and keeps the real one as window.__realRender.
  const isStub = /^\(\)=>\{\}$/.test(String(stub).replace(/\s/g, ''));
  const real = (typeof window !== 'undefined' && window.__realRender) || (isStub ? null : stub);
  const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
  const keyAt = (code, down) => document.body.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, bubbles: true, cancelable: true }));
  const pressT = () => {
    keyAt('KeyT', true);
    keyAt('KeyT', false);
  };
  const tankEl = () => document.querySelector('[data-fun-tank]');
  const chipBtn = () => document.querySelector('[data-fun-smoke]');
  const said = () => (F.hud ? F.hud.side.textContent : '');
  const pct = (x) => `${(x * 100).toFixed(0)}%`;
  const FT = 3.28084;
  /*
   * The aeroplane's step already wears gates other features put on it once, when they installed (stovl, tpose,
   * eject, multiplayer...). Put ours on top and take it off by putting that back — never `delete ac.update`,
   * which strips every one of those gates for the rest of the session and breaks every later flight.
   */
  const hooked = [];
  // Every scenario puts a "steady flight" step on the aeroplane and remembers what it put it on top of, so
  // take the last one off first: set up twice in a row and the second remembers the first's, which then stays.
  const scenario = async (o) => {
    if (sim._flickerRestore) sim._flickerRestore();
    return P.setupScenario(sim, o);
  };
  const hook = (ac, fn) => {
    hooked.push([ac, Object.prototype.hasOwnProperty.call(ac, 'update') ? ac.update : undefined]);
    ac.update = fn;
  };
  const unhook = () => {
    while (hooked.length) {
      const [ac, prev] = hooked.pop();
      if (prev === undefined) delete ac.update;
      else ac.update = prev;
    }
  };

  try {
    sim.applySetting('reduceFlashing', true);

    /* ---- 1. the tank in the game ------------------------------------------- */
    say('smoke clouds: the tank');
    await scenario({ altFt: 3000, view: 'chase', look: 'level', time: 'day', condition: 'clear', speed: 70 });
    sim.step(0.5, 1 / 30);
    const chip = document.querySelector('.fun-chip');
    r.ok('smoke clouds: a small bar sits beside the 💨 button, full', !!chip && !chip.hidden && !!tankEl() && !tankEl().hidden && tankEl().getAttribute('aria-valuenow') === '100' && tankEl().getAttribute('role') === 'meter', tankEl() ? tankEl().getAttribute('aria-valuenow') : 'no bar');
    if (tankEl() && chipBtn()) {
      const a = tankEl().getBoundingClientRect();
      const b = chipBtn().getBoundingClientRect();
      r.ok('smoke clouds: …to the right of the button, in the chip, on the screen', a.left >= b.right - 1 && a.width > 20 && a.height > 3 && a.right <= window.innerWidth && a.bottom <= window.innerHeight && chip.contains(tankEl()), `bar ${Math.round(a.width)}x${Math.round(a.height)} at ${Math.round(a.left)},${Math.round(a.top)}`);
    }
    r.ok('smoke clouds: a full tank, smoke off', F.tank.level === 1 && !F.smokeOn);
    pressT();
    sim.step(0.2, 1 / 30);
    r.ok('smoke clouds: T still just turns the smoke on', F.smokeOn && chipBtn().getAttribute('aria-pressed') === 'true');
    sim.step(10, 1 / 30);
    r.ok('smoke clouds: 10 s of smoke takes about half the tank', Math.abs(F.tank.level - 0.48) < 0.04, pct(F.tank.level));
    const bar = tankEl().querySelector('i');
    r.ok('smoke clouds: …and the bar shows it', Math.abs(Number(tankEl().getAttribute('aria-valuenow')) - F.tank.level * 100) <= 1 && /scaleX\(0\.4\d\)/.test(bar.style.transform), `${tankEl().getAttribute('aria-valuenow')}% ${bar.style.transform}`);
    sim.step(9, 1 / 30);
    r.ok('smoke clouds: still smoking at 19 s (about 20 s from full)', F.smokeOn && F.tank.level > 0 && F.tank.level < 0.1, pct(F.tank.level));
    // 20 s from full: step on until it stops by itself (it must do so within a couple of seconds).
    let guard = 0;
    while (F.smokeOn && guard++ < 120) sim.step(1 / 30, 1 / 30);
    r.ok('smoke clouds: when it runs dry the smoke stops by itself', !F.smokeOn && F.tank.level < 0.08 && chipBtn().getAttribute('aria-pressed') === 'false', `on ${F.smokeOn}, tank ${pct(F.tank.level)}, after ${(19.2 + guard / 30).toFixed(1)} s`);
    sim.step(0.2, 1 / 30);
    r.ok('smoke clouds: …the bar goes grey and quiet while it fills to where it can start (a plain class, no flashing)', tankEl().classList.contains('is-empty') && !tankEl().classList.contains('is-flash') && Number(tankEl().getAttribute('aria-valuenow')) < 8 && /empty/i.test(tankEl().title), `${tankEl().getAttribute('aria-valuenow')}% "${tankEl().title}" ${tankEl().className}`);
    r.ok('smoke clouds: …and it says so, in words', /empty/i.test(said()), said().slice(0, 100));
    const live0 = F.smoke.liveCount(F.time);
    r.ok('smoke clouds: …what is out there stays and wears off by itself', live0 > 300, `${live0} puffs`);
    pressT();
    sim.step(0.3, 1 / 30);
    r.ok('smoke clouds: T on an empty tank waits (says it is filling) and does not stutter', !F.smokeOn && /filling/i.test(said()), said().slice(0, 100));
    const fill0 = F.tank.level;
    sim.step(15, 1 / 30);
    r.ok('smoke clouds: 15 s without smoking fills half the tank (about 30 s from empty)', Math.abs(F.tank.level - fill0 - 0.5) < 0.03, `${pct(fill0)} -> ${pct(F.tank.level)}`);
    pressT();
    sim.step(0.3, 1 / 30);
    r.ok('smoke clouds: …and T works again', F.smokeOn);
    pressT();
    sim.step(0.2, 1 / 30);
    r.ok('smoke clouds: T off, the same key', !F.smokeOn);
    sim.step(20, 1 / 30);
    r.ok('smoke clouds: it fills to the top and stops there', F.tank.level === 1 && tankEl().getAttribute('aria-valuenow') === '100' && !tankEl().classList.contains('is-empty'), pct(F.tank.level));
    // The button, with the tank low: the same toggle.
    F.tank.level = 0.5;
    chipBtn().click();
    sim.step(0.2, 1 / 30);
    r.ok('smoke clouds: the 💨 button toggles it too', F.smokeOn);
    chipBtn().click();
    sim.step(0.2, 1 / 30);
    r.ok('smoke clouds: …on and off', !F.smokeOn);
    // A new flight begins with a full tank.
    F.tank.level = 0.2;
    await scenario({ altFt: 3000, view: 'chase', look: 'level' });
    sim.step(0.2, 1 / 30);
    r.ok('smoke clouds: a new flight starts with a full tank', F.tank.level === 1);

    /* ---- 2. Massimo, and T-pose Harrison -------------------------------------- */
    say('smoke clouds: Massimo and Harrison');
    for (const id of ['massimo', 'tpose']) {
      await scenario({ altFt: 3000, view: 'chase', look: 'level', aircraft: id });
      sim.step(0.3, 1 / 30);
      if (id === 'massimo') pressT();
      else chipBtn().click();
      sim.step(1.5, 1 / 30);
      const ac = sim.aircraft;
      const last = (F.smoke.next + F.smoke.max - 1) % F.smoke.max;
      const d = Math.hypot(F.smoke.aPos.getX(last) + F.smoke.drift.x - ac.pos.x, F.smoke.aPos.getY(last) + F.smoke.drift.y - ac.pos.y, F.smoke.aPos.getZ(last) + F.smoke.drift.z - ac.pos.z);
      r.ok(`smoke clouds: ${id === 'massimo' ? 'Air Massimo' : 'T-pose Harrison'} smokes${id === 'massimo' ? ' on T' : ' from the button (T is his spin)'}, from the tail`, F.smokeOn && F.smoke.liveCount(F.time) > 30 && d < 40, `${F.smoke.liveCount(F.time)} puffs, newest ${d.toFixed(1)} m from him`);
      if (F.smokeOn) {
        if (id === 'massimo') pressT();
        else chipBtn().click();
      }
    }

    /* ---- 3. a loop, drawn by the real renderer ------------------------------------- */
    say('smoke clouds: a loop');
    if (!real) {
      r.ok('smoke clouds: the real renderer is available for the pictures', false, 'no window.__realRender and the renderer is stubbed');
    } else {
      sim.renderer.render = real;
      await scenario({ altFt: 3000, view: 'chase', look: 'level', time: 'day', condition: 'clear', heading: 0, speed: 80, windKts: 12 });
      // Wind FROM the north (blowing south, +Z), steady, whatever the map's weather was.
      sim.weather.windSpeedKts = 12;
      sim.weather.windDirDeg = 0;
      const wv = sim.weather.windVector().clone();
      const ac = sim.aircraft;
      const V = 80;
      const R = 200;
      const base = ac.quat.clone();
      const start = ac.pos.clone();
      const qx = new THREE.Quaternion();
      const X = new THREE.Vector3(1, 0, 0);
      const fwd0 = new THREE.Vector3(0, 0, -1).applyQuaternion(base).normalize();
      let ang = 0;
      // The loop: round a circle in the vertical plane the aeroplane is heading along, then straight on.
      hook(ac, function loop(dt) {
        if (ang < Math.PI * 2) {
          ang = Math.min(Math.PI * 2, ang + (V / R) * dt);
          this.pos.set(start.x + fwd0.x * R * Math.sin(ang), start.y + R - R * Math.cos(ang), start.z + fwd0.z * R * Math.sin(ang));
          qx.setFromAxisAngle(X, ang);
          this.quat.copy(base).multiply(qx);
          this.vel.set(0, 0, -V).applyQuaternion(this.quat);
        } else {
          this.vel.copy(fwd0).multiplyScalar(V);
          this.pos.addScaledVector(this.vel, dt);
        }
      });
      sim.step(0.2, 1 / 30);
      F.smoke.clear();
      F.tank.reset();
      F.data.smoke.color = 'white';
      pressT();
      sim.step((Math.PI * 2 * R) / V + 0.05, 1 / 30);
      const loopEnd = F.time;
      pressT();
      sim.step(0.1, 1 / 30);
      r.ok('smoke clouds: a loop flown with smoke leaves a ring of puffs', !F.smokeOn && F.smoke.liveCount(F.time) > 400, `${F.smoke.liveCount(F.time)} puffs, tank ${pct(F.tank.level)} left`);
      const cx = start.x + fwd0.x * 0;
      const cy = start.y + R;
      const cz = start.z;

      // The same frame with the smoke and without it: what the smoke adds.
      const W = sim.renderer.domElement.width;
      const H = sim.renderer.domElement.height;
      const c2 = document.createElement('canvas');
      c2.width = W;
      c2.height = H;
      const x2 = c2.getContext('2d', { willReadFrequently: true });
      const grab = () => {
        sim.renderer.render(sim.scene, sim.camera);
        x2.clearRect(0, 0, W, H);
        x2.drawImage(sim.renderer.domElement, 0, 0);
        return x2.getImageData(0, 0, W, H).data;
      };
      // A camera off the side of the loop's plane, 800 m away, and where the wind has taken the cloud.
      const aimAt = (follow) => {
        const dx = F.smoke.drift.x * follow;
        const dz = F.smoke.drift.z * follow;
        // Beside the loop (its plane contains the heading), looking across it.
        const side = new THREE.Vector3(-fwd0.z, 0, fwd0.x);
        sim.camera.position.set(cx + dx + side.x * 800, cy + 40, cz + dz + side.z * 800);
        sim.camera.lookAt(cx + dx, cy, cz + dz);
        sim.camera.updateMatrixWorld(true);
      };
      const measure = () => {
        const shown = grab();
        F.smoke.points.visible = false;
        const bare = grab();
        F.smoke.points.visible = true;
        let n = 0;
        let sum = 0;
        let sx = 0;
        let sy = 0;
        for (let i = 0, p = 0; i < shown.length; i += 4, p++) {
          const d = (Math.abs(shown[i] - bare[i]) + Math.abs(shown[i + 1] - bare[i + 1]) + Math.abs(shown[i + 2] - bare[i + 2])) / 3;
          if (d > 2) {
            n++;
            sum += d;
            sx += p % W;
            sy += (p / W) | 0;
          }
        }
        return { n, mass: sum, mean: n ? sum / n : 0, cx: n ? sx / n : 0, cy: n ? sy / n : 0 };
      };
      const frozen = new THREE.Vector3();
      const samples = {};
      let pos0 = null;
      // Measure at +0, 15 and 30 s after the loop, then every 5 s to 90. The first camera stays where it is for
      // the wind check; the rest follow the cloud so it stays in the picture.
      let firstCam = null;
      for (const t of [0, 15, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90]) {
        const gap = loopEnd + t - F.time;
        if (gap > 0.001) sim.step(gap, 1 / 30);
        if (t === 0) {
          aimAt(0);
          firstCam = { p: sim.camera.position.clone(), q: sim.camera.quaternion.clone() };
          frozen.copy(F.smoke.drift);
        } else aimAt(0.5);
        samples[t] = measure();
        if (t === 0) {
          // The mean place of the puffs still in the air, for the wind check.
          pos0 = meanPlace(F, F.time);
        }
        if (t === 30) {
          const pos30 = meanPlace(F, F.time);
          const dt = 30;
          const moved = [pos30[0] - pos0[0], pos30[2] - pos0[2]];
          const want = [wv.x * dt, wv.z * dt];
          r.ok(
            "smoke clouds: it drifts with the game's own wind (12 kt from the north: 30 s carries it about 185 m south)",
            Math.abs(moved[1] - want[1]) < 30 && Math.abs(moved[0] - want[0]) < 30 && want[1] > 150,
            `moved ${moved.map((v) => v.toFixed(0)).join(', ')} m, wind says ${want.map((v) => v.toFixed(0)).join(', ')}`
          );
          // On a fixed camera, in the picture too: the wind goes to the camera's left (south = +Z, the camera looks across the plane).
          sim.camera.position.copy(firstCam.p);
          sim.camera.quaternion.copy(firstCam.q);
          sim.camera.updateMatrixWorld(true);
          const fixed30 = measure();
          const fixed0 = samples[0];
          const side = new THREE.Vector3(-fwd0.z, 0, fwd0.x);
          // Screen-right on this camera is +fwd0 x side... work it out from the camera itself.
          const right = new THREE.Vector3(1, 0, 0).applyQuaternion(firstCam.q);
          const windScreen = (wv.x * right.x + wv.z * right.z) / Math.max(1e-6, Math.hypot(wv.x, wv.z));
          const shift = fixed30.cx - fixed0.cx;
          r.ok('smoke clouds: …and on screen it moved the way the wind blows', fixed30.n > 0 && Math.sign(shift) === Math.sign(windScreen) && Math.abs(shift) > 20, `moved ${shift.toFixed(0)} px, the wind is ${(windScreen * 100).toFixed(0)}% along the camera's right (side ${side.x.toFixed(1)},${side.z.toFixed(1)})`);
        }
      }
      sim.renderer.render(sim.scene, sim.camera);
      // What the smoke adds to the picture is counted two ways: the pixels it changes (n) and how much it changes
      // them (mass). A puff opens out to 3-6 times its size as it ages, so the footprint grows while the body
      // thins: the shape is judged by n, the wearing off by mass.
      const n = (t) => samples[t].n;
      const mass = (t) => samples[t].mass;
      const times = Object.keys(samples).map(Number);
      const line = times.map((t) => `${t}s ${samples[t].n}px`).join(', ');
      const peakMass = Math.max(...times.map(mass));
      r.ok('smoke clouds: right after the loop the smoke is plainly there (a ring of it, not a speck)', n(0) > 800, line);
      r.ok('smoke clouds: 30 s later the shape is still there (at least 60% of what it was)', n(30) >= n(0) * 0.6, `${n(30)} vs ${n(0)}`);
      r.ok('smoke clouds: …and it has opened out (a bigger footprint than when it was laid)', n(30) > n(0) * 1.3, `${n(30)} vs ${n(0)}`);
      r.ok('smoke clouds: 60 s later it is thin, and thinner than at 30 s', mass(60) < mass(30) * 0.6 && n(60) < n(30), `mass ${mass(60).toFixed(0)} vs ${mass(30).toFixed(0)}`);
      r.ok('smoke clouds: it is gone by 90 s — not one pixel of it', n(90) === 0, `${n(90)} px, ${F.smoke.liveCount(F.time)} puffs`);
      // Wearing off: from its peak, never back up, and no step of 5 s takes more than a third of the most there ever was.
      let up = 0;
      let step = 0;
      const tail = times.filter((t) => t >= 30);
      for (let i = 1; i < tail.length; i++) {
        up = Math.max(up, (mass(tail[i]) - mass(tail[i - 1])) / peakMass);
        step = Math.max(step, (mass(tail[i - 1]) - mass(tail[i])) / peakMass);
      }
      r.ok('smoke clouds: …wearing off steadily: never thicker again, and no 5 s step takes more than a third of it', up < 0.05 && step < 0.34, `largest rise ${(up * 100).toFixed(1)}%, largest 5 s drop ${(step * 100).toFixed(1)}% of the peak; mass ${tail.map((t) => mass(t).toFixed(0)).join(' ')}`);
      r.ok('smoke clouds: it stays soft — the mean change it makes to a pixel is small (a veil, not a wall)', samples[0].mean < 60, `${samples[0].mean.toFixed(1)} of 255 on average`);
      // The ring is bigger than it started (it grows 3 to 6 times).
      F.smoke.points.visible = true;
      sim.renderer.render = stub;
      unhook();
    }

    /* ---- 4. the flicker probe, with smoke streaming ------------------------------------ */
    say('smoke clouds: the flicker probe');
    sim.renderer.render = real || stub;
    for (const s of [
      { name: 'white by day', time: 'day', colour: 'white' },
      { name: 'Rainbow at sunset', time: 'sunset', colour: 'rainbow' },
    ]) {
      if (!real) {
        r.ok(`smoke clouds: ${s.name} — flicker probe`, false, 'no real renderer');
        continue;
      }
      await scenario({ altFt: 3000, view: 'chase', look: 'level', time: s.time, condition: 'clear', speed: 70 });
      F.data.smoke.color = s.colour;
      sim.step(0.2, 1 / 30);
      pressT();
      const m = await P.measure(sim, { frames: 60, fps: 30, warm: 3 });
      r.ok(`smoke clouds: ${s.name} — the flicker probe finds nothing (under 0.5% of the screen, under 2% of any field by WCAG)`, m.percArea <= 0.005 && m.wcagWindow <= 0.02, `perceptual ${(m.percArea * 100).toFixed(3)}%, WCAG window ${(m.wcagWindow * 100).toFixed(3)}%, smoke ${F.smoke.liveCount(F.time)} puffs`);
      if (sim._flickerRestore) sim._flickerRestore();
    }
    sim.renderer.render = stub;

    /* ---- 5. the cost ----------------------------------------------------------------- */
    say('smoke clouds: the cost');
    await scenario({ altFt: 3000, view: 'chase', look: 'level' });
    sim.step(0.2, 1 / 30);
    const upd = ext.extensions().find((e) => e.id === 'fun').update;
    F.smokeOn = true;
    for (let k = 0; k < 600; k++) upd(sim, 1 / 30);
    F.smokeOn = false;
    F.tank.reset();
    const N = 240;
    const t0 = performance.now();
    F.smokeOn = true;
    for (let k = 0; k < N; k++) {
      sim.aircraft.pos.x += 2;
      upd(sim, 1 / 30);
    }
    const ms = (performance.now() - t0) / N;
    F.smokeOn = false;
    r.ok('smoke clouds: with the pool full of old and new smoke the work it does stays small', ms < 0.6, `${ms.toFixed(3)} ms a frame; ${F.smoke.liveCount(F.time)} puffs live, ${F.smoke.hi} slots drawn of ${F.smoke.max}`);
    // Drawing it. A full trail AND an old cloud (smoke to the end of the tank, half a minute of waiting, more
    // smoke) around a plane flying a circle, so all of it is near the camera; the same frame drawn with the smoke
    // and without it, alternating, medians. This graphics card is a software one when the suite runs headless,
    // so the allowance is wide; on a real one the smoke costs next to nothing (the old trail measured the same).
    if (!real) {
      r.ok('smoke clouds: the cost of drawing it', false, 'no real renderer');
    } else {
      await scenario({ altFt: 3000, view: 'chase', look: 'level', time: 'day', condition: 'clear', heading: 0, speed: 80, windKts: 8 });
      sim.renderer.render = stub;
      const ac = sim.aircraft;
      const Rc = 300;
      const start = ac.pos.clone();
      const base = ac.quat.clone();
      const qy = new THREE.Quaternion();
      const Y = new THREE.Vector3(0, 1, 0);
      let a = 0;
      hook(ac, function circle(dt) {
        a += (80 / Rc) * dt;
        this.pos.set(start.x + Rc * Math.sin(a), start.y, start.z - Rc + Rc * Math.cos(a));
        qy.setFromAxisAngle(Y, -a);
        this.quat.copy(base).multiply(qy);
        this.vel.set(0, 0, -80).applyQuaternion(this.quat);
      });
      sim.step(0.3, 1 / 30);
      F.smoke.clear();
      F.tank.reset();
      pressT();
      sim.step(21, 1 / 30);
      if (F.smokeOn) pressT();
      sim.step(30, 1 / 30);
      pressT();
      sim.step(15, 1 / 30);
      pressT();
      const live = F.smoke.liveCount(F.time);
      const gl = sim.renderer.getContext();
      const px = new Uint8Array(4);
      const frame = () => {
        const t0 = performance.now();
        real.call(sim.renderer, sim.scene, sim.camera);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        return performance.now() - t0;
      };
      const med = (xs) => xs.slice().sort((p, q) => p - q)[xs.length >> 1];
      const cx = start.x;
      const cz = start.z - Rc;
      const cy = start.y;
      const worst = { name: '', ms: -1e9 };
      const line = [];
      for (const pose of ['far', 'inside', 'chase']) {
        if (pose === 'far') sim.camera.position.set(cx + 700, cy + 60, cz);
        if (pose === 'inside') sim.camera.position.set(cx + 20, cy - 10, cz);
        if (pose === 'far') sim.camera.lookAt(cx, cy, cz);
        if (pose === 'inside') sim.camera.lookAt(cx, cy + 20, cz - 300);
        sim.camera.updateMatrixWorld(true);
        for (let i = 0; i < 3; i++) frame();
        const on = [];
        const off = [];
        for (let i = 0; i < 30; i++) {
          F.smoke.points.visible = true;
          on.push(frame());
          F.smoke.points.visible = false;
          off.push(frame());
        }
        F.smoke.points.visible = true;
        const d = med(on) - med(off);
        line.push(`${pose} ${med(on).toFixed(1)} vs ${med(off).toFixed(1)} ms`);
        if (d > worst.ms) {
          worst.ms = d;
          worst.name = pose;
        }
      }
      unhook();
      r.ok('smoke clouds: drawing a full trail and an old cloud (' + live + ' puffs) costs under 4 ms a frame over not drawing it', live > 1000 && worst.ms < 4, `${line.join('; ')}; worst ${worst.name} +${worst.ms.toFixed(1)} ms`);
      r.ok('smoke clouds: …and once a frame has drawn it the card has the whole pool, so from then on only what changed is sent', F.smoke.full === false && F.smoke.aPos.updateRanges.length <= 48, `full ${F.smoke.full}, ${F.smoke.aPos.updateRanges.length} ranges waiting`);
    }
    sim.quitToMenu('main');
  } finally {
    unhook();
    sim.renderer.render = stub;
    if (sim._flickerRestore) sim._flickerRestore();
    sim.override = null;
    if (F.data && F.data.smoke) F.data.smoke.color = colour0;
    F.smokeOn = false;
    if (F.smoke) F.smoke.points.visible = true;
    if (sim.settings.reduceFlashing !== reduce0) sim.applySetting('reduceFlashing', reduce0 !== false);
    if (sim.state !== 'menu' && typeof sim.quitToMenu === 'function') sim.quitToMenu('main');
    sim.autoPauseOnHide = origAuto;
  }
  return r;
}

/** The mean place (x, y, z) of the puffs still in the air at `time`, where the wind has taken them. */
function meanPlace(F, time) {
  const s = F.smoke;
  let n = 0;
  let x = 0;
  let y = 0;
  let z = 0;
  for (let i = 0; i < s.max; i++) {
    const age = time - s.aBirth.getX(i);
    if (age < 0 || age > 84) continue;
    n++;
    x += s.aPos.getX(i) + s.drift.x;
    y += s.aPos.getY(i) + s.drift.y;
    z += s.aPos.getZ(i) + s.drift.z;
  }
  return n ? [x / n, y / n, z / n] : [0, 0, 0];
}
