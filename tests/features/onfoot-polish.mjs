/**
 * On-foot polish (owner, 2026-11-11), the parts node can check:
 *   - World Map tree cards stay whole up close on foot, and still fade near the eye in flight
 *     (worldmap/tree-cards.js setCardNearFade, switched by features/onfoot.js);
 *   - the runaway plane's prompts point at the PLANE pin and the beam, not "the middle of the map";
 *   - the minimap can follow someone other than the aeroplane (sim.mapCentre) and draws no plane
 *     glyph for a person.
 * The in-game behaviour (map follows you, the pin moves with her, the beam once she is down,
 * grass at your feet) is checked by the GM's browser run; see the commit.
 *
 *   node tests/features/onfoot-polish.mjs
 */
import { readFileSync } from 'node:fs';
let passed = 0;
let failed = 0;
const ok = (name, pass, detail = '') => {
  if (pass) passed++;
  else failed++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};
const TC = await import('../../src/world/worldmap/tree-cards.js');
const m = TC.mergedCardMaterial(1);
const sh = { uniforms: {}, vertexShader: '#include <common>\n#include <uv_vertex>\n#include <begin_vertex>', fragmentShader: '#include <normal_fragment_begin>\n#include <alphatest_fragment>' };
m.onBeforeCompile(sh);
const u = sh.uniforms.uCardNear;
ok('tree cards: the near fade reads a uniform', !!u && /uniform vec2 uCardNear/.test(sh.fragmentShader) && /smoothstep\(uCardNear\.x, uCardNear\.y/.test(sh.fragmentShader));
ok('tree cards: flying, a card still fades out 26-60 m from the eye', u.value.x === 26 && u.value.y === 60);
TC.setCardNearFade(true);
ok('tree cards: on foot, a tree you walk up to stays whole', u.value.x === 0 && u.value.y < 0.1);
TC.setCardNearFade(false);
ok('tree cards: back in the air, the fade is back', u.value.x === 26 && u.value.y === 60);
const rw = readFileSync(new URL('../../src/features/runaway.js', import.meta.url), 'utf8');
ok('runaway: no prompt sends you to "the middle of the map" any more', !/middle of the map/.test(rw.replace(/\/\*[\s\S]*?\*\//g, '')));
ok('runaway: the map follows you (sim.mapCentre) and she is a PLANE pin; the beam goes with the runaway', /sim\.mapCentre = R\.centre/.test(rw) && /label: 'PLANE'/.test(rw) && /R\.beacon\.visible = false/.test(rw));
const mm = readFileSync(new URL('../../src/ui/minimap.js', import.meta.url), 'utf8');
ok('minimap: follows sim.mapCentre when set, no plane glyph for a person', /sim\.mapCentre \|\|/.test(mm) && /craft\.kind === 'foot'\) return/.test(mm));
const of = readFileSync(new URL('../../src/features/onfoot.js', import.meta.url), 'utf8');
ok('on foot: the card fade is switched off while walking and back on after, grass hidden after', /cardFade\(true\)/.test(of) && /cardFade\(false\)/.test(of) && /hideGrass\(\)/.test(of) && /updateGrass\(sim, S\.walker, dt\)/.test(of));
const G = await import('../../src/features/onfoot-grass.js');
let lo = 0, hi = 0;
for (let x = -2000; x < 2000; x += 7) for (let z = -2000; z < 2000; z += 7) { const m = G.meadowAt(x, z); if (m > 0.8) hi++; else if (m < 0.05) lo++; }
ok('long grass: meadows of it, and plenty of short grass between', hi > 1000 && lo > hi, `${hi} meadow samples, ${lo} short`);
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
