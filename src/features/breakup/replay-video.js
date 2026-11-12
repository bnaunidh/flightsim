/**
 * A video of the instant replay: the game's picture (the WebGL canvas, not
 * the controls over it) recorded with canvas.captureStream + MediaRecorder
 * while the replay plays in real time (./replay-player.js drives it).
 *
 * WebM where the browser makes it (Chrome, Edge, Firefox), MP4 where that is
 * what it makes (Safari on a Mac or an iPad: MediaRecorder there records
 * 'video/mp4'). At the canvas's own size and 30 or 60 frames a second, with
 * the game's sound only when there is a tap on it that plays nothing new (the
 * player hands in an audio track, or none). When a browser can't record,
 * support() says why in a sentence, for the player to show.
 *
 * Fetched only when the video panel opens.
 */

/** In the order they are tried: WebM first, MP4 for Safari. */
export const TYPES = [
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
  'video/mp4;codecs=avc1.42E01E',
  'video/mp4;codecs=avc1',
  'video/mp4',
];

/** Can this browser record the canvas? { ok, mime, ext, label } or { ok: false, why }. `env` is the window (a test hands in another). */
export function support(canvas, env = typeof window !== 'undefined' ? window : globalThis) {
  const MR = env && env.MediaRecorder;
  if (typeof MR !== 'function') {
    return { ok: false, why: "This browser can't record video (it has no MediaRecorder). Chrome, Edge, Firefox, or Safari 14.1 or newer on a Mac or iPad can." };
  }
  if (!canvas || typeof canvas.captureStream !== 'function') {
    return { ok: false, why: "This browser can't capture the game's picture to make a video." };
  }
  let mime = null;
  for (const t of TYPES) {
    let yes = false;
    try {
      yes = typeof MR.isTypeSupported !== 'function' ? t === 'video/webm' : MR.isTypeSupported(t);
    } catch (e) {
      yes = false;
    }
    if (yes) {
      mime = t;
      break;
    }
  }
  if (!mime) return { ok: false, why: "This browser can record, but not as a WebM or MP4 video, so there is nothing it could save." };
  const ext = /mp4/.test(mime) ? 'mp4' : 'webm';
  return { ok: true, mime, ext, label: ext === 'mp4' ? 'MP4 video' : 'WebM video' };
}

/** island-flight-<aircraft>-<yyyy-mm-dd-hhmm>.<ext> */
export function fileName(aircraft, ext, d = new Date()) {
  const slug = String(aircraft || 'aircraft').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'aircraft';
  const p = (n) => String(n).padStart(2, '0');
  return `island-flight-${slug}-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.${ext === 'mp4' ? 'mp4' : 'webm'}`;
}

/** Bits a second for the picture: enough for a sharp replay, not a file too big to keep (2.5-16 Mb/s). */
export function bitrate(w, h, fps) {
  return Math.round(Math.min(16e6, Math.max(2.5e6, w * h * fps * 0.09)));
}

/**
 * Start recording. Returns { stop(): Promise<Blob>, cancel(), pause(), resume(), bytes, onerror }.
 * Throws when the browser refuses to start (the player says so).
 */
export function startRecorder({ canvas, fps = 30, mime, audioTrack = null }) {
  const stream = canvas.captureStream(fps);
  if (audioTrack) {
    try {
      stream.addTrack(audioTrack);
    } catch (e) {
      /* no sound, then */
    }
  }
  const opts = { mimeType: mime, videoBitsPerSecond: bitrate(canvas.width || 1280, canvas.height || 720, fps) };
  if (audioTrack) opts.audioBitsPerSecond = 128000;
  let mr;
  try {
    mr = new MediaRecorder(stream, opts);
  } catch (e) {
    // Some browsers refuse a bitrate or a codec string they list: once more with the type alone.
    mr = new MediaRecorder(stream, { mimeType: mime.split(';')[0] });
  }
  const chunks = [];
  const out = {
    bytes: 0,
    onerror: null,
    get state() {
      return mr.state;
    },
    stop() {
      return new Promise((resolve, reject) => {
        if (mr.state === 'inactive') {
          end();
          resolve(new Blob(chunks, { type: mime.split(';')[0] }));
          return;
        }
        mr.onstop = () => {
          end();
          resolve(new Blob(chunks, { type: (mr.mimeType || mime).split(';')[0] }));
        };
        try {
          if (mr.state === 'paused') mr.resume();
          mr.requestData();
        } catch (e) {
          /* stop() flushes the last chunk anyway */
        }
        try {
          mr.stop();
        } catch (e) {
          end();
          reject(e);
        }
      });
    },
    cancel() {
      mr.ondataavailable = null;
      mr.onstop = null;
      try {
        if (mr.state !== 'inactive') mr.stop();
      } catch (e) {
        /* already stopped */
      }
      chunks.length = 0;
      end();
    },
    pause() {
      if (mr.state === 'recording') mr.pause();
    },
    resume() {
      if (mr.state === 'paused') mr.resume();
    },
  };
  function end() {
    for (const t of stream.getVideoTracks()) {
      try {
        t.stop();
      } catch (e) {
        /* fine */
      }
    }
  }
  mr.ondataavailable = (ev) => {
    if (ev.data && ev.data.size) {
      chunks.push(ev.data);
      out.bytes += ev.data.size;
    }
  };
  mr.onerror = (ev) => {
    if (typeof out.onerror === 'function') out.onerror((ev && ev.error) || ev);
  };
  mr.start(500);
  return out;
}
