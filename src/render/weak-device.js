/**
 * Is this a weak computer? (The Chromebook pass, 2026-10-30.)
 *
 * A school Chromebook -- a Celeron with two cores, 4 GB, Intel UHD 600 -- used
 * to get the default tier (High) and the Auto probe at its first boot: forty
 * timed frames of the High world, each of them a hitch, before the game
 * dropped it to Low anyway. Tomm1z's viewers were told to try the game on
 * theirs, and the class demo runs on them. So the first boot asks the cheap
 * questions first, and a computer that answers "weak" to any of them starts
 * at Low with Performance mode on and no probe at all. The player can turn
 * it off in Settings > Graphics; the answer is kept in the settings, so it is
 * asked once.
 *
 * Pure: pass the facts in. main.js gathers them (the GPU's name needs a
 * context; navigator the rest).
 */

/** GPU names that mean "draw as little as you can". */
export const WEAK_GPU = [
  /SwiftShader/i,                                        // no GPU at all: software GL
  /llvmpipe|softpipe|Mesa OffScreen/i,
  /Intel\(R\)? ?(U?HD|HD) Graphics ?(5\d\d|6\d\d|4\d\d|3\d\d|2\d\d)\b/i, // UHD 600/605/610/615/620, HD 500/515/520...
  /Intel.*(Celeron|Pentium|Gemini Lake|Apollo Lake|Jasper Lake)/i,
  /\bMali-(4|T|G[3-5])/i,                                // older/entry Mali
  /Adreno \(TM\) [1-5]\d\d\b/i,                          // entry Adreno
  /PowerVR/i,
  /Microsoft Basic Render/i,
];

/**
 * { weak, reasons: [...] } from the facts: ua, hardwareConcurrency,
 * deviceMemory (GB; Chrome caps the report at 8), renderer (the GPU's
 * name), saveData (the Data Saver flag). Any one reason is enough.
 */
export function detectWeakDevice({ ua = '', hardwareConcurrency = null, deviceMemory = null, renderer = '', saveData = false } = {}) {
  const reasons = [];
  if (/\bCrOS\b/.test(ua)) reasons.push('chromeos');
  if (typeof hardwareConcurrency === 'number' && hardwareConcurrency > 0 && hardwareConcurrency <= 4) reasons.push(`cores:${hardwareConcurrency}`);
  if (typeof deviceMemory === 'number' && deviceMemory > 0 && deviceMemory <= 4) reasons.push(`memory:${deviceMemory}`);
  if (renderer && WEAK_GPU.some((re) => re.test(renderer))) reasons.push('gpu');
  if (saveData) reasons.push('save-data');
  return { weak: reasons.length > 0, reasons };
}

/**
 * The GPU's name from a throwaway WebGL context, or '' when the browser will
 * not say. Cheap (a few ms), and the context is lost again at once so it
 * never counts against the browser's limit.
 */
export function gpuRendererName(doc = typeof document !== 'undefined' ? document : null) {
  if (!doc || typeof doc.createElement !== 'function') return '';
  try {
    const canvas = doc.createElement('canvas');
    const gl = canvas.getContext('webgl2', { failIfMajorPerformanceCaveat: false }) || canvas.getContext('webgl');
    if (!gl) return '';
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const name = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    const lose = gl.getExtension('WEBGL_lose_context');
    if (lose) lose.loseContext();
    return typeof name === 'string' ? name : '';
  } catch (e) {
    return '';
  }
}

/** The facts from this browser, for detectWeakDevice. */
export function deviceFacts(nav = typeof navigator !== 'undefined' ? navigator : null, doc) {
  if (!nav) return {};
  const conn = nav.connection || nav.mozConnection || nav.webkitConnection;
  return {
    ua: nav.userAgent || '',
    hardwareConcurrency: typeof nav.hardwareConcurrency === 'number' ? nav.hardwareConcurrency : null,
    deviceMemory: typeof nav.deviceMemory === 'number' ? nav.deviceMemory : null,
    renderer: gpuRendererName(doc),
    saveData: !!(conn && conn.saveData),
  };
}

/**
 * What Performance mode asks of the game, over and above Low: how often the
 * minimap redraws, the dynamic resolution's floor, and the ambient scale.
 * One place, so the tests and main.js agree.
 */
export const PERF_MODE = Object.freeze({
  minimapHz: 10,          // the minimap redraws ten times a second (every frame otherwise)
  renderScaleMin: 0.5,    // the dynamic resolution may go down to half size (0.65 otherwise)
  pixelRatioMax: 1,       // never more than one device pixel per CSS pixel
});
