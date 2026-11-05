/**
 * ATC director — decides when the radio should say something.
 *
 * It watches the flight for the events a real controller would react to:
 * a request for take-off, the clearance, the climb-out, joining final,
 * touchdown, weather warnings, low fuel and emergencies. Everything has a
 * cooldown so the frequency never gets spammed, and mission scripts always take
 * priority over ambient calls.
 */

import { RUNWAY } from '../world/airport.js';
import { isOnAnyRunway, isOnRunway, MAP, AIRPORT } from '../world/terrain.js';
import { UNITS } from '../aircraft/physics.js';
import { setRadioField } from '../audio/atc.js';
import { navField, thresholdOf, runwayWords, onFieldRunway } from '../world/navfield.js';
import { keyNames } from '../flight/input.js';

/** "Report your intentions" has been followed by how, this session. (resetAtcHowSaid: a test's.) */
let howSaid = false;
export function resetAtcHowSaid() {
  howSaid = false;
}

const ft = (m) => m * UNITS.FT;

function windCall(weather) {
  const dir = String(Math.round(weather.windDirDeg / 10) * 10).padStart(3, '0');
  const digits = dir.split('').join(' ');
  const kts = Math.round(weather.windSpeedKts);
  // The rolled sky (world/wx.js) has gusts and, some days, poor visibility: the tower says both.
  if (weather.isRandom && weather.describe) {
    const d = weather.describe();
    return `${d.windRadio}${d.vis ? `, ${d.vis}` : ''}`;
  }
  return `wind ${digits} at ${kts}`;
}

export class AtcDirector {
  constructor(sim) {
    this.sim = sim;
    this.reset();
  }

  /**
   * Who the controller is talking to.
   *
   * Every aeroplane in types.js has carried a `callsign` since the day it was
   * written, and nothing has ever read it: the tower called you "Skylark one
   * seven two" in fifteen places whether you were in the trainer, the airliner
   * or the bomber. Reading it at call time rather than caching it means
   * changing aeroplane mid-session changes what you are called, which is the
   * bug the class actually noticed.
   */
  /**
   * A mission's own radio (its def's `radio: { callsign, runway, field,
   * quiet: [...] }`): "Last Flight Out" is flown as "Reach two one" off an
   * ice strip facing west, and the generic calls were saying "Reach one
   * seven heavy ... runway zero nine" over its script. Null when no mission
   * says otherwise.
   */
  get missionRadio() {
    const r = this.sim.runner;
    const d = r && r.def;
    if (!d || !d.radio) return null;
    // Only while that mission is (or has just been) the flight: a def left on the runner after
    // the menu (status idle) must not keep calling the next free flight "Reach two one".
    if (r.status === 'idle') return null; // runner.js STATUS.IDLE
    return d.radio;
  }

  get callsign() {
    const mr = this.missionRadio;
    if (mr && mr.callsign) return mr.callsign;
    // In a game with friends everybody in a Skylark was "Skylark one seven two": there it is the player's username (multiplayer.js frame()).
    if (this.sim.mpCallsign) return this.sim.mpCallsign;
    const t = this.sim.aircraftType;
    return (t && t.callsign) || `${this.callsign}`;
  }

  /**
   * Which field. "${this.field} Tower" on the volcano, on the air base and at San
   * Francisco was the same class of mistake as the callsign.
   */
  get field() {
    const mr = this.missionRadio;
    if (mr && mr.field) return mr.field;
    // On the World Map, the field you are at (world/navfield.js).
    const nf = navField();
    if (nf) return nf.radio;
    return (MAP && MAP.name ? String(MAP.name).split(' ')[0] : 'Kestrel');
  }

  /** "zero nine", "two seven", from the runway this map actually has. */
  get runwayCall() {
    /*
     * A mission's `radio.runway` is the strip it DEPARTS from, so it holds
     * only until the aeroplane has flown. The landing calls (final, short
     * final) fire only on the field's own approach direction (a World Map
     * field's landing runway, runway 09 on every other map), so in the air
     * the runway is the field's — or "cleared to land runway two seven" went
     * out over a 09 approach at Caribou.
     */
    const mr = this.missionRadio;
    const ac0 = this.sim.aircraft;
    if (mr && mr.runway && !this.departed && !(ac0 && !ac0.onGround)) return mr.runway;
    const nf = navField();
    if (nf) return runwayWords(nf.dir);
    const deg = (AIRPORT && AIRPORT.headingDeg) || 90;
    const n = Math.round(((deg % 360) + 360) % 360 / 10) || 36;
    const words = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
    return String(n).padStart(2, '0').split('').map((d) => words[Number(d)]).join(' ');
  }

