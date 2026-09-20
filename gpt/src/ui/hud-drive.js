/**
 * The driving HUD — Island Courier.
 *
 * A mode on top of the existing HUD, not a second HUD. Everything an aeroplane
 * needs is still built and still works; this borrows the panels that are on
 * screen anyway, hides the instruments a van does not have, and adds the three
 * things a courier does have: what is under the wheels, how long is left, and
 * what state the load is in.
 *
 * WHY IT IS A SEPARATE FILE AND EDITS NOTHING IN hud.js
 * Hud.build() is one 400-line method that four other people are working in this
 * week. Every node this module needs is already public on the Hud instance —
 * speedValue, altValue, hdgValue, objective, objectiveClock, throttleBar, the
 * chips — so the drive mode reaches for those and adds three small elements of
 * its own. Nothing in hud.js changes. That also means a merge cannot
 * half-apply this: either the file is imported and driving has a HUD, or it is
 * not and driving looks exactly as it does today.
 *
 * WHAT IT REPLACES, AND WHY
 * hud.setVehicle() (hud.js:695) put the distance travelled where the altimeter
 * was. Distance travelled is a fact nobody acts on — you cannot steer with it,
 * you cannot lose with it. In its place is the distance still to run, which is
 * the number you actually want when a clock is going down, and it falls back to
 * the trip distance when there is no job on. setVehicle is left in place for
 * anything still calling it; once main.js goes through this module it is dead
 * code and can be deleted by whoever owns hud.js.
 *
 * THE THREE NUMBERS
 *   speed          big, km/h, with the surface named underneath it. The surface
 *                  word is why you just slid, and it is one text node.
 *   the clock       top centre, counting down, amber then red, ticking in the
 *                  last five seconds. It reuses the mission clock element, so
 *                  the game has one clock rather than two that disagree.
 *   cargo condition five pips beside the clock. One goes out per knock. This is
 *                  the only instrument here that is genuinely new.
 *
 * And the one instruction: a next-turn chevron, bottom centre, big. A
 * ten-year-old cannot read a minimap and steer at the same time. They can read
 * one arrow.
 *
 * Every write is guarded against its own last value. The HUD is repainted sixty
 * times a second and writing the same string into the same node sixty times a
 * second is how a panel like this ends up costing more than the island behind
 * it. That is the rule the rest of hud.js already follows.
 */

const el = (tag, cls, html) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html !== undefined) n.innerHTML = html;
  return n;
};

/**
 * Surfaces, in the words used on screen.
 *
 * The grip numbers live with the physics, not here — this is only the label and
 * the colour, so that a change to how slippery gravel is does not need a change
 * to the HUD. The order is best grip to worst, which is also the order the
 * colours run from calm to hot.
 */
export const SURFACE_WORDS = {
  tarmac: 'tarmac',
  road: 'tarmac',
  apron: 'tarmac',
  runway: 'tarmac',
  gravel: 'gravel',
  track: 'gravel',
  grass: 'grass',
  sand: 'sand',
  water: 'water',
};

/* ------------------------------------------------------------------ turns */

/**
 * Where the next turn is, walked off the route the delivery is following.
 *
 * The chevron is the single most important element on the driving screen and it
 * needs exactly one thing: the polyline the job is routed along. Give it the
 * road graph's route (an array of {x, z} in world metres), the car's position
 * and its heading, and it answers "left in 200 metres" — which is an
 * instruction a child can act on, unlike a blue line on a map they are not
 * looking at.
 *
 * It keeps its own index into the route and only searches a window around it,
 * so the cost does not grow with the length of the route. A fresh tracker, or
 * one whose car has been picked out of the sea and put back on the road
 * somewhere else, re-finds itself with `reset()`.
 */
export class RouteTracker {
  constructor(route = []) {
    this.setRoute(route);
  }

  setRoute(route) {
    this.route = Array.isArray(route) ? route : [];
    this.reset();
  }

  reset() {
    this.i = 0;
    this.searchAll = true;
  }

