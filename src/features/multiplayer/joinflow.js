/**
 * Join → flying, one phase at a time.
 *
 * The owner, twice: "it takes forever to join lobbies" / "it takes forever to
 * join". Measured on 2026-10-12 in two real tabs against the public
 * matchmaking server (the numbers are in tests/features/multiplayer.join.mjs's
 * header), a join was a queue of waits, each started only when the one before
 * it had finished — the Wi-Fi's hash, then the matchmaking socket, then a ping
 * to the lobby, then the claim or the connection, then the welcome, and only
 * then the island built — with nothing on the screen but "Joining Lobby 3…"
 * for all of it, which is what reads as stuck.
 *
 * This is the one place that knows how far a join has got. It holds two
 * tracks, because the two now run side by side (multiplayer.js joinLobby):
 *
 *   net     signalling → finding → claiming | connecting → syncing → in
 *           'finding' is skipped when the lobby list already knows who holds
 *           the lobby; 'claiming' (hosting it) and 'connecting' (joining whoever
 *           does) are the two ways through, and a claim refused because
 *           somebody hosts goes on to connecting. A try that did not work goes
 *           back to an earlier step, and is counted.
 *   island  loading → in: the lobby's island, built while the network works.
 *
 * Ready is both tracks in. It says one short line for the screen at every
 * step — "Connecting…", "Syncing…", "Ready" — and, when a step has gone on
 * longer than it should, that it is still going, so a join never looks stuck.
 * And it keeps when each step began, for the log line and the tests.
 *
 * No DOM, no network: the node test drives it with a pretend clock.
 */

const nowMs = () => (globalThis.performance ? performance.now() : Date.now());

/** The network's steps, in order. Two share a place: a join hosts the lobby or joins whoever does. */
export const NET_STEPS = Object.freeze(['signalling', 'finding', 'claiming', 'connecting', 'syncing', 'in']);
const RANK = Object.freeze({ signalling: 0, finding: 1, claiming: 2, connecting: 2, syncing: 3, in: 4 });

/** A step that has gone on this long gets "still going" on its line. */
export const JOIN_SLOW_MS = 4000;

/** The words, by step. "Connecting…" until the host answers, "Syncing…" until everything is in, then "Ready". */
const NET_WORDS = Object.freeze({
  signalling: 'Reaching the matchmaking server',
  finding: 'Finding {lobby}',
  claiming: 'Starting {lobby}',
  connecting: 'Reaching {lobby}’s host',
  syncing: 'Getting everybody’s planes',
});

export class JoinFlow {
  /**
   * @param label   the lobby's name for the line: 'Lobby 3', 'World 2'
   * @param island  the island's name, for "loading Fjord Island" while it is built
   */
  constructor({ label = 'the lobby', island = '', now = nowMs, slowMs = JOIN_SLOW_MS } = {}) {
    this.label = label;
    this.islandName = island;
    this.now = now;
    this.slowMs = slowMs;
    this.t0 = now();
    /** 'joining' | 'ready' | 'failed' | 'cancelled' */
    this.state = 'joining';
    this.net = null;
    /** The island track: null (nothing to build), 'loading' or 'in'. */
    this.world = null;
    this.role = null;
    this.retries = 0;
    this.why = null;
    /** Every step taken, in order: { step, at } — 'island-loading' and 'island-in' for the other track. */
    this.marks = [{ step: 'start', at: this.t0 }];
    this._netAt = this.t0;
  }

  get done() {
    return this.state !== 'joining';
  }

  /** On to a network step. False if it is not a step, the join is over, or it is where we are already. */
  step(name) {
    if (this.done || !(name in RANK) || name === this.net) return false;
    if (this.net === 'in') return false;
    // Back to an earlier step is a try that did not work. Claiming, then connecting, is not: a claim refused because somebody hosts.
    if (this.net && RANK[name] < RANK[this.net]) this.retries++;
    this.net = name;
    this._netAt = this.now();
    this.marks.push({ step: name, at: this._netAt });
    return true;
  }

  /** The network part is done: hosting the lobby, or welcomed into it. */
  joined(role) {
    if (this.done) return false;
    this.role = role === 'host' ? 'host' : 'client';
    return this.step('in');
  }

