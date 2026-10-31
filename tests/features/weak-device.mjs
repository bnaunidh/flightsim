/**
 * WEAK DEVICE + PERFORMANCE MODE (the Chromebook pass, 2026-10-30). Run from
 * the repo root: node tests/features/weak-device.mjs
 *
 *   - render/weak-device.js: a Chromebook UA, 4 cores or less, 4 GB or less,
 *     an entry GPU or Data Saver each mean "weak"; a capable laptop does not;
 *   - Low renders at one device pixel per CSS pixel, and the dynamic
 *     resolution on Low / Performance mode may drop to half size;
 *   - main.js asks at the first boot, writes Low + Performance mode, skips
 *     the Auto probe, and Performance mode is a setting with a checkbox in
 *     Settings > Graphics, a way back to the old tier, and a 10 Hz minimap.
 * Every check here fails on v75.5.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const src = (p) => readFileSync(resolve(ROOT, p), 'utf8');
let passed = 0, failed = 0;
const ok = (name, pass, detail = '') => { if (pass) passed++; else failed++; console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ` -- ${detail}` : ''}`); };

const W = await import(new URL('../../src/render/weak-device.js', import.meta.url).href);
const D = await import(new URL('../../src/render/dyn-res.js', import.meta.url).href);

const CROS = 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

let d = W.detectWeakDevice({ ua: CROS, hardwareConcurrency: 8, deviceMemory: 8, renderer: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Pro, Unspecified Version)' });
ok('weak-device: a ChromeOS browser is weak on the UA alone', d.weak && d.reasons.includes('chromeos'), JSON.stringify(d));
d = W.detectWeakDevice({ ua: MAC, hardwareConcurrency: 4, deviceMemory: 8, renderer: 'ANGLE (Apple M1)' });
ok('weak-device: four cores or less is weak', d.weak && d.reasons.includes('cores:4'));
d = W.detectWeakDevice({ ua: MAC, hardwareConcurrency: 8, deviceMemory: 4, renderer: 'ANGLE (Apple M1)' });
ok('weak-device: 4 GB or less is weak', d.weak && d.reasons.includes('memory:4'));
d = W.detectWeakDevice({ ua: MAC, hardwareConcurrency: 8, deviceMemory: 8, renderer: 'ANGLE (Intel, Intel(R) UHD Graphics 600 (0x00003185) Direct3D11 vs_5_0 ps_5_0, D3D11)' });
ok('weak-device: an Intel UHD 600 is weak', d.weak && d.reasons.includes('gpu'));
d = W.detectWeakDevice({ ua: MAC, hardwareConcurrency: 8, deviceMemory: 8, renderer: 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)' });
ok('weak-device: SwiftShader (no GPU) is weak', d.weak && d.reasons.includes('gpu'));
d = W.detectWeakDevice({ ua: MAC, hardwareConcurrency: 8, deviceMemory: 8, renderer: 'ANGLE (Apple M1)', saveData: true });
ok('weak-device: Data Saver is weak', d.weak && d.reasons.includes('save-data'));
d = W.detectWeakDevice({ ua: MAC, hardwareConcurrency: 10, deviceMemory: 8, renderer: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Pro, Unspecified Version)' });
ok('weak-device: this Mac is not weak', !d.weak && d.reasons.length === 0, JSON.stringify(d));
d = W.detectWeakDevice({ ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130', hardwareConcurrency: 12, deviceMemory: 8, renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)' });
ok('weak-device: a gaming PC is not weak', !d.weak);
d = W.detectWeakDevice({ ua: MAC, hardwareConcurrency: 8, deviceMemory: 8, renderer: 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)' });
ok('weak-device: an Iris Xe is not weak on the GPU', !d.weak, JSON.stringify(d));
d = W.detectWeakDevice({});
ok('weak-device: no facts at all is not weak', !d.weak);
ok('weak-device: gpuRendererName returns "" without a document', W.gpuRendererName(null) === '' && W.gpuRendererName({ createElement: () => ({ getContext: () => null }) }) === '');
ok('weak-device: deviceFacts reads navigator', (() => { const f = W.deviceFacts({ userAgent: CROS, hardwareConcurrency: 2, deviceMemory: 4, connection: { saveData: true } }, null); return f.ua === CROS && f.hardwareConcurrency === 2 && f.deviceMemory === 4 && f.saveData === true && f.renderer === ''; })());
ok('weak-device: PERF_MODE says 10 Hz minimap, half-size floor, pixel ratio 1', W.PERF_MODE.minimapHz === 10 && W.PERF_MODE.renderScaleMin === 0.5 && W.PERF_MODE.pixelRatioMax === 1);

ok('weak-device: Low renders at one device pixel per CSS pixel', D.pixelRatioCap('low', 2) === 1 && D.pixelRatioCap('low', 1.5) === 1 && D.pixelRatioCap('low', 1) === 1);
ok('weak-device: Medium keeps 1.25', D.pixelRatioCap('medium', 2) === 1.25);
const dr = new D.DynamicResolution();
ok('weak-device: the dynamic resolution floor is 0.65 on High', dr.configure('high').min === 0.65);
ok('weak-device: ...and 0.5 on Low', dr.configure('low').min === 0.5);
ok('weak-device: ...and 0.5 in Performance mode whatever the tier', dr.configure('medium', true).min === 0.5);
{
  const low = new D.DynamicResolution().configure('low');
  for (let i = 0; i < 20; i++) low.tick(20);
  ok('weak-device: twenty slow seconds on Low reach the half-size floor', low.scale === 0.5, `scale ${low.scale}`);
  for (let i = 0; i < 40; i++) low.tick(60);
  ok('weak-device: ...and fast seconds climb back to full', low.scale === 1, `scale ${low.scale}`);
  const high = new D.DynamicResolution().configure('high');
  for (let i = 0; i < 20; i++) high.tick(20);
  ok('weak-device: High never goes below 0.65', high.scale === 0.65, `scale ${high.scale}`);
}

/* ---- main.js, storage.js, menus.js ---- */
const main = src('src/main.js');
const storage = src('src/core/storage.js');
const menus = src('src/ui/menus.js');
ok('weak-device: settings carry performanceMode (off) and weakDevice (not asked)', /performanceMode: false,/.test(storage) && /weakDevice: null,/.test(storage) && /export function hasSavedSettings\(\)/.test(storage));
ok('weak-device: the first boot asks before the renderer is made', (() => { const c = main.indexOf('this.applyWeakDeviceDefaults();'); return c > 0 && c < main.indexOf("if (this.settings.quality !== 'low') installHeightFog();") && c < main.indexOf('new THREE.WebGLRenderer('); })());
ok('weak-device: a weak first boot is Low + Performance mode with no Auto probe', /s\.performanceMode = true;\s*s\.performanceModePrev = 'auto';\s*s\.qualityAuto = false;\s*s\.qualityAutoPicked = 'low';\s*s\.quality = 'low';/.test(main));
ok('weak-device: a save that chose a tier is never asked', /hasSavedSettings\(\) && !\(s\.qualityAuto && !s\.qualityAutoPicked\)/.test(main));
ok('weak-device: ?weak=1 forces and ?weak=0 skips the detection', /params\.get\('weak'\)/.test(main) && /force === '0'/.test(main) && /force === '1'/.test(main));
ok('weak-device: the dynamic resolution is configured for the tier at boot and on a rebuild', /new DynamicResolution\(\)\.configure\(q, this\.settings\.performanceMode\)/.test(main) && /this\.dynRes\.configure\(quality, this\.settings\.performanceMode\)/.test(main));
ok('weak-device: every pixel ratio goes through pixelCap (never over 1 in Performance mode)', (main.match(/this\.pixelCap\(/g) || []).length >= 4 && (main.match(/pixelRatioCap\(/g) || []).length === 1 && /Math\.min\(cap, PERF_MODE\.pixelRatioMax\)/.test(main));
ok('weak-device: Performance mode is a setting (applySetting -> setPerformanceMode)', /if \(path === 'performanceMode'\) \{\s*this\.setPerformanceMode\(!!value\);\s*return;/.test(main) && /setPerformanceMode\(on\) \{/.test(main));
ok('weak-device: Performance mode on remembers the tier (or Auto) and goes to Low', /s\.performanceModePrev = s\.qualityAuto \? 'auto' : s\.quality;/.test(main) && /this\.rebuildQuality\('low'\)/.test(main));
ok('weak-device: Performance mode off goes back (Auto probes again)', /if \(prev === 'auto'\) \{\s*saveSettings\(s\);\s*this\.chooseAutoQuality\(\);/.test(main));
ok('weak-device: picking a tier above Low, or Auto, leaves Performance mode', /if \(value !== 'low'\) this\.settings\.performanceMode = false;/.test(main) && /value === 'auto'\) \{\s*this\.settings\.performanceMode = false;/.test(main));
ok('weak-device: the minimap is ticked through tickMinimap everywhere', (main.match(/this\.tickMinimap\(dt\)/g) || []).length === 2 && !/if \(this\.minimap\) this\.minimap\.update\(dt, this\);/.test(main));
ok('weak-device: tickMinimap redraws at PERF_MODE.minimapHz on Low / Performance mode', /this\._minimapAcc < 1 \/ PERF_MODE\.minimapHz/.test(main));
ok('weak-device: the HUD measures its lanes and chips at a lower rate on Low / Performance mode', /this\._laneT = this\.lowRate \? 1\.5 : 0\.5;/.test(src('src/ui/hud.js')) && /this\.t = this\.lowRate \? TICK \* 2 : TICK;/.test(src('src/ui/hud-stack.js')) && /this\.hud\.lowRate = low;/.test(main) && /this\.hud\.stack\.lowRate = low;/.test(main));
ok('weak-device: Settings > Graphics has the Performance mode checkbox, finger-sized', /<label class="check check-perf"><input type="checkbox" data-set="performanceMode">/.test(menus) && /Performance mode/.test(menus) && /\.check\.check-perf \{ min-height: 44px;/.test(src('styles/main.css')));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
