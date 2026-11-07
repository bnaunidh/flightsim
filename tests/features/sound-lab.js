/**
 * The sound lab: the game's real audio classes rendered to numbers.
 *
 * Nobody working on this game can hear it (see sound-slots.browser.js), so a
 * sound is judged as data. This wraps the real GameAudio round an
 * OfflineAudioContext: the mixer builds exactly the graph it builds in the
 * game, the frame loop is stepped by suspending the render every 1/30 s, and
 * what comes out is a Float32Array that never went near a loudspeaker.
 *
 * measure() turns a stretch of it into loudness (dBFS), peak, band levels,
 * spectral centroid, the strongest tones, and the rate of any beat in the
 * envelope (blade slap, prop chop).
 */

const db = (x) => (x > 1e-9 ? +(20 * Math.log10(x)).toFixed(1) : -180);

/** A flight frame with nothing happening; a scene changes what it needs. */
export function flight(over = {}) {
  return {
    rpm: 0,
    controls: { throttle: 0, brakes: 0, yaw: 0 },
    airspeed: 0,
    ias: 0,
    fuel: 100,
    alt: 100,
    agl: 100,
    vs: 0,
    onGround: false,
    groundSpeed: 0,
    engineOn: true,
    alpha: 0.02,
    flaps: 0,
    flapsTarget: 0,
    gearDown: false,
    gearPos: 0,
    spoilerPos: 0,
    reverse: 0,
    burner: 0,
    sideslip: 0,
    crashed: false,
    ...over,
  };
}

export const CALM = { cond: { turb: 0, rain: 0 }, windSpeedKts: 0, lightningFlash: 0 };

/**
 * Render `seconds` of the game's own audio. `frame(audio, t, dt)` runs at
 * `fps`, where the game's frame loop would; `setup(audio)` once, before.
 * Returns { data, rate, audio, ms } (ms: how long the render took).
 */
export async function renderAudio({ seconds = 4, rate = 44100, fps = 30, setup = null, frame = null, GameAudio = null } = {}) {
  const GA = GameAudio || (await import('../../src/audio/index.js')).GameAudio;
  const offline = new OfflineAudioContext(1, Math.ceil(seconds * rate), rate);
  const Real = window.AudioContext;
  window.AudioContext = function StandIn() {
    return offline;
  };
  const resume = offline.resume;
  offline.resume = async () => {};
  let audio;
  try {
    audio = new GA();
    audio.mixer.lab = true; // its clock is stepped, and reads 'suspended' between frames
    await audio.start();
  } finally {
    window.AudioContext = Real;
    delete offline.resume;
    void resume;
  }
  audio.radio.backgroundChatter = false;
  if (setup) await setup(audio, offline);
  const step = 1 / fps;
  let n = 0;
  const tick = () => {
    if (frame) frame(audio, n * step, step);
    n++;
    const next = n * step;
    if (next < seconds - step) {
      offline.suspend(next).then(() => {
        tick();
        offline.resume();
      });
    }
  };
  tick();
  const t0 = performance.now();
  const buf = await offline.startRendering();
  return { data: buf.getChannelData(0), rate, audio, ms: performance.now() - t0 };
}

/** A roster entry with just what the sound reads, one per engine family (audio/profile.js). */
export const TYPES = {
  piston: { id: 'skylark', class: 'Trainer', shape: { power: { kind: 'prop', count: 1 } }, aero: { thrustMax: 3400 } },
  turboprop: { id: 'q400', class: 'Airliner', shape: { power: { kind: 'prop', count: 2 } }, aero: { thrustMax: 48000 } },
  regional: { id: 'meridian', class: 'Airliner', shape: { power: { kind: 'jet', count: 2 } }, aero: { thrustMax: 60000 } },
  narrow: { id: 'a320', class: 'Airliner', shape: { power: { kind: 'jet', count: 2 } }, aero: { thrustMax: 64000 } },
  wide: { id: 'b747', class: 'Airliner', shape: { power: { kind: 'jet', count: 4 } }, aero: { thrustMax: 85000 } },
  fighter: { id: 'f22', class: 'Fighter', shape: { power: { kind: 'jet', count: 1 } }, aero: { thrustMax: 62000 } },
  turbojet: { id: 'concorde', class: 'Airliner', shape: { power: { kind: 'jet', count: 4 } }, aero: { thrustMax: 86000 } },
  highbypass: { id: 'a10', class: 'Fighter', shape: { power: { kind: 'jet', count: 2 } }, aero: { thrustMax: 32000 } },
};

/* ---- the numbers ---- */

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let b = n >> 1;
    for (; j & b; b >>= 1) j ^= b;
    j ^= b;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const xr = re[b] * cr - im[b] * ci;
        const xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

/** Average power spectrum of data[from..to] (seconds), Hann window, size N. */
export function spectrum(data, rate, from = 0, to = null, N = 8192) {
  const a = Math.floor(from * rate);
  const b = Math.min(data.length, Math.floor((to == null ? data.length / rate : to) * rate));
  const P = new Float64Array(N / 2);
  let frames = 0;
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  for (let at = a; at + N <= b; at += N / 2) {
    for (let i = 0; i < N; i++) {
      re[i] = data[at + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)));
      im[i] = 0;
    }
    fft(re, im);
    for (let i = 0; i < N / 2; i++) P[i] += re[i] * re[i] + im[i] * im[i];
    frames++;
  }
  if (frames) for (let i = 0; i < N / 2; i++) P[i] /= frames;
  return P;
}

