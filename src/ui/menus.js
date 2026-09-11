/**
 * All the screens that are not the HUD: start menu, mission picker, free-flight
 * setup, settings (with key remapping), credits, pause and the debrief.
 */

import { MISSIONS } from '../game/missions.js';
import { icon } from './icons.js';
import { AIRCRAFT, performanceFor } from '../aircraft/types.js';
import { NATURAL_EVENTS, SELECTABLE_EVENTS } from '../game/disasters.js';
import { EF_SCALE } from '../world/tornado.js';
import { AP_MODES } from '../flight/autopilot.js';
import { PRESETS, TIMES, CONDITIONS } from '../world/weather.js';
import { ACTIONS, keyLabel } from '../flight/input.js';
import { CREDITS_HTML } from './credits.js';
import { MAPS } from '../world/maps.js';
import { loadFreePresets, saveFreePresets, MAX_FREE_PRESETS } from '../core/storage.js';
import * as Prog from '../game/progression.js';
import { LIVERIES, schemeFor } from '../aircraft/liveries.js';

function h(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

/**
 * A small painted preview of a map, drawn from the same island list the
 * terrain generator uses — so the picture is genuinely the place you are
 * about to fly, not decoration.
 */
function mapThumbnail(def) {
  const S = 190;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  c.className = 'map-thumb';
  const g = c.getContext('2d');
  const pal = def.palette;
  const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;

  // Sea.
  const sea = g.createLinearGradient(0, 0, 0, S);
  sea.addColorStop(0, hex(pal.swell));
  sea.addColorStop(1, hex(pal.deepWater));
  g.fillStyle = sea;
  g.fillRect(0, 0, S, S);

  // Fit every island into the frame.
  let span = 2500;
  for (const i of def.islands) {
    span = Math.max(span, Math.abs(i.cx) + i.radius * 1.3, Math.abs(i.cz) + i.radius * 1.3);
  }
  const k = (S * 0.46) / span;
  const px = (x) => S / 2 + x * k;
  const pz = (z) => S / 2 + z * k;

  const land = `rgb(${Math.round(150 * pal.grass[0])}, ${Math.round(175 * pal.grass[1])}, ${Math.round(105 * pal.grass[2])})`;
  const shore = `rgb(${Math.round(214 * pal.sand[0])}, ${Math.round(198 * pal.sand[1])}, ${Math.round(158 * pal.sand[2])})`;
  const high = `rgb(${Math.round(150 * pal.rock[0])}, ${Math.round(148 * pal.rock[1])}, ${Math.round(144 * pal.rock[2])})`;

  for (const isl of def.islands) {
    const r = isl.radius * k;
    // Beach ring, then land, then a cap of high ground scaled by the peak.
    g.beginPath();
    g.arc(px(isl.cx), pz(isl.cz), r * 1.06, 0, Math.PI * 2);
    g.fillStyle = shore;
    g.fill();
    g.beginPath();
    g.arc(px(isl.cx), pz(isl.cz), r * 0.92, 0, Math.PI * 2);
    g.fillStyle = land;
    g.fill();
    const relief = Math.min(0.72, isl.peak / 900);
    if (relief > 0.08) {
      g.beginPath();
      g.arc(px(isl.cx), pz(isl.cz), r * relief, 0, Math.PI * 2);
      g.fillStyle = high;
      g.globalAlpha = 0.85;
      g.fill();
      g.globalAlpha = 1;
    }
  }

  // The runway, in the same place on every map.
  g.strokeStyle = '#f2f5f8';
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(px(-550), pz(0));
  g.lineTo(px(550), pz(0));
  g.stroke();
  return c;
}

/**
 * A plan view of one aeroplane, drawn from the same shape data the 3D model
 * is lofted from — so the picture on the card is genuinely the aircraft you
 * are about to fly, not an illustration of one. Span, chord, sweep, tail size,
 * engine count and their positions all come straight off `type.shape`.
 */
function aircraftThumbnail(type, liveryId) {
  const W = 300;
  const H = 190;
  const c = document.createElement('canvas');
  c.width = W * 2;
  c.height = H * 2;
  c.className = 'fleet-art';
  const g = c.getContext('2d');
  g.scale(2, 2);
  const S = type.shape;
  /*
   * Lighten the livery for the plan view.
   *
   * Several aeroplanes are painted in genuinely dark colours — the Courier is
   * #1d2b3a — and on a dark card that silhouette simply disappeared: you got
   * an empty box where the picture should be. Mixing each livery two-thirds of
   * the way to white keeps the aircraft recognisably its own colour while
   * guaranteeing it reads against the panel behind it.
   */
  const lighten = (hex, amount) => {
    const n = parseInt(String(hex).replace('#', ''), 16);
    const r = (n >> 16) & 255;
    const g2 = (n >> 8) & 255;
    const b = n & 255;
    const mix = (v) => Math.round(v + (255 - v) * amount);
    return `rgb(${mix(r)},${mix(g2)},${mix(b)})`;
  };
  /*
   * The card has to show the paint you are actually flying, or the hangar is
   * quietly lying about what is on the apron.
   */
  const sch = schemeFor(type, liveryId);
  const livery = lighten(sch.base || type.livery || '#26323f', 0.66);
  const accent = sch.accent || type.accent || '#e0a838';
  const tailCol = sch.tail != null ? `#${sch.tail.toString(16).padStart(6, '0')}` : accent;

  // Fit the aeroplane into the frame: span across, length down.
  const span = S.halfSpan * 2 * S.scale;
  const len = (S.hZ + S.hRootChord + 3.4) * S.scale * S.bodyLength;
  const k = Math.min((W * 0.86) / span, (H * 0.84) / len);
  const cx = W / 2;
  const cz = H / 2;
  // Model space: -Z is forward, so screen-up is -Z.
  const px = (x) => cx + x * S.scale * k;
  const py = (z) => cz + z * S.scale * S.bodyLength * k;

  const wing = (half, root, tip, sweep, z, colour) => {
    for (const side of [-1, 1]) {
      g.fillStyle = colour;
      g.beginPath();
      g.moveTo(px(0), py(z - root / 2));
      g.lineTo(px(side * half), py(z + sweep - tip / 2));
      g.lineTo(px(side * half), py(z + sweep + tip / 2));
      g.lineTo(px(0), py(z + root / 2));
      g.closePath();
      g.fill();
    }
  };

  // Main wing, then tailplane.
  wing(S.halfSpan, S.rootChord, S.tipChord, S.sweep, S.wingZ, livery);
  wing(S.hSpan, S.hRootChord, S.hRootChord * 0.62, 0.28, S.hZ, livery);

  // Fuselage: a rounded spindle down the middle.
  const noseZ = -(2.9 + (S.power.kind === 'prop' ? 0.5 : 0)) ;
  const tailZ = S.hZ + S.hRootChord * 0.7;
  const bw = 0.42 * (S.bodyRadius || 1);
  g.fillStyle = livery;
  g.beginPath();
  g.moveTo(px(0), py(noseZ));
  g.quadraticCurveTo(px(bw), py(noseZ + 1.2), px(bw), py(0));
  g.quadraticCurveTo(px(bw), py(tailZ - 1.2), px(0), py(tailZ));
  g.quadraticCurveTo(px(-bw), py(tailZ - 1.2), px(-bw), py(0));
  g.quadraticCurveTo(px(-bw), py(noseZ + 1.2), px(0), py(noseZ));
  g.closePath();
  g.fill();

  // A stripe down the spine, in the accent colour, plus the fin.
  g.strokeStyle = accent;
  g.lineWidth = Math.max(1.6, bw * S.scale * k * 0.5);
  g.beginPath();
  g.moveTo(px(0), py(noseZ + 1));
  g.lineTo(px(0), py(tailZ - 0.4));
  g.stroke();
  g.fillStyle = tailCol;
  g.beginPath();
  g.moveTo(px(0), py(S.finZ - S.finRootChord / 2));
  g.lineTo(px(0.12), py(S.finZ + S.finRootChord / 2));
  g.lineTo(px(-0.12), py(S.finZ + S.finRootChord / 2));
  g.closePath();
  g.fill();

  // Engines: propeller discs out front, or nacelles under the wing.
  const P = S.power;
  g.strokeStyle = 'rgba(226,236,248,0.8)';
  g.fillStyle = 'rgba(226,236,248,0.22)';
  if (P.kind === 'prop') {
    const spots = P.count === 1 ? [0] : [-S.halfSpan * 0.42, S.halfSpan * 0.42];
    for (const sx of spots) {
      g.beginPath();
      g.arc(px(sx), py(P.z), P.propRadius * S.scale * k, 0, Math.PI * 2);
      g.fill();
      g.lineWidth = 1.2;
      g.stroke();
    }
  } else {
    const spots =
      P.count >= 2 ? [-S.halfSpan * 0.46, S.halfSpan * 0.46] : [0];
    for (const sx of spots) {
      g.fillStyle = '#2a3340';
      const nw = 0.34 * S.scale * k;
      const nl = 1.5 * S.scale * k;
      g.beginPath();
      g.roundRect
        ? g.roundRect(px(sx) - nw, py(S.wingZ) - nl / 2, nw * 2, nl, nw)
        : g.rect(px(sx) - nw, py(S.wingZ) - nl / 2, nw * 2, nl);
      g.fill();
    }
  }

  // Canopy / flight-deck glazing, so the nose end is obvious.
  g.fillStyle = 'rgba(150,205,240,0.75)';
  g.beginPath();
  g.ellipse(px(0), py(S.wingZ - 1.5), bw * 0.62 * S.scale * k, 0.9 * S.scale * k, 0, 0, Math.PI * 2);
  g.fill();
  return c;
}

export class Menus {
  /**
   * @param {HTMLElement} root
   * @param {object} hooks callbacks into the game
   */
  constructor(root, hooks) {
    this.root = root;
    this.hooks = hooks;
    /*
     * Read once here so the hangar can paint itself at build time. main.js
     * owns the live copy and hands the SAME object back through
     * syncProgression() — the two must never be separate objects, because the
     * hangar's buttons mutate this one in place while main.js reads its own
     * for gating. They diverged exactly that way once already: entering the
     * passcode unlocked the menus' copy and left main.js's at false for the
     * rest of the session.
     */
    this.prog = Prog.load();
    this.current = null;
    this.screens = {};
    this.build();
  }

  build() {
    const layer = h('<div class="menu-layer" hidden></div>');
    this.layer = layer;

    layer.appendChild(this.buildMain());
    layer.appendChild(this.buildMissions());
    layer.appendChild(this.buildMaps());
    layer.appendChild(this.buildFree());
    layer.appendChild(this.buildSettings());
    layer.appendChild(this.buildCredits());
    layer.appendChild(this.buildHangar());
    layer.appendChild(this.buildMore());
    layer.appendChild(this.buildPause());
    layer.appendChild(this.buildDebrief());

    this.root.appendChild(layer);
  }

  /* ------------------------------------------------------------------ */

  buildMain() {
    const s = h(`
      <section class="screen screen-main" data-screen="main" hidden>
        <div class="brand">
          <div class="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 64 64" width="58" height="58">
              <path d="M32 6 L36 24 L58 32 L36 40 L32 58 L28 40 L6 32 L28 24 Z" fill="currentColor" opacity="0.9"/>
              <circle cx="32" cy="32" r="5" fill="#0b1220"/>
            </svg>
          </div>
          <div>
            <h1>Island Flight Simulator</h1>
            <p class="tagline">Learn to fly a real aeroplane — <span data-map-name>Kestrel Island</span></p>
          </div>
        </div>

        <nav class="main-nav">
          <button class="card-btn" data-act="tutorial">
            <span class="card-icon">${icon('learn', 24)}</span>
            <span class="card-body"><strong>Tutorial</strong><em>Start here — learn take-off, turning and landing</em></span>
          </button>
          <button class="card-btn" data-act="missions">
            <span class="card-icon">${icon('target', 24)}</span>
            <span class="card-body"><strong>Missions</strong><em>Three challenges: rings, a delivery and a storm</em></span>
          </button>
          <button class="card-btn" data-act="free">
            <span class="card-icon">${icon('cloud', 24)}</span>
            <span class="card-body"><strong>Free Flight</strong><em>Any weather, any time of day, no rules</em></span>
          </button>
          <button class="card-btn" data-act="maps">
            <span class="card-icon">${icon('map', 24)}</span>
            <span class="card-body"><strong>Choose Map</strong><em data-map-blurb>Five places to fly, from flat grassland to a volcano</em></span>
          </button>
          <button class="card-btn" data-act="more">
            <span class="card-icon">${icon('more', 24)}</span>
            <span class="card-body"><strong>More</strong><em>Your rank and leaderboard, the hangar, the other vehicles, and settings</em></span>
          </button>
        </nav>

        <div class="main-foot">
          <div class="stats" data-stats></div>
          <div class="foot-links">
            <button class="ghost" data-act="sound" data-sound>🔇 Sound is off — turn it on</button>
            <button class="ghost" data-act="credits">Credits &amp; licences</button>
            <button class="ghost" data-act="install" data-install hidden>⇩ Install / Download game</button>
            <a class="ghost" data-zip href="download/island-flight-sim-source.zip" download>⇩ Download source ZIP</a>
          </div>
          <p class="tiny">Works offline once installed. All artwork and sound is generated by the game itself.</p>
        </div>
      </section>
    `);
    s.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const act = btn.dataset.act;
      this.hooks.onClick && this.hooks.onClick(act);
      if (act === 'tutorial') this.hooks.startTutorial();
      else if (act === 'missions') this.show('missions');
      else if (act === 'free') this.show('free');
      else if (act === 'maps') this.show('maps');
      else if (act === 'more') this.show('more');
      else if (act === 'hangar') this.show('hangar');
      else if (act === 'settings') this.show('settings');
      else if (act === 'credits') this.show('credits');
      else if (act === 'install') this.hooks.install && this.hooks.install();
      else if (act === 'sound') this.hooks.toggleSound && this.hooks.toggleSound();
    });
    this.screens.main = s;
    return s;
  }

  buildMaps() {
    const cards = MAPS.map(
      (m) => `
      <article class="map-card" data-map-card="${m.id}">
        <div class="map-art" data-map-art="${m.id}" aria-hidden="true"></div>
        <div class="map-text">
          <h3>${m.name}</h3>
          <span class="map-sub">${m.subtitle}</span>
          <span class="map-diff diff-${m.difficulty}">${'●'.repeat(m.difficulty)}${'○'.repeat(5 - m.difficulty)} ${m.difficultyLabel}</span>
          <p>${m.blurb}</p>
        </div>
        <div class="map-foot">
          <span class="map-current" data-map-current="${m.id}" hidden>Currently flying here</span>
          <button class="primary" data-choose-map="${m.id}">Fly here</button>
        </div>
      </article>`
    ).join('');

    const s = h(`
      <section class="screen screen-list" data-screen="maps" hidden>
        <header class="screen-head">
          <button class="ghost" data-back>← Back</button>
          <h2>Choose your map</h2>
          <span></span>
        </header>
        <p class="hint">Every map has the same runway, so everything you have learned still works.
        What changes is the land around it — and how much room it leaves you.</p>
        <div class="map-grid">${cards}</div>
      </section>
    `);
    // A little painted preview of each map's shape, drawn from the same island
    // data the terrain uses. Cheap, and it makes the choice mean something.
    for (const m of MAPS) {
      const host = s.querySelector(`[data-map-art="${m.id}"]`);
      if (host) host.appendChild(mapThumbnail(m));
    }
    s.addEventListener('click', (e) => {
      if (e.target.closest('[data-back]')) return this.show('main');
      const pick = e.target.closest('[data-choose-map]');
      if (pick) {
        this.hooks.onClick && this.hooks.onClick('map');
        this.hooks.chooseMap && this.hooks.chooseMap(pick.dataset.chooseMap);
      }
    });
    this.screens.maps = s;
    return s;
  }

  /** Highlight the map currently loaded, everywhere it is mentioned. */
  syncMap(id) {
    const def = MAPS.find((m) => m.id === id) || MAPS[0];
    for (const el of this.root.querySelectorAll('[data-map-name]')) el.textContent = def.name;
    for (const el of this.root.querySelectorAll('[data-map-blurb]')) {
      el.textContent = `Now flying ${def.name} — ${def.subtitle}`;
    }
    if (!this.screens.maps) return;
    for (const m of MAPS) {
      const tag = this.screens.maps.querySelector(`[data-map-current="${m.id}"]`);
      const card = this.screens.maps.querySelector(`[data-map-card="${m.id}"]`);
      if (tag) tag.hidden = m.id !== id;
      if (card) card.classList.toggle('is-current', m.id === id);
    }
  }

  buildMissions() {
    const cards = MISSIONS.map(
      (m) => `
      <article class="mission-card" data-mission="${m.id}">
        <div class="mission-top">
          <span class="mission-icon">${m.icon}</span>
          <div>
            <h3>${m.name}</h3>
            <span class="mission-diff diff-${m.difficulty.toLowerCase()}">${m.difficulty}</span>
            <span class="mission-sub">${m.short}</span>
          </div>
        </div>
        <p>${m.blurb}</p>
        <p class="mission-learn">${m.reward}</p>
        <div class="mission-foot">
          <span class="mission-best" data-best="${m.id}"></span>
          <button class="primary" data-start="${m.id}">Fly this mission</button>
        </div>
      </article>`
    ).join('');

    const s = h(`
      <section class="screen screen-list" data-screen="missions" hidden>
        <header class="screen-head">
          <button class="ghost" data-back>← Back</button>
          <h2>Missions</h2>
          <span></span>
        </header>
        <div class="mission-grid">${cards}</div>
      </section>
    `);
    /*
     * Hide the military missions until the passcode is entered.
     *
     * Every card is rendered and then hidden, rather than filtered out of
     * MISSIONS at build time — build() runs exactly once from the constructor,
     * so a filter applied while mapping could never bring them back when the
     * passcode is entered mid-session.
     *
     * `this.prog` is read at call time, never captured: main.js owns the live
     * object and swaps it in later.
     */
    this.syncMissionLocks = () => {
      for (const m of MISSIONS) {
        const card = s.querySelector(`[data-mission="${m.id}"]`);
        if (card) card.hidden = Prog.needsPasscode(this.prog, m);
      }
    };
    this.syncMissionLocks();

    s.addEventListener('click', (e) => {
      if (e.target.closest('[data-back]')) return this.show('main');
      const start = e.target.closest('[data-start]');
      if (!start) return;
      // The UI filter is not a gate on the engine, so guard the click too.
      const m = MISSIONS.find((x) => x.id === start.dataset.start);
      if (m && Prog.needsPasscode(this.prog, m)) {
        this.hooks.onLocked &&
          this.hooks.onLocked('Military missions are behind a passcode — enter it in the Hangar.');
        return;
      }
      this.hooks.startMission(start.dataset.start);
    });
    this.screens.missions = s;
    return s;
  }

  /**
   * Free Flight setup.
   *
   * This screen grew an aircraft picker and a start picker and became 1,780
   * pixels tall in an 825 pixel window — with no scrolling, so everything
   * below the aeroplanes was off the bottom of the screen and unreachable.
   * Nothing was broken; you simply could not get to it.
   *
   * So it is four tabs and a bar along the bottom that is always there. Each
   * tab is short enough to read at a glance, the summary tells you what you
   * are about to fly without going back through the tabs, and "Take off"
   * never moves.
   */
  buildFree() {
    const pips = (n) =>
      Array.from({ length: 5 }, (_, i) => `<i class="fleet-pip${i < n ? ' is-lit' : ''}"></i>`).join('');
    const fleet = AIRCRAFT.map((a) => {
      const perf = performanceFor(a.id);
      return `
        <button class="fleet-card${a.id === 'skylark' ? ' is-on' : ''}" data-aircraft="${a.id}">
          <span class="fleet-art-slot" data-fleet-art="${a.id}"></span>
          <span class="fleet-head">
            <span class="fleet-name">${a.name}</span>
            <span class="fleet-class">${a.class}</span>
          </span>
          <span class="fleet-blurb">${a.blurb}</span>
          <span class="fleet-bars">
            <span class="fleet-bar"><span>Speed</span><span class="fleet-pips">${pips(a.stats.speed)}</span></span>
            <span class="fleet-bar"><span>Agility</span><span class="fleet-pips">${pips(a.stats.handling)}</span></span>
            <span class="fleet-bar"><span>Forgiving</span><span class="fleet-pips">${pips(a.stats.ease)}</span></span>
          </span>
          <span class="fleet-numbers">
            <span>Approach <b>${perf.stallLanding} kt</b></span>
            <span>Top <b>${perf.vne} kt</b></span>
            <span>Endurance <b>${perf.enduranceMin} min</b></span>
          </span>
        </button>`;
    }).join('');

    const presets = PRESETS.map(
      (p) => `<button class="preset" data-preset="${p.id}"><strong>${p.name}</strong><em>${p.hint}</em></button>`
    ).join('');
    const times = Object.entries(TIMES).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('');
    const conds = Object.entries(CONDITIONS).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('');

    // Failures you arm before you go. Each one waits the number of minutes you
    // set, so you get to be somewhere interesting before it happens.
    const FAILURES = [
      { id: 'engine', label: 'Engine failure', hint: 'It stops, and it will not restart', delay: [0, 20, 5] },
      { id: 'fuelLeak', label: 'Fuel leak', hint: 'Choose how long the fuel lasts', delay: [0, 20, 2], amount: [2, 30, 6], amountLabel: 'Fuel lasts' },
      { id: 'elevator', label: 'Jammed elevator', hint: 'Pitch sticks — fly it on power and trim', delay: [0, 20, 4] },
      { id: 'icing', label: 'Icing', hint: 'More drag, less lift, an earlier stall', delay: [0, 20, 3] },
      { id: 'gear', label: 'Undercarriage jammed', hint: 'It stays wherever it is', delay: [0, 20, 6] },
      { id: 'brakes', label: 'Brake failure', hint: 'Found out about on the roll-out', delay: [0, 20, 0] },
      { id: 'roughEngine', label: 'Running rough', hint: 'Part power only — can you still make it back?', delay: [0, 20, 4] },
      { id: 'tyre', label: 'Burst tyre', hint: 'Drags hard to one side on the roll-out', delay: [0, 20, 0] },
    ];
    const failureRows = FAILURES.map((f) => `
      <div class="fail-row" data-fail-row="${f.id}">
        <label class="fail-head">
          <input type="checkbox" data-fail="${f.id}">
          <span><strong>${f.label}</strong><em>${f.hint}</em></span>
        </label>
        <div class="fail-sliders" hidden>
          <label class="field"><span>Happens <b data-fail-delay-val="${f.id}">${f.delay[2] === 0 ? 'straight away' : `after ${f.delay[2]} min of flight`}</b></span>
            <input type="range" min="${f.delay[0]}" max="${f.delay[1]}" step="1" value="${f.delay[2]}" data-fail-delay="${f.id}"></label>
          ${f.amount ? `<label class="field"><span>${f.amountLabel} <b data-fail-amount-val="${f.id}">${f.amount[2]}</b> min</span>
            <input type="range" min="${f.amount[0]}" max="${f.amount[1]}" step="1" value="${f.amount[2]}" data-fail-amount="${f.id}"></label>` : ''}
        </div>
      </div>`).join('');

    const eventRows = SELECTABLE_EVENTS.map((e) => `
      <div class="fail-row" data-fail-row="${e.id}">
        <label class="fail-head">
          <input type="checkbox" data-event="${e.id}">
          <span><strong>${e.name}</strong><em>${e.hint}</em></span>
        </label>
        <div class="fail-sliders" hidden>
          <label class="field"><span>Happens <b data-event-delay-val="${e.id}">straight away</b></span>
            <input type="range" min="0" max="25" step="1" value="0" data-event-delay="${e.id}"></label>
          ${
            e.id === 'tornado'
              ? `<label class="field"><span>Strength <b data-ef-val>whatever comes</b></span>
                   <input type="range" min="-1" max="5" step="1" value="-1" data-ef></label>
                 <p class="hint tiny" data-ef-hint>Left of EF0 it picks its own, and the weak ones are
                 far commoner — an EF5 should be a rare, bad day.</p>`
              : ''
          }
        </div>
      </div>`).join('');

    const s = h(`
      <section class="screen screen-list screen-free" data-screen="free" hidden>
        <header class="screen-head">
          <button class="ghost" data-back>← Back</button>
          <h2>Free Flight</h2>
          <span></span>
        </header>

        <div class="tabs">
          <button class="tab is-on" data-ftab="aircraft">Aircraft</button>
          <button class="tab" data-ftab="departure">Departure</button>
          <button class="tab" data-ftab="weather">Weather</button>
          <button class="tab" data-ftab="failures">Failures</button>
        </div>

        <div class="free-panel" data-fpanel="aircraft">
          <div class="fleet-grid">${fleet}</div>
        </div>

        <div class="free-panel" data-fpanel="departure" hidden>
          <div class="start-grid">
            <button class="start-opt" data-start="gate">
              ${icon('gate', 22)}
              <span><strong>At the parking stand</strong>
              <em>Taxi out to the runway with ATC talking you through it. A skip button is on screen the whole way.</em></span>
            </button>
            <button class="start-opt is-on" data-start="runway">
              ${icon('plane', 22)}
              <span><strong>Lined up on the runway</strong><em>Straight to it — full power when you are ready.</em></span>
            </button>
            <button class="start-opt" data-start="air">
              ${icon('cloud', 22)}
              <span><strong>Already flying</strong><em>Airborne at 2,000 ft with the engine running.</em></span>
            </button>
          </div>

          <h3 class="fail-heading">Fuel on board</h3>
          <label class="field">
            <span><b data-fuelval>Full tanks</b></span>
            <input type="range" min="8" max="100" step="2" value="100" data-fuel>
          </label>
          <p class="hint" data-fuelhint></p>
        </div>

        <div class="free-panel free-two" data-fpanel="weather" hidden>
          <div>
            <h3>Presets</h3>
            <div class="preset-grid">${presets}</div>
          </div>
          <div>
            <h3>Or set it yourself</h3>
            <label class="field"><span>Time of day</span><select data-time>${times}</select></label>
            <label class="field"><span>Sky</span><select data-cond>${conds}</select></label>
            <label class="field"><span>Wind speed <b data-windval>4</b> kt</span>
              <input type="range" min="0" max="35" step="1" data-wind></label>
            <label class="field"><span>Wind comes from <b data-dirval>090</b>°</span>
              <input type="range" min="0" max="350" step="10" data-dir></label>
            <p class="hint" data-crosswind></p>
          </div>
          <div class="free-col-full">
            <h3>Disasters</h3>
            <p class="trigger-note">
              Weather that happens to you rather than to the aeroplane, and ends on its own. Harder maps and
              worse skies bring them round more often when the randomiser is on.
            </p>
            <div class="fail-list">${eventRows}</div>
          </div>
        </div>

        <div class="free-panel" data-fpanel="failures" hidden>
          <p class="trigger-note">
            Arm something before you go and it will happen while you are flying. Nothing here switches itself
            on — an ordinary flight is never sabotaged. You can also trigger any of these on the spot from the
            pause menu.
          </p>
          <div class="fail-list">${failureRows}</div>
          <label class="check check-wide"><input type="checkbox" data-random-disasters>
            <span><strong>Randomised disasters</strong>
            <em>Things go wrong on their own, at times you will not see coming. Bad weather makes them
            more likely — a storm is when an aeroplane is most likely to have a bad day.</em></span></label>
        </div>

        <div class="free-slots">
          <div class="free-slots-head">
            <span>Saved flights</span>
            <span class="hint tiny">Click to load · Shift-click or hold to overwrite · long-press to clear</span>
          </div>
          <div class="slot-row" data-slots></div>
        </div>

        <footer class="free-bar">
          <div class="free-summary" data-summary></div>
          <button class="primary big" data-fly>Take off</button>
        </footer>
      </section>
    `);

    const wind = s.querySelector('[data-wind]');
    const dir = s.querySelector('[data-dir]');
    const time = s.querySelector('[data-time]');
    const cond = s.querySelector('[data-cond]');
    // A plan view on each card, drawn from that aeroplane's own shape data.
    this.repaintFleetArt = (liveryId) => {
      for (const a of AIRCRAFT) {
        const host = s.querySelector(`[data-fleet-art="${a.id}"]`);
        if (!host) continue;
        host.innerHTML = '';
        host.appendChild(aircraftThumbnail(a, liveryId));
      }
    };
    this.repaintFleetArt(this.settingsRef ? this.settingsRef.livery : 'house');
    // Show which of the fleet you have actually earned.
    this.syncFleetLocks = () => {
      for (const a of AIRCRAFT) {
        const card = s.querySelector(`[data-aircraft="${a.id}"]`);
        if (!card) continue;
        const gated = Prog.needsPasscode(this.prog, a);
        card.hidden = gated;
        const locked = gated || !Prog.isUnlocked(this.prog, a.id);
        card.classList.toggle('is-locked', locked);
        let tag = card.querySelector('.fleet-lock');
        if (locked && !tag) {
          tag = document.createElement('span');
          tag.className = 'fleet-lock';
          card.appendChild(tag);
        }
        if (tag) tag.textContent = locked ? `${Prog.costOf(a.id).toLocaleString()} credits` : '';
        if (!locked && tag) tag.remove();
      }
    };
    this.syncFleetLocks();

    this.freeControls = { wind, dir, time, cond };
    this.chosenAircraft = 'skylark';
    this.chosenStart = 'runway';

    const startWords = {
      gate: 'from the parking stand',
      runway: 'from the runway',
      air: 'already airborne',
    };

    const refresh = () => {
      s.querySelector('[data-windval]').textContent = wind.value;
      s.querySelector('[data-dirval]').textContent = String(dir.value).padStart(3, '0');
      const rel = ((Number(dir.value) - 90 + 540) % 360) - 180;
      const cross = Math.abs(Math.sin((rel * Math.PI) / 180)) * Number(wind.value);
      const side = rel > 0 ? 'right' : 'left';
      let msg;
      if (Number(wind.value) < 2) msg = 'Calm air — the easiest conditions to fly in.';
      else if (cross < 4) msg = 'The wind is almost straight down the runway. Nice and easy.';
      else if (cross < 12) msg = `A gentle crosswind from the ${side} (${Math.round(cross)} kt across the runway).`;
      else msg = `A strong crosswind from the ${side} — ${Math.round(cross)} kt across the runway. Tricky!`;
      s.querySelector('[data-crosswind]').textContent = msg;

      // Fuel: shown as a share of the tanks *and* as the time it buys in this
      // particular aeroplane, because 40% means nothing on its own.
      const fuelPct = Number(s.querySelector('[data-fuel]').value);
      const perf = performanceFor(this.chosenAircraft);
      const mins = Math.round((perf.enduranceMin * fuelPct) / 100);
      s.querySelector('[data-fuelval]').textContent =
        fuelPct >= 100 ? 'Full tanks' : `${fuelPct}% of full tanks`;
      s.querySelector('[data-fuelhint]').textContent =
        `About ${mins} minutes at full power, and appreciably longer at a cruise setting. ` +
        (fuelPct <= 25 ? 'Enough to make fuel a real problem — plan where you are landing.' : '');

      // The summary is the whole point of the bottom bar: you can see what you
      // are about to fly without going back through the tabs.
      const ac = AIRCRAFT.find((a) => a.id === this.chosenAircraft);
      const armed = [...s.querySelectorAll('[data-fail]:checked, [data-event]:checked')].length;
      s.querySelector('[data-summary]').innerHTML =
        `<strong>${ac.name}</strong> · ${startWords[this.chosenStart]} · ` +
        `${CONDITIONS[cond.value].label.toLowerCase()}, ${wind.value} kt` +
        (fuelPct < 100 ? ` · <span class="sum-warn">${mins} min of fuel</span>` : '') +
        (armed ? ` · <span class="sum-warn">${armed} failure${armed > 1 ? 's' : ''} armed</span>` : '');
    };
    wind.addEventListener('input', refresh);
    dir.addEventListener('input', refresh);
    s.querySelector('[data-fuel]').addEventListener('input', refresh);
    cond.addEventListener('change', refresh);
    this.refreshFree = refresh;

    // Sliders live-update their own labels and reveal themselves with the box.
    s.addEventListener('input', (e) => {
      const d = e.target.dataset;
      if (d.failDelay) {
        const v = Number(e.target.value);
        s.querySelector(`[data-fail-delay-val="${d.failDelay}"]`).textContent =
          v === 0 ? 'straight away' : `after ${v} min of flight`;
      }
      if (d.eventDelay) {
        const v = Number(e.target.value);
        s.querySelector(`[data-event-delay-val="${d.eventDelay}"]`).textContent =
          v === 0 ? 'straight away' : `after ${v} min of flight`;
      }
      if (d.failAmount) s.querySelector(`[data-fail-amount-val="${d.failAmount}"]`).textContent = e.target.value;
      if (d.ef !== undefined) {
        const v = Number(e.target.value);
        const band = v < 0 ? null : EF_SCALE[v];
        s.querySelector('[data-ef-val]').textContent = band ? band.label : 'whatever comes';
        s.querySelector('[data-ef-hint]').textContent = band
          ? `${Math.round(band.windMs * 2.23694)} mph at the wall — ${band.damage.toLowerCase()}.`
          : 'Left of EF0 it picks its own, and the weak ones are far commoner — an EF5 should be a rare, bad day.';
      }
    });
    s.addEventListener('change', (e) => {
      if (e.target.dataset.fail || e.target.dataset.event) {
        const row = e.target.closest('[data-fail-row]');
        row.querySelector('.fail-sliders').hidden = !e.target.checked;
        row.classList.toggle('is-armed', e.target.checked);
        refresh();
      }
    });

    /**
     * Everything the Free Flight screen is currently asking for, as one plain
     * object. "Take off" and "save this slot" both go through here so the
     * thing you save is exactly the thing you would have flown.
     */
    const collectSetup = () => {
      const failures = {};
      for (const f of FAILURES) {
        const box = s.querySelector(`[data-fail="${f.id}"]`);
        if (!box || !box.checked) continue;
        failures[f.id] = {
          afterMin: Number(s.querySelector(`[data-fail-delay="${f.id}"]`).value),
          amountMin: f.amount ? Number(s.querySelector(`[data-fail-amount="${f.id}"]`).value) : null,
        };
      }
      const events = {};
      for (const ev of SELECTABLE_EVENTS) {
        const box = s.querySelector(`[data-event="${ev.id}"]`);
        if (!box || !box.checked) continue;
        events[ev.id] = { afterMin: Number(s.querySelector(`[data-event-delay="${ev.id}"]`).value) };
      }
      const efRaw = Number(s.querySelector('[data-ef]')?.value ?? -1);
      return {
        fuel: Number(s.querySelector('[data-fuel]').value) / 100,
        events,
        // -1 means "let it choose", which is why this is null rather than 0.
        tornadoEF: efRaw < 0 ? null : efRaw,
        randomDisasters: s.querySelector('[data-random-disasters]').checked,
        time: time.value,
        condition: cond.value,
        windSpeedKts: Number(wind.value),
        windDirDeg: Number(dir.value),
        airborne: this.chosenStart === 'air',
        taxi: this.chosenStart === 'gate',
        aircraft: this.chosenAircraft,
        failures,
      };
    };

    /** Put a saved setup back into every control on the screen. */
    const applySetup = (c) => {
      if (!c) return;
      time.value = c.time;
      cond.value = c.condition;
      wind.value = c.windSpeedKts;
      dir.value = c.windDirDeg;
      this.chosenAircraft = c.aircraft || 'skylark';
      this.chosenStart = c.airborne ? 'air' : c.taxi ? 'gate' : 'runway';
      s.querySelectorAll('[data-aircraft]').forEach((n) =>
        n.classList.toggle('is-on', n.dataset.aircraft === this.chosenAircraft));
      s.querySelectorAll('[data-start]').forEach((n) =>
        n.classList.toggle('is-on', n.dataset.start === this.chosenStart));
      s.querySelector('[data-fuel]').value = Math.round((c.fuel ?? 1) * 100);
      s.querySelector('[data-random-disasters]').checked = !!c.randomDisasters;
      const ef = s.querySelector('[data-ef]');
      if (ef) {
        ef.value = c.tornadoEF == null ? -1 : c.tornadoEF;
        ef.dispatchEvent(new Event('input', { bubbles: true }));
      }
      // Failures and events: tick what was armed, clear everything else, and
      // reveal each row's sliders to match.
      const restore = (sel, saved, delaySel, amountSel) => {
        s.querySelectorAll(sel).forEach((box) => {
          const id = box.dataset.fail || box.dataset.event;
          const cfg = saved[id];
          box.checked = !!cfg;
          const row = box.closest('[data-fail-row]');
          if (row) {
            row.querySelector('.fail-sliders').hidden = !cfg;
            row.classList.toggle('is-armed', !!cfg);
          }
          if (!cfg) return;
          const d = s.querySelector(`[${delaySel}="${id}"]`);
          if (d) { d.value = cfg.afterMin ?? 0; d.dispatchEvent(new Event('input', { bubbles: true })); }
          if (amountSel && cfg.amountMin != null) {
            const a = s.querySelector(`[${amountSel}="${id}"]`);
            if (a) { a.value = cfg.amountMin; a.dispatchEvent(new Event('input', { bubbles: true })); }
          }
        });
      };
      restore('[data-fail]', c.failures || {}, 'data-fail-delay', 'data-fail-amount');
      restore('[data-event]', c.events || {}, 'data-event-delay', null);
      refresh();
    };

    /** Repaint the five slots from storage. */
    const renderSlots = () => {
      const saved = loadFreePresets();
      const host = s.querySelector('[data-slots]');
      if (!host) return;
      host.innerHTML = '';
      for (let i = 0; i < MAX_FREE_PRESETS; i++) {
        const p = saved[i];
        const b = document.createElement('button');
        b.className = 'slot' + (p ? ' is-filled' : '');
        b.dataset.slot = String(i);
        b.innerHTML = p
          ? `<strong>${p.label}</strong><em>${p.summary}</em>`
          : `<strong>Slot ${i + 1}</strong><em>empty — save this setup here</em>`;
        host.appendChild(b);
      }
    };
    this.renderFreeSlots = renderSlots;

    s.addEventListener('click', (e) => {
      if (e.target.closest('[data-back]')) return this.show('main');

      const tab = e.target.closest('[data-ftab]');
      if (tab) {
        s.querySelectorAll('[data-ftab]').forEach((n) => n.classList.toggle('is-on', n === tab));
        s.querySelectorAll('[data-fpanel]').forEach((n) => (n.hidden = n.dataset.fpanel !== tab.dataset.ftab));
        return;
      }

      const p = e.target.closest('[data-preset]');
      if (p) {
        const preset = PRESETS.find((x) => x.id === p.dataset.preset);
        time.value = preset.time;
        cond.value = preset.condition;
        wind.value = preset.wind;
        dir.value = Math.round(preset.dir / 10) * 10;
        refresh();
        s.querySelectorAll('.preset').forEach((n) => n.classList.remove('is-on'));
        p.classList.add('is-on');
        return;
      }

      const plane = e.target.closest('[data-aircraft]');
      if (plane) {
        /*
         * Locked aeroplanes cannot be chosen, and say why.
         *
         * The alternative — letting you pick it and refusing at take-off — is
         * the version that feels broken, because the game let you do a thing
         * and then took it back.
         */
        const id = plane.dataset.aircraft;
        const type = AIRCRAFT.find((a) => a.id === id);
        if (Prog.needsPasscode(this.prog, type)) {
          this.hooks.onLocked && this.hooks.onLocked(
            'Military aircraft are behind a passcode — enter it in the Hangar.'
          );
          return;
        }
        if (!Prog.isUnlocked(this.prog, id)) {
          const cost = Prog.costOf(id);
          const short = cost - this.prog.credits;
          this.hooks.onLocked && this.hooks.onLocked(
            short > 0
              ? `Locked — ${short.toLocaleString()} more credits needed. Fly missions to earn them.`
              : `Locked — unlock it for ${cost.toLocaleString()} credits in the Hangar.`
          );
          return;
        }
        this.chosenAircraft = id;
        s.querySelectorAll('[data-aircraft]').forEach((n) => n.classList.toggle('is-on', n === plane));
        refresh();
        return;
      }

      const start = e.target.closest('[data-start]');
      if (start) {
        this.chosenStart = start.dataset.start;
        s.querySelectorAll('[data-start]').forEach((n) => n.classList.toggle('is-on', n === start));
        refresh();
        return;
      }

      const slot = e.target.closest('[data-slot]');
      if (slot) {
        const i = Number(slot.dataset.slot);
        const saved = loadFreePresets();
        /*
         * One button, two jobs, decided by whether the slot has anything in
         * it. An empty slot saves; a full one loads. Shift-click overwrites a
         * full slot, and alt-click empties it — which keeps the common case to
         * a single unmodified click and hides nothing behind a menu.
         */
        if (e.altKey && saved[i]) {
          saved[i] = null;
          saveFreePresets(saved);
          renderSlots();
          return;
        }
        if (saved[i] && !e.shiftKey) {
          applySetup(saved[i]);
          s.querySelectorAll('[data-slot]').forEach((n) => n.classList.remove('is-loaded'));
          slot.classList.add('is-loaded');
          return;
        }
        const cfg = collectSetup();
        const ac = AIRCRAFT.find((a) => a.id === cfg.aircraft);
        saved[i] = {
          ...cfg,
          label: `${ac ? ac.name : cfg.aircraft}`,
          summary:
            `${CONDITIONS[cfg.condition].label.toLowerCase()}, ${cfg.windSpeedKts} kt` +
            `${startWords[this.chosenStart] ? ' · ' + startWords[this.chosenStart] : ''}`,
        };
        saveFreePresets(saved);
        renderSlots();
        return;
      }

      if (e.target.closest('[data-fly]')) this.hooks.startFree(collectSetup());
    });

    renderSlots();
    this.screens.free = s;
    return s;
  }

  buildSettings() {
    const s = h(`
      <section class="screen screen-list" data-screen="settings" hidden>
        <header class="screen-head">
          <button class="ghost" data-back>← Back</button>
          <h2>Settings</h2>
          <button class="ghost" data-reset-all>Reset everything</button>
        </header>
        <div class="tabs">
          <button class="tab is-on" data-tab="flight">Flying</button>
          <button class="tab" data-tab="sound">Sound</button>
          <button class="tab" data-tab="graphics">Graphics</button>
          <button class="tab" data-tab="controls">Controls</button>
          <button class="tab" data-tab="access">Accessibility</button>
        </div>

        <div class="tab-body" data-panel="flight">
          <label class="field"><span>Airline livery</span>
            <select data-set="livery">
              ${LIVERIES.map((l) => `<option value="${l.id}">${l.name} — ${l.blurb}</option>`).join('')}
            </select>
          </label>
          <p class="hint">These are original airlines, styled after the real ones rather than copying
          them. The tail is painted with its own material — a stripe drawn into the shared body texture
          wraps around the fuselage as a ring instead, which is a property of how the mesh is unwrapped.</p>
          <label class="field"><span>Difficulty</span>
            <select data-set="difficulty">
              <option value="easy">Easy — for a first flight</option>
              <option value="normal">Normal — the usual game (recommended)</option>
              <option value="realistic">Realistic — no help at all</option>
            </select>
          </label>
          <p class="hint"><b>Easy</b> gives you much more elevator at low speed, so the aeroplane rotates and flares almost by itself, guards the stall earlier, and halves the gusts. <b>Normal</b> is the game as it has always flown: it levels the wings, coordinates the rudder and will not let you stall. <b>Realistic</b> switches all of that off — it can stall, and it will drift in a crosswind.</p>
          <label class="check"><input type="checkbox" data-set="mouseFlying"><span>Fly with the mouse (click the sky to capture the pointer)</span></label>
          <label class="check"><input type="checkbox" data-set="invertMouse"><span>Invert mouse up/down</span></label>
          <label class="field"><span>Mouse / stick sensitivity <b data-out="sensitivity"></b></span>
            <input type="range" min="0.3" max="2" step="0.1" data-set="sensitivity"></label>
          <label class="check"><input type="checkbox" data-set="gamepad"><span>Use a gamepad if one is plugged in</span></label>
          <label class="check"><input type="checkbox" data-set="showHints"><span>Repeat hints if I get stuck</span></label>
          <label class="check"><input type="checkbox" data-set="guidance"><span>Show guidance to the runway or target (N)</span></label>
          <label class="field"><span>Show it as</span>
            <select data-set="guideStyle">
              <option value="arrow">An arrow — points which way to turn</option>
              <option value="beacon">A beacon — a light standing on the spot</option>
              <option value="both">Both</option>
            </select></label>
          <label class="check"><input type="checkbox" data-set="startAtGate"><span>Start on the parking stand and taxi out (Free Flight)</span></label>
          <label class="check"><input type="checkbox" data-set="realisticFuel"><span>Realistic fuel — the tank drains 1% every 30 seconds, so you have to plan</span></label>
          <label class="check"><input type="checkbox" data-set="randomWinds"><span>Random winds — the wind wanders and gusts blow through</span></label>
          <p class="hint">With random winds on, the wind drifts around the speed and direction you chose and a gust rolls
          through every half minute or so. It makes landings much more interesting. Leave it off while you are learning.</p>
        </div>

        <div class="tab-body" data-panel="sound" hidden>
          <label class="field"><span>Overall volume <b data-out="volumes.master"></b></span>
            <input type="range" min="0" max="1" step="0.05" data-set="volumes.master"></label>
          <div class="sound-row">
            <label class="check sound-switch"><input type="checkbox" data-set="soundOn.engine"><span>Engine</span></label>
            <label class="field"><span><b data-out="volumes.engine"></b></span>
              <input type="range" min="0" max="1" step="0.05" data-set="volumes.engine"></label>
          </div>
          <div class="sound-row">
            <label class="check sound-switch"><input type="checkbox" data-set="soundOn.environment"><span>Wind, rain &amp; tyres</span></label>
            <label class="field"><span><b data-out="volumes.environment"></b></span>
              <input type="range" min="0" max="1" step="0.05" data-set="volumes.environment"></label>
          </div>
          <div class="sound-row">
            <label class="check sound-switch"><input type="checkbox" data-set="soundOn.atc"><span>ATC radio</span></label>
            <label class="field"><span><b data-out="volumes.atc"></b></span>
              <input type="range" min="0" max="1" step="0.05" data-set="volumes.atc"></label>
          </div>
          <div class="sound-row">
            <label class="check sound-switch"><input type="checkbox" data-set="soundOn.alerts"><span>Warnings &amp; alerts</span></label>
            <label class="field"><span><b data-out="volumes.alerts"></b></span>
              <input type="range" min="0" max="1" step="0.05" data-set="volumes.alerts"></label>
          </div>
          <div class="sound-row">
            <label class="check sound-switch"><input type="checkbox" data-set="soundOn.music"><span>Music</span></label>
            <label class="field"><span><b data-out="volumes.music"></b></span>
              <input type="range" min="0" max="1" step="0.05" data-set="volumes.music"></label>
          </div>
          <label class="check"><input type="checkbox" data-set="music"><span>Play background music</span></label>
          <label class="field"><span>ATC voices</span>
            <select data-set="atcVoice">
              <option value="radio">Radio chatter (default — no text-to-speech)</option>
              <option value="speech">Your device's speech voice (text-to-speech)</option>
              <option value="recordings">Recordings I have added myself</option>
            </select></label>
          <p class="hint">The default radio is built entirely from Web Audio — indistinct formant chatter through a
          real radio chain, with the words as subtitles. No text-to-speech and no AI voices. The speech option uses your
          operating system's own voice; it is text-to-speech, which is why it is not the default. The third option plays
          clips you put in <code>assets/atc/</code> yourself.</p>
          <label class="check"><input type="checkbox" data-set="atcChatter"><span>Background radio chatter from other aircraft</span></label>
          <label class="check"><input type="checkbox" data-set="muted"><span>Mute everything</span></label>
          <p class="hint">Every sound is synthesised by the game — engine, wind, rain, tyres and the radio. Nothing is downloaded, so it all works offline.</p>
        </div>

        <div class="tab-body" data-panel="graphics" hidden>
          <label class="field"><span>Detail level</span>
            <select data-set="quality">
              <option value="low">Low — fastest, for older laptops</option>
              <option value="medium">Medium</option>
              <option value="high">High — best looking</option>
            </select>
          </label>
          <p class="hint">Changing the detail level rebuilds the island, which takes a couple of seconds.</p>
          <div class="fps-box">Frames per second: <b data-fps>—</b></div>
        </div>

        <div class="tab-body" data-panel="controls" hidden>
          <p class="hint">Click a key, then press the new key you want to use.</p>
          <div class="keymap" data-keymap></div>
          <button class="ghost" data-reset-keys>Reset keys to default</button>
        </div>

        <div class="tab-body" data-panel="access" hidden>
          <label class="check"><input type="checkbox" data-set="subtitles"><span>Show subtitles for radio calls</span></label>
          <label class="check"><input type="checkbox" data-set="reducedMotion"><span>Reduced motion (much less camera shake)</span></label>
          <label class="check"><input type="checkbox" data-set="highContrast"><span>High-contrast display</span></label>
          <label class="check"><input type="checkbox" data-set="largeText"><span>Larger text</span></label>
        </div>
      </section>
    `);

    s.addEventListener('click', (e) => {
      if (e.target.closest('[data-back]')) return this.show(this.settingsReturn || 'main');
      const tab = e.target.closest('[data-tab]');
      if (tab) {
        s.querySelectorAll('.tab').forEach((t) => t.classList.toggle('is-on', t === tab));
        s.querySelectorAll('.tab-body').forEach((b) => (b.hidden = b.dataset.panel !== tab.dataset.tab));
        return;
      }
      if (e.target.closest('[data-reset-keys]')) {
        this.hooks.resetKeys();
        this.renderKeymap();
        return;
      }
      if (e.target.closest('[data-reset-all]')) {
        if (confirm('Reset all settings, keys and mission progress?')) this.hooks.resetAll();
      }
    });

    s.addEventListener('input', (e) => {
      const t = e.target.closest('[data-set]');
      if (!t) return;
      const path = t.dataset.set;
      let value;
      if (t.type === 'checkbox') value = t.checked;
      else if (t.type === 'range') value = Number(t.value);
      else value = t.value;
      this.hooks.onSetting(path, value);
      const out = s.querySelector(`[data-out="${path}"]`);
      if (out) out.textContent = t.type === 'range' && Number(value) <= 1 ? `${Math.round(value * 100)}%` : value;
    });

    this.screens.settings = s;
    return s;
  }

  /**
   * Hangar: your rank, your credits, what you have earned and what is left to
   * earn — plus the other games.
   *
   * All of it local. There is no account and no server, which is why the game
   * opens instantly and keeps working with no wifi; a leaderboard of your own
   * best flights is also the version people actually play, because a global
   * board is somebody else's score and this one is yours to beat.
   */
  /**
   * "More" — one page for everything that is not flying.
   *
   * The main menu had grown a button per feature, which is how a start screen
   * turns into a filing cabinet. This gathers the four things you visit
   * between flights — where you stand, what you have earned, what else you can
   * drive, and the settings — behind one entry, with the leaderboard right
   * there on the page rather than a click further in.
   */
  buildMore() {
    const s = h(`
      <section class="screen screen-list" data-screen="more" hidden>
        <header class="screen-head">
          <button class="ghost" data-back>← Back</button>
          <h2>More</h2>
          <span></span>
        </header>

        <div class="rank-card">
          <div class="rank-badge" data-more-rank>Cadet</div>
          <div class="rank-meat">
            <div class="rank-line"><b data-more-credits>0</b> credits · <span data-more-earned>0</span> earned all-time</div>
            <div class="rank-bar"><div class="rank-fill" data-more-fill></div></div>
            <div class="hint tiny" data-more-next></div>
          </div>
        </div>

        <h3 class="fail-heading">Leaderboard — your best flights</h3>
        <div class="board" data-more-board></div>

        <h3 class="fail-heading">Other things to drive</h3>
        <p class="trigger-note">All of these are in the same world as the aeroplane — the same island, the
        same sea, the same runway. You can fly to the coast and then take the boat out.</p>
        <div class="games-grid" data-more-games></div>

        <h3 class="fail-heading">Everything else</h3>
        <div class="start-grid">
          <button class="start-opt" data-goto="hangar">
            ${icon('hangar', 22)}
            <span><strong>Hangar</strong><em>Buy aeroplanes with your credits, and enter codes</em></span>
          </button>
          <button class="start-opt" data-goto="settings">
            ${icon('gear', 22)}
            <span><strong>Settings</strong><em>Controls, difficulty, liveries, sound and graphics</em></span>
          </button>
          <button class="start-opt" data-goto="credits">
            ${icon('help', 22)}
            <span><strong>Credits &amp; licences</strong><em>Who made what, and what you may do with it</em></span>
          </button>
        </div>
      </section>
    `);

    const DRIVES = [
      { name: 'Helicopter', blurb: 'Skyhook H-3 — it hovers. Pick it in the hangar.', pick: 'harrier' },
      { name: 'Boat', blurb: 'Kestrel Launch — out of the bay', drive: 'boat' },
      { name: 'Car', blurb: 'Airfield Runabout — round the apron', drive: 'car' },
    ];
    s.querySelector('[data-more-games]').innerHTML = DRIVES.map((g) => {
      const attr = g.drive ? `data-drive="${g.drive}"` : `data-pick="${g.pick}"`;
      return `<button class="game-card" ${attr}><strong>${g.name}</strong><em>${g.blurb}</em></button>`;
    }).join('');

    const render = () => {
      const p = this.prog || Prog.load();
      const rank = Prog.rankFor(p);
      const next = Prog.nextRank(p);
      s.querySelector('[data-more-rank]').textContent = rank.name;
      s.querySelector('[data-more-credits]').textContent = p.credits.toLocaleString();
      s.querySelector('[data-more-earned]').textContent = p.earned.toLocaleString();
      s.querySelector('[data-more-fill]').style.width = next
        ? `${Math.max(2, Math.min(100, (next.into / next.span) * 100))}%`
        : '100%';
      s.querySelector('[data-more-next]').textContent = next
        ? `${next.need.toLocaleString()} more to ${next.rank.name} — ${next.rank.blurb}`
        : rank.blurb;
      const board = p.best || [];
      s.querySelector('[data-more-board]').innerHTML = board.length
        ? board.map((b, i) => `<div class="board-row"><span class="board-pos">${i + 1}</span><span class="board-name">${b.label}</span><span class="board-score">${b.score}</span><span class="board-date">${b.date}</span></div>`).join('')
        : '<p class="hint tiny">Fly something and it will show up here.</p>';
    };
    this.syncMore = render;

    s.addEventListener('click', (e) => {
      if (e.target.closest('[data-back]')) return this.show('main');
      const goto = e.target.closest('[data-goto]');
      if (goto) return this.show(goto.dataset.goto);
      const drive = e.target.closest('[data-drive]');
      if (drive) {
        this.hooks.startDrive && this.hooks.startDrive(drive.dataset.drive);
        return;
      }
      const pick = e.target.closest('[data-pick]');
      if (pick) {
        this.show('hangar');
        this.hooks.onLocked &&
          this.hooks.onLocked('The Skyhook is in the hangar — unlock it, then pick it in Free Flight.');
      }
    });

    render();
    this.screens.more = s;
    return s;
  }

  buildHangar() {
    const s = h(`
      <section class="screen screen-list" data-screen="hangar" hidden>
        <header class="screen-head">
          <button class="ghost" data-back>← Back</button>
          <h2>Hangar &amp; Rank</h2>
          <span></span>
        </header>

        <div class="rank-card">
          <div class="rank-badge" data-rank-name>Cadet</div>
          <div class="rank-meat">
            <div class="rank-line"><b data-credits>0</b> credits · <span data-earned>0</span> earned all-time</div>
            <div class="rank-bar"><div class="rank-fill" data-rank-fill></div></div>
            <div class="hint tiny" data-rank-next></div>
          </div>
        </div>

        <h3 class="fail-heading">Aeroplanes</h3>
        <div class="unlock-grid" data-unlocks></div>

        <h3 class="fail-heading">Your best flights</h3>
        <div class="board" data-board></div>

        <h3 class="fail-heading">Military access</h3>
        <p class="trigger-note" data-mil-note>Military aircraft are behind a passcode. Ask whoever runs the game.</p>
        <div class="code-row">
          <input type="text" data-mil-code placeholder="Passcode" maxlength="20">
          <button data-mil-enter>Enter</button>
        </div>

        <h3 class="fail-heading">Got a code?</h3>
        <div class="code-row">
          <input type="text" data-code placeholder="Ask the CEO" maxlength="20">
          <button data-redeem>Redeem</button>
        </div>
        <p class="hint tiny" data-code-msg>Codes pay out once each.</p>

        <h3 class="fail-heading">More games</h3>
        <p class="trigger-note">Other things built by the same person. The ones marked
        <em>not yet</em> do not exist — a link to nothing is worse than an honest gap.</p>
        <div class="games-grid" data-games></div>
      </section>
    `);

    /*
     * The other games.
     *
     * A boat, a helicopter and a car sim were asked for; each is its own game
     * rather than a feature of this one, so they are listed honestly as not
     * built rather than linked to a dead page. Anything with a `url` opens in
     * a new tab; anything without simply says so.
     */
    /*
     * The other games — in this world rather than three copies of it.
     *
     * A boat sim needs an ocean and islands; a car sim needs roads and ground;
     * a helicopter sim needs terrain to hover over. All three already exist
     * here, so building them as separate games would have meant duplicating
     * the entire engine three times to end up somewhere less interesting than
     * being able to fly to the coast and take the boat out.
     */
    const GAMES = [
      { name: 'Flight Simulator', blurb: 'You are here', here: true },
      { name: 'Helicopter', blurb: 'Skyhook H-3 — it hovers. In the hangar.', drive: null },
      { name: 'Boat', blurb: 'Kestrel Launch — take her out of the bay', drive: 'boat' },
      { name: 'Car', blurb: 'Airfield Runabout — around the apron', drive: 'car' },
    ];
    const games = s.querySelector('[data-games]');
    games.innerHTML = GAMES.map((g) => {
      const cls = g.here ? 'game-card is-here' : g.url ? 'game-card' : 'game-card is-soon';
      const inner = `<strong>${g.name}</strong><em>${g.blurb}</em>`;
      if (g.drive) return `<button class="${cls}" data-drive="${g.drive}">${inner}</button>`;
      return g.url && !g.here
        ? `<a class="${cls}" href="${g.url}" target="_blank" rel="noopener">${inner}</a>`
        : `<div class="${cls}">${inner}</div>`;
    }).join('');

    const render = () => {
      const p = this.prog || Prog.load();
      const rank = Prog.rankFor(p);
      const next = Prog.nextRank(p);
      s.querySelector('[data-rank-name]').textContent = rank.name;
      s.querySelector('[data-credits]').textContent = p.credits.toLocaleString();
      s.querySelector('[data-earned]').textContent = p.earned.toLocaleString();
      s.querySelector('[data-rank-fill]').style.width = next
        ? `${Math.max(2, Math.min(100, (next.into / next.span) * 100))}%`
        : '100%';
      s.querySelector('[data-rank-next]').textContent = next
        ? `${next.need.toLocaleString()} more to ${next.rank.name} — ${next.rank.blurb}`
        : `${rank.blurb}`;

      const milOpen = !!p.militaryUnlocked;
      s.querySelector('[data-mil-note]').textContent = milOpen
        ? 'Access granted. The military hangar is open.'
        : 'Military aircraft are behind a passcode. Ask whoever runs the game.';
      s.querySelector('[data-unlocks]').innerHTML = AIRCRAFT.filter((a) => milOpen || !a.military).map((a) => {
        const owned = Prog.isUnlocked(p, a.id);
        const cost = Prog.costOf(a.id);
        const afford = p.credits >= cost;
        return `<button class="unlock${owned ? ' is-owned' : afford ? ' can-buy' : ' is-locked'}" data-buy="${a.id}" ${owned ? 'disabled' : ''}>
          <strong>${a.name}</strong>
          <em>${owned ? 'Yours' : `${cost.toLocaleString()} credits`}</em>
        </button>`;
      }).join('');

      const board = p.best || [];
      s.querySelector('[data-board]').innerHTML = board.length
        ? board.map((b, i) => `<div class="board-row"><span class="board-pos">${i + 1}</span><span class="board-name">${b.label}</span><span class="board-score">${b.score}</span><span class="board-date">${b.date}</span></div>`).join('')
        : '<p class="hint tiny">Fly something and it will show up here.</p>';
    };
    this.syncProgression = (p) => { if (p) this.prog = p; render(); this.syncMore && this.syncMore(); };

    s.addEventListener('click', (e) => {
      if (e.target.closest('[data-back]')) return this.show('main');
      const buy = e.target.closest('[data-buy]');
      if (buy) {
        const p = this.prog || Prog.load();
        const r = Prog.buy(p, buy.dataset.buy);
        s.querySelector('[data-code-msg]').textContent = r.ok ? 'Unlocked — it is in the hangar now.' : r.why;
        render();
        return;
      }
      const drive = e.target.closest('[data-drive]');
      if (drive) {
        this.hooks.startDrive && this.hooks.startDrive(drive.dataset.drive);
        return;
      }
      if (e.target.closest('[data-mil-enter]')) {
        const p = this.prog || Prog.load();
        const r = Prog.enterPasscode(p, s.querySelector('[data-mil-code]').value);
        s.querySelector('[data-code-msg]').textContent = r.ok
          ? 'Access granted — the military hangar is open.'
          : r.why;
        if (r.ok) s.querySelector('[data-mil-code]').value = '';
        render();
        this.syncFleetLocks && this.syncFleetLocks();
        this.syncMissionLocks && this.syncMissionLocks();
        // The start screen's "N missions" denominator excludes hidden ones, so
        // it has to be recomputed too or it keeps advertising the old total.
        this._lastProgress && this.syncProgress(this._lastProgress);
        return;
      }
      if (e.target.closest('[data-redeem]')) {
        const p = this.prog || Prog.load();
        const r = Prog.redeem(p, s.querySelector('[data-code]').value);
        s.querySelector('[data-code-msg]').textContent = r.ok
          ? `${r.note}${r.credits ? ` — ${r.credits} credits` : ''}${r.rank ? ` — you are now ${r.rank}` : ''}`
          : r.why;
        if (r.ok) s.querySelector('[data-code]').value = '';
        render();
      }
    });

    render();
    this.screens.hangar = s;
    return s;
  }

  buildCredits() {
    const s = h(`
      <section class="screen screen-list" data-screen="credits" hidden>
        <header class="screen-head">
          <button class="ghost" data-back>← Back</button>
          <h2>Credits &amp; licences</h2>
          <span></span>
        </header>
        <div class="credits">${CREDITS_HTML}</div>
      </section>
    `);
    s.addEventListener('click', (e) => {
      if (e.target.closest('[data-back]')) this.show('main');
    });
    this.screens.credits = s;
    return s;
  }

  /**
   * The pause card.
   *
   * Two things live here that used to have nowhere to go: the realistic
   * cockpit view, and the triggers panel — a way to break something on purpose
   * and practise dealing with it. Triggers only appear in Free Flight, because
   * an engine failure in the middle of a tutorial is not a lesson, it is a bug
   * report.
   */
  buildPause() {
    const triggers = [
      { id: 'engine', label: 'Engine failure', hint: 'It stops, and it will not restart' },
      { id: 'fuelLeak', label: 'Fuel leak', hint: 'Tanks empty in about four minutes' },
      { id: 'elevator', label: 'Jammed elevator', hint: 'Pitch sticks — fly it on power' },
      { id: 'icing', label: 'Icing', hint: 'More drag, less lift, earlier stall' },
      { id: 'gear', label: 'Undercarriage jammed', hint: 'Stays wherever it is now' },
      { id: 'brakes', label: 'Brake failure', hint: 'No wheel braking at all' },
      { id: 'roughEngine', label: 'Running rough', hint: 'Part power only — you can still fly, just not far' },
      { id: 'tyre', label: 'Burst tyre', hint: 'Drags to one side the moment you touch down' },
    ]
      .map(
        (t) => `
        <button class="trigger-btn" data-trigger="${t.id}">
          ${icon('warning', 18)}
          <span>${t.label}<small>${t.hint}</small></span>
        </button>`
      )
      .join('');

    const eventTriggers = SELECTABLE_EVENTS.map(
      (e) => `
        <button class="trigger-btn" data-natural="${e.id}">
          ${icon('cloud', 18)}
          <span>${e.name}<small>${e.hint}</small></span>
        </button>`
    ).join('');

    const s = h(`
      <section class="screen screen-pause" data-screen="pause" hidden>
        <div class="pause-card">
          <h2>Paused</h2>
          <div class="pause-info" data-pause-info></div>
          <div class="pause-actions">
            <button class="primary" data-act="resume">${icon('play', 18)}<span>Resume flight</span></button>
            <button data-act="restart">${icon('restart', 18)}<span>Restart</span></button>
            <button data-act="airport">${icon('tower', 18)}<span>Return to the airfield</span></button>
            <button data-act="settings">${icon('gear', 18)}<span>Settings</span></button>
            <button data-act="quit">${icon('chevronLeft', 18)}<span>Quit to menu</span></button>
          </div>

          <details class="pause-fold">
            <summary>${icon('autopilot', 16)} Autopilot</summary>
            <div class="start-grid">
              ${AP_MODES.map((m, i) => `
                <button class="start-opt${i === 0 ? ' is-on' : ''}" data-apmode="${m.id}">
                  ${icon('autopilot', 18)}
                  <span><strong>${m.label}</strong><em>${m.hint}</em></span>
                </button>`).join('')}
            </div>
            <label class="field ap-alt">
              <span>Climb or descend to <b data-apalt-val>2,000</b> ft</span>
              <input type="range" min="500" max="12000" step="250" value="2000" data-apalt>
            </label>
            <label class="field ap-alt">
              <span>Heading <b data-aphdg-val>090</b>°</span>
              <input type="range" min="0" max="355" step="5" value="90" data-aphdg>
            </label>
            <label class="field ap-alt">
              <span>Speed <b data-apspd-val>95</b> kt</span>
              <input type="range" min="55" max="260" step="5" value="95" data-apspd>
            </label>
            <label class="field ap-alt">
              <span>Climb and descend at <b data-apvs-val>900</b> ft/min</span>
              <input type="range" min="200" max="2000" step="50" value="900" data-apvs>
            </label>
            <p class="hint tiny">All four can be changed while it is flying — it will not disconnect.
            Heading only applies to <b>hold</b> and <b>climb or descend</b>; returning to the field and
            lining up with the runway work out their own heading and height every moment.</p>
          </details>

          <details class="pause-fold">
            <summary>${icon('camera', 16)} View</summary>
            <div class="pause-actions">
              <button data-act="freelook" data-freelook>Free look: off</button>
              <button data-act="realistic" data-realistic>Realistic cockpit: off</button>
            </div>
          </details>

          <details class="pause-fold" data-triggers hidden>
            <summary>${icon('warning', 16)} Break something</summary>
            <p class="trigger-note">
              Practise dealing with it. Press one again to put it right.
            </p>
            <div class="trigger-grid">${triggers}</div>
          </details>

          <details class="pause-fold" data-natural-fold hidden>
            <summary>${icon('cloud', 16)} Disasters</summary>
            <p class="trigger-note">These run their course and stop on their own.</p>
            <div class="trigger-grid">${eventTriggers}</div>
          </details>

          <p class="tiny">Esc resumes · C changes camera · H shows the controls</p>
        </div>
      </section>
    `);
    // The height selector: tell it to climb or descend while it holds.
    s.addEventListener('input', (e) => {
      if (e.target.matches('[data-aphdg]')) {
        const v = Number(e.target.value);
        s.querySelector('[data-aphdg-val]').textContent = String(v).padStart(3, '0');
        this.hooks.onAutopilotHeading && this.hooks.onAutopilotHeading(v);
        return;
      }
      if (e.target.matches('[data-apspd]')) {
        const v = Number(e.target.value);
        s.querySelector('[data-apspd-val]').textContent = v;
        this.hooks.onAutopilotSpeed && this.hooks.onAutopilotSpeed(v);
        return;
      }
      if (e.target.matches('[data-apvs]')) {
        const v = Number(e.target.value);
        s.querySelector('[data-apvs-val]').textContent = v.toLocaleString();
        this.hooks.onAutopilotVs && this.hooks.onAutopilotVs(v);
        return;
      }
      if (!e.target.matches('[data-apalt]')) return;
      const ft = Number(e.target.value);
      s.querySelector('[data-apalt-val]').textContent = ft.toLocaleString();
      this.hooks.onAutopilotAlt && this.hooks.onAutopilotAlt(ft);
    });

    s.addEventListener('click', (e) => {
      const ap = e.target.closest('[data-apmode]');
      if (ap) {
        this.hooks.onAutopilotMode && this.hooks.onAutopilotMode(ap.dataset.apmode);
        return;
      }
      const nat = e.target.closest('[data-natural]');
      if (nat) {
        this.hooks.onNatural && this.hooks.onNatural(nat.dataset.natural);
        return;
      }
      const t = e.target.closest('[data-trigger]');
      if (t) {
        this.hooks.onTrigger && this.hooks.onTrigger(t.dataset.trigger);
        return;
      }
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const act = b.dataset.act;
      if (act === 'settings') {
        this.settingsReturn = 'pause';
        this.show('settings');
      } else {
        this.hooks.onPauseAction(act);
      }
    });
    this.screens.pause = s;
    return s;
  }

  /** Show the triggers panel only where it belongs. */
  syncTriggers(show, failures) {
    const nat = this.screens.pause && this.screens.pause.querySelector('[data-natural-fold]');
    if (nat) nat.hidden = !show;
    const host = this.screens.pause && this.screens.pause.querySelector('[data-triggers]');
    if (!host) return;
    host.hidden = !show;
    if (!failures) return;
    host.querySelectorAll('[data-trigger]').forEach((b) => {
      const on = !!failures[b.dataset.trigger];
      b.classList.toggle('is-on', on);
      // A tinted border was too easy to miss, so it says so as well.
      let tag = b.querySelector('.trigger-state');
      if (!tag) {
        tag = document.createElement('span');
        tag.className = 'trigger-state';
        b.appendChild(tag);
      }
      tag.textContent = on ? 'ON' : '';
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  /**
   * Light the natural-disaster buttons that are currently running.
   *
   * Unlike the failures these are not toggles — weather happens and then it is
   * over — so they light up for as long as the event lasts and count down,
   * rather than staying on until you press them again.
   */
  /**
   * Show whether the autopilot is engaged, and in what.
   *
   * The mode buttons used to light up when you picked one and stay lit after
   * you took the controls back, which reads as "still flying it" when it is
   * very much not. Nothing is lit unless it is actually flying the aeroplane.
   */
  syncAutopilot(engaged, mode) {
    const host = this.screens.pause;
    if (!host) return;
    host.querySelectorAll('[data-apmode]').forEach((b) => {
      const on = !!engaged && b.dataset.apmode === mode;
      b.classList.toggle('is-on', on);
      let tag = b.querySelector('.ap-state');
      if (!tag) {
        tag = document.createElement('span');
        tag.className = 'ap-state';
        b.appendChild(tag);
      }
      tag.textContent = on ? 'FLYING' : '';
    });
  }

  syncNatural(active) {
    const host = this.screens.pause;
    if (!host) return;
    host.querySelectorAll('[data-natural]').forEach((b) => {
      const left = active && active[b.dataset.natural];
      const on = left > 0;
      b.classList.toggle('is-on', on);
      let tag = b.querySelector('.trigger-state');
      if (!tag) {
        tag = document.createElement('span');
        tag.className = 'trigger-state';
        b.appendChild(tag);
      }
      tag.textContent = on ? (left > 3 ? `${Math.ceil(left)}s` : 'ON') : '';
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  syncRealisticCockpit(on) {
    const b = this.screens.pause && this.screens.pause.querySelector('[data-realistic]');
    if (b) b.textContent = `Realistic cockpit: ${on ? 'on' : 'off'}`;
  }

  buildDebrief() {
    const s = h(`
      <section class="screen screen-pause" data-screen="debrief" hidden>
        <div class="pause-card debrief-card">
          <h2 data-title>Mission complete</h2>
          <div class="debrief-body" data-body></div>
          <div class="pause-actions" data-actions></div>
        </div>
      </section>
    `);
    this.screens.debrief = s;
    return s;
  }

  /* ------------------------------------------------------------------ */

  renderKeymap() {
    const host = this.screens.settings.querySelector('[data-keymap]');
    const bindings = this.hooks.getBindings();
    const groups = {};
    for (const key in ACTIONS) {
      const a = ACTIONS[key];
      groups[a.group] = groups[a.group] || [];
      groups[a.group].push({ key, ...a });
    }
    host.innerHTML = Object.entries(groups)
      .map(
        ([g, items]) => `
        <div class="keymap-group"><h4>${g}</h4>
          ${items
            .map(
              (i) => `<div class="keymap-row"><span>${i.label}</span>
                <button class="keycap" data-bind="${i.key}">${(bindings[i.key] || [])
                  .map(keyLabel)
                  .join(' / ') || '—'}</button></div>`
            )
            .join('')}
        </div>`
      )
      .join('');

    host.querySelectorAll('[data-bind]').forEach((btn) => {
      btn.addEventListener('click', () => {
        btn.textContent = 'press a key…';
        btn.classList.add('is-listening');
        this.hooks.captureKey(btn.dataset.bind, () => {
          btn.classList.remove('is-listening');
          this.renderKeymap();
        });
      });
    });
  }

  syncSettings(settings) {
    const s = this.screens.settings;
    const get = (path) => path.split('.').reduce((o, k) => (o ? o[k] : undefined), settings);
    s.querySelectorAll('[data-set]').forEach((node) => {
      const v = get(node.dataset.set);
      if (v === undefined) return;
      if (node.type === 'checkbox') node.checked = !!v;
      else node.value = v;
      const out = s.querySelector(`[data-out="${node.dataset.set}"]`);
      if (out) out.textContent = node.type === 'range' && Number(v) <= 1 ? `${Math.round(v * 100)}%` : v;
    });
    // Free-flight defaults follow the saved weather.
    if (this.freeControls && settings.weather) {
      this.freeControls.time.value = settings.weather.time;
      this.freeControls.cond.value = settings.weather.condition;
      this.freeControls.wind.value = settings.weather.windSpeedKts;
      this.freeControls.dir.value = Math.round(settings.weather.windDirDeg / 10) * 10;
      this.refreshFree();
    }
  }

  syncProgress(progress) {
    this._lastProgress = progress;
    const stats = this.screens.main.querySelector('[data-stats]');
    const done = Object.values(progress.missions).filter((m) => m.complete).length;
    const best = progress.bestLanding;
    stats.innerHTML = `
      <span><b>${done}</b>/${MISSIONS.filter((m) => !Prog.needsPasscode(this.prog, m)).length} missions</span>
      <span><b>${progress.landings}</b> landings</span>
      ${best ? `<span>Best landing <b>${best.score}</b>/100</span>` : '<span>No landings yet</span>'}
      ${progress.tutorialComplete ? '<span class="ok">Flight school ✓</span>' : ''}
    `;
    for (const m of MISSIONS) {
      const node = this.screens.missions.querySelector(`[data-best="${m.id}"]`);
      const rec = progress.missions[m.id];
      if (node) {
        node.innerHTML = rec && rec.complete
          ? `<span class="ok">Completed ✓</span> best ${rec.bestScore}/100`
          : 'Not flown yet';
      }
    }
  }

  /** Reflect the mute state on the start-screen button. */
  syncSound(muted) {
    const btn = this.screens.main.querySelector('[data-sound]');
    if (!btn) return;
    btn.textContent = muted ? '🔇 Sound is off — turn it on' : '🔊 Sound is on — turn it off';
    btn.classList.toggle('is-live', !muted);
  }

  showInstall(canInstall) {
    const btn = this.screens.main.querySelector('[data-install]');
    btn.hidden = !canInstall;
  }

  setInstalled() {
    const btn = this.screens.main.querySelector('[data-install]');
    btn.hidden = false;
    btn.textContent = '✓ Installed — playable offline';
    btn.disabled = true;
  }

  setZipAvailable(ok) {
    const a = this.screens.main.querySelector('[data-zip]');
    if (!ok) a.remove();
  }

  updateFps(fps) {
    const n = this.screens.settings.querySelector('[data-fps]');
    if (n) n.textContent = fps;
  }

  setPauseInfo(html) {
    this.screens.pause.querySelector('[data-pause-info]').innerHTML = html;
  }

  showDebrief({ title, kind, body, actions }) {
    const s = this.screens.debrief;
    s.querySelector('[data-title]').textContent = title;
    s.querySelector('[data-title]').className = `debrief-title is-${kind}`;
    s.querySelector('[data-body]').innerHTML = body;
    const host = s.querySelector('[data-actions]');
    host.innerHTML = '';
    for (const a of actions) {
      const b = document.createElement('button');
      b.textContent = a.label;
      if (a.primary) b.className = 'primary';
      b.addEventListener('click', a.onClick);
      host.appendChild(b);
    }
    this.show('debrief');
  }

  show(name) {
    this.layer.hidden = false;
    for (const key in this.screens) this.screens[key].hidden = key !== name;
    this.current = name;
    if (name === 'settings') this.renderKeymap();
    // Repaint the hub and the mission gate on open, so they are right whatever
    // changed them — a code, a flight, a passcode entered somewhere else.
    if (name === 'more') this.syncMore && this.syncMore();
    if (name === 'missions') this.syncMissionLocks && this.syncMissionLocks();
    if (name === 'pause') this.syncFreeLook();
    if (name !== 'settings') this.settingsReturn = null;
    // Move focus for keyboard users.
    const focusable = this.screens[name].querySelector('button, select, input, a');
    if (focusable) setTimeout(() => focusable.focus({ preventScroll: true }), 30);
  }



  /**
   * Draw the hand-inked frames for whatever is on screen. Called on every
   * screen change because the shapes are sized to their elements, and an
   * element that was hidden has no size to measure.
   */
  /** Show whether free look is on, on the pause-menu button. */
  syncFreeLook(on) {
    const btn = this.root.querySelector('[data-freelook]');
    if (!btn) return;
    const state = on === undefined ? this._freeLook : !!on;
    this._freeLook = state;
    btn.textContent = `Free look: ${state ? 'on' : 'off'}`;
    btn.classList.toggle('is-live', state);
  }



  hide() {
    this.layer.hidden = true;
    this.current = null;
    for (const key in this.screens) this.screens[key].hidden = true;
    // Hand the keyboard back to the aeroplane. A slider or dropdown that keeps
    // focus after the menu closes swallows key presses meant for flying.
    const el = document.activeElement;
    if (el && el !== document.body && this.root.contains(el) && el.blur) el.blur();
  }

  get isOpen() {
    return !this.layer.hidden;
  }
}
