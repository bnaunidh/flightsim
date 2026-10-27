/**
 * Browser checks for the high-speed shake hotfix and the first-run seizure
 * warning, in the real game (tests/features/shake.mjs and safety-intro.mjs
 * did the numbers in node):
 *
 *   1. T-Pose Harrison in the follow view at 549 kt, 3,540 ft, full power,
 *      through the game's own frame loop (sim.update) with uneven frames
 *      (a fifth of them twice as long): he stays put on the screen — his
 *      size and place change by less than the comfort cap frame to frame.
 *      Before the fix he grew and shrank by 19-39% and jumped up to 13 degrees.
 *   2. The World Map — Preview, Harrison 44 km out, Tower view: a lens within
 *      12 km of him, inside the sky dome and over the sea (the owner's black
 *      void), every field's tower known to the rig (5 in wave 16, 16 since the bigger world).
 *   3. The seizure warning, put up as Settings does: the standard wording and
 *      "Possible seizure warning", both switches are the game's own settings
 *      (Reduce flashing on), flipping one flips the game's, Enter continues
 *      and the menu behind it never hears the key, it fits the screen with a
 *      16 px gutter, it is remembered, and it is gone from the page.
 *
 * `check(sim, r, say)`; every import dynamic. Everything it changes is put back.
 */
const wait = (ms) => new Promise((res) => setTimeout(res, ms));