const BANDS = [[20, 100], [100, 300], [300, 1000], [1000, 3000], [3000, 8000], [8000, 20000]];

/** How a stretch of sound measures. Times in seconds. */
export function measure(data, rate, from = 0, to = null) {
  const a = Math.floor(from * rate);
  const b = Math.min(data.length, Math.floor((to == null ? data.length / rate : to) * rate));
  let sum = 0;
  let peak = 0;
  for (let i = a; i < b; i++) {
    const v = data[i];
    sum += v * v;
    const m = Math.abs(v);
    if (m > peak) peak = m;
  }
  const rms = Math.sqrt(sum / Math.max(1, b - a));
  const N = b - a >= 8192 ? 8192 : b - a >= 2048 ? 2048 : 0;
  const out = { rms: db(rms), peak: db(peak), crest: +(db(peak) - db(rms)).toFixed(1) };
  if (!N || rms < 1e-7) return out;
  const P = spectrum(data, rate, from, to, N);
  const hz = rate / N;
  let tot = 0;
  let mom = 0;
  for (let i = 1; i < P.length; i++) {
    tot += P[i];
    mom += P[i] * i * hz;
  }
  out.centroid = Math.round(mom / (tot || 1));
  // What a tablet's speakers can actually play: they give up below about 250 Hz.
  let hi = 0;
  for (let i = Math.ceil(250 / hz); i < P.length; i++) hi += P[i];
  out.speaker = +(out.rms + 10 * Math.log10((hi + 1e-20) / (tot || 1))).toFixed(1);
  out.bands = BANDS.map(([lo, hi]) => {
    let e = 0;
    for (let i = Math.ceil(lo / hz); i <= Math.floor(hi / hz) && i < P.length; i++) e += P[i];
    return +(10 * Math.log10((e + 1e-20) / (tot || 1))).toFixed(1);
  });
  // Tones: bins standing well above their neighbourhood.
  const tones = [];
  for (let i = 2; i < P.length - 2 && i * hz < 12000; i++) {
    if (P[i] > P[i - 1] && P[i] > P[i + 1]) {
      let near = 0;
      let cnt = 0;
      for (let k = Math.max(1, i - 40); k < Math.min(P.length, i + 40); k++) {
        if (Math.abs(k - i) > 3) {
          near += P[k];
          cnt++;
        }
      }
      const prom = 10 * Math.log10(P[i] / (near / cnt + 1e-20));
      if (prom > 9) tones.push({ hz: Math.round(i * hz), prom: +prom.toFixed(0), p: P[i] });
    }
  }
  tones.sort((x, y) => y.p - x.p);
  out.tones = tones.slice(0, 4).map((t) => `${t.hz}Hz+${t.prom}`);
  return out;
}

/** The strongest beat in the loudness between 1.5 and 90 Hz, and how deep it is. */
export function beat(data, rate, from = 0, to = null) {
  const a = Math.floor(from * rate);
  const b = Math.min(data.length, Math.floor((to == null ? data.length / rate : to) * rate));
  const down = Math.round(rate / 400);
  const N = 1024;
  const env = new Float64Array(N);
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  const P = new Float64Array(N / 2);
  let frames = 0;
  for (let at = a; at + N * down <= b; at += (N * down) / 2) {
    let mean = 0;
    for (let i = 0; i < N; i++) {
      let s = 0;
      for (let k = 0; k < down; k++) s += Math.abs(data[at + i * down + k]);
      env[i] = s / down;
      mean += env[i];
    }
    mean /= N;
    for (let i = 0; i < N; i++) {
      re[i] = (env[i] - mean) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)));
      im[i] = 0;
    }
    fft(re, im);
    for (let i = 1; i < N / 2; i++) P[i] += (re[i] * re[i] + im[i] * im[i]) / (mean * mean * N * N + 1e-20);
    frames++;
  }
  if (!frames) return { hz: 0, depth: 0 };
  const hz = rate / down / N;
  let best = 0;
  let at = 0;
  for (let i = Math.ceil(1.5 / hz); i * hz < 90; i++) {
    if (P[i] > best) {
      best = P[i];
      at = i;
    }
  }
  return { hz: +(at * hz).toFixed(1), depth: +Math.sqrt(best / frames).toFixed(3) };
}

/** Largest sample-to-sample jump, as a multiple of the median jump round a loop point (1 = no seam). */
export function seam(data) {
  const n = data.length;
  const w = Math.min(2048, n >> 2);
  let sum = 0;
  for (let i = 1; i < w; i++) sum += Math.abs(data[i] - data[i - 1]) + Math.abs(data[n - i] - data[n - i - 1]);
  const typical = sum / (2 * (w - 1)) + 1e-9;
  return +(Math.abs(data[0] - data[n - 1]) / typical).toFixed(2);
}
