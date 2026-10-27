/**
 * Every real model shows a livery (wave 18; the owner's World Map screenshots:
 * "the 747 real model is plain white"). tests/features/real-models.mjs holds
 * the files and that the skin has a texture and coordinates; this checks, in
 * the page, with the canvas the skin really wears, that what is painted on it
 * is a livery and not a white shell — for every real model, in its house
 * colours, in each airline that flies it, and built with no paint at all (the
 * TCAS drill, an NPC flyer, a rescue escort pass none):
 *
 *   - both fuselage sides carry the painted canvas (not a flat colour);
 *   - the side the camera sees carries the scheme: some of the area sampled
 *     off the canvas, through the skin's own coordinates, is the cheatline,
 *     the titles or the windows (not all one white);
 *   - the fin is in the scheme's tail colour (or its accent), never the white
 *     of the body;
 *   - an airline with a name has its titles painted on.
 * The A-10 has no livery map by design (painted flat in its own greys).
 */
export async function check(sim, r, say = () => {}) {
  const R = await import('../../src/aircraft/real-models.js');
  const A = await import('../../src/aircraft/model-adapter.js');
  const L = await import('../../src/aircraft/liveries.js');
  const T = await import('../../src/aircraft/types.js');
  const THREE = await import('../../src/vendor/three.module.js');
  say('real liveries');

  /** Area-weighted share of the side-facing skin whose sampled paint is not the plain body. */
  const sideCoverage = (skin) => {
    let n = 0;
    let coloured = 0;
    let maps = 0;
    let meshes = 0;
    skin.traverse((o) => {
      if (!o.isMesh) return;
      const role = o.parent && o.parent !== skin ? o.parent.name : o.name;
      if (!/^skin_/.test(role)) return;
      meshes++;
      const map = o.material.map;
      const img = map && map.image;
      if (!img || !img.getContext) return;
      maps++;
      const W = img.width;
      const H = img.height;
      const data = img.getContext('2d').getImageData(0, 0, W, H).data;
      const uv = o.geometry.attributes.uv;
      const pos = o.geometry.attributes.position;
      const idx = o.geometry.index;
      if (!uv) return;
      const flip = map.flipY !== false;
      const I = (t) => (idx ? idx.getX(t) : t);
      const tri = (idx ? idx.count : pos.count) / 3;
      let seed = 11;
      const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      for (let t = 0; t < tri; t++) {
        const a = I(t * 3);
        const b = I(t * 3 + 1);
        const c = I(t * 3 + 2);
        const ux = pos.getX(b) - pos.getX(a);
        const uy = pos.getY(b) - pos.getY(a);
        const uz = pos.getZ(b) - pos.getZ(a);
        const vx = pos.getX(c) - pos.getX(a);
        const vy = pos.getY(c) - pos.getY(a);
        const vz = pos.getZ(c) - pos.getZ(a);
        const nx = uy * vz - uz * vy;
        const area = Math.hypot(nx, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
        if (!(area > 0) || Math.abs(nx) / (2 * area) < 0.6) continue;
        for (let k = 0; k < 3; k++) {
          let p1 = rnd();
          let p2 = rnd();
          if (p1 + p2 > 1) {
            p1 = 1 - p1;
            p2 = 1 - p2;
          }
          const u = uv.getX(a) + (uv.getX(b) - uv.getX(a)) * p1 + (uv.getX(c) - uv.getX(a)) * p2;
          const v = uv.getY(a) + (uv.getY(b) - uv.getY(a)) * p1 + (uv.getY(c) - uv.getY(a)) * p2;
          const x = Math.min(W - 1, Math.max(0, Math.floor(u * W)));
          const y = Math.min(H - 1, Math.max(0, Math.floor((flip ? 1 - v : v) * H)));
          const p = (y * W + x) * 4;
          const mx = Math.max(data[p], data[p + 1], data[p + 2]);
          const mn = Math.min(data[p], data[p + 1], data[p + 2]);
          n += area;
          if (mx - mn > 40 || mx < 170) coloured += area;
        }
      }
    });
    return { share: n ? coloured / n : 0, maps, meshes };
  };
  const finOf = (skin) => {
    let c = null;
    skin.traverse((o) => {
      if (!c && o.isMesh && o.parent && o.parent.name === 'fin' && o.material && o.material.color) c = o.material.color.clone();
    });
    return c;
  };
  const lum = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

  for (const id of R.realModelIds()) {
    const type = T.getAircraft(id);
    if (!type || type.id !== id) continue;
    try {
      await R.loadRealModel(id);
    } catch (e) {
      r.ok(`real livery: ${id} loads`, false, String(e && e.message));
      continue;
    }
    const airlines = L.liveriesFor(type).filter((l) => !l.house).slice(0, 3);
    const cases = [['house colours', L.schemeFor(type, 'house')], ['no paint given', undefined], ...airlines.map((l) => [l.name, L.schemeFor(type, l.id)])];
    const bad = [];
    let flat = false;
    for (const [what, livery] of cases) {
      const m = A.createAircraftModel({ type, livery, realModel: true });
      for (let i = 0; i < 40 && !(m.userData.realModel && m.userData.realModel.skin); i++) await new Promise((res) => setTimeout(res, 50));
      const rm = m.userData.realModel;
      if (!rm || !rm.skin) {
        bad.push(`${what}: not worn (${rm && rm.state})`);
        continue;
      }
      const rp = m.userData.realPaint;
      if (!rp) {
        // Painted flat in its own colours by design (no livery map: the A-10).
        flat = true;
        continue;
      }
      const cov = sideCoverage(rm.skin);
      if (cov.maps < 2 || cov.maps < cov.meshes) bad.push(`${what}: ${cov.maps}/${cov.meshes} fuselage pieces painted`);
      if (!(cov.share >= 0.02)) bad.push(`${what}: the side is ${(100 * cov.share).toFixed(1)}% livery (plain white)`);
      const fin = finOf(rm.skin);
      const body = new THREE.Color(rp.base || '#ffffff');
      if (!fin || (lum(fin) > 0.8 && Math.abs(lum(fin) - lum(body)) < 0.08)) bad.push(`${what}: the fin is the body's white (#${fin ? fin.getHexString() : '?'})`);
      const titled = livery && livery.id && livery.id !== 'house' && (livery.titling || livery.title);
      if (titled && !(rp.decals && rp.decals.length)) bad.push(`${what}: no titles painted`);
    }
    r.ok(`real livery: ${id} wears its livery — house colours, no paint given, ${airlines.length} airline${airlines.length === 1 ? '' : 's'}${flat ? ' (flat by design)' : ''}`, bad.length === 0, bad.slice(0, 4).join('; '));
  }
}