export async function check(sim, r, say) {
  const THREE = await import('../../src/vendor/three.module.js');
  const R = await import('../../src/aircraft/reheat.js');
  const FS = await import('../../src/render/flash-safety.js');
  const log = (m) => { if (say) say(`shake: ${m}`); };
  const origAuto = sim.autoPauseOnHide;
  sim.autoPauseOnHide = false;
  const before = { map: sim.settings.map, rf: sim.settings.reduceFlashing, rm: sim.settings.reducedMotion };
  try {
    /* ---- 1. Harrison at 549 kt ---- */
    log('Harrison, 549 kt, follow view, uneven frames');
    await sim.startMode('free', { aircraft: 'tpose', airborne: true, time: 'day', condition: 'clear', windSpeedKts: 0, loadingScreen: false });
    const ac = sim.aircraft;
    const tas = 549 / 1.94384;
    ac.reset({ pos: new THREE.Vector3(-2500, 0, 0), headingDeg: 90, speed: tas, altAGL: 1080, engineOn: true });
    if (sim.input) sim.input.throttleTarget = 1;
    sim.rig.setMode('chase');
    const cam = sim.camera;
    const frame = sim.rig.frame;
    const radius = frame ? frame.radius || 2 : 2;
    const size = [];
    const place = [];
    const v = new THREE.Vector3();
    for (let i = 0; i < 60 * 4; i++) {
      sim.update(i % 5 === 4 ? 2 / 60 : 1 / 60);
      if (i < 60) continue;
      cam.updateMatrixWorld();
      const aim = sim.rig.aimPoint(ac);
      const d = aim.distanceTo(cam.position);
      v.copy(aim).applyMatrix4(cam.matrixWorldInverse);
      size.push(2 * Math.atan(radius / Math.max(0.5, d)) * (180 / Math.PI));
      place.push(Math.hypot(Math.atan2(v.x, -v.z), Math.atan2(v.y, -v.z)) * (180 / Math.PI));
    }
    const jump = (a) => a.slice(1).reduce((m, x, i) => Math.max(m, Math.abs(x - a[i])), 0);
    const cap = FS.SHAKE_CAP_DEG || 0.15;
    r.ok('shake: Harrison at 549 kt in the follow view, uneven frames — his size and place move less than the cap frame to frame',
      !ac.crashed && jump(size) < cap && jump(place) < cap,
      `size ${jump(size).toFixed(3)} deg, place ${jump(place).toFixed(3)} deg a frame (cap ${cap}), Mach ${R.machOf(ac.airspeed, ac.pos.y).toFixed(2)}`);

    /* ---- 2. the tower on the World Map — Preview ---- */
    const wp = sim.worldPreview;
    if (wp && wp.choose && wp.whenBuilt) {
      log('World Map — Preview, tower view 44 km out');
      if (sim.state !== 'menu' && sim.quitToMenu) sim.quitToMenu();
      const done = wp.whenBuilt();
      wp.choose('haven');
      await Promise.race([done, wait(120000)]);
      await wait(50);
      await sim.startMode('free', { aircraft: 'tpose', airborne: true, loadingScreen: false });
      const a2 = sim.aircraft;
      a2.reset({ pos: new THREE.Vector3(44000, 0, 2000), headingDeg: 90, speed: 554 / 1.94384, altAGL: 1100, engineOn: true });
      sim.rig.setMode('tower');
      for (let i = 0; i < 30; i++) sim.update(1 / 60);
      sim.renderFrame();
      const c = sim.camera.position;
      const dome = sim.sky && sim.sky.mesh;
      const inDome = dome ? Math.hypot(c.x - dome.position.x, c.z - dome.position.z) < dome.scale.x * 0.9 : false;
      const sea = sim.ocean && sim.ocean.deep;
      const half = sea && sea.geometry && sea.geometry.parameters ? sea.geometry.parameters.width / 2 : 0;
      const onSea = sea ? Math.max(Math.abs(c.x - sea.position.x), Math.abs(c.z - sea.position.z)) < half * 0.9 : false;
      const towers = (sim.rig.towers || []).length;
      r.ok('shake: World Map — Preview, Harrison 44 km out, Tower view: a lens within 12 km of him, inside the sky dome, over the sea',
        c.distanceTo(a2.pos) < 12000 && inDome && onSea && towers >= 5,
        `${(c.distanceTo(a2.pos) / 1000).toFixed(1)} km off, in the dome ${inDome}, over the sea ${onSea}, ${towers} towers`);
      if (sim.state !== 'menu' && sim.quitToMenu) sim.quitToMenu();
      if (before.map && before.map !== sim.settings.map) sim.setMap(before.map);
      await wait(1500);
      r.ok('shake: back on a normal map the rig has only the start field\'s tower', !sim.rig.towers, String(sim.rig.towers && sim.rig.towers.length));
    }

    /* ---- 3. the seizure warning ---- */
    log('the seizure warning');
    if (sim.state !== 'menu' && sim.quitToMenu) sim.quitToMenu();
    const SI = await import('../../src/ui/safety-intro.js');
    let stored = null;
    try {
      stored = localStorage.getItem(SI.STORE_KEY);
      localStorage.removeItem(SI.STORE_KEY);
    } catch (e) {
      /* no storage: the remembering check below says so */
    }
    sim.applySetting('reduceFlashing', true);
    const heard = { n: 0 };
    const spy = () => heard.n++;
    document.addEventListener('keydown', spy);
    const shown = sim.showSafetyIntro({ skipIntro: true });
    await wait(900);
    const el = document.querySelector('.safety-intro');
    const card = el && el.querySelector('[data-si-card]');
    const text = card ? card.textContent : '';
    r.ok('shake: the warning is up, with the standard wording and "Possible seizure warning"',
      !!card && /photosensitive seizure warning/i.test(text) && /possible seizure warning/i.test(text) && /very small percentage of people/i.test(text) && /consult a doctor/i.test(text) && /parents should watch their children/i.test(text),
      text.slice(0, 120));
    const flash = el && el.querySelector('[data-si="reduceFlashing"]');
    const motion = el && el.querySelector('[data-si="reducedMotion"]');
    r.ok('shake: its switches are the game\'s own: Reduce flashing on, Reduce motion as set', !!flash && flash.checked === true && !!motion && motion.checked === !!sim.settings.reducedMotion);
    if (flash) flash.click();
    await wait(30);
    const offNow = FS.FLASH.reduce === false && sim.settings.reduceFlashing === false;
    if (flash) flash.click();
    await wait(30);
    r.ok('shake: flipping Reduce flashing on the card flips the game\'s (and back)', offNow && FS.FLASH.reduce === true && sim.settings.reduceFlashing === true);
    const rect = card ? card.getBoundingClientRect() : null;
    r.ok('shake: the card fits the screen with a 16 px gutter', !!rect && rect.left >= 15.5 && rect.right <= window.innerWidth - 15.5 && rect.top >= 0 && rect.bottom <= window.innerHeight + 0.5,
      rect ? `${Math.round(rect.left)}..${Math.round(rect.right)} of ${window.innerWidth}, ${Math.round(rect.top)}..${Math.round(rect.bottom)} of ${window.innerHeight}` : 'no card');
    const n0 = heard.n;
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
    const vals = await Promise.race([shown, wait(2000).then(() => null)]);
    await wait(900);
    let remembered = false;
    try {
      remembered = !!localStorage.getItem(SI.STORE_KEY);
    } catch (e) {
      remembered = false;
    }
    r.ok('shake: Enter continues — the menu behind it never heard the key — and it is remembered and gone from the page',
      !!vals && heard.n === n0 && remembered && !document.querySelector('.safety-intro') && !SI.isOpen(),
      `values ${JSON.stringify(vals)}, keys heard behind it ${heard.n - n0}, remembered ${remembered}`);
    document.removeEventListener('keydown', spy);
    try {
      if (stored == null) localStorage.removeItem(SI.STORE_KEY);
      else localStorage.setItem(SI.STORE_KEY, stored);
    } catch (e) {
      /* nothing to put back */
    }
    const btn = sim.menus && sim.menus.screens.settings && sim.menus.screens.settings.querySelector('[data-safety-intro]');
    r.ok('shake: Settings → Accessibility has "Show the photosensitive seizure warning"', !!btn && !!btn.closest('[data-panel="access"]'));
  } finally {
    sim.autoPauseOnHide = origAuto;
    try { sim.applySetting('reduceFlashing', before.rf !== false); } catch (e) { /* */ }
    try { sim.applySetting('reducedMotion', !!before.rm); } catch (e) { /* */ }
    try { sim.rig.setMode('chase'); } catch (e) { /* */ }
    try { if (sim.state !== 'menu' && sim.quitToMenu) sim.quitToMenu('main'); } catch (e) { /* */ }
  }
}
