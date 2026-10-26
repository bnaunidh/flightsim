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
 *     the airline's weight, a billboard name is taller;
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
ok('abyssinia: the title is in the fin\'s green (readable on white), not the cheatline\'s gold', L.findLivery('abyssinia').style.titleInk === '#0b8a3e');
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
 * Texture size per tier, and the tier change
 * ------------------------------------------------------------------ */
const sizeOf = (tier) => {
  TEX.setTextureTier(tier);
  PAINT.setPaintTier(tier);
  const m = build('a320', 'abyssinia');
  const skin = materialNamed(m, 'Airliner_livery');
  const img = skin && skin.map && skin.map.image;
  const emblem = meshesNamed(m, /^Tail emblem$/)[0];
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
    ok(`${tier}: the fin mark is ${tier === 'high' || tier === 'ultra' ? 512 : 256} px`, r.emblem === (tier === 'high' || tier === 'ultra' ? 512 : 256), String(r.emblem));
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
  ok('abyssinia (painted): the skin is paint — low metalness, a clearcoat on High', !!pskin && pskin.metalness < 0.3 && pskin.clearcoat > 0.2, pskin ? `metalness ${pskin.metalness}, clearcoat ${pskin.clearcoat}` : 'none');
  const fans = meshesNamed(painted, /^Fan cowl$/);
  ok('abyssinia: both fan cowls wear the cowl skin, in the airline\'s green with the gold ring', fans.length === 2 && fans.every((f) => f.material.name === 'Airliner_cowl' && f.material.map && /#0b8a3e\|#e8b40a/.test(f.material.map.name)), fans.map((f) => f.material.map && f.material.map.name).join(' | '));
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
  ok('abyssinia: the name is lettered heavy (weight 700) and spaced, sixteen to one, in its own face (Kanit)', !!title && /_700_0\.05_Kanit\/600\/normal$/.test(title.material.map.name) && title.material.map.image.width === 2048, title ? title.material.map.name : 'none');
  const pylons = meshesNamed(painted, /^Engine pylon$/);
  ok('abyssinia: the pylons keep the body colour (no cowl skin smeared on them)', pylons.length === 0 || pylons.every((p) => p.material.name !== 'Airliner_cowl'));
  dispose(painted);

  const freight = build('b747', 'nightfreight');
  const ft = meshesNamed(freight, /^Titling$/)[0];
  ok('nightfreight (billboard): the name is taller — ten to one, weight 800, in amber, condensed (Oswald)', !!ft && ft.material.map.image.width === 1280 && /_800_0\.12_Oswald\/600\/normal$/.test(ft.material.map.name) && /#e8a33c/.test(ft.material.map.name), ft ? ft.material.map.name : 'none');
  const reg = meshesNamed(freight, /^Airframe registration$/)[0];
  ok('nightfreight: the registration is light on a dark body, medium weight, stencil-spaced', !!reg && /#e9eef2/.test(reg.material.map.name) && /_600_0\.08$/.test(reg.material.map.name), reg ? reg.material.map.name : 'none');
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
        const emb = meshesNamed(m, /^Tail emblem$/);
        if (skin && emb.length !== 2) bad.push(`${id}/${l.id}: ${emb.length} fin marks`);
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