  /** The island: 'loading' when its build starts, 'in' when it is built. */
  island(what, name) {
    if (this.done || (what !== 'loading' && what !== 'in')) return false;
    if (what === this.world || (this.world === 'in' && what === 'loading')) return false;
    if (name) this.islandName = name;
    this.world = what;
    this.marks.push({ step: `island-${what}`, at: this.now() });
    return true;
  }

  /** In the world with everybody: only once the network is in and the island, if there was one to build, too. */
  ready() {
    if (this.done || this.net !== 'in' || this.world === 'loading') return false;
    this.state = 'ready';
    this.marks.push({ step: 'ready', at: this.now() });
    return true;
  }

  fail(why) {
    if (this.done) return false;
    this.state = 'failed';
    this.why = why || 'failed';
    this.marks.push({ step: 'failed', at: this.now() });
    return true;
  }

  cancel() {
    if (this.done) return false;
    this.state = 'cancelled';
    this.marks.push({ step: 'cancelled', at: this.now() });
    return true;
  }

  /** How long the current network step has gone on. */
  get stepMs() {
    return this.now() - this._netAt;
  }

  /**
   * The progress line: { text, kind, slow }, or null when there is nothing to
   * say (failed or cancelled — the screen says why in its own words).
   */
  line() {
    // Ready as soon as both tracks are in — the world itself is a moment away (ready() is said once it is up).
    if (this.state === 'ready' || (this.state === 'joining' && this.net === 'in' && this.world !== 'loading')) return { text: 'Ready', kind: 'good', slow: false };
    if (this.done) return null;
    const lobby = this.label;
    const islandBusy = this.world === 'loading';
    const netIn = this.net === 'in';
    const head = !this.net || RANK[this.net] < RANK.syncing ? 'Connecting…' : 'Syncing…';
    let detail = '';
    if (netIn) detail = islandBusy ? `Loading ${this.islandName || 'the island'}` : '';
    else if (this.net) detail = NET_WORDS[this.net].replace('{lobby}', lobby);
    if (islandBusy && !netIn && this.islandName) detail += ` · loading ${this.islandName}`;
    const slow = !netIn && this.stepMs > this.slowMs;
    const text = `${netIn && islandBusy ? 'Syncing…' : head}${detail ? ` ${detail}` : ''}${slow ? ' — still going, this can take a few seconds' : ''}`;
    return { text, kind: '', slow };
  }

  /**
   * Milliseconds per step, from when it began to when the next network step
   * did (or to now, or to the end): { signalling, finding, claiming,
   * connecting, syncing, island, total }. A step taken twice adds up.
   */
  durations() {
    const out = {};
    const end = this.done ? this.marks[this.marks.length - 1].at : this.now();
    const net = this.marks.filter((m) => m.step in RANK || m.step === 'start' || m.step === 'ready' || m.step === 'failed' || m.step === 'cancelled');
    for (let i = 0; i < net.length; i++) {
      const m = net[i];
      if (!(m.step in RANK) || m.step === 'in') continue;
      const to = i + 1 < net.length ? net[i + 1].at : end;
      out[m.step] = Math.round((out[m.step] || 0) + (to - m.at));
    }
    const a = this.marks.find((m) => m.step === 'island-loading');
    const b = this.marks.find((m) => m.step === 'island-in');
    if (a) out.island = Math.round((b ? b.at : end) - a.at);
    const inAt = this.marks.find((m) => m.step === 'in');
    if (inAt) out.network = Math.round(inAt.at - this.t0);
    out.total = Math.round(end - this.t0);
    return out;
  }

  /** One line for the log: "Lobby 3 in 1.9 s as host: signalling 0.1 · claiming 0.6 · island 1.2 (side by side)". */
  summary() {
    const d = this.durations();
    const s = (ms) => `${(ms / 1000).toFixed(1)}`;
    const parts = NET_STEPS.filter((k) => k !== 'in' && d[k] != null).map((k) => `${k} ${s(d[k])}`);
    if (d.island != null) parts.push(`island ${s(d.island)} (side by side)`);
    const how = this.state === 'ready' ? `in ${s(d.total)} s${this.role ? ` as ${this.role === 'host' ? 'host' : 'player'}` : ''}` : `${this.state} after ${s(d.total)} s`;
    return `${this.label} ${how}: ${parts.join(' · ') || 'nothing'}${this.retries ? ` · ${this.retries} retr${this.retries === 1 ? 'y' : 'ies'}` : ''}`;
  }
}
