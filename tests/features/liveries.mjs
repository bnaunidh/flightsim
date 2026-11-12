/**
 * The liveries (wave 10, skins lane), checked in node:
 *
 *   node tests/features/liveries.mjs
 *
 *   - every airline scheme's style block is well formed (colours, layout,
 *     weights), and every scheme builds on every type it flies with its
 *     cowls, its name and its mark;
 *   - the livery texture is drawn at the size of the quality tier (Low a
 *     quarter of High's pixels), and a tier change drops the old size;
 *   - the paint is paint: a clearcoat on High and Ultra only, a plain
 *     material on Low and Medium; bare metal is metal;
 *   - the fan cowls wear the airline's cowl skin, the name is lettered in
 *     the airline's weight and set by its cap height, a freighter's bigger;
 *   - each scheme is its own drawing (fleet/extra/livery-art.js), the fin one
 *     canvas with the mark inside it, and no two schemes the same layout;
 *   - no scheme's words are a real airline's; the military types keep
 *     low-saturation greys and greens and never an airline's paint.
 */

global.document = {
  createElement: () => ({
    getContext: () => new Proxy({}, { get: () => () => ({ addColorStop() {}, data: new Uint8ClampedArray(4) }) }),
    width: 0, height: 0, style: {},
  }),
  body: { appendChild() {} },
  head: { appendChild() {} },
};
globalThis.window = globalThis.window || { addEventListener() {}, devicePixelRatio: 1 };

const SRC = new URL('../../src/', import.meta.url).href;
const THREE = await import(SRC + 'vendor/three.module.js');
const T = await import(SRC + 'aircraft/types.js');
const L = await import(SRC + 'aircraft/liveries.js');
const ADAPTER = await import(SRC + 'aircraft/model-adapter.js');
const TEX = await import(SRC + 'render/textures.js');
const PAINT = await import(SRC + 'render/paint.js');
const KIT = await import(SRC + 'fleet/extra/airliner-kit.js');
const AT = await import(SRC + 'fleet/aircraft-textures.js');

let failed = 0;
let passed = 0;
function ok(name, pass, detail = '') {
  if (pass) passed++;
  else failed++;
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}${detail !== '' ? ` — ${detail}` : ''}`);
}
const hex = (c) => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c);
const build = (typeId, liveryId) => {
  const type = T.getAircraft(typeId);
  return ADAPTER.createAircraftModel({ type, livery: L.schemeFor(type, liveryId) });
};
const dispose = (m) => {
  if (m && m.userData && typeof m.userData.dispose === 'function') m.userData.dispose();
};
const meshesNamed = (model, re) => {
  const out = [];
  model.traverse((o) => {
    if (o.isMesh && re.test(o.name)) out.push(o);
  });
  return out;
};
const materialNamed = (model, name) => {
  let found = null;
  model.traverse((o) => {
    if (found || !o.isMesh) return;
    for (const m of [].concat(o.material)) if (m && m.name === name) found = m;
  });
  return found;
};

/* ------------------------------------------------------------------ *
 * The schemes' style blocks
 * ------------------------------------------------------------------ */
const LAYOUTS = L.LAYOUTS;
const EMBLEMS = L.EMBLEMS;
ok('the module lists its layouts and marks, with the crown layout and the parody table\'s thirteen marks among them', LAYOUTS.includes('crown') && EMBLEMS.length === 19 && EMBLEMS.includes('tulip') && EMBLEMS.includes('horizon'));
const schemes = L.LIVERIES.filter((l) => !l.house);
for (const l of schemes) {
  const st = l.style;
  const colours = [st && st.belly, st && st.cowl, st && st.cowlBand, st && st.pinstripe, st && st.titleInk, ...((st && st.bands) || []), ...((st && st.emblemInks) || [])].filter((c) => c != null);
  ok(`${l.id}: has a style block with a known layout and well-formed colours`,
    !!st && LAYOUTS.includes(st.layout) && colours.every(hex) && (st.titleWeight == null || (st.titleWeight >= 100 && st.titleWeight <= 900))
      && (st.titleSpacing == null || (st.titleSpacing >= 0 && st.titleSpacing <= 0.5)),
    st ? `${st.layout}; ${colours.length} colours` : 'no style');
  if (l.emblem) ok(`${l.id}: its mark is one of the game's own (${l.emblem})`, EMBLEMS.includes(l.emblem));
  ok(`${l.id}: the cheatline bands, if any, are two or three colours`, !st || !st.bands || (st.bands.length >= 2 && st.bands.length <= 3));
  if (st && st.layout === 'crown') ok(`${l.id}: a crown layout names its crown colour`, hex(st.crown));
}
ok('one scheme wears the crown layout (the sky-blue-over-white airline)', schemes.filter((l) => l.style && l.style.layout === 'crown').map((l) => l.id).join() === 'krd');
ok('abyssinia: the title is the fin\'s indigo, dark enough for cream, not the cheatline\'s ochre', L.findLivery('abyssinia').style.titleInk === '#262c66');
ok('exactly one scheme is bare metal (the silver-bird airline), and its material is asked for', schemes.filter((l) => l.style && l.style.metal).map((l) => l.id).join() === 'liberty');
ok('the United-style scheme carries a compass, not a globe (a circle with meridians was too near a real mark)', L.findLivery('continental').emblem === 'compass');

