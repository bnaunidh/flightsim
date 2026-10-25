/**
 * Skins: what the livery picker does to every aeroplane, on the real models.
 *
 * The v64 sweep (every type x every paint, hangar, flight and multiplayer)
 * found the paints half-applied, and this is what holds each finding:
 *
 *   1  the fleet pack's six non-airliner types (Vanguard, Osprey, F-22, F-35B,
 *      F/A-18, Massimo) take an airline scheme's TAIL colour on the fin and
 *      rudder, its REGISTRATION, and (Air Force One) its TITLE; the Nightjar,
 *      which has no fin or fuselage sides, wears both on its upper surface;
 *   2  the four older civil models (Skylark, Courier, Meridian, Tempest) carry
 *      the registration and the title as DECALS on the fuselage, once a side,
 *      readable and not mirrored from either, and nothing of the sort is
 *      painted into the one skin their wings and nacelles share;
 *   3  the Air Force One paint is never handed out at random, to a parked
 *      aeroplane or an ambient airliner (and so never to the radio);
 *   5  a parked fighter keeps its own paint: airline colours are for the
 *      civil types;
 *   6  T-Pose Harrison takes the paint (it was one picture for all eight);
 *   8  the Skyhook's lettering is legible on a light paint, and it carries
 *      the scheme's number.
 *
 * The airliners (their own decorator, fleet/extra/airliners.js) are held to
 * the same checks, so nothing that fixed the others can break them.
 *
 *  10  (wave 10, the skins lane) the paint at this quality tier: the livery
 *      canvas is the tier's size (airliner-kit liverySizeFor), a clearcoat
 *      on High and Ultra only, the fan cowls in the airline's cowl skin,
 *      bare metal as metal, the name's decal at its layout's proportion.
 *
 * `check(sim, r, say)`, as tests/features/index.js expects.
 */

const PACK = ['vanguard', 'osprey', 'f22', 'f35b', 'fa18', 'massimo'];
const AIRLINERS = ['a320', 'b747', 'a380'];
const LEGACY = ['skylark', 'courier', 'meridian', 'tempest'];
const SCHEMES = ['abyssinia', 'continental', 'nightfreight', 'potus'];

