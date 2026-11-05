/**
 * The names and the marks, on the real canvases and the real meshes. The node
 * half is tests/features/wordmarks.mjs.
 *
 *   - the faces land, and the UI wears them: the body in Jost, the read-outs in
 *     Barlow Condensed, with digits that all take the same width;
 *   - a name's canvas is kerned and has ink in it, in every airline's real face;
 *   - THE MARKS ARE CENTRED, by measuring. For every airline on every type: the
 *     fin is painted with and without its mark, the difference is the mark's ink,
 *     and the centre of that ink must be the centre of the fin's visible area, on
 *     the game's own fin and, through its coordinates, on the real model's. All of
 *     the ink must be on the fin. Measured in the page, off the pixels.
 *   - on a real model the name is its own patch of that hull, on both sides, each
 *     reading left to right, and THAT model's wing stays under it from a chase
 *     camera; on a widebody it is a big name, not a tag.
 */
export async function check(sim, r, say = () => {}) {
  const R = await import('../../src/aircraft/real-models.js');
  const A = await import('../../src/aircraft/model-adapter.js');
  const L = await import('../../src/aircraft/liveries.js');
  const T = await import('../../src/aircraft/types.js');
  const ART = await import('../../src/fleet/extra/livery-art.js');
  const W = await import('../../src/fleet/extra/wordmarks.js');
  const F = await import('../../src/render/airline-fonts.js');
  const S0 = await import('../../src/fleet/extra/title-slot.js');
  const THREE = await import('../../src/vendor/three.module.js');
  await F.loadAirlineFonts();

  say('wordmarks: the UI type');
  const body = getComputedStyle(document.body);
  r.ok('type: the interface is in Jost', /^"?Jost/.test(body.fontFamily), body.fontFamily);
  await document.fonts.load('600 16px "Jost"');
  await document.fonts.load('700 16px "Barlow Condensed"');
  r.ok('type: the faces are in', document.fonts.check('600 16px "Jost"') && document.fonts.check('700 16px "Barlow Condensed"'));
  const probe = document.createElement('span');
  probe.style.cssText = 'font-family:var(--mono);font-size:40px;position:absolute;visibility:hidden';
  document.body.append(probe);
  const widths = [...'0123456789'].map((d) => {
    probe.textContent = d;
    return Math.round(probe.getBoundingClientRect().width * 10);
  });
  probe.remove();
  r.ok('type: read-outs do not jitter: every digit is one width', new Set(widths).size === 1, widths.join());

  say('wordmarks: the names');
  const air = L.AIRLINE_LIVERIES;
  for (const l of air) {
    const spec = W.WORDMARKS[l.id];
    for (const s of [spec, W.stackedWordmark(spec)].filter(Boolean)) {
      const lay = W.layoutWordmark(s, l.style.titleFont);
      const c = document.createElement('canvas');
      c.height = 128;
      c.width = Math.min(2048, Math.round(128 * lay.aspect));
      const g = c.getContext('2d');
      W.paintWordmark(g, s, l.style.titleFont, c.width, c.height, l.emblem);
      const d = g.getImageData(0, 0, c.width, c.height).data;
      let [ink, edge] = [0, 0];
      for (let y = 0, i = 3; y < c.height; y++) {
        for (let x = 0; x < c.width; x++, i += 4) {
          if (d[i] < 128) continue;
          ink++;
          if (x === 0 || y === 0 || x === c.width - 1 || y === c.height - 1) edge++;
        }
      }
      const share = ink / (c.width * c.height);
      r.ok(`wordmark: ${s.key || s.reads}: inked, and nothing cut by its patch`, share > 0.08 && edge === 0, `${(100 * share).toFixed(0)}% ink, ${edge} px on the edge`);
    }
  }

  say('wordmarks: the fins');
  const types = R.realModelIds().filter((id) => {
    const t = T.getAircraft(id);
    return t && t.id === id;
  });
  const profiles = [];
  for (const id of [...new Set([...types, 'concorde'])]) {
    const type = T.getAircraft(id);
    if (type.id !== id) continue;
    const m = A.createAircraftModel({ type, livery: L.schemeFor(type, air[0].id) });
    const rp = m.userData.realPaint;
    if (rp && rp.finProfile) profiles.push([id, rp.finProfile]);
    if (m.userData.dispose) m.userData.dispose();
  }
  r.ok('fins: the classes are all here', profiles.length >= 10 && ['a320', 'b777', 'a380', 'b747', 'q400'].every((i) => profiles.some((p) => p[0] === i)), profiles.map((p) => p[0]).join());
  const S = 256;
  const a = Object.assign(document.createElement('canvas'), { width: S, height: S }).getContext('2d', { willReadFrequently: true });
  const b = Object.assign(document.createElement('canvas'), { width: S, height: S }).getContext('2d', { willReadFrequently: true });
  const css = (c) => `#${new THREE.Color(c).getHexString()}`;
  const off = [];
  const out = [];
  let n = 0;
  for (const [id, P] of profiles) {
    const box = ART.finBox(P);
    const aim = ART.finCentre(P);
    const H = P.y1 - P.y0;
    for (const l of air) {
      const art = ART.artFor(l);
      const inks = (l.style.emblemInks || [l.base]).map(css);
      const tail = css(l.tail != null ? l.tail : l.accent);
      // On the plain colour: the mark's place does not depend on the fin's other paint, and two canvases
      // can edge a curved band differently, which is not ink.
      const plain = art && art.fin && art.fin.mark ? { mark: art.fin.mark } : null;
      ART.paintFin(a, S, P, plain, tail, l.emblem, inks);
      ART.paintFin(b, S, P, plain, tail, null, inks);
      const p = a.getImageData(0, 0, S, S).data;
      const q = b.getImageData(0, 0, S, S).data;
      let [x0, y0, x1, y1] = [S, S, -1, -1];
      let spill = 0;
      for (let y = 0, i = 0; y < S; y++) {
        for (let x = 0; x < S; x++, i += 4) {
          if (Math.abs(p[i] - q[i]) + Math.abs(p[i + 1] - q[i + 1]) + Math.abs(p[i + 2] - q[i + 2]) < 40) continue;
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
          // Every inked pixel on the fin itself.
          const z = box.zA + ((x + 0.5) / S) * (box.zB - box.zA);
          const ym = box.yB - ((y + 0.5) / S) * (box.yB - box.yA);
          const h = (ym - P.y0) / H;
          const le = P.le0 + (P.le1 - P.le0) * h;
          const ch = P.ch0 + (P.ch1 - P.ch0) * h;
          if (h < 0 || h > 1 || z < le || z > le + ch || (P.crown && ym < P.crown(z))) spill++;
        }
      }
      n++;
      if (x1 < 0) {
        off.push(`${id}/${l.id}: no ink`);
        continue;
      }
      const cz = box.zA + (((x0 + x1 + 1) / 2) / S) * (box.zB - box.zA);
      const cy = box.yB - (((y0 + y1 + 1) / 2) / S) * (box.yB - box.yA);
      const miss = Math.hypot(cz - aim.z, cy - aim.y) / H;
      if (miss > 0.025) off.push(`${id}/${l.id}: ${(100 * miss).toFixed(1)}% of the fin off`);
      if (spill > 0) out.push(`${id}/${l.id}: ${spill} px`);
    }
  }
  r.ok(`fins: on ${n} type-and-airline fins the mark's ink is centred on the fin's area, within 2.5% of its height`, off.length === 0, off.slice(0, 8).join('; '));
  r.ok('fins: all of the ink is on the fin', out.length === 0, out.slice(0, 8).join('; '));

  say('wordmarks: the real models');
  const parts = (skin) => {
    const got = {};
    skin.traverse((o) => {
      if (!o.isMesh) return;
      const role = o.parent && o.parent !== skin ? o.parent.name : o.name;
      (got[role] = got[role] || []).push(o);
    });
    return got;
  };
  for (const id of types) {
    const type = T.getAircraft(id);
    let tpl = null;
    try {
      tpl = await R.loadRealModel(id);
    } catch (e) {
      /* below */
    }
    if (!tpl) {
      r.ok(`real ${id}: the model loads`, false);
      continue;
    }
    for (const liv of ['riverdelta', 'dashfreight', 'abyssinia', 'parcelbrown']) {
      const m = A.createAircraftModel({ type, livery: L.schemeFor(type, liv), realModel: true });
      for (let i = 0; i < 40 && !(m.userData.realModel && m.userData.realModel.skin); i++) await new Promise((res) => setTimeout(res, 50));
      const rm = m.userData.realModel;
      const rp = m.userData.realPaint;
      if (!rm || !rm.skin || !rp) continue;
      const P = parts(rm.skin);
      const d = rp.decals.find((x) => x.title);
      if (!d) continue;
      const tag = `real ${id} in ${liv}`;
      const patch = P.real_title && P.real_title[0];
      r.ok(`${tag}: the name is its own patch of this hull`, !!patch && d.meshed === true, d.meshed);
      if (patch) {
        const p = patch.geometry.attributes.position;
        const uv = patch.geometry.attributes.uv;
        const dir = [0, 0];
        for (let t = 0; t + 2 < p.count; t += 3) {
          const side = p.getX(t) < 0 ? 0 : 1;
          for (const [i, j] of [[t, t + 1], [t + 1, t + 2], [t + 2, t]]) dir[side] += (uv.getX(j) - uv.getX(i)) * (p.getZ(j) - p.getZ(i));
        }
        r.ok(`${tag}: it reads left to right from each side`, dir[0] > 0 && dir[1] < 0, dir.map((v) => v.toFixed(2)).join());
      }
      // This model's own wing, off its vertices: the name may run back over the root, but from a chase
      // camera a little above the wing must not have risen to the foot of the letters by the end of it.
      const W0 = m.userData.fuselage.halfWidth;
      const [z1, y0] = [d.z + d.w / 2, d.y - d.h / 2];
      const rises = [];
      for (const o of P.wing || []) {
        const q = o.geometry.attributes.position;
        for (let i = 0; i < q.count; i++) {
          const x = Math.abs(q.getX(i));
          if (x > W0 * 1.1 && q.getZ(i) < z1) rises.push(q.getY(i) + x * S0.CHASE_RISE);
        }
      }
      rises.sort((u, v) => u - v);
      // (the 98th percentile: the role that holds the wing also holds a few strays of the file's sorting)
      const high = rises.length ? rises[Math.floor(rises.length * 0.98)] : -Infinity;
      if (Number.isFinite(high) && d.zone.a < rp.wing.rootZ) r.ok(`${tag}: this model's wing stays under the name from a chase camera`, high < y0 + 0.2, `wing ${high.toFixed(2)}, foot of the letters ${y0.toFixed(2)}`);
      // On this hull's own side: its crown, measured, is over the top of the letters.
      let crown = -Infinity;
      for (const k of ['skin_l', 'skin_r']) {
        for (const o of P[k] || []) {
          const q = o.geometry.attributes.position;
          for (let i = 0; i < q.count; i++) if (Math.abs(q.getZ(i) - d.z) < d.w / 2 && Math.abs(q.getX(i)) < W0 && q.getY(i) > crown) crown = q.getY(i);
        }
      }
      r.ok(`${tag}: the top of the name is under this hull's own crown`, d.y + d.h / 2 < crown, `${(d.y + d.h / 2).toFixed(2)} under ${crown.toFixed(2)}`);
      // A name, not a tag: on a widebody it stands as a real title does.
      if (['b787', 'a350', 'b777', 'a380', 'b747'].includes(id)) {
        const f = m.userData.fuselage;
        const lay = W.layoutWordmark(d.texture.userData.spec || W.WORDMARKS[liv], L.findLivery(liv).style.titleFont);
        r.ok(`${tag}: a big name: at least 18% of the fuselage long, or a tenth of the body high in caps`, d.w / (f.tail - f.nose) >= 0.18 || d.h / lay.h / (f.top - f.bottom) >= 0.1, `${d.w.toFixed(1)} m of ${(f.tail - f.nose).toFixed(1)}`);
      }
      if (m.userData.dispose) m.userData.dispose();
    }
    // The real fin: its area's middle on the canvas's middle, on both faces.
    const m = A.createAircraftModel({ type, livery: L.schemeFor(type, 'bosphorus'), realModel: true });
    for (let i = 0; i < 40 && !(m.userData.realModel && m.userData.realModel.skin); i++) await new Promise((res) => setTimeout(res, 50));
    const rm = m.userData.realModel;
    const rp = m.userData.realPaint;
    if (rm && rm.skin && rp && rp.finProfile) {
      const fins = parts(rm.skin).fin || [];
      const box = ART.finBox(rp.finProfile);
      const aim = ART.finCentre(rp.finProfile);
      const [ua, va] = ART.finUV(rp.finProfile, box, aim.z, aim.y);
      // Each face on its own: the middle of the visible area, sampled, and the point the mark's
      // centre lands on, found through the fin's own coordinates.
      const H = rp.finProfile.y1 - rp.finProfile.y0;
      const miss = [];
      for (const side of [-1, 1]) {
        let [sum, zs, ys] = [0, 0, 0];
        let hit = null;
        for (const o of fins) {
          const q = o.geometry.attributes.position;
          const uv = o.geometry.attributes.uv;
          const idx = o.geometry.index;
          const n3 = idx ? idx.count : q.count;
          const at = (t) => (idx ? idx.getX(t) : t);
          for (let t = 0; t + 2 < n3; t += 3) {
            const [i, j, k] = [at(t), at(t + 1), at(t + 2)];
            if ((q.getX(i) + q.getX(j) + q.getX(k)) * side < 0) continue;
            const [y0, z0, ey, ez, fy, fz] = [q.getY(i), q.getZ(i), q.getY(j) - q.getY(i), q.getZ(j) - q.getZ(i), q.getY(k) - q.getY(i), q.getZ(k) - q.getZ(i)];
            const area = Math.abs(ey * fz - ez * fy) / 2;
            if (!(area > 1e-5)) continue;
            for (let a1 = 0; a1 < 8; a1++) {
              for (let b1 = 0; b1 < 8 - a1; b1++) {
                const [y, z] = [y0 + (ey * (a1 + 0.3)) / 8 + (fy * (b1 + 0.3)) / 8, z0 + (ez * (a1 + 0.3)) / 8 + (fz * (b1 + 0.3)) / 8];
                if (y < rp.hull.topAt(Math.min(rp.hull.zMax, Math.max(rp.hull.zMin, z))) + 0.25) continue;
                sum += area;
                zs += area * z;
                ys += area * y;
              }
            }
            const [u0, v0, u1, v1, u2, v2] = [uv.getX(i), uv.getY(i), uv.getX(j), uv.getY(j), uv.getX(k), uv.getY(k)];
            const den = (u1 - u0) * (v2 - v0) - (u2 - u0) * (v1 - v0);
            if (Math.abs(den) < 1e-9) continue;
            const l1 = ((ua - u0) * (v2 - v0) - (u2 - u0) * (va - v0)) / den;
            const l2 = ((u1 - u0) * (va - v0) - (ua - u0) * (v1 - v0)) / den;
            if (l1 >= 0 && l2 >= 0 && l1 + l2 <= 1) hit = [z0 + ez * l1 + fz * l2, y0 + ey * l1 + fy * l2];
          }
        }
        miss.push(hit && sum ? Math.hypot(hit[0] - zs / sum, hit[1] - ys / sum) / H : 9);
      }
      r.ok(`real ${id}: the mark is on the middle of this fin's area, port and starboard`, miss.every((v) => v < 0.06), miss.map((v) => v.toFixed(3)).join());
    }
    if (m.userData.dispose) m.userData.dispose();
  }
}
