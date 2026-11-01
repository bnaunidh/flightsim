/**
 * Snow lies on the ground, the ploughed tarmac stays dark (the owner,
 * 2026-10-31: "runways are white" — in snowing weather the runway was lit as
 * white as snow while the grass stayed summer green).
 */
import { readFileSync } from 'node:fs';
const SRC = new URL('../../src/', import.meta.url).href;
let n = 0;
let fails = 0;
const ok = (name, pass, detail = '') => { n++; if (!pass) fails++; console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`); };
const S = await import(SRC + 'render/surfaces.js');
const wx = (snow, rain = 0) => ({ cond: { snow, rain, cloud: 0.9 }, timeInfo: { sunElev: 40 } });
S.resetSurfaces && S.resetSurfaces();
S.SNOW_COVER.value = 0;
S.setFieldWetness(0);
for (let t = 0; t < 30; t += 0.1) S.updateSurfaces(wx(0.6), 0.1);
const half = S.SNOW_COVER.value;
for (let t = 0; t < 60; t += 0.1) S.updateSurfaces(wx(0.6), 0.1);
ok('steady snow settles: about half lying after 30 s, white over after 90 s', half > 0.4 && half < 0.6 && S.SNOW_COVER.value > 0.99, `${half.toFixed(2)} then ${S.SNOW_COVER.value.toFixed(2)}`);
ok('...and the tarmac is wet (darker, glossy), not lit white', S.fieldWetness() > 0.7, S.fieldWetness().toFixed(2));
for (let t = 0; t < 60; t += 0.1) S.updateSurfaces(wx(0), 0.1);
const after1 = S.SNOW_COVER.value;
ok('it melts slowly once the snow stops (a minute later most is still there)', after1 > 0.75 && after1 < 0.85, after1.toFixed(2));
for (let t = 0; t < 300; t += 0.1) S.updateSurfaces(wx(0), 0.1);
ok('...and is gone five minutes after', S.SNOW_COVER.value === 0, S.SNOW_COVER.value.toFixed(3));
for (let t = 0; t < 200; t += 0.1) S.updateSurfaces(wx(0, 1), 0.1);
ok('rain lays no snow', S.SNOW_COVER.value === 0);
const terr = readFileSync(new URL('../../src/world/terrain.js', import.meta.url), 'utf8');
ok('every terrain material reads the shared lying-snow uniform (no recompile)', /shader\.uniforms\.uSnowCover = SNOW_COVER;/.test(terr) && /uniform float uSnowCover;/.test(terr));
ok('...above the tide line only (no snow on the wet sand or under the sea)', /uSnowCover \* smoothstep\(0\.5, 3\.0, vGroundY\)/.test(terr));
console.log(`\nsnow-lies: ${n - fails}/${n} passed`);
process.exit(fails ? 1 : 0);