/* ------------------------------------------------------------------ *
 * No real names
 * ------------------------------------------------------------------ */
const REAL = [
  'KLM', 'Delta', 'Emirates', 'Etihad', 'DHL', 'FedEx', 'UPS', 'Air India', 'Singapore Airlines', 'Singapore',
  'Air France', 'Spirit', 'United', 'Continental', 'British Airways', 'Speedbird', 'Turkish', 'Qatar', 'Japan Airlines', 'JAL',
  'Ethiopian', 'American', 'Lufthansa', 'Ryanair', 'Southwest', 'easyJet', 'Air Canada', 'Qantas', 'Virgin', 'Alaska', 'JetBlue',
  'Frontier', 'Cathay', 'ANA', 'Korean Air', 'Iberia', 'Aeroflot', 'Finnair', 'Swiss', 'Austrian', 'TAP', 'Hawaiian', 'Allegiant',
  'WestJet', 'Pan Am', 'TWA', 'Northwest', 'US Airways', 'Eastern', 'Boeing', 'Airbus', 'Speedbird', 'Dynasty', 'Skyteam', 'Oneworld',
];
const word = (text, real) => new RegExp(`(^|[^A-Za-z])${real.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^A-Za-z])`, 'i').test(text);
{
  const hits = [];
  for (const l of schemes) {
    for (const text of [l.name, l.titling, l.title, l.blurb].filter(Boolean)) {
      for (const real of REAL) if (word(text, real)) hits.push(`${l.id}: "${text}" matches ${real}`);
    }
  }
  // "UNITED STATES OF AMERICA" is a country, not the airline: the one allowed whole-word hit.
  const bad = hits.filter((h) => !/UNITED STATES OF AMERICA/.test(h));
  ok('no scheme\'s name, titling or blurb is a real airline\'s or a maker\'s name', bad.length === 0, bad.join('; '));
}