  reset() {
    /*
     * The field's name over the subtitles, now, not on the first update():
     * a call made while the flight starts (the stand start's "Gateway Ground,
     * you are on stand 11", features/spawns.js) went out under the last
     * map's label — "KESTREL GROUND" over Gateway's words.
     */
    this._radioField = this.field;
    setRadioField(this._radioField);
    this.said = {};
    this.cool = 0;
    this.landingCall = 0;
    this.weatherCall = 0;
    this.wasAirborne = false;
    // Off the ground at least once this flight (runwayCall: a mission's departure runway stops applying).
    this.departed = false;
    this.lastCondition = null;
  }

  /*
   * A call that has not been made yet, and can be made NOW. Every once() is
   * followed by say(), and say() is silent during the pause after the last
   * call (cool); marking the call made while it was suppressed lost it for
   * good — the take-off clearance most of all: open the throttle within a
   * few seconds of the ground's engine-start call and the tower never
   * cleared you (checker, wave 17b). So while the frequency is busy nothing
   * is marked, and the call goes out once the pause is over, if it still
   * applies.
   */
  once(key) {
    if (this.said[key]) return false;
    // A mission's script has these calls (`radio.quiet`): the generic ones stay off the air.
    const mr = this.missionRadio;
    if (mr && Array.isArray(mr.quiet) && mr.quiet.includes(key)) return false;
    if (this.cool > 0) return false;
    this.said[key] = true;
    return true;
  }

