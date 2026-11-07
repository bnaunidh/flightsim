/**
 * Recorded sounds, where there are any.
 *
 * Every sound in the game is synthesised and stays that way until a recording
 * is added: assets/sounds/manifest.json names a file per slot, and a slot with
 * no file is simply not here, so mixer.sampled() answers false and the caller
 * plays its own synth. Nothing about the game changes when the folder is empty,
 * and a file that fails to fetch or decode only leaves its slot synthesised.
 *
 * Fetched after the first flight starts, one at a time, in manifest order
 * (demo-path slots first), never on the first-load path. The service worker
 * caches each the first time, by its normal rule. Decoded audio is what
 * costs an iPad its memory, about 176 KB a second, so past MAX_SECONDS of
 * decoded sound the rest are skipped; a weak device gets half.
 */

export const MAX_FILE = 200 * 1024;
export const MAX_TOTAL = 600 * 1024;
export const MAX_SECONDS = 40;
const MAX_VOICES = 6;

export class SoundSamples {
  constructor(mixer, base = 'assets/sounds/') {
    this.mixer = mixer;
    this.base = base;
    this.slots = new Map();
    this.loaded = false;
    this.loading = null;
    this.bytes = 0;
    this.seconds = 0;
    this.voices = 0;
    this.loops = new Map();
    this.skipped = [];
  }

  /** Fetch the manifest and whatever it lists. Once; never throws. */
  load({ manifest = null, limitSeconds = MAX_SECONDS } = {}) {
    if (!this.loading) this.loading = this._load(manifest, limitSeconds).catch(() => {}).then(() => (this.loaded = true));
    return this.loading;
  }

  async _load(manifest, limitSeconds) {
    const m = manifest || (await fetch(`${this.base}manifest.json`).then((r) => (r.ok ? r.json() : null)));
    const slots = (m && m.slots) || {};
    for (const slot of Object.keys(slots)) {
      const def = slots[slot];
      const files = [].concat(def.file || []);
      const buffers = [];
      for (const file of files) {
        try {
          const buf = await this._fetch(file, limitSeconds);
          if (buf) buffers.push(buf);
        } catch (e) {
          this.skipped.push(file); // a bad file leaves the synth in charge
        }
      }
      if (buffers.length) this.slots.set(slot, { ...def, buffers });
    }
  }

  async _fetch(file, limitSeconds) {
    const url = /^(blob:|data:|https?:)/.test(file) ? file : this.base + file;
    const res = await fetch(url);
    if (!res.ok) throw new Error(res.status);
    const bytes = await res.arrayBuffer();
    if (bytes.byteLength > MAX_FILE || this.bytes + bytes.byteLength > MAX_TOTAL) {
      this.skipped.push(file);
      return null;
    }
    const buf = await this.mixer.ctx.decodeAudioData(bytes);
    if (this.seconds + buf.duration > limitSeconds) {
      this.skipped.push(file);
      return null;
    }
    this.bytes += bytes.byteLength;
    this.seconds += buf.duration;
    return buf;
  }

  has(slot) {
    return this.slots.has(slot);
  }

  _source(def) {
    const ctx = this.mixer.ctx;
    const src = ctx.createBufferSource();
    src.buffer = def.buffers[Math.floor(Math.random() * def.buffers.length)];
    const g = ctx.createGain();
    g.gain.value = def.gain == null ? 1 : def.gain;
    src.connect(g);
    return { src, g };
  }

  /** A one-shot, if its slot has a recording. True when it played. */
  play(slot, { gain = 1, rate = 1, bus = null } = {}) {
    const def = this.slots.get(slot);
    const m = this.mixer;
    if (!def || !m.ctx || m.frozen || this.voices >= MAX_VOICES) return false;
    const { src, g } = this._source(def);
    g.gain.value *= gain;
    src.playbackRate.value = rate * (1 + (def.vary || 0) * (Math.random() * 2 - 1));
    g.connect(m.bus(bus || def.bus || 'environment'));
    this.voices++;
    src.onended = () => {
      this.voices--;
      g.disconnect();
    };
    src.start(m.time);
    return true;
  }

  /**
   * A loop that follows a number: call every frame, or with level 0 to let it
   * go. False when there is no recording, so the caller knows the synth is on
   * its own. Rate and level glide, with no new nodes after the first call.
   */
  follow(slot, level, rate = 1, bus = 'environment') {
    const def = this.slots.get(slot);
    const m = this.mixer;
    if (!def || !m.ctx) return false;
    let v = this.loops.get(slot);
    if (!v) {
      if (level <= 0) return true;
      const { src, g } = this._source(def);
      src.loop = true;
      if (def.end) {
        src.loopStart = def.start || 0;
        src.loopEnd = def.end;
      }
      g.gain.value = 0;
      g.connect(m.bus(bus));
      src.start(m.time, def.start || 0);
      v = { src, g, base: def.gain == null ? 1 : def.gain };
      this.loops.set(slot, v);
    }
    const t = m.time;
    v.g.gain.setTargetAtTime(level * v.base, t, 0.15);
    v.src.playbackRate.setTargetAtTime(rate, t, 0.2);
    return true;
  }

  /** Every loop to nothing, for the menus and the debrief. */
  hush() {
    for (const v of this.loops.values()) v.g.gain.setTargetAtTime(0, this.mixer.time, 0.08);
  }
}
