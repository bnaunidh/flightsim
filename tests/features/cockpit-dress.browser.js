/**
 * The cockpits in the real game: the owner's "COCKPIT DOESNT EVEN UPDATE", and
 * what features/cockpit-dress.js adds.
 *
 *   1. In the seat, on High and Low, in the clean and the realistic view: with
 *      the aeroplane's state changed through the game's own controls, every
 *      screen is repainted AND reaches the card (its texture's version moves,
 *      and the pixels on the real frame buffer change where it is on screen),
 *      and every part flagged as moving (needles, levers, yokes, sticks,
 *      pedals, cards) has moved. Allowed to stand: the lamps nothing lit, and
 *      the OFF flags, a dead radio's cover, the trim wheel (nothing trimmed),
 *      the speed brake (not pulled) and the carburettor heat (not modelled).
 *      The autopilot panel shows what is SET, so it stands too.
 *   2. The same after remountCockpit(): what the game does when a real skin
 *      arrives mid-flight.
 *   3. The dress: each room gets it once, only in the seat, within its draws;
 *      no new canvas on Low beyond the one printed sheet; the dials it adds run.
 */
const STANDS = /OFF flag|dead display|lamp |trim wheel|^throttle$|UNSAFE|speed brake|carb/;
const DRAWS = { low: 2, high: 3 };

function pose(o) {
  const uv = o.material && o.material.map && o.material.map.matrixAutoUpdate === false ? o.material.map.matrix.elements.join() : '';
  return [o.position.x, o.position.y, o.position.z, o.rotation.x, o.rotation.y, o.rotation.z, uv].join();
}

function hash(c) {
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let h = 0;
  for (let i = 0; i < d.length; i += 28) h = (h * 31 + d[i] + d[i + 1] * 3 + d[i + 2] * 7) | 0;
  return h;
}

export async function moveAndWatch(sim, THREE, id, r, tag) {
  const gl = sim.renderer.getContext();
  const cp = sim.cockpit;
  const ud = cp.userData;
  const dyn = [];
  cp.traverse((o) => {
    if (o.userData.dynamic && o.name !== 'needles') dyn.push(o);
  });
  const name = (o) => {
    const p = [];
    for (let x = o; x && x !== cp && p.length < 2; x = x.parent) p.push(x.name || x.type);
    return p[0] === 'Group' ? p.join('<') : p[0];
  };
  const shot = () => {
    const W = gl.drawingBufferWidth;
    const H = gl.drawingBufferHeight;
    const px = new Uint8Array(W * H * 4);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return { px, W, H };
  };
  const snap = () => ({
    disp: (ud.displays || []).map((d) => ({ h: hash(d.canvas), v: d.texture.version })),
    dyn: dyn.map(pose),
    batch: ((ud.panel && ud.panel.batches) || []).map((b) => b.mesh.geometry.attributes.position.version),
  });
  const a = snap();
  sim.step(1 / 30);
  const pa = shot();
  const ac = sim.aircraft;
  sim.override = { throttle: ac.controls && ac.controls.throttle > 0.5 ? 0 : 1, pitch: 0.5, roll: 0.6, yaw: 0.6 };
  ac.gearDown = !ac.gearDown;
  ac.setFlaps(ac.flapsTarget > 0.3 ? 0 : 2);
  if (ac.fuel) ac.fuel *= 0.7;
  sim.step(1.2);
  ac.pos.y += 250;
  ac.quat.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0.15, 0.6, 0.3)));
  ac.vel.multiplyScalar(0.8);
  sim.step(1);
  const b = snap();
  sim.step(1 / 30);
  const pb = shot();
  sim.override = null;
  const screens = ud.displays || [];
  const frozen = screens.filter((d, i) => !/^(MCP|FCU)$/.test(d.name) && a.disp[i].h === b.disp[i].h).map((d) => d.name);
  const noUpload = screens.filter((d, i) => !/^(MCP|FCU)$/.test(d.name) && a.disp[i].v === b.disp[i].v).map((d) => d.name);
  r.ok(`cockpit dress: ${id} ${tag}: every screen is repainted and sent to the card`, !frozen.length && !noUpload.length, `frozen ${frozen.join()} / not uploaded ${noUpload.join()}`);
  const still = [...new Set(dyn.filter((o, i) => a.dyn[i] === b.dyn[i]).map(name))].filter((n) => !STANDS.test(n));
  r.ok(`cockpit dress: ${id} ${tag}: every moving part moved`, !still.length, still.join(' ; '));
  r.ok(`cockpit dress: ${id} ${tag}: the needles' vertices went to the card`, a.batch.every((v, i) => b.batch[i] > v), `${a.batch} -> ${b.batch}`);
  const v = new THREE.Vector3();
  let shown = 0;
  let dark = [];
  screens.forEach((d) => {
    if (/^(MCP|FCU)$/.test(d.name) || d.hud) return;
    d.mesh.updateMatrixWorld(true);
    v.setFromMatrixPosition(d.mesh.matrixWorld).project(sim.camera);
    if (v.z > 1 || Math.abs(v.x) > 0.9 || Math.abs(v.y) > 0.9) return;
    const cx = Math.round(((v.x + 1) / 2) * pa.W);
    const cy = Math.round(((v.y + 1) / 2) * pa.H);
    let diff = 0;
    let n = 0;
    for (let y = Math.max(0, cy - 14); y < Math.min(pa.H, cy + 14); y += 2) {
      for (let x = Math.max(0, cx - 14); x < Math.min(pa.W, cx + 14); x += 2) {
        const i = (y * pa.W + x) * 4;
        n++;
        if (Math.abs(pa.px[i] - pb.px[i]) + Math.abs(pa.px[i + 1] - pb.px[i + 1]) > 18) diff++;
      }
    }
    shown++;
    if (diff / n < 0.05) dark.push(d.name);
  });
  r.ok(`cockpit dress: ${id} ${tag}: what the screens show changes on the real picture`, !dark.length, `${shown} on screen; unchanged: ${dark.join()}`);
}