  /** Is one of the AI traffic's aeroplanes on the main runway, on the ground (sim.traffic: the traffic feature's published list)? */
  runwayBusy(sim) {
    const list = sim.traffic;
    if (!Array.isArray(list)) return false;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e && e.onGround && e.pos && typeof e.phase === 'string' && isOnRunway(e.pos.x, e.pos.z, 6)) return true;
    }
    return false;
  }

  say(text, voice = 'tower', urgency = 0) {
    if (this.cool > 0) return false;
    this.sim.speak(text, voice, urgency);
    this.cool = 3.2 + text.length * 0.035;
    return true;
  }

  update(dt) {
    /*
     * Keep the name over the subtitle in step with the name in the sentence.
     *
     * The voice labels are static strings that say Kestrel, so at Ironhead the
     * subtitle read "KESTREL GROUND" above the words "Nightjar zero two,
     * Ironhead Ground, runway zero nine" — two different fields in one call.
     * Set here because this is the one object that already knows which field
     * it is speaking for, and it is asked every frame anyway.
     */
    if (this._radioField !== this.field) {
      const was = this._radioField;
      this._radioField = this.field;
      setRadioField(this._radioField);
      // A handover between World Map fields: the next field's tower is a new
      // frequency, and its calls (the clearance, final) have not been made.
      const nf = navField();
      if (nf && was && nf.id !== this._navId) {
        this._navId = nf.id;
        for (const k of ['start', 'clearance', 'final', 'shortfinal']) this.said[k] = false;
        const ac0 = this.sim.aircraft;
        if (ac0 && !ac0.onGround && !ac0.crashed) {
          this.cool = 0;
          this.say(`${this.callsign}, contact ${nf.radio} Tower. ${nf.name}, runway ${runwayWords(nf.dir)}.`, 'approach');
        }
      }
    }
    const sim = this.sim;
    const ac = sim.aircraft;
    const w = sim.weather;
    if (ac && !ac.onGround && !ac.crashed) this.departed = true;
    this.cool -= dt;
    this.landingCall -= dt;
    this.weatherCall -= dt;

    if (ac.crashed) {
      if (this.once('crash')) {
        this.say(
          `${this.callsign}, ${this.field} Tower, we have lost sight of you. Emergency services are rolling. Stand by.`,
          'tower',
          1
        );
      }
      return;
    }

    // Down on the water: the rescue has the frequency (features/ditching.js).
    if (ac.ditched) return;

    // Engine start on the apron.
    if (ac.engineOn && this.once('start') && ac.onGround) {
      this.say(
        `${this.callsign}, ${this.field} Ground, runway ${this.runwayCall}, ${windCall(w)}. Taxi and hold.`,
        'ground'
      );
    }

    /*
     * Opening the throttle *lined up on a runway* reads as a take-off request.
     *
     * It used to be throttle alone, anywhere on the airfield. Taxiing needs
     * more than 45% to get a heavy aeroplane rolling at all, so the tower
     * cleared you for take-off while you were still trundling down a taxiway
     * with the runway a quarter of a mile away — which is both nonsense and,
     * for anyone learning, actively misleading about what a clearance means.
     *
     * Three conditions now: on a runway, pointing along it, and using real
     * power rather than taxi power.
     */
    const NF = navField();
    // Along the runway either way (09 or 27) on a named field; on 09 as always elsewhere.
    const offEast = NF ? Math.abs(((ac.readouts().heading - 90 + 540) % 360) - 180) : 0;
    const lined = NF
      ? onFieldRunway(NF, ac.pos.x, ac.pos.z, 12) && (offEast < 25 || offEast > 155)
      : isOnAnyRunway(ac.pos.x, ac.pos.z, 12) &&
        Math.abs(((ac.readouts().heading - RUNWAY.headingDeg + 540) % 360) - 180) < 25;
    if (ac.onGround && lined && ac.controls.throttle > 0.6 && this.once('clearance')) {
      this.say(
        `${this.callsign}, ${this.field} Tower, ${windCall(w)}, runway ${this.runwayCall}, cleared for take-off.`,
        'tower'
      );
    }

    // Airborne.
    if (!ac.onGround && ac.airborneTime > 4 && this.once('airborne')) {
      this.say(
        `${this.callsign}, radar contact, climb at your discretion and report your intentions.`,
        'approach'
      );
      /*
       * ...and, the first time, HOW. Tomm1z (8:25): "How do I even report? I
       * don't know how I do that." The radio key by name (Z, fn F8 on a
       * Mac: features/pilot-systems.js's atcRequest), or the RADIO button
       * on a touchscreen, once a session.
       */
      if (!howSaid) {
        howSaid = true;
        let names = [];
        try {
          names = keyNames('atcRequest', this.sim);
        } catch (e) {
          names = [];
        }
        const key = names.length ? names.slice(0, 2).join(' or ') : 'Z';
        const how = this.sim.touch ? `tap RADIO on the sheet (or press ${key})` : `press ${key} for the radio`;
        if (this.sim.hud && this.sim.hud.notify) this.sim.hud.notify(`To report your intentions: ${how}, then pick what you want to do`, 'info', 7);
      }
    }

    // Joining final: within 6 km, west of the field, below 2,000 ft, pointing east.
    // The aiming point and the way in: the named field's, landing into the wind, or runway 09.
    let toTouchdown;
    let headingOk;
    let shortSide;
    if (NF) {
      const t = thresholdOf(NF);
      toTouchdown = Math.hypot(ac.pos.x - t.touchX, ac.pos.y - NF.elev, ac.pos.z - NF.cz);
      headingOk = Math.abs(((ac.heading - (NF.dir > 0 ? 90 : 270) + 540) % 360) - 180) < 45;
      shortSide = NF.dir * (t.touchX - ac.pos.x) > 0;
    } else {
      toTouchdown = ac.pos.distanceTo(RUNWAY.touchdown);
      headingOk = Math.abs(((ac.heading - 90 + 540) % 360) - 180) < 45;
      shortSide = ac.pos.x < RUNWAY.touchdown.x;
    }
    if (
      !ac.onGround &&
      shortSide &&
      toTouchdown < 6000 &&
      ft(ac.alt) < 2200 &&
      headingOk &&
      this.landingCall <= 0
    ) {
      /*
       * Not "cleared to land" with an aeroplane on the runway. The AI traffic
       * (sim.traffic) leaves it for you when you are on final, but a Courier
       * backtracking to the far end takes a while to get off: until it has,
       * the tower says what a tower says — continue, and the runway will be
       * yours — and clears you once it is empty.
       */
      if (this.runwayBusy(sim)) {
        if (this.once('continue')) {
          this.say(`${this.callsign}, continue approach runway ${this.runwayCall}, traffic vacating. You're number one.`, 'tower');
          this.landingCall = 8;
        }
      } else if (this.once('final')) {
        this.say(
          `${this.callsign}, cleared to land runway ${this.runwayCall}, ${windCall(w)}.`,
          'tower'
        );
        this.landingCall = 25;
      }
    }

    // Short final courtesy call.
    if (!ac.onGround && toTouchdown < 1400 && ft(ac.agl) < 400 && headingOk && this.once('shortfinal')) {
      const cross = w.windDescription(90);
      this.say(
        cross.cross > 8
          ? `${this.callsign}, ${windCall(w)}, crosswind from the ${cross.side}. Runway ${this.runwayCall}, continue.`
          : `${this.callsign}, runway ${this.runwayCall}, continue. Looking good.`,
        'tower'
      );
    }

    // Weather changes — the weather in force, so the rolled sky's phases (world/wx.js) are called too.
    const cond = w.effectiveCondition || w.condition;
    if (this.lastCondition && this.lastCondition !== cond && this.weatherCall <= 0) {
      const lines = {
        stormy: `All aircraft, ${this.field} Tower. Thunderstorm over the field, severe turbulence and wind shear. Use extreme caution.`,
        rainy: `All aircraft, ${this.field} Tower. Rain moving through, the runway is wet and braking may be poor.`,
        cloudy: `All aircraft, ${this.field} Tower. Cloud base is coming down, visibility reducing.`,
        clear: `All aircraft, ${this.field} Tower. Weather is clearing nicely, visibility good.`,
      };
      // And the rolled sky's visibility, when it is poor ("visibility 3 km in mist").
      const d = w.isRandom && w.describe ? w.describe() : null;
      this.say((lines[cond] || lines.clear) + (d && d.vis ? ` Now ${d.vis}, ${d.windRadio}.` : ''), 'tower', cond === 'stormy' ? 1 : 0);
      this.weatherCall = 30;
    }
    this.lastCondition = cond;

    // Flying into cloud.
    if (sim.cloudImmersion > 0.55 && this.once('incloud')) {
      this.say(
        `${this.callsign}, you are entering cloud. Trust your instruments, keep the wings level.`,
        'approach'
      );
    }

    // Low fuel.
    if (ac.fuel / 160 < 0.12 && !ac.onGround && this.once('fuel')) {
      this.say(
        `${this.callsign}, say your fuel state. If you are low, we can give you a direct approach to runway ${this.runwayCall}.`,
        'tower',
        1
      );
    }

    // Low altitude alert away from the runway.
    if (
      !ac.onGround &&
      ft(ac.agl) < 260 &&
      toTouchdown > 3000 &&
      ac.vs < -3 &&
      this.once('lowalt')
    ) {
      this.say(`${this.callsign}, low altitude alert. Check your altitude immediately.`, 'approach', 1);
      // Allow this one to repeat after a while.
      setTimeout(() => (this.said.lowalt = false), 45000);
    }
  }

  /** Called from the touchdown event so the reply matches the landing. */
  onTouchdown(grade) {
    if (grade.crashed) return;
    let line;
    if (grade.water) {
      line = grade.quality === 'firm' || grade.quality === 'rough'
        ? `${this.callsign}, down on the water, a firm one. Say when you are clear of the boats.`
        : `${this.callsign}, nicely down on the water. Keep clear of the boats.`;
    } else if (!grade.onRunway) {
      line = `${this.callsign}, that was off the runway. Are you able to taxi? Say your condition.`;
    } else if (grade.quality === 'perfect') {
      line = `${this.callsign}, beautiful landing. Welcome back to ${this.field}, taxi to the apron.`;
    } else if (grade.quality === 'good') {
      line = `${this.callsign}, nice landing. Taxi to the apron when you are ready.`;
    } else if (grade.quality === 'firm') {
      line = `${this.callsign}, down safely. Firm one, but the wheels are round. Taxi to the apron.`;
    } else {
      line = `${this.callsign}, that woke everyone up. You are down safely, taxi to the apron.`;
    }
    this.cool = 0;
    this.say(line, 'tower');
    this.said.final = false;
    this.said.continue = false;
    this.said.shortfinal = false;
    this.said.airborne = false;
    this.said.clearance = false;
  }
}
