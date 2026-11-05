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
 *   - the fin wears the scheme's own canvas, on coordinates that stay on it;
 *   - no scrap of the fuselage is left in the wing's paint (the lightning bolts
 *     on a dark belly), the fan cowls wear the cowl skin with its ring, and no
 *     wing wears the cowl's;
 *   - winglets take the scheme's colour;
 *   - the name is its own patch of the hull, reads left to right on both sides, and is not stretched;
 *   - on every type of every airline, the name is at least 3:1 against the paint
 *     directly behind it, and its letters are heavy enough to hold up;
 *   - a skin lettered before the faces landed is lettered again when they do.
 * The A-10 has no livery map by design (painted flat in its own greys).
 */
export async function check(sim, r, say = () => {}) {
  const R = await import('../../src/aircraft/real-models.js');
  const A = await import('../../src/aircraft/model-adapter.js');
  const L = await import('../../src/aircraft/liveries.js');
  const T = await import('../../src/aircraft/types.js');
  const THREE = await import('../../src/vendor/three.module.js');
  const ART = await import('../../src/fleet/extra/livery-art.js');
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
    return { share: n ? coloured / n : 0, maps, meshes, canvas: canvasShare(skin) };
  };
  /*
   * How much of the livery canvas itself is paint (same colour test). A sparse scheme on a big
   * freighter (the C-5 in Abyssinia Air: white, a window row and a registration; 1.5% of its own
   * canvas, the procedural C-5 the same) cannot put 2% on the side: the skin is held to what its
   * canvas carries, and to 2% wherever the canvas carries more.
   */
  const canvasShare = (skin) => {
    let img = null;
    skin.traverse((o) => {
      if (!img && o.isMesh && /^skin_/.test(o.parent && o.parent !== skin ? o.parent.name : o.name) && o.material.map && o.material.map.image && o.material.map.image.getContext) img = o.material.map.image;
    });
    if (!img) return 0;
    const d = img.getContext('2d').getImageData(0, 0, img.width, img.height).data;
    let c = 0;
    let n = 0;
    for (let y = 0; y < img.height; y += 2) {
      for (let x = 0; x < img.width; x += 2) {
        const p = (y * img.width + x) * 4;
        const mx = Math.max(d[p], d[p + 1], d[p + 2]);
        const mn = Math.min(d[p], d[p + 1], d[p + 2]);
        n++;
        if (mx - mn > 40 || mx < 170) c++;
      }
    }
    return n ? c / n : 0;
  };
  /** The colour of the fin: its paint's own, or the average of its canvas. */
  const finOf = (skin) => {
    let c = null;
    skin.traverse((o) => {
      if (c || !o.isMesh || !o.parent || o.parent.name !== 'fin' || !o.material || !o.material.color) return;
      c = o.material.color.clone();
      const img = o.material.map && o.material.map.image;
      if (!img || !img.getContext) return;
      const d = img.getContext('2d').getImageData(0, 0, img.width, img.height).data;
      const rgb = [0, 0, 0];
      for (let i = 0; i < d.length; i += 4) for (let k = 0; k < 3; k++) rgb[k] += d[i + k];
      c = new THREE.Color().setRGB(rgb[0] / (d.length / 4) / 255, rgb[1] / (d.length / 4) / 255, rgb[2] / (d.length / 4) / 255, THREE.SRGBColorSpace);
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
      if (!(cov.share >= Math.min(0.02, 0.7 * cov.canvas))) bad.push(`${what}: the side is ${(100 * cov.share).toFixed(1)}% livery (plain white; its canvas ${(100 * cov.canvas).toFixed(1)}%)`);
      const fin = finOf(rm.skin);
      const body = new THREE.Color(rp.base || '#ffffff');
      if (!fin || (lum(fin) > 0.8 && Math.abs(lum(fin) - lum(body)) < 0.08)) bad.push(`${what}: the fin is the body's white (#${fin ? fin.getHexString() : '?'})`);
      const titled = livery && livery.id && livery.id !== 'house' && (livery.titling || livery.title);
      if (titled && !(rp.decals && rp.decals.length)) bad.push(`${what}: no titles painted`);
    }
    r.ok(`real livery: ${id} wears its livery — house colours, no paint given, ${airlines.length} airline${airlines.length === 1 ? '' : 's'}${flat ? ' (flat by design)' : ''}`, bad.length === 0, bad.slice(0, 4).join('; '));
  }

  /* The paint that fits the real airframe (fleet/extra/real-paint.js). */
  const parts = (skin) => {
    const out = {};
    skin.traverse((o) => {
      if (!o.isMesh) return;
      const role = o.parent && o.parent !== skin ? o.parent.name : o.name;
      (out[role] = out[role] || []).push(o);
    });
    return out;
  };
  const wearing = async (id, liv) => {
    const type = T.getAircraft(id);
    await R.loadRealModel(id);
    const m = A.createAircraftModel({ type, livery: L.schemeFor(type, liv), realModel: true });
    for (let i = 0; i < 40 && !(m.userData.realModel && m.userData.realModel.skin); i++) await new Promise((res) => setTimeout(res, 50));
    return m;
  };
  for (const [id, liv] of [['a320', 'continental'], ['a321', 'riverdelta'], ['b737', 'oversea'], ['b777', 'royalisles'], ['b787', 'bharat'], ['a350', 'pearlgulf'], ['b747', 'parcelbrown'], ['a380', 'desertpearl'], ['q400', 'oversea']]) {
    const m = await wearing(id, liv);
    const scheme = L.findLivery(liv);
    const rp = m.userData.realPaint;
    const skin = m.userData.realModel.skin;
    const p = parts(skin);
    const bad = [];
    // The fin.
    for (const o of p.fin || []) {
      if (!o.material.map || !/airliner-fin/.test(o.material.map.name)) bad.push('fin without its canvas');
      // Corners may run past the canvas (a fillet): the canvas's edge is what they get, so it must clamp.
      if (o.material.map && o.material.map.wrapS !== THREE.ClampToEdgeWrapping) bad.push('fin canvas repeats');
    }
    // No body in the wing's mesh: every triangle in it reaches out past the fuselage, or is the tailplane's or a nacelle's.
    const hull = rp.hull;
    const W = hull.section((hull.zMin + hull.zMax) / 2).w;
    for (const o of p.wing || []) {
      const g = o.geometry;
      const q = g.attributes.position;
      const idx = g.index;
      let stray = 0;
      for (let t = 0; idx && t < idx.count; t += 3) {
        const v = [idx.getX(t), idx.getX(t + 1), idx.getX(t + 2)];
        if (v.every((i) => Math.abs(q.getX(i)) < 0.9 * W)) stray++;
      }
      if (stray) bad.push(`${stray} body triangles in the wing's paint`);
    }
    // The cowls.
    const fan = (scheme.fleet || []).length && rp.engines.some((e) => e.kind === 'jet');
    if (fan) for (const o of p.cowl || []) if (!o.material.map || !/airliner-cowl/.test(o.material.map.name)) bad.push('cowl without its skin');
    // And nothing but a nacelle in the cowl's paint: the 737's wing came in with it, in the engine's colour to the tip.
    for (const o of p.cowl || []) {
      const q = o.geometry.attributes.position;
      const idx = o.geometry.index;
      const jets = rp.engines.filter((e) => e.kind === 'jet');
      for (let t = 0; jets.length && idx && t < idx.count; t++) {
        const i = idx.getX(t);
        if (!jets.some((e) => Math.hypot(q.getX(i) - e.x, q.getY(i) - e.y) < e.radius * 1.8)) {
          bad.push('wing in the cowl\'s paint');
          break;
        }
      }
    }
    // The wing's own paint, the winglet in it.
    for (const o of p.wing || []) if (!o.material.map || !/airliner-wing/.test(o.material.map.name) || !o.material.map.name.includes(new THREE.Color(ART.artFor(scheme).winglet).getHexString())) bad.push(`wing paint ${o.material.map && o.material.map.name}`);
    // The name: its own patch of this hull, not paint in the skin, reading left to right from each side.
    const d = rp.decals.find((x) => x.texture.userData.text === scheme.titling);
    if (!d) bad.push('no titles');
    else {
      const patch = (p.real_title || [])[0];
      if (!patch || !d.meshed) bad.push('the name has no patch on this hull');
      else {
        const q = patch.geometry.attributes.position;
        const uv = patch.geometry.attributes.uv;
        const dir = [0, 0];
        for (let t = 0; t + 2 < q.count; t += 3) {
          for (const [i, j] of [[t, t + 1], [t + 1, t + 2], [t + 2, t]]) dir[q.getX(t) < 0 ? 0 : 1] += (uv.getX(j) - uv.getX(i)) * (q.getZ(j) - q.getZ(i));
        }
        if (!(dir[0] > 0 && dir[1] < 0)) bad.push(`the name reads the same way round on both sides (${dir.map((v) => v.toFixed(1))})`);
      }
      // The mark faces forward on both sides, so the two faces of the fin take one canvas (node checks it); and
      // the name's own proportions: the patch's shape in metres is the texture's.
      const im = d.texture.image;
      if (Math.abs(im.width / im.height - d.w / d.h) / (d.w / d.h) > 0.03) bad.push('the name is stretched');
    }
    r.ok(`real livery: ${id} in ${liv} — fin canvas, body and nacelle scraps sorted, cowl and wing paint, the name both ways round`, bad.length === 0, [...new Set(bad)].slice(0, 4).join('; '));
    if (m.userData.dispose) m.userData.dispose();
  }

  /* The name against the paint behind it, on the canvas itself, every airline on every type it flies. */
  {
    const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    const lum = (d, p) => 0.2126 * lin(d[p] / 255) + 0.7152 * lin(d[p + 1] / 255) + 0.0722 * lin(d[p + 2] / 255);
    const inkOf = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    const worst = [];
    const thin = [];
    let n = 0;
    for (const l of L.AIRLINE_LIVERIES) {
      for (const id of l.fleet) {
        if (id === 'meridian') continue;
        const type = T.getAircraft(id);
        const m = A.createAircraftModel({ type, livery: L.schemeFor(type, l.id) });
        const rp = m.userData.realPaint;
        const d = rp.decals.find((x) => x.texture.userData.text === l.titling);
        const cv = rp.texture.image;
        const px = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
        const ink = lum(inkOf(l.style.titleInk || '#1f272e'), 0);
        const list = [];
        for (let i = 0; i <= 20; i++) {
          for (let j = 2; j <= 8; j++) {
            const z = d.z - d.w / 2 + (d.w * i) / 20;
            const y = d.y - d.h / 2 + (d.h * j) / 10;
            const x = Math.min(cv.width - 1, Math.round(rp.along(z) * cv.width));
            const row = Math.min(cv.height - 1, Math.round((1 - rp.vAt(z, y)) * cv.height));
            const b = lum(px, (row * cv.width + x) * 4);
            list.push((Math.max(b, ink) + 0.05) / (Math.min(b, ink) + 0.05));
          }
        }
        list.sort((a, b) => a - b);
        const c = list[Math.floor(list.length * 0.05)];
        n++;
        if (!(c >= 3)) worst.push(`${id}/${l.id} ${c.toFixed(2)}`);
        // Heavy enough: the share of the cap band that is ink.
        const im = d.texture.image;
        const t = im.getContext('2d').getImageData(0, 0, im.width, im.height).data;
        const [r0, r1] = [Math.round(im.height * 0.21), Math.round(im.height * 0.79)];
        let on = 0;
        let all = 0;
        for (let r = r0; r < r1; r++) {
          for (let x = 0; x < im.width; x++) {
            all++;
            if (t[(r * im.width + x) * 4 + 3] > 128) on++;
          }
        }
        if (on / all < 0.2) thin.push(`${l.id} ${(on / all).toFixed(2)}`);
        if (m.userData.dispose) m.userData.dispose();
      }
    }
    r.ok(`real livery: the name is 3:1 or better against the paint behind it, ${n} aeroplanes`, worst.length === 0, worst.slice(0, 6).join('; '));
    r.ok('real livery: every name is heavy enough (a fifth of its cap band is ink)', thin.length === 0, [...new Set(thin)].slice(0, 6).join('; '));
  }

  /* A cold start: a real skin lettered before the faces land is lettered again when they do. */
  {
    const F = await import('../../src/render/airline-fonts.js');
    const land = F.holdFonts();
    // (a word this page has not lettered yet: a texture from the cache would be in its face already)
    const type = T.getAircraft('a380');
    const m = A.createAircraftModel({ type, livery: { ...L.findLivery('oversea'), titling: 'Cold Start' }, realModel: true });
    for (let i = 0; i < 40 && !(m.userData.realModel && m.userData.realModel.skin); i++) await new Promise((res) => setTimeout(res, 50));
    const rp = m.userData.realPaint;
    const d = rp.decals.find((x) => x.texture.userData.text === 'Cold Start');
    const held = d && d.texture.userData.fallback === true;
    const map = d.texture; // the name's own canvas: a patch of the hull wears it (fleet/extra/real-paint.js decalPatch)
    const before = map.version;
    land();
    r.ok('real livery: a name lettered before the faces landed is drawn again, on the real skin too', held && d.texture.userData.fallback !== true && map.version > before, `v${before} -> v${map.version}`);
    if (m.userData.dispose) m.userData.dispose();
  }

  // The hangar's swatches come from the same drawing: the mark on the tail colour.
  const canvas = ART.markCanvas('tulip', ['#f4f7fa', '#0a3b6e'], 128);
  r.ok('real livery: a mark can be drawn for a swatch', canvas.width === 128);
}
