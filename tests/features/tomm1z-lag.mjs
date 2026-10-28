/**
 * Node checks for the Tomm1z video pass, item 1 — LAG
 * (.claude/devtools/briefs/tomm1z-video.md; the owner: "there was a lot of lag").
 *
 *   node tests/features/tomm1z-lag.mjs
 *
 * The shader warm-up (render/shader-warm.js) compiles in the background
 * through compileAsync, shows the cockpit for the compile and hides it again
 * before returning, counts itself and never throws; the AudioContext is made
 * before the first gesture (audio/mixer.js prewarm) and the first gesture
 * only resumes it. The same in the page: tests/features/tomm1z-lag.browser.js.
 */
import { win, load, near, ok, report } from './tomm1z-common.mjs';
void win;
void near;

/* ---------------- 1. the shader warm-up and the audio context ---------------- */
{
  const W = await load('src/render/shader-warm.js');
  const compiled = [];
  const renderer = {
    info: { programs: [1, 2, 3] },
    compileAsync(obj, cam, scene) {
      compiled.push({ visible: obj.children.map((c) => c.visible), scene: !!scene });
      return new Promise((r) => setTimeout(r, 5));
    },
  };
  const cockpit = { visible: false };
  const model = { children: [cockpit] };
  const before = W.shaderWarmStats();
  const p = W.warmShadersAsync(renderer, model, {}, { isScene: true }, { show: [cockpit] });
  ok('warm-up compiles in the background through compileAsync', compiled.length === 1 && compiled[0].scene, JSON.stringify(compiled));
  ok('...with the cockpit shown for the compile', compiled[0] && compiled[0].visible[0] === true);
  ok('...and hidden again before the call returns (never seen from outside)', cockpit.visible === false);
  const done = await p;
  const after = W.shaderWarmStats();
  ok('...resolving true, counted', done === true && after.warms === before.warms + 1 && after.pending === before.pending && after.programsAfter === 3, JSON.stringify(after));
  const bad = await W.warmShadersAsync(null, model, {}, null);
  ok('no renderer: false, never a throw', bad === false);
  const sync = await W.warmShadersAsync({ compile() { return [] } }, model, {}, null);
  ok('a renderer without compileAsync compiles the old way (true)', sync === true);

  const { AudioMixer } = await load('src/audio/mixer.js');
  let made = 0;
  class FakeCtx {
    constructor() {
      made++;
      this.state = 'suspended';
      this.currentTime = 0;
      this.destination = {};
    }
    createGain() {
      return { gain: { value: 1, setTargetAtTime() {} }, connect() {} };
    }
    createDynamicsCompressor() {
      return { threshold: {}, knee: {}, ratio: {}, attack: {}, release: {}, connect() {} };
    }
    async resume() {
      this.state = 'running';
    }
  }
  win.AudioContext = FakeCtx;
  const m = new AudioMixer();
  ok('prewarm() makes the context before any gesture, suspended', m.prewarm() === true && made === 1 && m.ctx && m.ctx.state === 'suspended' && m.ready === true, `${made} ${m.ctx && m.ctx.state}`);
  const okd = await m.ensure();
  ok('...and the first gesture only resumes it (no second context, no stall)', okd === true && made === 1 && m.ctx.state === 'running', `${made} ${m.ctx.state}`);
  delete win.AudioContext;
  const m2 = new AudioMixer();
  ok('no Web Audio at all: prewarm() is false and harmless', m2.prewarm() === false && m2.ctx === null);
}

/* ---------------- 1. the service worker's precache ---------------- */
{
  // Run the real sw.js install handler under a stand-in worker scope and count
  // how many fetches it has in flight at once, and how it asks for them.
  const { readFileSync } = await import('node:fs');
  const vm = await import('node:vm');
  const src = readFileSync(new URL('sw.js', (await import('./tomm1z-common.mjs')).root), 'utf8');
  const handlers = {};
  let inFlight = 0;
  let peak = 0;
  let n = 0;
  const modes = new Set();
  const puts = [];
  const self = {
    addEventListener: (type, fn) => (handlers[type] = fn),
    skipWaiting() {},
    clients: { claim: async () => {} },
  };
  const ctx = {
    self,
    console: { warn() {}, info() {}, log() {} },
    caches: { open: async () => ({ put: async (url) => puts.push(url) }), keys: async () => [], delete: async () => true },
    Request: class { constructor(url, init = {}) { this.url = url; this.cache = init.cache || 'default'; } },
    fetch: async (req) => {
      n++;
      modes.add(req.cache);
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight--;
      return { ok: true };
    },
    setTimeout,
    Promise,
    Array,
    Math,
    URL,
  };
  vm.createContext(ctx);
  vm.runInContext(src, ctx, { filename: 'sw.js' });
  let settled = null;
  await handlers.install({ waitUntil: (p) => (settled = p) });
  await settled;
  const total = (src.match(/^\s*'[^']+',\s*$/gm) || []).length;
  ok(`sw.js install precaches every listed file (${n} fetched, ${puts.length} stored)`, n > 300 && puts.length === n, `${n} ${puts.length} (listed lines ${total})`);
  ok('...a few at a time, not all at once (peak in flight ≤ 4; it was every file)', peak <= 4 && peak >= 2, `peak ${peak}`);
  ok('...revalidating (cache: no-cache), never bypassing the HTTP cache the page just filled (reload)', modes.size === 1 && modes.has('no-cache'), [...modes].join(','));
}


report();