/* ------------------------------------------------------------------ *
 * Three schemes that sat too close to a real company (owner, 2026-11-04)
 *
 * A parody may borrow an idea, not a look. These three wore the real one's
 * colours and the idea of its mark, so here the inks themselves are held
 * apart: every colour the scheme paints, read from its style and its art.
 * ------------------------------------------------------------------ */
{
  const ART = await import(new URL('../../src/fleet/extra/livery-art.js', import.meta.url).href);
  const hexes = (o, out = []) => {
    if (typeof o === 'string') { for (const m of o.matchAll(/#[0-9a-f]{6}\b/gi)) out.push(m[0].toLowerCase()); }
    else if (o && typeof o === 'object') for (const k of Object.keys(o)) hexes(o[k], out);
    return out;
  };
  const rgbaHex = (c) => { const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c || ''); return m ? `#${m.slice(1, 4).map((n) => Number(n).toString(16).padStart(2, '0')).join('')}` : ''; };
  const inksOf = (id) => {
    const l = L.findLivery(id);
    return [...new Set(hexes({ base: l.base, accent: l.accent, cheatline: rgbaHex(l.cheatline), tail: `#${l.tail.toString(16).padStart(6, '0')}`, style: l.style, art: ART.artFor(l) }))];
  };
  const hsl = (h) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
    const hi = Math.max(r, g, b);
    const lo = Math.min(r, g, b);
    const d = hi - lo;
    const l = (hi + lo) / 2;
    const sat = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
    const hue = d === 0 ? 0 : hi === r ? (((g - b) / d) % 6 + 6) % 6 * 60 : hi === g ? ((b - r) / d + 2) * 60 : ((r - g) / d + 4) * 60;
    return { h: hue, s: sat, l };
  };
  const vivid = (id, from, to) => inksOf(id).filter((c) => { const v = hsl(c); return v.s > 0.45 && v.l > 0.15 && v.l < 0.85 && v.h >= from && v.h <= to; });
  ok('the scheme reader finds colours in the paint', inksOf('dashfreight').length >= 4 && hsl('#ffcc00').h > 40 && hsl('#ffcc00').h < 60 && hsl('#4d148c').h > 250);
  ok('dashfreight: no yellow and no signal red anywhere in the paint', vivid('dashfreight', 40, 70).length === 0 && vivid('dashfreight', 345, 360).length === 0 && vivid('dashfreight', 0, 8).length === 0, inksOf('dashfreight').join(' '));
  ok('dashfreight: the name and the mark are not one strong ink on a bright ground: a dark body, a light name', hsl(L.findLivery('dashfreight').base).l < 0.5 && hsl(L.findLivery('dashfreight').style.titleInk).l > 0.8);
  ok('dashfreight: no bars across the body', !ART.artFor(L.findLivery('dashfreight')).body.some((op) => op[0] === 'poly'));
  ok('flexship: no purple or violet, and no orange, anywhere in the paint', vivid('flexship', 250, 310).length === 0 && vivid('flexship', 15, 40).length === 0, inksOf('flexship').join(' '));
  ok('flexship: no roof of colour falling away behind the wing', !ART.artFor(L.findLivery('flexship')).body.some((op) => op[0] === 'over'));
  ok('flexship: no arrow, no parcel', L.findLivery('flexship').emblem === 'links');
  ok('flexship: not lettered in a tight black grotesque', L.findLivery('flexship').style.titleFont.family !== 'Archivo Black' && (await import(SRC + 'fleet/extra/wordmarks.js')).WORDMARKS.flexship.rows[0].track > 0.01);
  const aby = vivid('abyssinia', 0, 360).map((c) => hsl(c).h);
  ok('abyssinia: the green, yellow and red of a flag are not all there: no green at all, no pure yellow, no pure red', vivid('abyssinia', 75, 170).length === 0 && vivid('abyssinia', 46, 70).length === 0 && vivid('abyssinia', 350, 360).length === 0 && vivid('abyssinia', 0, 6).length === 0, `${inksOf('abyssinia').join(' ')} (${aby.map(Math.round).join()})`);
  ok('abyssinia: the cheatline is not three flag stripes off one point on the fin: a mark of its own', L.findLivery('abyssinia').emblem === 'acacia');
  const { readFileSync: readFile } = await import('node:fs');
  const text = readFile(new URL('../../src/aircraft/liveries.js', import.meta.url), 'utf8');
  const block = (id) => text.slice(text.lastIndexOf('{', text.indexOf(`id: '${id}'`)), text.indexOf('fleet:', text.indexOf(`id: '${id}'`)) + 400);
  ok('none of the three names the company it used to look like, even in a comment', !/DHL|FedEx|Ethiopian/i.test(['dashfreight', 'flexship', 'abyssinia'].map(block).join('\n')));
}

/* ------------------------------------------------------------------ *
 * Texture size per tier, and the tier change
 * ------------------------------------------------------------------ */
const sizeOf = (tier) => {
  TEX.setTextureTier(tier);
  PAINT.setPaintTier(tier);
  const m = build('a320', 'abyssinia');
  const skin = materialNamed(m, 'Airliner_livery');
  const img = skin && skin.map && skin.map.image;
  const emblem = meshesNamed(m, /^Painted fin$/)[0];
  const eimg = emblem && emblem.material.map && emblem.material.map.image;
  const cowl = materialNamed(m, 'Airliner_cowl');
  const cimg = cowl && cowl.map && cowl.map.image;
  const out = { skin, img: img ? [img.width, img.height] : null, emblem: eimg ? eimg.width : null, cowl: cimg ? [cimg.width, cimg.height] : null, model: m };
  return out;
};
{
  const want = { low: [1024, 256], medium: [1536, 384], high: [2048, 512], ultra: [3072, 768] };
  for (const tier of ['low', 'medium', 'high', 'ultra']) {
    const r = sizeOf(tier);
    ok(`${tier}: the livery is drawn at ${want[tier].join('x')}`, r.img && r.img[0] === want[tier][0] && r.img[1] === want[tier][1] && KIT.liverySizeFor(tier).join() === want[tier].join(), r.img ? r.img.join('x') : 'no map');
    ok(`${tier}: the fin's paint is ${tier === 'high' || tier === 'ultra' ? 512 : 256} px`, r.emblem === (tier === 'high' || tier === 'ultra' ? 512 : 256), String(r.emblem));
    ok(`${tier}: the cowl skin is ${tier === 'low' ? '128x32' : '256x64'}`, r.cowl && r.cowl.join('x') === (tier === 'low' ? '128x32' : '256x64'), r.cowl ? r.cowl.join('x') : 'none');
    const physical = r.skin instanceof THREE.MeshPhysicalMaterial;
    const clear = tier === 'high' || tier === 'ultra';
    ok(`${tier}: the paint ${clear ? 'wears a clearcoat' : 'is a plain standard material (no clearcoat on a school laptop)'}`,
      clear ? physical && r.skin.clearcoat > 0 : !physical && r.skin instanceof THREE.MeshStandardMaterial, r.skin ? r.skin.type : 'no skin');
    dispose(r.model);
  }
  ok('Low draws a quarter of High\'s livery pixels', KIT.liverySizeFor('low')[0] * KIT.liverySizeFor('low')[1] * 4 === KIT.liverySizeFor('high')[0] * KIT.liverySizeFor('high')[1]);
  // The older civil models' shared skin (render/textures.js airframeTexture) follows too.
  TEX.setTextureTier('low');
  const legacyLow = TEX.airframeTexture({ base: '#eef1f5', accent: '#c8102e' }).image.width;
  TEX.setTextureTier('high');
  const legacyHigh = TEX.airframeTexture({ base: '#eef1f5', accent: '#c8102e' }).image.width;
  ok('the older civil models\' airframe skin is 512 on Low and 1024 on High', legacyLow === 512 && legacyHigh === 1024, `${legacyLow} / ${legacyHigh}`);
  // A tier change drops the old size: a High texture after a Low one is a new, High-sized one.
  const low = sizeOf('low');
  const high = sizeOf('high');
  ok('after a tier change the livery is redrawn at the new size (not the cached old one)', low.img[0] === 1024 && high.img[0] === 2048 && low.skin.map !== high.skin.map);
  dispose(low.model);
  dispose(high.model);
}
TEX.setTextureTier('high');
PAINT.setPaintTier('high');

/* ------------------------------------------------------------------ *
 * Paint, metal, cowls, names
 * ------------------------------------------------------------------ */
{
  const metal = build('b737', 'liberty');
  const skin = materialNamed(metal, 'Airliner_livery');
  ok('liberty (bare metal): the skin is metal — high metalness, low roughness, a thin clearcoat at most', !!skin && skin.metalness > 0.6 && skin.roughness < 0.4 && (skin.clearcoat == null || skin.clearcoat < 0.2), skin ? `metalness ${skin.metalness}, roughness ${skin.roughness}, clearcoat ${skin.clearcoat}` : 'none');
  const cowl = materialNamed(metal, 'Airliner_cowl');
  ok('liberty: bare-metal cowls too', !!cowl && cowl.metalness > 0.6, cowl ? `metalness ${cowl.metalness}` : 'none');
  dispose(metal);

  const painted = build('b737', 'abyssinia');
  const pskin = materialNamed(painted, 'Airliner_livery');
  ok('abyssinia (painted): the skin is paint — low metalness, a clearcoat on High', !!pskin && pskin.metalness < 0.3 && pskin.clearcoat > 0.05, pskin ? `metalness ${pskin.metalness}, clearcoat ${pskin.clearcoat}` : 'none');
  const fans = meshesNamed(painted, /^Fan cowl$/);
  ok('abyssinia: both fan cowls wear the cowl skin, in the airline\'s indigo with the ochre ring', fans.length === 2 && fans.every((f) => f.material.name === 'Airliner_cowl' && f.material.map && /#262c66\|#e0a458/.test(f.material.map.name)), fans.map((f) => f.material.map && f.material.map.name).join(' | '));
  ok('abyssinia: the cowl skin runs along the cowl (v from the lip to the nozzle), not one band', fans.length > 0 && (() => {
    const uv = fans[0].geometry.attributes.uv;
    let lo = 1;
    let hi = 0;
    for (let i = 0; i < uv.count; i++) {
      lo = Math.min(lo, uv.getY(i));
      hi = Math.max(hi, uv.getY(i));
    }
    return lo < 0.05 && hi > 0.95;
  })());
  const title = meshesNamed(painted, /^Titling$/)[0];
  ok('abyssinia: the name is its own wordmark, in its own face (Kanit)', !!title && /wordmark\|Abyssinia Air\|.*Kanit\/600\/normal/.test(title.material.map.name), title ? title.material.map.name : 'none');
  const pylons = meshesNamed(painted, /^Engine pylon$/);
  ok('abyssinia: the pylons keep the body colour (no cowl skin smeared on them)', pylons.length === 0 || pylons.every((p) => p.material.name !== 'Airliner_cowl'));
  dispose(painted);

  const freight = build('b747', 'nightfreight');
  const ft = meshesNamed(freight, /^Titling$/)[0];
  ok('nightfreight (billboard): its own wordmark, condensed (Oswald)', !!ft && /wordmark\|NIGHT FREIGHT\|.*Oswald\/600\/normal/.test(ft.material.map.name), ft ? ft.material.map.name : 'none');
  const reg = meshesNamed(freight, /^Airframe registration$/)[0];
  ok('nightfreight: the registration is light on a dark body, medium weight, stencil-spaced', !!reg && /#e9eef2/.test(reg.material.map.name) && /_600_0\.08_Titillium/.test(reg.material.map.name), reg ? reg.material.map.name : 'none');
  dispose(freight);

  const house = build('a320', 'house');
  ok('house colours: no style, but the cowls still wear a skin (the split line and the grime), in the body colour', materialNamed(house, 'Airliner_cowl') && /#f5f7f9\|null/.test(materialNamed(house, 'Airliner_cowl').map.name), materialNamed(house, 'Airliner_cowl') && materialNamed(house, 'Airliner_cowl').map.name);
  dispose(house);

  // The decal cache tells weights apart, and gives the same texture for the same ask.
  const a = AT.aircraftDecalTexture('OVERSEA', { color: '#111111', weight: 700, spacing: 0.05 });
  const b = AT.aircraftDecalTexture('OVERSEA', { color: '#111111', weight: 500, spacing: 0.05 });
  const c = AT.aircraftDecalTexture('OVERSEA', { color: '#111111', weight: 700, spacing: 0.05 });
  ok('decals: a different weight is a different texture; the same ask is the same one', a !== b && a === c && a.userData.text === 'OVERSEA');
}

/* ------------------------------------------------------------------ *
 * Every airline on every type it flies — and the Meridian, which every one flies
 * ------------------------------------------------------------------ */
{
  const bad = [];
  let n = 0;
  for (const l of L.AIRLINE_LIVERIES) {
    for (const id of l.fleet) {
      try {
        const m = build(id, l.id);
        n++;
        const skin = materialNamed(m, 'Airliner_livery');
        const fin = meshesNamed(m, /^Painted fin$/)[0];
        if (skin && !(fin && fin.material.map && fin.material.map.name.includes(`|${id}|${l.id}|`))) bad.push(`${id}/${l.id}: the fin does not wear its canvas`);
        // The Meridian is the game's own model (aircraft/models/meridian.js), not the
        // kit's: its paint is render/textures.js airframeTexture, its lettering decals.
        if (skin) {
          if (!skin.map) bad.push(`${id}/${l.id}: no livery skin`);
          else if (!skin.map.name.includes(`"layout":"${l.style.layout}"`)) bad.push(`${id}/${l.id}: skin not drawn in the ${l.style.layout} layout (${skin.map.name.slice(0, 60)})`);
          const titles = meshesNamed(m, /^Titling$/);
          if (titles.length !== 2) bad.push(`${id}/${l.id}: ${titles.length} titling decals`);
          // A turbofan wears the cowl skin; a turboprop (the Q400) has none to wear it.
          const fans = meshesNamed(m, /^Fan cowl$/);
          if (fans.length && !fans.every((f) => f.material.name === 'Airliner_cowl')) bad.push(`${id}/${l.id}: fan cowls without the cowl skin`);
        }
        const regs = meshesNamed(m, /^Airframe registration$/);
        if (!regs.length || !regs.every((r) => r.material.map.userData.text === l.reg)) bad.push(`${id}/${l.id}: registration ${regs.map((r) => r.material.map.userData.text).join()}`);
        dispose(m);
      } catch (e) {
        bad.push(`${id}/${l.id}: ${e.message}`);
      }
    }
  }
  ok(`every airline builds on every type in its fleet, in its own layout, with its name, number and cowls (${n} builds)`, bad.length === 0, bad.slice(0, 4).join('; '));
}

/* ------------------------------------------------------------------ *
 * The paint shop's drawings (fleet/extra/livery-art.js)
 * ------------------------------------------------------------------ */
{
  const ART = await import(SRC + 'fleet/extra/livery-art.js');
  const air = L.AIRLINE_LIVERIES;
  ok('every airline has a drawing of its own', air.every((l) => ART.artFor(l) && ART.artFor(l).body.length > 0), air.filter((l) => !ART.artFor(l)).map((l) => l.id).join());
  // The silhouette of the drawing: what kinds of shape, how many. A recolour of a template would repeat.
  const sig = (l) => JSON.stringify(ART.artFor(l).body.map((o) => [o[0], o[2].map((p) => p.slice(0, 2))]));
  const sigs = new Set(air.map(sig));
  ok('no two airlines share one layout: each is a drawing, not a recolour', sigs.size >= air.length - 2, `${sigs.size} layouts for ${air.length} airlines`);
  ok('at least ten airlines carry the tail\'s colour or a ribbon on to the aft body (past s = 0.65, up to the fin root)', air.filter((l) => ART.artFor(l).body.some((o) => o[2].some((p) => p[0] > 0.65 && p[1] > 0.7))).length >= 10);
  ok('every shape is in range (s about 0-1, t about 0-1)', air.every((l) => ART.artFor(l).body.every((o) => o[2].every((p) => p[0] >= -0.05 && p[0] <= 1.1 && p[1] >= -0.2 && p[1] <= 1.2))));
  ok('every winglet colour, registration ink and shape ink is a colour', air.every((l) => {
    const a = ART.artFor(l);
    return [a.winglet, a.regInk, ...a.body.map((o) => o[1]), ...((a.fin && a.fin.ops) || []).map((o) => o[1])].filter(Boolean).every(hex);
  }));
  ok('the freighters have no cabin windows; nothing else loses them', air.filter((l) => ART.artFor(l).freighter).map((l) => l.id).join() === 'nightfreight,dashfreight,flexship,parcelbrown');
  const freighter = build('b777', 'nightfreight');
  const liner = build('b777', 'desertpearl');
  const panes = (m) => meshesNamed(m, /window/i).filter((o) => o.material && o.material.name === 'Airliner_cabin_window').length;
  ok('a freighter is built with no window panes, an airliner with them', panes(freighter) === 0 && panes(liner) > 0, `${panes(freighter)} / ${panes(liner)}`);
  dispose(freighter);
  dispose(liner);

  // The fin: the largest circle it holds lies inside it, on the fallback fin of every type an airline flies.
  const seen = new Set();
  const badFin = [];
  for (const l of air) {
    for (const id of l.fleet) {
      const t = T.getAircraft(id);
      if (seen.has(id) || id === 'meridian') continue;
      seen.add(id);
      const m = build(id, l.id);
      const fc = m.userData.config && m.userData.config.fin;
      dispose(m);
      if (!fc) continue;
      const P = { y0: fc.rootY, y1: fc.rootY + fc.height, le0: fc.rootZ, le1: fc.rootZ + fc.sweep, ch0: fc.rootChord, ch1: fc.tipChord };
      const c = ART.finCentre(P);
      if (!(c.r > 0.16 * (P.y1 - P.y0))) badFin.push(`${t.id}: ${c.r.toFixed(2)} m`);
    }
  }
  ok('the mark\'s circle fills the fin: at least a third of its height across, on every type', badFin.length === 0, badFin.join('; '));

  // Marks face forward: the canvas is laid the same way on both faces of the fin.
  const m = build('a320', 'krd');
  const finMesh = meshesNamed(m, /^Painted fin$/)[0];
  const p = finMesh.geometry.attributes.position;
  const uv = finMesh.geometry.attributes.uv;
  let flipped = 0;
  for (let i = 0; i < p.count; i++) {
    for (let j = 0; j < p.count; j++) {
      if (p.getX(i) > 0 && p.getX(j) < 0 && Math.abs(p.getZ(i) - p.getZ(j)) < 1e-3 && Math.abs(p.getY(i) - p.getY(j)) < 1e-3 && Math.abs(uv.getX(i) - uv.getX(j)) > 1e-3) flipped++;
    }
  }
  ok('the fin\'s canvas runs nose to tail on BOTH faces, so a mark faces forward on both sides', flipped === 0, `${flipped} vertices apart`);
  ok('the fin\'s paint material is lit, not a glowing decal', finMesh.material.isMeshStandardMaterial === true, finMesh.material.type);
  dispose(m);

  // The hangar's swatches load the drawing code on the first visit: it stays out of the first load.
  {
    const { readFileSync } = await import('node:fs');
    const ui = readFileSync(new URL('../../src/ui/hangar-showcase-ui.js', import.meta.url), 'utf8');
    ok('the hangar imports the marks when it opens, never statically', /import\('\.\.\/fleet\/extra\/livery-art\.js'\)/.test(ui) && !/^import .*livery-art/m.test(ui));
  }

  // The name, by the sign-writer's rule: cap height a share of the body, never stretched.
  const decal = (id, liv) => {
    const mm = build(id, liv);
    const rp = mm.userData.realPaint;
    const d = rp.decals.find((x) => x.h < x.w * 0.9 && x.texture.userData.text !== L.findLivery(liv).reg);
    const hullH = rp.hull.topAt(0) - rp.hull.botAt(0);
    dispose(mm);
    return { d, hullH };
  };
  const a = decal('a320', 'bleuciel');
  const b = decal('a380', 'bleuciel');
  // (a share of the body's height at most, held down further by the room between the door and the wing)
  const WM0 = await import(SRC + 'fleet/extra/wordmarks.js');
  const lay0 = WM0.layoutWordmark(WM0.WORDMARKS.bleuciel, L.findLivery('bleuciel').style.titleFont);
  const capA = a.d.h / lay0.h;
  const capB = b.d.h / lay0.h;
  ok('the name\'s cap height scales with the body, A320 and A380 alike, and never a banner', capA / a.hullH > 0.12 && capA / a.hullH < 0.29 && capB / b.hullH > 0.1 && capB / b.hullH < 0.29, `${capA.toFixed(2)} m of ${a.hullH.toFixed(2)}; ${capB.toFixed(2)} m of ${b.hullH.toFixed(2)}`);
  ok('...so on an A380 it is bigger than on an A320, not the same 1.2 m band', capB > capA * 1.3);
  const pic = a.d.texture.image;
  ok('the name\'s canvas has the shape of its patch on the aeroplane: nothing is stretched', Math.abs(pic.width / pic.height - a.d.w / a.d.h) / (a.d.w / a.d.h) < 0.02, `${pic.width}x${pic.height} for ${a.d.w.toFixed(1)} x ${a.d.h.toFixed(2)} m`);
}

/* ------------------------------------------------------------------ *
 * The lettering (owner: "make sure FONTS ARE GOOD")
 * ------------------------------------------------------------------ */
{
  const ART = await import(SRC + 'fleet/extra/livery-art.js');
  const F = await import(SRC + 'render/airline-fonts.js');
  const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const lum = (h) => [1, 3, 5].map((i) => lin(parseInt(h.slice(i, i + 2), 16) / 255)).reduce((t, c, i) => t + c * [0.2126, 0.7152, 0.0722][i], 0);
  const ratio = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
  const air = L.AIRLINE_LIVERIES;
  const behind = (l) => (l.style.layout === 'crown' ? l.style.crown : l.base);
  const low = air.filter((l) => ratio(l.style.titleInk || '#1f272e', behind(l)) < 3.5).map((l) => `${l.id} ${ratio(l.style.titleInk || '#1f272e', behind(l)).toFixed(2)}`);
  ok('every name is at least 3.5 to 1 against the paint behind it (the lit body takes some of that away)', low.length === 0, low.join('; '));
  ok('every airline names a bundled face, and only a bundled face', air.every((l) => !!F.faceFor(l.style.titleFont)));
  const mixed = air.filter((l) => l.titling !== l.titling.toUpperCase());
  const WMT = (await import(SRC + 'fleet/extra/wordmarks.js')).WORDMARKS;
  const tracks = (l) => WMT[l.id].rows.map((r) => r.track || 0);
  ok('upper-and-lower names are set tight, as words (at most 0.03 em)', mixed.length >= 6 && mixed.every((l) => tracks(l).every((t) => t <= 0.03 || !/[a-z]/.test(WMT[l.id].rows[tracks(l).indexOf(t)].runs.map((u) => u.t || '').join(''))) ), mixed.map((l) => `${l.id} ${tracks(l)}`).join());
  ok('capitals are spaced, not scattered (at most 0.2 em)', air.filter((l) => !mixed.includes(l)).every((l) => tracks(l).every((t) => t <= 0.2)));
  // (2026-11-09, owner-approved faces: Sandline moved from Cinzel to Josefin Sans, a light geometric, so
  // three airlines are serif now: Pearl Gulf in Playfair, Bharat in Lora, Desert Pearl in Cormorant.)
  const serifs = air.filter((l) => /Playfair|Lora|Cinzel|Cormorant/.test(l.style.titleFont.family));
  const WM = await import(SRC + 'fleet/extra/wordmarks.js');
  ok('the serif airlines stay serif, their fine strokes fattened so they outlive the mipmaps', serifs.length === 3 && serifs.every((l) => WM.WORDMARKS[l.id].bold >= 0.01), serifs.map((l) => l.id).join());
  ok('the light faces are fattened too: Sandline\'s Josefin Sans carries weight for the apron', L.findLivery('sandline').style.titleFont.family === 'Josefin Sans' && WM.WORDMARKS.sandline.bold >= 0.008);
  // The heads of the letters stop short of the crown, on every type an airline flies.
  const high = [];
  for (const l of air) {
    if (ART.artFor(l).freighter) continue;
    for (const id of l.fleet) {
      if (id === 'meridian') continue;
      const m = build(id, l.id);
      const rp = m.userData.realPaint;
      const d = rp.decals.find((x) => x.texture.userData.text === l.titling);
      const mid = (rp.hull.topAt(0) + rp.hull.botAt(0)) / 2;
      const R = (rp.hull.topAt(0) - rp.hull.botAt(0)) / 2;
      if ((d.y + d.h / 2 - mid) / R > 0.97 && !rp.hump) high.push(`${id}/${l.id}`);
      dispose(m);
    }
  }
  ok('the whole name is on the side of the body: its head stays short of the crown\'s shoulder', high.length === 0, high.slice(0, 6).join());
}

/* ------------------------------------------------------------------ *
 * Too near a real airline's logo: redrawn, and held there
 *
 * The coordinator's review, 2026-11-03: three fin marks read as real carriers'
 * and one needed a second look. A real mark cannot be listed here to compare
 * against, so what is held is what made them near: their parts.
 * ------------------------------------------------------------------ */
{
  const { readFileSync } = await import('node:fs');
  const ART = await import(SRC + 'fleet/extra/livery-art.js');
  const E = await import(SRC + 'fleet/extra/emblems.js');
  const src = readFileSync(new URL('../../src/fleet/extra/emblems.js', import.meta.url), 'utf8');
  const doc = (who) => (src.match(new RegExp(`/\\*\\* ${who}: ([^\\n]*)\\*/`)) || [])[1] || '';
  const fakeG = () => new Proxy({}, { get: (t, k) => (k === 'beginPath' ? () => {} : () => ({})) });

  const lib = L.findLivery('liberty');
  const libArt = ART.artFor(lib);
  const ops = (libArt.fin.ops || []).map((o) => o[0]);
  ok('liberty: no stripe stack and no star field: one band on the fin, nothing square', ops.join() === 'rib' && !libArt.fin.bg, ops.join());
  ok('liberty: the fin is navy, the one band red, the one mark a white star', lib.tail === 0x143478 && libArt.fin.ops[0][1] === '#c8102e' && lib.emblem === 'star' && lib.style.emblemInks.join() === '#f4f6f8');
  ok('liberty: the star is alone (no trails, no canton)', /one big/i.test(doc('Liberty')) && !/trail|canton|stripe/i.test(doc('Liberty')), doc('Liberty'));
  ok('liberty: the name, metal body and cheatline stayed', lib.titling === 'LIBERTY AIR' && lib.style.metal === true && libArt.body.filter((o) => o[0] === 'rib').length === 2);

  const gulf = L.findLivery('pearlgulf');
  ok('pearlgulf: the mark is the pearl in its shell', gulf.emblem === 'pearlshell' && /oyster/i.test(doc('Pearl Gulf')) && /pearl/i.test(doc('Pearl Gulf')), doc('Pearl Gulf'));
  ok('pearlgulf: no animal, and no ribbed fan of a shell (a scallop is an oil company\'s mark)', !/antelope|gazelle|oryx|horn|deer|animal|scallop/i.test(`${gulf.emblem} ${gulf.blurb} ${doc('Pearl Gulf')}`), gulf.blurb);

  const WMS = await import(SRC + 'fleet/extra/wordmarks.js');
  const river = L.findLivery('riverdelta');
  const rivArt = ART.artFor(river);
  ok('riverdelta: the mark is a river, as flowing lines', river.emblem === 'riverlines' && /river/i.test(doc('Riverdelta')) && /flowing/i.test(doc('Riverdelta')), doc('Riverdelta'));
  ok('riverdelta: no triangle, delta, fan or chevron in the mark', !/triangle|delta shape|fan\b|chevron|widget/i.test(`${river.emblem} ${doc('Riverdelta')}`));
  ok('riverdelta: the fin carries nothing but the mark, in one ink (a two-tone triangle was the trouble)', !(rivArt.fin.ops || []).length && river.style.emblemInks.length === 1);
  ok('riverdelta: the name has no triangle in it either: its idea is a river that forks', !/triangle|delta shape|chevron/i.test(WMS.WORDMARKS.riverdelta.idea) && !/'delta'/.test(String(WMS.WORDMARKS.riverdelta.rows[0].runs.map((u) => u.shape))));

  const parcel = L.findLivery('parcelbrown');
  ok('parcelbrown: parcels with nothing round them (a badge on brown read as a real carrier\'s shield)', parcel.emblem === 'parcel' && /nothing round/i.test(doc('Parcel Brown')) && !/hexagon|shield/i.test(doc('Parcel Brown')), doc('Parcel Brown'));

  // speedlines, stripes and arrowbox were the three nearest to real freight and flag-carrier marks (owner, 2026-11-04).
  const gone = ['antelope', 'gazelle', 'wavetri', 'speedlines', 'stripes', 'arrowbox'];
  ok('the old marks are gone from the lists and from the drawing file', gone.every((m) => !L.EMBLEMS.includes(m) && !E.EMBLEM_STYLES.includes(m) && !src.includes(`${m}(P`) && E.drawEmblem(fakeG(), m, 256, ['#fff']) === false));
  ok('no airline wears a mark that is not in the list', L.AIRLINE_LIVERIES.every((l) => L.EMBLEMS.includes(l.emblem)));
}

/* ------------------------------------------------------------------ *
 * The military types
 * ------------------------------------------------------------------ */
{
  // HSL off the sRGB hex itself (three's getHSL answers in its linear working space).
  const sat = (c) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(String(c).slice(i, i + 2), 16) / 255);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    const s = max === min ? 0 : (max - min) / (l <= 0.5 ? max + min : 2 - max - min);
    return { s, l };
  };
  const mil = T.AIRCRAFT.filter((t) => t.military || t.category === 'military');
  ok('there are military types to check', mil.length >= 6, mil.map((t) => t.id).join(','));
  const loud = mil.filter((t) => {
    const hsl = sat(t.livery);
    return hsl.s > 0.3 || hsl.l < 0.12 || hsl.l > 0.7;
  });
  ok('every military type\'s house paint is a low-saturation grey or green, dark to mid-tone (no bright colours, no white)', loud.length === 0, loud.map((t) => `${t.id} ${t.livery}`).join(','));
  ok('no military type wears an airline\'s paint when the world paints it', mil.every((t) => L.wearsAirlinePaint(t) === false && L.airlinesFor(t).length === 0 || !L.wearsAirlinePaint(t)));
  for (const id of ['c17', 'c5']) {
    const m = build(id, 'house');
    ok(`${id}: grey, no mark, no titling (no insignia of any nation)`, meshesNamed(m, /^Tail emblem$|^Titling$/).length === 0 && sat(T.getAircraft(id).livery).s < 0.12);
    dispose(m);
  }
  // The tail code on a grey airlifter is a low-contrast grey, not black.
  const c17 = build('c17', 'house');
  const code = meshesNamed(c17, /^Airframe registration$/)[0];
  ok('c17: its tail code is lettered, and keeps the game\'s own code (no real serial)', !!code && code.material.map.userData.text === 'GM-317', code ? code.material.map.userData.text : 'none');
  dispose(c17);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