  /**
   * @param {{x:number,z:number}} pos    where the car is
   * @param {number} headingDeg          where it is pointing, compass degrees
   * @returns {{dir:string,label:string,distanceM:number,angleDeg:number,remainingM:number}|null}
   */
  next(pos, headingDeg, { turnDeg = 25, lookaheadM = 1600 } = {}) {
    const r = this.route;
    if (!r || r.length < 2) return null;

    /*
     * Find the segment we are on. After the first frame this only looks a
     * handful of segments either side of where we were, because a car at 30 m/s
     * moves under three metres between frames and cannot have jumped halfway
     * round the island. The full sweep is kept for the first frame and for
     * after a recovery, where it really has.
     */
    const from = this.searchAll ? 0 : Math.max(0, this.i - 6);
    const to = this.searchAll ? r.length - 1 : Math.min(r.length - 1, this.i + 24);
    let best = from;
    let bestD = Infinity;
    let bestT = 0;
    for (let k = from; k < to; k++) {
      const ax = r[k].x, az = r[k].z;
      const bx = r[k + 1].x, bz = r[k + 1].z;
      const ex = bx - ax, ez = bz - az;
      const len2 = ex * ex + ez * ez || 1e-6;
      const t = Math.max(0, Math.min(1, ((pos.x - ax) * ex + (pos.z - az) * ez) / len2));
      const px = ax + ex * t, pz = az + ez * t;
      const d = (pos.x - px) * (pos.x - px) + (pos.z - pz) * (pos.z - pz);
      if (d < bestD) { bestD = d; best = k; bestT = t; }
    }
    this.i = best;
    this.searchAll = false;

    // Distance from here to the far end of the segment we are on, then whole
    // segments after it.
    const seg = (k) => Math.hypot(r[k + 1].x - r[k].x, r[k + 1].z - r[k].z);
    const bearing = (k) =>
      (Math.atan2(r[k + 1].x - r[k].x, -(r[k + 1].z - r[k].z)) * 180) / Math.PI;

    let walked = seg(best) * (1 - bestT);
    let remaining = walked;
    for (let k = best + 1; k < r.length - 1; k++) remaining += seg(k);

    // Arriving: close enough that the next instruction is "stop", not "turn".
    if (remaining < 45) {
      return { dir: 'arrive', label: 'ARRIVING', distanceM: remaining, angleDeg: 0, remainingM: remaining };
    }

    let prev = bearing(best);
    for (let k = best + 1; k < r.length - 1 && walked < lookaheadM; k++) {
      const b = bearing(k);
      const turn = ((b - prev + 540) % 360) - 180;
      if (Math.abs(turn) >= turnDeg) {
        const dir = Math.abs(turn) > 150 ? 'uturn' : turn > 0 ? 'right' : 'left';
        return {
          dir,
          label: dir === 'uturn' ? 'TURN AROUND' : dir.toUpperCase(),
          distanceM: walked,
          angleDeg: turn,
          remainingM: remaining,
        };
      }
      prev = b;
      walked += seg(k);
    }

    // Nothing to do for a while. Say how far the straight runs, because "1.4 km
    // of nothing" is itself information: it is when you use the throttle.
    return { dir: 'straight', label: 'STRAIGHT ON', distanceM: Math.min(walked, remaining), angleDeg: 0, remainingM: remaining };
  }
}

/* -------------------------------------------------------------- the mode */

export class DriveHud {
  /**
   * @param {import('./hud.js').Hud} hud the live HUD, already built
   */
  constructor(hud) {
    this.hud = hud;
    this.active = false;
    this.last = {};
    this.audio = null;
    this.tracker = new RouteTracker();
    this.build();
  }

  /* ---------------------------------------------------------------- build */