export async function check(sim, r, say = () => {}) {
  const THREE = await import('../../src/vendor/three.module.js');
  const { DRESS, fillLevel } = await import('../../src/features/cockpit-dress.js');
  const isStub = /^\(\)=>\{\}$/.test(String(sim.renderer.render).replace(/\s/g, ''));
  const stub = sim.renderer.render;
  const real = (typeof window !== 'undefined' && window.__realRender) || (isStub ? null : stub);
  if (real) sim.renderer.render = real;
  const qWas = sim.settings.quality;
  const rWas = !!sim.settings.realisticCockpit;
  sim.autoPauseOnHide = false;
  const calm = { airborne: true, time: 'day', condition: 'clear', windSpeedKts: 0, windDirDeg: 90 };
  try {
    r.ok('cockpit dress: the fill follows the light, and is small', fillLevel({ time: 'day' }) === DRESS.fill && fillLevel({ time: 'night' }) < DRESS.fill / 2 && DRESS.fill < 0.15);
    const sets = [['high', false, ['skylark', 'a320', 'b737', 'b747', 'h145', 'f22']], ['high', true, ['skylark', 'a320', 'h145']], ['low', false, ['skylark', 'a320', 'h145']], ['low', true, ['a320']]];
    for (const [q, realistic, ids] of sets) {
      sim.applySetting('quality', q);
      sim.applySetting('realisticCockpit', realistic);
      const tag = `${q}, ${realistic ? 'realistic' : 'clean'}`;
      for (const id of ids) {
        say(`cockpit dress: ${id} ${tag}`);
        await sim.startMode('free', { ...calm, aircraft: id });
        sim.step(0.3);
        const before = sim.cockpit.children.length;
        r.ok(`cockpit dress: ${id}: nothing is added before you sit in it`, !sim.cockpit.userData.dress);
        sim.rig.setMode('cockpit');
        sim.step(1);
        const dr = sim.cockpit.userData.dress;
        r.ok(`cockpit dress: ${id} ${tag}: dressed, within its draws`, !!dr && dr.draws <= DRESS_DRAWS(q) && sim.cockpit.children.length >= before, dr ? `${dr.draws} draws, ${dr.fill.length} materials` : 'none');
        await moveAndWatch(sim, THREE, id, r, tag);
        if (q === 'high' && !realistic && id !== 'f22') {
          sim.remountCockpit();
          sim.step(1);
          r.ok(`cockpit dress: ${id}: a cockpit built again in flight is dressed again`, !!sim.cockpit.userData.dress, sim.cockpit.userData.remounted);
          await moveAndWatch(sim, THREE, id, r, 'after a remount');
        }
        sim.rig.setMode('chase');
        sim.quitToMenu('main');
      }
    }
  } catch (e) {
    r.ok('cockpit dress: the checks ran', false, String((e && e.stack) || e).slice(0, 400));
  } finally {
    sim.override = null;
    sim.renderer.render = stub;
    sim.applySetting('quality', qWas);
    sim.applySetting('realisticCockpit', rWas);
    if (sim.state !== 'menu') sim.quitToMenu('main');
  }
}

const DRESS_DRAWS = (q) => (q === 'low' ? DRAWS.low : DRAWS.high);
