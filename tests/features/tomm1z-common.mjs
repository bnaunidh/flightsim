/**
 * Shared stand-ins for the Tomm1z node suites (tests/features/tomm1z-*.mjs):
 * the smallest browser the modules under src/ need to load in node, a
 * results list and the report. One place, so the nine suites agree.
 */
if (typeof globalThis.window === 'undefined') {
  const mem = new Map();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) },
  });
}
globalThis.document = {
  createElement: () => ({
    getContext: () => new Proxy({}, { get: () => () => ({ addColorStop() {}, data: new Uint8ClampedArray(4) }) }),
    width: 0,
    height: 0,
    style: {},
  }),
  body: { appendChild() {} },
};
export const win = new EventTarget();
globalThis.window = win;

export const root = new URL('../../', import.meta.url);
export const load = (p) => import(new URL(p, root).href);
export const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

export const results = [];
export function ok(name, pass, detail = '') {
  results.push({ name, pass: !!pass, detail: String(detail) });
}

export function report() {
  const failed = results.filter((r) => !r.pass);
  for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `\n      ${r.detail}` : ''}`);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
}