  build() {
    const hud = this.hud;
    const wrap = hud.wrap;

    /*
     * Handles on the bits of the existing strip this mode rewrites.
     *
     * Looked up once and cached, and every one of them is allowed to be
     * missing: if somebody reorganises the left panel, driving should lose a
     * label, not throw inside the frame loop and take the whole game with it.
     */
    const rowOf = (node) => (node && node.closest ? node.closest('.hud-row') : null);
    this.speedRow = rowOf(hud.speedValue);
    this.distRow = rowOf(hud.altValue);
    this.vsRow = rowOf(hud.vsValue);
    this.hdgRow = rowOf(hud.hdgValue);
    this.speedLabel = this.speedRow && this.speedRow.querySelector('.hud-label');
    this.distLabel = this.distRow && this.distRow.querySelector('.hud-label');
    this.speedUnit = hud.speedValue && hud.speedValue.parentElement.querySelector('.hud-unit');
    this.distUnit = hud.altValue && hud.altValue.parentElement.querySelector('.hud-unit');
    this.keyhint = wrap.querySelector('.hud-keyhint');
    this.keyhintFlight = this.keyhint ? this.keyhint.innerHTML : '';
    this.speedLabelFlight = this.speedLabel ? this.speedLabel.textContent : 'Airspeed';
    this.distLabelFlight = this.distLabel ? this.distLabel.textContent : 'Altitude';

    /*
     * The cargo pips, beside the clock.
     *
     * Five divs. This is the whole teaching device of the game: go fast and you
     * make the clock, go fast and the load takes knocks, and a load delivered
     * whole pays double. Nothing on screen explains that and nothing should —
     * the pips going out while the clock is still green is the lesson, and a
     * child works it out in about four minutes.
     *
     * It is inserted into the objective panel between the clock and the
     * objective text, which is a fixed sibling order the CSS lays out as a
     * two-column row. Inserted rather than appended so the order holds however
     * many times we enter and leave.
     */
    this.cargo = el('div', 'hud-cargo');
    this.cargo.hidden = true;
    this.cargoPips = [];
    const pipHost = el('div', 'hud-cargo-pips');
    for (let i = 0; i < 5; i++) {
      const p = el('i', 'hud-cargo-pip');
      this.cargoPips.push(p);
      pipHost.appendChild(p);
    }
    this.cargoLabel = el('div', 'hud-cargo-label', 'LOAD');
    this.cargo.appendChild(this.cargoLabel);
    this.cargo.appendChild(pipHost);
    if (hud.objective && hud.objectiveText) {
      hud.objective.insertBefore(this.cargo, hud.objectiveText);
    }

    /*
     * The next-turn chevron.
     *
     * Bottom centre, big, and the only thing on the screen a child has to read
     * while moving. An arrow and a distance: "LEFT 200 m". It is deliberately
     * not near the minimap and not in a panel with anything else in it.
     */
    this.chev = el('div', 'hud-chevron');
    this.chev.hidden = true;
    this.chevArrow = el('div', 'hud-chevron-arrow', '&#8593;');
    this.chevWords = el('div', 'hud-chevron-words');
    this.chevWhat = el('div', 'hud-chevron-what', '');
    this.chevDist = el('div', 'hud-chevron-dist', '');
    this.chevWords.appendChild(this.chevWhat);
    this.chevWords.appendChild(this.chevDist);
    this.chev.appendChild(this.chevArrow);
    this.chev.appendChild(this.chevWords);
    wrap.appendChild(this.chev);
  }

  /* ---------------------------------------------------------------- enter */

  /**
   * Put the HUD into driving.
   *
   * @param {object} spec        the vehicle spec from vehicles/surface.js
   * @param {object} [opts]
   * @param {object} [opts.audio] the audio front end, for the clock tick
   */
  enter(spec, { audio = null } = {}) {
    const hud = this.hud;
    this.active = true;
    this.audio = audio;
    this.spec = spec || { kind: 'car' };
    this.isBoat = this.spec.kind === 'boat';
    this.last = {};
    this.tracker.reset();

    /*
     * is-vehicle as well as is-drive. hud.clearVehicle() refuses to do anything
     * unless hud.inVehicle is true, and it carries the fix for the bug where
     * one trip in the boat left the altimeter reading kilometres for the rest
     * of the session. Setting the flag here is what keeps that fix working.
     */
    hud.inVehicle = true;
    hud.wrap.classList.add('is-vehicle', 'is-drive');
    hud.wrap.classList.toggle('is-drive-boat', this.isBoat);
    hud.wrap.classList.toggle('is-drive-car', !this.isBoat);

    if (this.speedLabel) this.speedLabel.textContent = 'Speed';
    if (this.speedUnit) this.speedUnit.textContent = this.isBoat ? 'kt' : 'km/h';
    if (this.distLabel) this.distLabel.textContent = 'Trip';
    if (this.distUnit) this.distUnit.textContent = 'km';
    if (this.vsRow) this.vsRow.hidden = true;          // a van has no vertical speed
    if (hud.fuelBar) hud.fuelBar.root.hidden = true;   // and no fuel gauge worth reading
    if (hud.gearChip) hud.gearChip.style.display = 'none';
    if (hud.flapChip) hud.flapChip.style.display = 'none';
    if (hud.trimChip) hud.trimChip.style.display = 'none';
    if (hud.apChip) hud.apChip.style.display = 'none';
    if (hud.damagePanel) hud.damagePanel.hidden = true;
    if (hud.waypoint) hud.waypoint.style.display = 'none';
    if (hud.stallWarn) hud.stallWarn.style.display = 'none';
    if (hud.papiHint) hud.papiHint.style.display = 'none';
    if (this.keyhint) {
      this.keyhint.innerHTML = this.isBoat
        ? 'Throttle: <kbd>Shift</kbd>/<kbd>&uarr;</kbd> · Steer: <kbd>A</kbd><kbd>D</kbd> · Slow: <kbd>Ctrl</kbd>/<kbd>&darr;</kbd>'
        : 'Go: <kbd>Shift</kbd>/<kbd>&uarr;</kbd> · Steer: <kbd>A</kbd><kbd>D</kbd> · Brake: <kbd>Space</kbd> · Map: <kbd>J</kbd>';
    }
    /*
     * The clock element is shared with flying, and both sides cache the last
     * value they wrote into hud.lastValues.clock. Clearing it here means the
     * first frame of a job always paints, instead of being swallowed because a
     * flight happened to end on the same number of seconds.
     */
    hud.lastValues.clock = null;
    this.setClock(null);
    this.setCargo(null);
    this.setTurn(null);
  }