export async function check(sim, r, say = () => {}) {
  let A;
  let L;
  let TY;
  let TR;
  let TEX;
  let THREE;
  try {
    A = await import('../../src/aircraft/model-adapter.js');
    L = await import('../../src/aircraft/liveries.js');
    TY = await import('../../src/aircraft/types.js');
    TR = await import('../../src/features/traffic.js');
    TEX = await import('../../src/render/textures.js');
    THREE = await import('../../src/vendor/three.module.js');
  } catch (e) {
    r.ok('skins: modules load', false, String((e && e.message) || e));
    return;
  }

  const warns = [];
  const realWarn = console.warn;
  console.warn = (...a) => {
    warns.push(a.map((x) => String((x && x.message) || x)).join(' ').slice(0, 160));
  };
  const built = [];
  const build = (id, lid) => {
    const type = TY.getAircraft(id);
    const scheme = L.schemeFor(type, lid);
    const model = A.createAircraftModel({ type, livery: scheme });
    built.push(model);
    return { type, scheme, model };
  };
  const decals = (model, name) => {
    const out = [];
    model.traverse((o) => {
      if (o.isMesh && o.name === name && o.geometry && o.geometry.attributes.position.count > 0 && o.visible) out.push(o);
    });
    return out;
  };
  const textOf = (mesh) => (mesh.material && mesh.material.map && mesh.material.map.userData && mesh.material.map.userData.text) || null;
  /** Vertices of a decal in the aeroplane's own frame: x, y, z, u, v. */
  const rowsOf = (model, mesh) => {
    model.updateMatrixWorld(true);
    const inv = model.matrixWorld.clone().invert();
    const p = mesh.geometry.attributes.position;
    const uv = mesh.geometry.attributes.uv;
    const v = new THREE.Vector3();
    const rows = [];
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(mesh.matrixWorld).applyMatrix4(inv);
      rows.push([v.x, v.y, v.z, uv.getX(i), uv.getY(i)]);
    }
    return rows;
  };
  const cov = (rows, a, b) => {
    const n = rows.length || 1;
    let ma = 0;
    let mb = 0;
    for (const q of rows) {
      ma += q[a];
      mb += q[b];
    }
    ma /= n;
    mb /= n;
    let c = 0;
    for (const q of rows) c += (q[a] - ma) * (q[b] - mb);
    return c / n;
  };
  /**
   * Reads left to right and the right way up from outside? Starboard side
   * (x > 0): the nose is on the reader's right, so u must grow as z falls.
   * Port: u grows with z. Both: v grows with y. A decal across the top of a
   * flying wing (x on both sides, nothing standing up): u grows with x, and
   * v towards the nose (z falls).
   */
  const reads = (model, mesh) => {
    const rows = rowsOf(model, mesh);
    const pos = rows.filter((q) => q[0] > 1e-4);
    const neg = rows.filter((q) => q[0] < -1e-4);
    const ext = (i) => Math.max(...rows.map((q) => q[i])) - Math.min(...rows.map((q) => q[i]));
    const top = pos.length > 0 && neg.length > 0 && ext(1) < 0.25 * ext(0);
    if (top) return cov(rows, 3, 0) > 0 && cov(rows, 4, 2) < 0;
    const groups = [];
    if (pos.length) groups.push(['starboard', pos]);
    if (neg.length) groups.push(['port', neg]);
    return groups.every(([side, g]) => (side === 'starboard' ? cov(g, 3, 2) < 0 : cov(g, 3, 2) > 0) && cov(g, 4, 1) > 0);
  };
  const finite = (model) => {
    let bad = 0;
    model.traverse((o) => {
      if (!o.isMesh || !o.geometry) return;
      const a = o.geometry.attributes.position.array;
      for (let i = 0; i < a.length; i += 7) if (!Number.isFinite(a[i])) bad++;
    });
    return bad === 0;
  };
  const tailStyle = (hex) => new THREE.Color(hex).getStyle();

  try {
    /* ---- 1. the pack's types wear the scheme ----------------------------------- */
    say('skins: the pack types');
    for (const id of [...PACK, 'nightjar', ...AIRLINERS]) {
      for (const lid of SCHEMES) {
        let tag = `skins: ${id} in ${lid}`;
        try {
          const { scheme, model } = build(id, lid);
          const regs = decals(model, 'Airframe registration');
          const regTexts = [...new Set(regs.map(textOf))];
          r.ok(`${tag}: wears the scheme's registration (${scheme.reg})`, regTexts.length === 1 && regTexts[0] === scheme.reg, regTexts.join(',') || 'no registration decal');
          const titles = decals(model, 'Titling');
          const titleTexts = [...new Set(titles.map(textOf))];
          // The airliner models also write the airline's own name (liveries.js
          // `titling`) along the forward fuselage; nothing else reads it, so a
          // Skylark in an airline's colours stays a plain flying-school aeroplane.
          const words = scheme.title || (AIRLINERS.includes(id) ? scheme.titling : null);
          if (words) r.ok(`${tag}: carries the title (${words})`, titleTexts.length === 1 && titleTexts[0] === words, titleTexts.join(',') || 'no Titling decal');
          else r.ok(`${tag}: carries no title (the scheme has none)`, titles.length === 0, `${titles.length} titling meshes`);
          r.ok(`${tag}: every decal reads left to right the right way up, from both sides`, [...regs, ...titles].every((m) => reads(model, m)), `${regs.length + titles.length} decals`);
          if (id !== 'nightjar') {
            let fin = false;
            const want = `Aircraft_tail_${tailStyle(scheme.tail)}`;
            model.traverse((o) => {
              if (!o.isMesh) return;
              const mats = [].concat(o.material);
              for (const m of mats) {
                if (m && m.map && typeof m.map.name === 'string' && m.map.name.startsWith(want)) fin = true;
                if (m && m.name === 'Aircraft_livery_tail' && m.color && m.color.getHex() === new THREE.Color(scheme.tail).getHex()) fin = true;
              }
            });
            r.ok(`${tag}: the fin and rudder are the scheme's tail colour`, fin);
          } else {
            r.ok(`${tag}: a flying wing has no fin to paint, so its number and words lie on its upper surface`, regs.length === 1 && (!scheme.title || titles.length === 1), `${regs.length} number, ${titles.length} title`);
          }
          r.ok(`${tag}: no NaN in its geometry`, finite(model));
        } catch (e) {
          r.ok(`${tag}: builds`, false, String((e && e.stack) || e).slice(0, 200));
        }
      }
      // The house paint is the type's own: no airline's number, no title, no new fin material.
      try {
        const { model } = build(id, 'house');
        const regs = decals(model, 'Airframe registration');
        const texts = [...new Set(regs.map(textOf))];
        const airline = new Set(L.LIVERIES.filter((l) => !l.house).map((l) => l.reg));
        r.ok(`skins: ${id} in house colours keeps its own registration, and no title`, !texts.some((t) => airline.has(t)) && decals(model, 'Titling').length === 0, texts.join(',') || 'none');
      } catch (e) {
        r.ok(`skins: ${id} in house colours builds`, false, String((e && e.stack) || e).slice(0, 200));
      }
    }

    /* ---- 2. the older civil models: decals, not paint in the skin ------------------ */
    say('skins: the older civil models');
    for (const id of LEGACY) {
      const type = TY.getAircraft(id);
      for (const lid of ['house', ...SCHEMES]) {
        const tag = `skins: ${id} in ${lid}`;
        try {
          const { scheme, model } = build(id, lid);
          const regs = decals(model, 'Airframe registration');
          const t = [...new Set(regs.map(textOf))];
          if (scheme.reg) r.ok(`${tag}: its number (${scheme.reg}) is a decal on the fuselage`, regs.length === 1 && t[0] === scheme.reg, t.join(',') || 'none');
          const titles = decals(model, 'Titling');
          if (scheme.title) r.ok(`${tag}: its title is a decal on the fuselage`, titles.length === 1 && textOf(titles[0]) === scheme.title, titles.map(textOf).join(',') || 'none');
          else r.ok(`${tag}: no title`, titles.length === 0);
          r.ok(`${tag}: its lettering reads left to right the right way up, on both sides`, [...regs, ...titles].every((m) => reads(model, m)), `${regs.length + titles.length} decals`);
          // On the fuselage, once a side: both sides of the centreline, close to it, and the model not mirrored.
          const sides = (m) => {
            const rows = rowsOf(model, m);
            return rows.some((q) => q[0] > 0.05) && rows.some((q) => q[0] < -0.05);
          };
          r.ok(`${tag}: the lettering is on both sides of the body, once each`, [...regs, ...titles].every(sides));
        } catch (e) {
          r.ok(`${tag}: builds`, false, String((e && e.stack) || e).slice(0, 200));
        }
      }
      // Nothing is painted into the skin that the wings and nacelles share: a number and a title change
      // which decals there are, never the texture.
      const sa = TEX.airframeTexture({ base: '#eef1f5', accent: '#c8102e', cheatline: 'rgba(30,44,74,0.85)', reg: 'AAA 1', title: 'SOME WORDS' });
      const sb = TEX.airframeTexture({ base: '#eef1f5', accent: '#c8102e', cheatline: 'rgba(30,44,74,0.85)', reg: 'BBB 2' });
      r.ok(`skins: the shared airframe skin carries no lettering (${id} cannot get a number on a wing)`, sa === sb && sa === TEX.airframeTexture({ base: '#eef1f5', accent: '#c8102e', cheatline: 'rgba(30,44,74,0.85)' }));
      void type;
      break; // one proof for the shared texture is enough
    }

    /* ---- 3 and 5. nothing hands out Air Force One, and a fighter keeps its paint ------ */
    say('skins: who gets which paint');
    const special = L.LIVERIES.filter((l) => l.special).map((l) => l.id);
    r.ok('skins: the Air Force One paint is flagged story-only, and the hangar still offers it', special.includes('potus') && L.LIVERIES.some((l) => l.id === 'potus'), special.join(','));
    r.ok('skins: the random airline schemes are the real airlines, not the house colours, not a story-only one',
      L.AIRLINE_LIVERIES.length === 6 && L.AIRLINE_LIVERIES.every((l) => !l.house && !l.special), L.AIRLINE_LIVERIES.map((l) => l.id).join(','));
    let leaked = 0;
    const seen = new Set();
    for (let i = 0; i < 400; i++) {
      const l = TR.pickAirlineScheme(Math.random);
      if (!l || l.special || l.house) leaked++;
      else seen.add(l.id);
    }
    r.ok('skins: an ambient airliner is never given the Air Force One paint (so never "Air Force One 47" on the radio)', leaked === 0 && seen.size === 6, `${leaked} bad of 400; ${seen.size} airlines used`);
    const civil = TY.AIRCRAFT.filter((t) => L.wearsAirlinePaint(t)).map((t) => t.id).sort();
    // The airliners (the three, the jets and the giants of aircraft/extra) and the civil
    // light aeroplanes; never the military ones (the C-17, the C-5, the B-1B, the A-10).
    // Which airline the world paints on which airliner is airlinesFor's (tests/features/fleets.mjs).
    const civilWant = ['a320', 'b747', 'a380', 'b737', 'a321', 'b787', 'a350', 'b777', 'q400', 'concorde', 'belugaxl', 'dreamlifter', 'an225',
      'courier', 'meridian', 'skylark', 'tempest'].sort().join();
    r.ok('skins: airline paints are for airliners and the civil light aeroplanes only', civil.join() === civilWant, civil.join(','));
    const parked = (sim.apron && sim.apron.parked) || [];
    const badParked = parked.filter((p) => {
      const [tid, lid] = String(p.key).split('|');
      const t = TY.AIRCRAFT.find((a) => a.id === tid);
      return lid === 'potus' || (t && !L.wearsAirlinePaint(t) && lid !== 'house');
    });
    r.ok('skins: no parked aeroplane wears the Air Force One paint, and no parked fighter wears an airline', badParked.length === 0, `${parked.length} parked: ${parked.map((p) => p.key).join(' ')}`);

    /* ---- 6. T-Pose Harrison takes the paint ------------------------------------------ */
    say('skins: T-Pose Harrison and the Skyhook');
    {
      const colours = (model) => {
        const set = new Set();
        model.traverse((o) => {
          if (!o.isMesh) return;
          for (const m of [].concat(o.material)) if (m && m.color) set.add(m.color.getHexString());
          const c = o.geometry && o.geometry.attributes && o.geometry.attributes.color;
          if (c && c.count) set.add('vc' + [0, 1, 2].map((k) => c.array[k].toFixed(2)).join(','));
        });
        return [...set].sort().join('|');
      };
      const house = colours(build('tpose', 'house').model);
      const aby = colours(build('tpose', 'abyssinia').model);
      const night = colours(build('tpose', 'nightfreight').model);
      r.ok('skins: T-Pose Harrison looks different in each paint (the swatches do something)', house !== aby && aby !== night && house !== night);
    }

    /* ---- 8. the Skyhook ------------------------------------------------------------------- */
    {
      const matColour = (model, name) => {
        let hex = null;
        model.traverse((o) => {
          if (o.isMesh && o.material && o.material.name === name && !hex) hex = o.material.color.getHex();
        });
        return hex;
      };
      const lum = (hex) => {
        const c = new THREE.Color(hex);
        return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
      };
      const skyhook = build('harrier', 'abyssinia');
      const blender = skyhook.model.userData.blenderModel;
      if (!blender) {
        r.ok('skins: the Skyhook is the Blender model here (not loaded: its lettering check is skipped)', true, 'not loaded');
      } else {
        const main = matColour(blender, 'paint_main');
        const white = matColour(blender, 'paint_white');
        r.ok('skins: the Skyhook\'s lettering stands out from a light paint', main != null && white != null && Math.abs(lum(main) - lum(white)) > 0.25, `body ${main && main.toString(16)}, lettering ${white && white.toString(16)}`);
        const pot = build('harrier', 'potus');
        const regs = decals(pot.model, 'Airframe registration');
        r.ok('skins: the Skyhook carries the scheme\'s number on its boom, once a side', regs.length >= 1 && regs.every((m) => textOf(m) === 'SAM 42'), regs.map(textOf).join(',') || 'none');
        const night = build('harrier', 'nightfreight');
        const nWhite = matColour(night.model.userData.blenderModel, 'paint_white');
        r.ok('skins: …and on a dark paint the lettering stays white', nWhite != null && lum(nWhite) > 0.5, `lettering ${nWhite && nWhite.toString(16)}`);
      }
    }

    /* ---- 7. the hangar shows a paint at its own shade -------------------------------------------- */
    say('skins: the hangar light');
    {
      const isStub = /^\(\)=>\{\}$/.test(String(sim.renderer.render).replace(/\s/g, ''));
      const real = (typeof window !== 'undefined' && window.__realRender) || (isStub ? null : sim.renderer.render);
      const stub = sim.renderer.render;
      if (!real) {
        r.ok('skins: the hangar light (no real renderer here: skipped)', true, 'stubbed');
      } else {
        sim.renderer.render = real;
        const { HangarShowcase } = await import('../../src/ui/hangar-showcase.js');
        const stage = document.createElement('div');
        Object.assign(stage.style, { position: 'fixed', left: '0px', top: '0px', width: '640px', height: '420px', zIndex: '-1' });
        document.body.appendChild(stage);
        const sc = new HangarShowcase({ stage, isActive: () => true, onFlick() {}, onSettled() {} });
        const cv = sim.renderer.domElement;
        const grab = () => {
          const pr = cv.width / (cv.clientWidth || cv.width);
          const t = document.createElement('canvas');
          t.width = 640;
          t.height = 420;
          const g = t.getContext('2d', { willReadFrequently: true });
          g.drawImage(cv, 0, 0, 640 * pr, 420 * pr, 0, 0, 640, 420);
          return g.getImageData(0, 0, 640, 420).data;
        };
        try {
          for (const id of ['f22', 'vanguard', 'nightjar', 'courier', 'a320']) {
            sc.show(id, { livery: 'house', locked: false, dir: 0 });
            for (let i = 0; i < 14; i++) sc.render(sim.renderer, 0.1);
            sc.angle = Math.PI / 2;
            sc.spinVel = 0;
            sc.render(sim.renderer, 1e-6);
            const a = grab();
            const holder = sc.current.holder;
            holder.visible = false;
            sc.render(sim.renderer, 1e-6);
            const b = grab();
            holder.visible = true;
            // The aeroplane's own pixels: the ones that change when it is taken away.
            const lums = [];
            for (let i = 0; i < a.length; i += 4) {
              if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 60) lums.push(0.2126 * a[i] + 0.7152 * a[i + 1] + 0.0722 * a[i + 2]);
            }
            lums.sort((x, y) => x - y);
            const hx = TY.getAircraft(id).livery;
            const rgb = [1, 3, 5].map((k) => parseInt(hx.slice(k, k + 2), 16));
            const paint = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
            const median = lums.length ? lums[lums.length >> 1] : -1;
            const p75 = lums.length ? lums[(lums.length * 3) >> 2] : -1;
            if (id === 'a320') r.ok('skins: a white airliner is still white on the podium (the lit side of it)', lums.length > 2000 && p75 > 200, `${p75.toFixed(0)} of 255 at the 75th percentile`);
            else r.ok(`skins: the ${id} on the hangar's podium reads at about its own shade (paint ${paint.toFixed(0)} of 255, not washed out to white)`, lums.length > 2000 && Math.abs(median - paint) <= 42, `${median.toFixed(0)} (${lums.length} px)`);
          }
        } finally {
          document.body.removeChild(stage);
          sim.renderer.render = stub;
        }
      }
    }

    /* ---- 4. another player's aeroplane wears their paint ------------------------------------ */
    say('skins: remotes');
    {
      const MP = await import('../../src/features/multiplayer.js');
      const rem = MP.multiplayer.remotes;
      const colour = '#ff5a4f';
      const finOf = (model) => {
        let hex = null;
        model.traverse((o) => {
          if (o.isMesh && o.name === 'Painted fin' && !hex) hex = o.material.color.getHex();
        });
        return hex;
      };
      const pot = rem._build('air', 'b747', colour, 'potus');
      built.push(pot);
      r.ok('skins: another player\'s 747 in the Air Force One paint is in that paint: its title, its number, its navy tail',
        decals(pot, 'Titling').length > 0 && textOf(decals(pot, 'Airframe registration')[0]) === 'SAM 42' && finOf(pot) === 0x1c365e, `fin ${finOf(pot) && finOf(pot).toString(16)}`);
      const plain = rem._build('air', 'b747', colour, '');
      built.push(plain);
      r.ok('skins: …and with no paint heard (or the factory colours) it is in their player colour, as it always was', decals(plain, 'Titling').length === 0 && finOf(plain) === new THREE.Color(colour).getHex(), `fin ${finOf(plain) && finOf(plain).toString(16)}`);
      const fighter = rem._build('air', 'f22', colour, 'abyssinia');
      built.push(fighter);
      r.ok('skins: a fighter is in its pilot\'s airline paint too', textOf(decals(fighter, 'Airframe registration')[0]) === 'ET-ABY');
      const colourOf = (m) => {
        const set = new Set();
        m.traverse((o) => {
          const c = o.isMesh && o.geometry && o.geometry.attributes && o.geometry.attributes.color;
          if (c && c.count) set.add([0, 1, 2].map((k) => c.array[k].toFixed(2)).join(','));
          if (o.isMesh) for (const mm of [].concat(o.material)) if (mm && mm.color) set.add(mm.color.getHexString());
        });
        return [...set].sort().join('|');
      };
      const h = rem._build('air', 'tpose', '#ff5a4f', '');
      const h2 = rem._build('air', 'tpose', '#4fd684', '');
      built.push(h, h2);
      r.ok('skins: T-Pose Harrison as a remote takes the player colour (it was green shirt and blue trousers for everybody)', colourOf(h) !== colourOf(h2));
    }

    /* ---- 10. wave 10: the paint at this tier -------------------------------------------- */
    say('skins: the paint at this tier');
    try {
      const KIT = await import('../../src/fleet/extra/airliner-kit.js');
      const PAINT = await import('../../src/render/paint.js');
      const tier = TEX.textureTier();
      const want = KIT.liverySizeFor(tier);
      const clear = PAINT.paintHasClearcoat();
      const matNamed = (model, name) => {
        let found = null;
        model.traverse((o) => {
          if (found || !o.isMesh) return;
          for (const m of [].concat(o.material)) if (m && m.name === name) found = m;
        });
        return found;
      };
      const named = (model, re) => {
        const out = [];
        model.traverse((o) => {
          if (o.isMesh && re.test(o.name)) out.push(o);
        });
        return out;
      };
      /** How many distinct colours a 24 x 12 grid of samples off the livery canvas finds. */
      const shades = (map) => {
        const img = map && map.image;
        if (!img || typeof img.getContext !== 'function') return -1;
        const g = img.getContext('2d', { willReadFrequently: true });
        const set = new Set();
        for (let i = 0; i < 24; i++) {
          for (let j = 0; j < 12; j++) {
            const d = g.getImageData(Math.floor(((i + 0.5) / 24) * img.width), Math.floor(((j + 0.5) / 12) * img.height), 1, 1).data;
            set.add((d[0] >> 3) + ',' + (d[1] >> 3) + ',' + (d[2] >> 3));
          }
        }
        return set.size;
      };
      for (const lid of ['house', ...L.AIRLINE_LIVERIES.map((l) => l.id)]) {
        const { scheme, model } = build('a320', lid);
        const skin = matNamed(model, 'Airliner_livery');
        const img = skin && skin.map && skin.map.image;
        r.ok(`skins: a320 in ${lid}: the livery is drawn at this tier's size (${tier}: ${want.join('x')})`, !!img && img.width === want[0] && img.height === want[1], img ? `${img.width}x${img.height}` : 'no skin');
        r.ok(`skins: a320 in ${lid}: the paint ${clear ? 'wears a clearcoat (High/Ultra)' : 'is a plain material (Low/Medium: no clearcoat)'}`,
          !!skin && (clear ? skin.isMeshPhysicalMaterial && skin.clearcoat > 0 : !skin.isMeshPhysicalMaterial), skin ? skin.type : 'none');
        const n = shades(skin && skin.map);
        r.ok(`skins: a320 in ${lid}: the livery canvas is painted, not a flat colour (${n} shades sampled)`, n >= 6, String(n));
        const fans = named(model, /^Fan cowl$/);
        r.ok(`skins: a320 in ${lid}: both fan cowls wear the cowl skin`, fans.length === 2 && fans.every((f) => f.material.name === 'Airliner_cowl' && f.material.map), `${fans.length} cowls`);
        // The ring is at the FRONT of the cowl (by the lip), not at the nozzle:
        // read the cowl skin at the v the front of the cowl has, the way the
        // GPU does (a flipped texture reads row (1 - v)).
        if (scheme.style && scheme.style.cowlBand && fans[0]) {
          const f = fans[0];
          const map = f.material.map;
          const img = map.image;
          const gc = img.getContext('2d', { willReadFrequently: true });
          const pos = f.geometry.attributes.position;
          const uvs = f.geometry.attributes.uv;
          let zMin = Infinity;
          let zMax = -Infinity;
          for (let i = 0; i < pos.count; i++) {
            zMin = Math.min(zMin, pos.getZ(i));
            zMax = Math.max(zMax, pos.getZ(i));
          }
          // v runs along the cowl in step with z, lip (0) to nozzle (1): the
          // vertices are few, so check that, then read 13.5% back (the ring).
          let lin = 0;
          for (let i = 0; i < pos.count; i++) lin = Math.max(lin, Math.abs(uvs.getY(i) - (pos.getZ(i) - zMin) / (zMax - zMin)));
          const best = { v: lin < 0.03 ? 0.135 : NaN };
          const row = (v) => Math.min(img.height - 1, Math.max(0, Math.floor((map.flipY ? 1 - v : v) * img.height)));
          const at = (v) => Array.from(gc.getImageData(2, row(v), 1, 1).data.slice(0, 3));
          const hexOf = String(scheme.style.cowlBand).replace('#', '');
          const want = [0, 2, 4].map((k) => parseInt(hexOf.slice(k, k + 2), 16)); // sRGB, as the canvas holds it
          const got = at(best.v);
          const near = Math.abs(got[0] - want[0]) + Math.abs(got[1] - want[1]) + Math.abs(got[2] - want[2]) < 60;
          r.ok(`skins: a320 in ${lid}: the cowl ring is at the front of the cowl, by the lip`, near, `rgb ${got.join(',')} at v 0.135; v off z-linear by ${lin.toFixed(3)}`);
          // The reverser sleeve wears the same skin and carries on the cowl's v for its z.
          const sleeve = named(model, /^Reverser sleeve skin$/)[0];
          if (sleeve) {
            const sp = sleeve.geometry.attributes.position;
            const su = sleeve.geometry.attributes.uv;
            let front = null;
            for (let i = 0; i < sp.count; i++) if (!front || sp.getZ(i) < front.z) front = { z: sp.getZ(i), v: su.getY(i) };
            const vCowl = (front.z - zMin) / (zMax - zMin);
            r.ok(`skins: a320 in ${lid}: the reverser sleeve carries on the cowl's paint (no ring of its own)`, Math.abs(front.v - vCowl) < 0.05, `sleeve front v ${front.v.toFixed(2)}, cowl there ${vCowl.toFixed(2)}`);
          }
        }
        if (scheme.style && scheme.style.metal) r.ok(`skins: a320 in ${lid}: bare metal is metal`, !!skin && skin.metalness > 0.6, skin ? `metalness ${skin.metalness}` : 'none');
        const title = named(model, /^Titling$/)[0];
        if (scheme.titling) r.ok(`skins: a320 in ${lid}: the name's decal is ${scheme.style && scheme.style.layout === 'billboard' ? 'ten' : 'sixteen'} to one`, !!title && title.material.map.image.width === (scheme.style && scheme.style.layout === 'billboard' ? 1280 : 2048), title ? String(title.material.map.image.width) : 'none');
      }
    } catch (e) {
      r.ok('skins: the paint at this tier (checks ran)', false, String((e && e.stack) || e).slice(0, 200));
    }

    r.ok('skins: nothing warned while all those aeroplanes were built', warns.length === 0, warns.slice(0, 2).join(' | '));
  } catch (e) {
    r.ok('skins: the checks ran', false, String((e && e.stack) || e).slice(0, 300));
  } finally {
    console.warn = realWarn;
    for (const m of built) {
      try {
        if (m.userData && m.userData.dispose) m.userData.dispose();
      } catch (e) {
        /* a model that cannot be disposed is left to the garbage collector */
      }
    }
  }
}
