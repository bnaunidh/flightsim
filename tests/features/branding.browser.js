/**
 * Wave 14, the branding lane, in the real game: the airline lettering is in
 * its own faces by the time anything is drawn, and the new fin marks are on
 * the fins.
 *
 * `check(sim, r, say)`, as tests/features/index.js expects.
 */

export async function check(sim, r, say = () => {}) {
  let F;
  let L;
  let MA;
  let T;
  let ART;
  try {
    F = await import('../../src/render/airline-fonts.js');
    L = await import('../../src/aircraft/liveries.js');
    MA = await import('../../src/aircraft/model-adapter.js');
    T = await import('../../src/aircraft/types.js');
    ART = await import('../../src/fleet/extra/livery-art.js');
  } catch (e) {
    r.ok('branding: modules load', false, String(e && e.message));
    return;
  }
  say('branding: fonts');
  const st = F.airlineFontsState();
  r.ok('branding: the airline faces were declared and loaded at boot, none failed', st.declared && st.loaded && st.failed.length === 0, JSON.stringify(st));
  const notReady = F.AIRLINE_FONTS.filter((f) => !document.fonts.check(`${f.style === 'italic' ? 'italic ' : ''}${f.weight} 32px "${f.family}"`, 'AIRWAYS'));
  r.ok('branding: every face is ready in document.fonts', notReady.length === 0, notReady.map((f) => f.family).join(', '));
  // Each face really is a different shape from the fallback: the same word measures differently.
  const c = document.createElement('canvas').getContext('2d');
  const widths = F.AIRLINE_FONTS.map((f) => {
    c.font = F.canvasFont(f, 64);
    const a = c.measureText('KANAL ROYAL DUTCH').width;
    c.font = `${f.style === 'italic' ? 'italic ' : ''}${f.weight} 64px "Helvetica Neue", Helvetica, Arial, sans-serif`;
    const b = c.measureText('KANAL ROYAL DUTCH').width;
    return { family: f.family, a, b };
  });
  const same = widths.filter((w) => Math.abs(w.a - w.b) < 0.5);
  r.ok('branding: every face draws differently from the old Helvetica (it is really in use)', same.length === 0, same.map((w) => w.family).join(', '));

  // The silhouettes held away from real marks: read off the pixels.
  {
    /** Ink as a share of its convex hull: a filled triangle or chevron is most of its hull, flowing lines are not. */
    const hullShare = (cv) => {
      const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
      const rows = [];
      let ink = 0;
      for (let y = 0; y < cv.height; y++) {
        let lo = -1;
        let hi = -1;
        for (let x = 0; x < cv.width; x++) {
          if (d[(y * cv.width + x) * 4 + 3] < 128) continue;
          ink++;
          if (lo < 0) lo = x;
          hi = x;
        }
        if (lo >= 0) rows.push([y, lo, hi]);
      }
      const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
      const pts = rows.flatMap(([y, lo, hi]) => [[lo, y], [hi, y]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      const half = (list) => {
        const h = [];
        for (const p of list) {
          while (h.length >= 2 && cross(h[h.length - 2], h[h.length - 1], p) <= 0) h.pop();
          h.push(p);
        }
        return h;
      };
      const poly = [...half(pts), ...half([...pts].reverse())];
      let area = 0;
      for (let i = 0; i < poly.length; i++) {
        const [a, b] = [poly[i], poly[(i + 1) % poly.length]];
        area += a[0] * b[1] - a[1] * b[0];
      }
      return ink / (Math.abs(area) / 2 || 1);
    };
    const share = hullShare(ART.markCanvas('riverlines', ['#ffffff'], 256));
    r.ok('branding: Riverdelta\'s mark is lines, not a solid shape (under a third of its outline is ink)', share < 0.34, share.toFixed(2));

    /** How many times the colour changes down a column of the fin's canvas: a stripe stack changes at every stripe. */
    const type = T.getAircraft('b737');
    const lib = MA.createAircraftModel({ type, livery: L.schemeFor(type, 'liberty') });
    let fin = null;
    lib.traverse((o) => {
      if (!fin && o.isMesh && o.name === 'Painted fin') fin = o;
    });
    const img = fin.material.map.image;
    const px = img.getContext('2d').getImageData(0, 0, img.width, img.height).data;
    let most = 0;
    for (const u of [0.45, 0.6, 0.75, 0.9]) {
      const x = Math.round(u * img.width) - 1;
      let changes = 0;
      let was = -1;
      for (let y = 0; y < img.height; y++) {
        const p = (y * img.width + x) * 4;
        const now = px[p] > 200 && px[p + 1] > 200 ? 0 : px[p] > 150 ? 1 : 2;
        if (was >= 0 && now !== was) changes++;
        was = now;
      }
      most = Math.max(most, changes);
    }
    r.ok('branding: Liberty\'s fin has no stripe stack (a column of it crosses at most the band and the star)', most <= 5, most);
    if (lib.userData.dispose) lib.userData.dispose();
  }

  say('branding: titling');
  {
    const st = F.airlineFontsState();
    r.ok('branding: every face really is in (no silent fallback to a system font)', st.loaded && st.failed.length === 0 && F.AIRLINE_FONTS.every((f) => document.fonts.check(`${f.style === 'italic' ? 'italic ' : ''}${f.weight} 32px "${f.family}"`, 'Hamburgefonstiv')), JSON.stringify(st));
    // Each airline's name in its face is not the width the fallback would give.
    const g = document.createElement('canvas').getContext('2d');
    const off = [];
    for (const l of L.AIRLINE_LIVERIES) {
      g.font = F.canvasFont(l.style.titleFont, 100);
      const own = g.measureText(l.titling).width;
      g.font = `${l.style.titleFont.weight} 100px sans-serif`;
      if (Math.abs(own - g.measureText(l.titling).width) < 0.5) off.push(l.id);
    }
    r.ok('branding: every airline\'s name measures in its own face, not a fallback', off.length === 0, off.join());
  }
  // Built now, after boot: lettered in its face first time, nothing pending a redraw.
  const cases = [['a320', 'bleuciel'], ['b777', 'desertpearl'], ['b747', 'dashfreight'], ['a350', 'sandline']];
  for (const [typeId, liv] of cases) {
    const type = T.getAircraft(typeId);
    const m = MA.createAircraftModel({ type, livery: L.schemeFor(type, liv) });
    let title = null;
    let marks = 0;
    m.traverse((o) => {
      if (o.isMesh && o.name === 'Titling') title = o;
      if (o.isMesh && o.name === 'Painted fin' && o.material.map) marks += 2;
    });
    const map = title && title.material.map;
    const want = F.fontKey(L.findLivery(liv).style.titleFont);
    r.ok(`branding: ${typeId} in ${liv} — the name in ${want}, not a fallback awaiting redraw`, !!map && map.userData.font === want && !map.userData.fallback, map ? map.name : 'no titling');
    // Ink in the middle of the band, none at its ends.
    if (map && map.image && map.image.getContext) {
      const g = map.image.getContext('2d');
      const W = map.image.width;
      const H = map.image.height;
      const mid = g.getImageData(Math.round(W * 0.3), Math.round(H * 0.3), Math.round(W * 0.4), Math.round(H * 0.4)).data;
      let inked = 0;
      for (let i = 3; i < mid.length; i += 4) if (mid[i] > 128) inked++;
      const edge = g.getImageData(0, 0, 3, H).data;
      let edgeInk = 0;
      for (let i = 3; i < edge.length; i += 4) if (edge[i] > 16) edgeInk++;
      r.ok(`branding: ${liv} — the name is lettered across the band and fits inside it`, inked > 200 && edgeInk === 0, `${inked} inked px mid, ${edgeInk} at the edge`);
    }
    r.ok(`branding: ${typeId} in ${liv} — a mark each side of the fin`, marks === 2, marks);
    // The mark on its own square: something drawn, transparent round it.
    const l = L.findLivery(liv);
    const img = ART.markCanvas(l.emblem, l.style.emblemInks || [l.base], 256);
    const g = img.getContext('2d');
    const d = g.getImageData(0, 0, img.width, img.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 128) n++;
    const frac = n / (img.width * img.height);
    const corner = g.getImageData(0, 0, 4, 4).data;
    r.ok(`branding: ${liv}'s mark covers a fair share of its patch, its corners clear`, frac > 0.06 && frac < 0.7 && corner[3] === 0, `${(frac * 100).toFixed(1)}% inked`);
    if (m.userData.dispose) m.userData.dispose();
  }

  say('branding: the apron');
  // The parked airliners, built at boot: none of their names waits on a redraw.
  const waiting = [];
  let named = 0;
  const scene = sim.scene;
  if (scene) {
    scene.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      for (const mat of Array.isArray(o.material) ? o.material : [o.material]) {
        const map = mat && mat.map;
        if (!map || !map.userData || !map.userData.font) continue;
        named++;
        if (map.userData.fallback) waiting.push(map.name);
      }
    });
  }
  r.ok('branding: the world has airline names in it, and none is still lettered in a fallback face', named > 0 && waiting.length === 0, `${named} names, ${waiting.length} waiting: ${waiting.slice(0, 3).join('; ')}`);
}