  /* ----------------------------------------------------------------- exit */

  /**
   * Back to the aeroplane. Everything enter() touched goes back, including the
   * two unit labels, which is what hud.clearVehicle() is for.
   */
  exit() {
    if (!this.active) return;
    const hud = this.hud;
    this.active = false;
    this.audio = null;
    hud.wrap.classList.remove('is-drive', 'is-drive-boat', 'is-drive-car');
    if (this.speedLabel) this.speedLabel.textContent = this.speedLabelFlight;
    if (this.distLabel) this.distLabel.textContent = this.distLabelFlight;
    if (this.vsRow) this.vsRow.hidden = false;
    if (hud.fuelBar) hud.fuelBar.root.hidden = false;
    if (hud.gearChip) hud.gearChip.style.display = '';
    if (hud.flapChip) hud.flapChip.style.display = '';
    if (hud.apChip) hud.apChip.style.display = '';
    if (this.keyhint) this.keyhint.innerHTML = this.keyhintFlight;
    this.setClock(null);
    this.setCargo(null);
    this.setTurn(null);
    hud.lastValues.clock = null;
    hud.clearVehicle();
  }

  /* -------------------------------------------------------------- setters */

  /** The job strip. Exactly hud.setObjective, named for what it is here. */
  setJob(title, text) {
    this.hud.setObjective(title || 'Island Roads', text || 'No job on. Take one at the depot, or just drive.');
  }

  /**
   * Seconds left, or null for no clock at all.
   *
   * Amber under thirty, red under ten, and an audible tick in the last five.
   * The flight side of the same element turns amber at a minute; a delivery is
   * a shorter thing and a minute of amber is a minute of ignoring it.
   */
  setClock(secondsLeft) {
    const node = this.hud.objectiveClock;
    if (!node) return;
    if (secondsLeft == null) {
      if (!node.hidden) node.hidden = true;
      node.classList.remove('is-warn', 'is-bad');
      this.last.clock = null;
      this._tickedAt = -1;
      return;
    }
    const left = Math.max(0, Math.ceil(secondsLeft));
    if (left <= 5 && left !== this._tickedAt) {
      this._tickedAt = left;
      this.tick(left === 0);
    }
    if (this.last.clock === left) return;
    this.last.clock = left;
    this.hud.lastValues.clock = null;
    node.hidden = false;
    const m = Math.floor(left / 60);
    node.textContent = `${m}:${String(left % 60).padStart(2, '0')}`;
    node.classList.toggle('is-warn', left <= 30 && left > 10);
    node.classList.toggle('is-bad', left <= 10);
  }

  /** One short blip a second in the last five. Silent if audio is not up. */
  tick(last = false) {
    const a = this.audio;
    if (!a || !a.available || !a.mixer) return;
    try {
      a.mixer.tone({
        bus: 'alerts',
        freq: last ? 660 : 1180,
        duration: last ? 0.22 : 0.05,
        gain: 0.13,
        type: 'square',
      });
    } catch (e) {
      // A HUD must never be the reason a frame throws. If the mixer is not
      // ready, the clock is still perfectly readable.
    }
  }

