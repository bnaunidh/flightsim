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
import { isOnAnyRunway, MAP, AIRPORT } from '../world/terrain.js';
import { UNITS } from '../aircraft/physics.js';

const ft = (m) => m * UNITS.FT;

function windCall(weather) {
  const dir = String(Math.round(weather.windDirDeg / 10) * 10).padStart(3, '0');
  const digits = dir.split('').join(' ');
  return `wind ${digits} at ${Math.round(weather.windSpeedKts)}`;
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
  get callsign() {
    const t = this.sim.aircraftType;
    return (t && t.callsign) || `${this.callsign}`;
  }

  /**
   * Which field. "${this.field} Tower" on the volcano, on the air base and at San
   * Francisco was the same class of mistake as the callsign.
   */
  get field() {
    return (MAP && MAP.name ? String(MAP.name).split(' ')[0] : 'Kestrel');
  }

  /** "zero nine", "two seven", from the runway this map actually has. */
  get runwayCall() {
    const deg = (AIRPORT && AIRPORT.headingDeg) || 90;
    const n = Math.round(((deg % 360) + 360) % 360 / 10) || 36;
    const words = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
    return String(n).padStart(2, '0').split('').map((d) => words[Number(d)]).join(' ');
  }

  reset() {
    this.said = {};
    this.cool = 0;
    this.landingCall = 0;
    this.weatherCall = 0;
    this.wasAirborne = false;
    this.lastCondition = null;
  }

  once(key) {
    if (this.said[key]) return false;
    this.said[key] = true;
    return true;
  }

  say(text, voice = 'tower', urgency = 0) {
    if (this.cool > 0) return false;
    this.sim.speak(text, voice, urgency);
    this.cool = 3.2 + text.length * 0.035;
    return true;
  }

  update(dt) {
    const sim = this.sim;
    const ac = sim.aircraft;
    const w = sim.weather;
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
    const lined =
      isOnAnyRunway(ac.pos.x, ac.pos.z, 12) &&
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
    }

    // Joining final: within 6 km, west of the field, below 2,000 ft, pointing east.
    const toTouchdown = ac.pos.distanceTo(RUNWAY.touchdown);
    const headingOk = Math.abs(((ac.heading - 90 + 540) % 360) - 180) < 45;
    if (
      !ac.onGround &&
      ac.pos.x < RUNWAY.touchdown.x &&
      toTouchdown < 6000 &&
      ft(ac.alt) < 2200 &&
      headingOk &&
      this.landingCall <= 0 &&
      this.once('final')
    ) {
      this.say(
        `${this.callsign}, cleared to land runway ${this.runwayCall}, ${windCall(w)}.`,
        'tower'
      );
      this.landingCall = 25;
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

    // Weather changes.
    if (this.lastCondition && this.lastCondition !== w.condition && this.weatherCall <= 0) {
      const lines = {
        stormy: `All aircraft, ${this.field} Tower. Thunderstorm over the field, severe turbulence and wind shear. Use extreme caution.`,
        rainy: `All aircraft, ${this.field} Tower. Rain moving through, the runway is wet and braking may be poor.`,
        cloudy: `All aircraft, ${this.field} Tower. Cloud base is coming down, visibility reducing.`,
        clear: `All aircraft, ${this.field} Tower. Weather is clearing nicely, visibility good.`,
      };
      this.say(lines[w.condition] || lines.clear, 'tower', w.condition === 'stormy' ? 1 : 0);
      this.weatherCall = 30;
    }
    this.lastCondition = w.condition;

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
    if (!grade.onRunway) {
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
    this.said.shortfinal = false;
    this.said.airborne = false;
    this.said.clearance = false;
  }
}
