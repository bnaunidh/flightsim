/**
 * Dump what the game's own model of a type measures, for process.py to fit
 * a real model to: the fuselage profile (top, bottom, half width every
 * half metre), the engines, wing, fin and gear, the gear contact points and
 * the span — all from the real roster and the real fleet factory.
 *
 *   node tools/real-models/ref.mjs b737 [a321 ...]   -> tools/real-models/ref/<id>.json
 */
import { writeFileSync } from 'node:fs';
global.document = {
  createElement: () => ({ getContext: () => new Proxy({}, { get: () => () => ({ addColorStop() {}, data: new Uint8ClampedArray(4) }) }), width: 0, height: 0, style: {} }),
  body: { appendChild() {} }, head: { appendChild() {} },
};
globalThis.window = globalThis.window || { addEventListener() {}, devicePixelRatio: 1 };
const SRC = new URL('../../src/', import.meta.url).href;
const T = await import(SRC + 'aircraft/types.js');
const A = await import(SRC + 'aircraft/model-adapter.js');
const r3 = (v) => Math.round(v * 1000) / 1000;
for (const id of process.argv.slice(2)) {
  const type = T.getAircraft(id);
  const m = A.createAircraftModel({ type });
  const ud = m.userData;
  const c = ud.config || {};
  const fd = ud.flightDeck;
  // The main tube (the flight deck's hull is the hump's on a 747), and the hump if there is one.
  const paint = ud.realPaint;
  const h = (paint && paint.hull) || (fd && fd.hull);
  const hump = paint && paint.hump;
  const fus = ud.fuselage || null;
  const profile = [];
  if (h && fus) {
    for (let z = Math.ceil(fus.nose * 2) / 2; z <= fus.tail; z += 0.5) {
      const s = h.section(z);
      profile.push([r3(z), r3(s.yc + s.ht), r3(s.yc - s.hb), r3(s.w), r3(s.yc)]);
    }
  }
  // An aeroplane the airliner kit did not draw (the A-10): its fuselage from the pack's own stations [z, rx, ry, cy].
  if (!profile.length && Array.isArray(c.body) && c.body.length > 1) {
    const st = c.body;
    const at = (z, k) => {
      if (z <= st[0][0]) return st[0][k];
      for (let i = 1; i < st.length; i++) if (z <= st[i][0]) { const t = (z - st[i - 1][0]) / (st[i][0] - st[i - 1][0]); return st[i - 1][k] + (st[i][k] - st[i - 1][k]) * t; }
      return st[st.length - 1][k];
    };
    for (let z = Math.ceil(st[0][0] * 2) / 2; z <= st[st.length - 1][0]; z += 0.5) {
      const rx = at(z, 1), ry = at(z, 2), cy = at(z, 3);
      profile.push([r3(z), r3(cy + ry), r3(cy - ry), r3(rx), r3(cy)]);
    }
  }
  const humpProfile = [];
  if (hump && fus) {
    for (let z = Math.ceil(fus.nose * 2) / 2; z <= fus.tail; z += 0.5) {
      const s = hump.section(z);
      if (z >= hump.zMin && z <= hump.zMax && s.w > 0.01) humpProfile.push([r3(z), r3(s.yc + s.ht), r3(s.yc - s.hb), r3(s.w), r3(s.yc)]);
    }
  }
  const fg = ud.flightGeometry || {};
  const out = {
    id, name: type.name, realSpan: type.aero && type.aero.wingSpan, realLength: fus ? r3(fus.tail - fus.nose) : null, fus: fus || (profile.length ? { nose: profile[0][0], tail: profile[profile.length - 1][0], halfWidth: Math.max(...profile.map((p) => p[3])), top: Math.max(...profile.map((p) => p[1])), bottom: Math.min(...profile.map((p) => p[2])) } : null), profile, humpProfile, engines: c.engines || [], wing: c.wing || null, fin: c.fin || null, tail: c.tail || null,
    gear: c.gear || null, gearPoints: fg.gearPoints || [], span: fg.wingSpan, bounds: fg.bounds, eye: fg.eye, deck: fd ? fd.on : null,
  };
  writeFileSync(new URL(`./ref/${id}.json`, import.meta.url), JSON.stringify(out, null, 1));
  console.log(id, 'profile', profile.length, 'fus', JSON.stringify(fus), 'span', fg.wingSpan, 'engines', out.engines.length);
}