  /**
   * How the load is doing. Pass null to hide it — free driving has no cargo.
   *
   * @param {number|null} pips  how many are still lit
   * @param {number} [max]
   * @param {string} [label]    what is in the back, e.g. CHILLED VACCINE
   */
  setCargo(pips, max = 5, label = 'LOAD') {
    if (pips == null) {
      if (!this.cargo.hidden) this.cargo.hidden = true;
      this.last.cargo = null;
      return;
    }
    const n = Math.max(0, Math.min(this.cargoPips.length, Math.round(pips)));
    const cap = Math.max(1, Math.min(this.cargoPips.length, Math.round(max)));
    const key = `${n}/${cap}/${label}`;
    if (this.last.cargo === key) return;
    this.last.cargo = key;
    this.cargo.hidden = false;
    if (this.cargoLabel.textContent !== label) this.cargoLabel.textContent = label;
    for (let i = 0; i < this.cargoPips.length; i++) {
      const p = this.cargoPips[i];
      const state = i >= cap ? 'none' : i < n ? 'lit' : 'out';
      if (p.dataset.state === state) continue;
      p.dataset.state = state;
      p.hidden = state === 'none';
      p.classList.toggle('is-out', state === 'out');
    }
    // Amber from two pips down: the point where "floor it" stops paying.
    this.cargo.classList.toggle('is-care', n <= 2 && n > 0);
    this.cargo.classList.toggle('is-ruined', n === 0);
  }

  /**
   * A knock. Called by the jobs code when the load takes one, so the pip goes
   * out with a shake rather than silently becoming a smaller number.
   */
  cargoHit() {
    this.cargo.classList.remove('is-hit');
    void this.cargo.offsetWidth;
    this.cargo.classList.add('is-hit');
  }

  /**
   * The next instruction. Pass null when there is no route — free driving shows
   * no chevron at all rather than an arrow pointing nowhere.
   *
   * @param {{dir:string,label:string,distanceM:number,angleDeg:number}|null} turn
   */
  setTurn(turn) {
    if (!turn) {
      if (!this.chev.hidden) this.chev.hidden = true;
      this.last.turn = null;
      return;
    }
    const d = turn.distanceM || 0;
    // Round the way the number is useful: to the nearest 10 m when it is far
    // enough away to plan, to the nearest 5 m when you are about to do it.
    const distText =
      turn.dir === 'arrive'
        ? `${Math.round(d / 5) * 5} m`
        : d > 1200
          ? `${(d / 1000).toFixed(1)} km`
          : d > 150
            ? `${Math.round(d / 10) * 10} m`
            : `${Math.round(d / 5) * 5} m`;
    const key = `${turn.dir}|${turn.label}|${distText}`;
    if (this.last.turn === key) return;
    this.last.turn = key;
    this.chev.hidden = false;
    const glyph =
      turn.dir === 'left' ? '&#8624;'
        : turn.dir === 'right' ? '&#8625;'
          : turn.dir === 'uturn' ? '&#8634;'
            : turn.dir === 'arrive' ? '&#9679;'
              : '&#8593;';
    if (this.chevArrow.innerHTML !== glyph) this.chevArrow.innerHTML = glyph;
    this.chevWhat.textContent = turn.label || '';
    this.chevDist.textContent = turn.dir === 'arrive' ? 'drop it here' : distText;
    this.chev.dataset.dir = turn.dir;
    // Close now: the chevron gets bigger and warms up. Distance, not time, so
    // it reads the same whether you are creeping or flying.
    this.chev.classList.toggle('is-near', d < 90 || turn.dir === 'arrive');
  }

  /* --------------------------------------------------------------- frame */

  /**
   * One frame of driving.
   *
   * Everything here is optional except `readouts`, on purpose: the roads and
   * the jobs land after this does, and until they do this still gives a correct
   * speed, surface and heading with no clock, no pips and no chevron. A HUD
   * that needs three other people's work before it shows anything is a HUD that
   * cannot be tested.
   *
   * @param {number} dt
   * @param {object} s
   * @param {object} s.readouts  SurfaceVehicle.readouts()
   * @param {{kind:string}} [s.surface]   what is under the wheels right now
   * @param {{name:string,toGoM:number}} [s.job]
   * @param {number} [s.clock]   seconds left, or null
   * @param {{pips:number,max:number,label:string}} [s.cargo]
   * @param {object} [s.turn]    from RouteTracker.next(), or null
   */
  update(dt, s = {}) {
    const hud = this.hud;
    const r = s.readouts || {};
    if (!this.active) return;

    /* -- speed, big, with the surface underneath it -------------------- */
    const fast = this.isBoat ? Math.round(r.speedKts || 0) : Math.round(r.speedKph || 0);
    if (this.last.speed !== fast) {
      this.last.speed = fast;
      hud.speedValue.textContent = String(fast);
    }
    const surfKind = (s.surface && s.surface.kind) || null;
    const word = this.isBoat
      ? (fast < 1 ? 'stopped' : fast < 8 ? 'idling along' : fast < 25 ? 'making way' : 'on the plane')
      : (SURFACE_WORDS[surfKind] || (fast < 1 ? 'stopped' : 'off road'));
    if (this.last.word !== word) {
      this.last.word = word;
      hud.speedWord.textContent = word;
      hud.speedWord.dataset.surface = surfKind || '';
    }

    /* -- the second row: how far there is left to go -------------------
     *
     * The old drive HUD put the distance travelled here, which is a number you
     * cannot act on. With a job on, this is the distance still to run, which is
     * the number the clock is about. With no job it falls back to the trip,
     * because something has to be there and a blank row looks broken.
     */
    const job = s.job || null;
    const toGo = job && job.toGoM != null ? job.toGoM : null;
    const wantLabel = toGo != null ? 'To go' : 'Trip';
    if (this.last.distLabel !== wantLabel) {
      this.last.distLabel = wantLabel;
      if (this.distLabel) this.distLabel.textContent = wantLabel;
    }
    const metres = toGo != null ? toGo : (r.distanceM || 0);
    const km = metres / 1000;
    const shown = km < 10 ? km.toFixed(1) : String(Math.round(km));
    if (this.last.dist !== shown) {
      this.last.dist = shown;
      hud.altValue.textContent = shown;
    }
    const dWord = toGo != null ? (job.name || 'to the drop') : 'travelled';
    if (this.last.distWord !== dWord) {
      this.last.distWord = dWord;
      hud.altWord.textContent = dWord;
    }

    /* -- heading, unchanged from the aeroplane ------------------------- */
    const h = Math.round(r.heading || 0);
    if (this.last.hdg !== h) {
      this.last.hdg = h;
      hud.hdgValue.textContent = String(h).padStart(3, '0');
      const dirs = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
      hud.hdgWord.textContent = dirs[Math.round(h / 45) % 8];
    }

    /* -- throttle bar and the brake chip, both already on screen ------- */
    const thr = Math.round((r.throttle || 0) * 100);
    if (this.last.thr !== thr) {
      this.last.thr = thr;
      hud.throttleBar.fill.style.width = `${thr}%`;
      hud.throttleBar.val.textContent = `${thr}%`;
    }
    if (hud.brakeChip) hud.brakeChip.classList.toggle('is-on', (r.brakes || 0) > 0.4);

    /* -- the three courier instruments --------------------------------- */
    this.setClock(s.clock == null ? null : s.clock);
    if (s.cargo) this.setCargo(s.cargo.pips, s.cargo.max || 5, s.cargo.label || 'LOAD');
    else this.setCargo(null);
    this.setTurn(s.turn || null);

    this.tickOverlays(dt);
  }

  /**
   * Age the toasts, the banner and the subtitle.
   *
   * These are ticked inside Hud.update(), and main.js returns from its drive
   * branch long before Hud.update() is reached — so today a toast raised while
   * driving never expires. Take the boat out, run aground, and "You ran aground
   * — press Esc to go back" stays welded to the screen for the rest of the
   * session, including through every flight afterwards. Ticking them here is
   * the smallest fix that does not need an edit inside hud.js; if that method
   * ever grows a public `updateOverlays(dt)`, this should call it instead of
   * repeating it.
   */
  tickOverlays(dt) {
    const hud = this.hud;
    if (hud.subtitleTimer > 0) {
      hud.subtitleTimer -= dt;
      if (hud.subtitleTimer <= 0) hud.subtitle.style.display = 'none';
    }
    if (hud.bannerTimer > 0) {
      hud.bannerTimer -= dt;
      if (hud.bannerTimer <= 0) hud.banner.style.display = 'none';
    }
    for (let i = hud.toasts.length - 1; i >= 0; i--) {
      hud.toasts[i].life -= dt;
      if (hud.toasts[i].life > 0) continue;
      const node = hud.toasts[i].node;
      node.classList.add('is-out');
      setTimeout(() => node.remove(), 400);
      hud.toasts.splice(i, 1);
    }
  }
}
