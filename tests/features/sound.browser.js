/**
 * Browser check for "turn off sound doesnt work".
 *
 * Three things let sound through after the player had turned it off:
 *
 *   - the start screen's button and Settings' "Mute everything" each kept
 *     their own idea of the state. The box was painted once at boot (sound
 *     starts off, so ticked); after the button turned sound on it still read
 *     ticked, and ticking it "again" unticked it and left the sound on. Muting
 *     from the box left the button offering "turn it off", which turned the
 *     sound back ON;
 *   - ATC on the device's speech voice is the one sound outside the mixer.
 *     Mute, or the ATC switch, silenced the master gain and the voice went on
 *     talking — every tower call, in every game;
 *   - a muted save started its master gain at full volume and faded it out
 *     only after the context was running, so each session began with a blip.
 *
 * NOTHING IS PLAYED OUT LOUD. The device's speech voice is replaced by a
 * recorder for the whole check, the game's own output is unplugged from the
 * speakers while the check turns sound on and off, and the spare mixer made
 * for the start-up test is unplugged and closed. The player's sound settings
 * are put back at the end, whatever happens.
 */

export const id = 'sound';

const wait = (ms) => new Promise((res) => setTimeout(res, ms));

export async function check(sim, r, say) {
  say && say('sound: every way of turning it off');
  const menus = sim.menus;
  const box = () => menus.screens.settings.querySelector('[data-set="muted"]');
  const btn = () => menus.screens.main.querySelector('[data-sound]');
  // "Sound is off — turn it on" / "Sound is on — turn it off"
  const btnSaysOff = () => /turn it on/i.test(btn().textContent);
  let saveSettings = null;
  try {
    ({ saveSettings } = await import('../../src/core/storage.js'));
  } catch (e) {
    /* reported below if the settings cannot be put back */
  }

  // --- the guards: no voice, no speakers ---
  const said = [];
  let cancels = 0;
  const hadSpeech = typeof window.speechSynthesis !== 'undefined';
  const hadUtterance = typeof window.SpeechSynthesisUtterance !== 'undefined';
  if (!hadSpeech) Object.defineProperty(window, 'speechSynthesis', { value: { getVoices: () => [] }, configurable: true, writable: true });
  if (!hadUtterance) window.SpeechSynthesisUtterance = function (t) { this.text = t; };
  const synth = window.speechSynthesis;
  synth.speak = (u) => said.push(String(u && u.text));
  synth.cancel = () => {
    cancels++;
  };
  const mx = sim.audio && sim.audio.mixer;
  const unplugged = !!(mx && mx.ctx && mx.limiter);
  if (unplugged) {
    try {
      mx.limiter.disconnect();
    } catch (e) {
      /* already off */
    }
  }
  // Never start the game's own sound from here: a harness with no gesture
  // would wait on it for ever, and a real one would hear it.
  const origUnlocking = sim._unlocking;
  if (sim.audio && !sim.audio.started) sim._unlocking = true;

  const orig = {
    muted: !!sim.settings.muted,
    atcVoice: sim.settings.atcVoice || 'radio',
    atcOn: !(sim.settings.soundOn && sim.settings.soundOn.atc === false),
  };
  let fresh = null;
  try {
    /* ---------------- the button and the box agree ---------------- */
    menus.show('main');
    if (sim.settings.muted) btn().click();
    const onAtStart = !sim.settings.muted;
    r.ok('sound: Settings "Mute everything" is unticked once the start button has turned sound on',
      onAtStart && box().checked === false,
      `settings.muted ${sim.settings.muted}, box ${box().checked}, button "${btn().textContent}"`);

    // Mute from Settings, the way a player does: tick the box.
    if (!box().checked) box().click();
    r.ok('sound: ticking "Mute everything" mutes, and the start button then offers to turn it ON',
      sim.settings.muted === true && sim.audio.mixer.muted === true && btnSaysOff(),
      `settings.muted ${sim.settings.muted}, mixer.muted ${sim.audio.mixer.muted}, button "${btn().textContent}"`);

    // And back on from the start screen: the box follows.
    btn().click();
    r.ok('sound: the start button turns it back on, and "Mute everything" unticks',
      sim.settings.muted === false && sim.audio.mixer.muted === false && box().checked === false && !btnSaysOff(),
      `settings.muted ${sim.settings.muted}, mixer.muted ${sim.audio.mixer.muted}, box ${box().checked}`);

    // The HUD button and M both go through hudAction('mute').
    sim.hudAction('mute');
    r.ok('sound: the in-flight mute (HUD button / M) ticks "Mute everything" and the start button follows',
      sim.settings.muted === true && sim.audio.mixer.muted === true && box().checked === true && btnSaysOff(),
      `settings.muted ${sim.settings.muted}, box ${box().checked}, button "${btn().textContent}"`);
    sim.hudAction('mute');
    r.ok('sound: and unmuting in flight unticks it again',
      sim.settings.muted === false && sim.audio.mixer.muted === false && box().checked === false && !btnSaysOff(),
      `settings.muted ${sim.settings.muted}, box ${box().checked}`);

    /* ---------------- the speech voice, through the game ---------------- */
    sim.settings.atcVoice = 'speech';
    sim.audio.radio.setMode('speech');
    let c0 = cancels;
    sim.hudAction('mute');
    r.ok('sound: muting stops the device\'s speech voice mid-sentence', cancels > c0, `${cancels - c0} cancel(s)`);
    sim.hudAction('mute');
    c0 = cancels;
    sim.applySetting('soundOn.atc', false);
    r.ok('sound: switching the ATC radio off stops the speech voice too', cancels > c0, `${cancels - c0} cancel(s)`);
    sim.applySetting('soundOn.atc', orig.atcOn);

    /* ---------------- a fresh start, from a muted save ---------------- */
    // The way main.js starts sound, on a spare mixer and a stand-in host, so
    // the game's own audio and state are not touched.
    const GameAudio = sim.audio.constructor;
    fresh = new GameAudio();
    const m = fresh.mixer;
    // Unplugged from the speakers the moment it is made, before it can render
    // a sample; and the master as it was made is the thing being tested.
    let atCreate = null;
    const ensure0 = m.ensure.bind(m);
    m.ensure = function () {
      const p = ensure0();
      if (m.limiter) {
        atCreate = m.master.gain.value;
        try {
          m.limiter.disconnect();
        } catch (e) {
          /* already off */
        }
      }
      return p;
    };
    const host = { audio: fresh, settings: { ...sim.settings, muted: true, atcVoice: 'radio' }, state: 'flying', hud: null, _unlocking: false };
    const started = sim.unlockAudio.call(host);
    // A harness with no gesture never resolves resume(); the master exists by then either way.
    await Promise.race([started, wait(4000)]);
    if (!m.ctx || !m.master) {
      r.ok('sound: a muted save starts silent', true, 'no Web Audio in this browser — nothing to hear');
    } else {
      const g = m.master.gain.value;
      r.ok('sound: a muted save makes its master at zero, not at full volume fading down', atCreate === 0 && g < 0.001 && m.muted === true,
        `master ${atCreate} when made, ${g.toFixed(4)} once sound was up, mixer.muted ${m.muted}`);

      /* ---------------- the speech voice, at the radio ---------------- */
      fresh.radio.setMode('speech');
      let n = said.length;
      fresh.setMuted(true);
      fresh.radio.transmit('Kestrel Tower, sound is off', { voice: 'tower' });
      r.ok('sound: muted, the speech voice says nothing', said.length === n, said.slice(n).join(' | ') || 'silent');
      n = said.length;
      fresh.setMuted(false);
      fresh.radio.busyUntil = 0;
      fresh.radio.transmit('Kestrel Tower, sound is on', { voice: 'tower' });
      r.ok('sound: unmuted, it speaks again (to the recorder)', said.length === n + 1, `${said.length - n} line(s)`);
      n = said.length;
      fresh.mixer.setBusEnabled('atc', false);
      fresh.radio.transmit('Kestrel Tower, radio is off', { voice: 'tower' });
      r.ok('sound: with the ATC switch off, the speech voice says nothing', said.length === n, said.slice(n).join(' | ') || 'silent');
    }
  } catch (err) {
    r.ok('sound: the checks ran to the end', false, String((err && err.stack) || err).slice(0, 400));
  } finally {
    if (fresh && fresh.mixer.ctx) {
      try {
        await fresh.mixer.ctx.close();
      } catch (e) {
        /* closed already */
      }
    }
    try {
      sim.settings.atcVoice = orig.atcVoice;
      sim.audio.radio.setMode(orig.atcVoice);
      if (!(sim.settings.soundOn && sim.settings.soundOn.atc === false) !== orig.atcOn) sim.applySetting('soundOn.atc', orig.atcOn);
      if (!!sim.settings.muted !== orig.muted) sim.applySetting('muted', orig.muted);
      menus.syncSound(sim.settings.muted);
      saveSettings && saveSettings(sim.settings);
    } catch (e) {
      r.ok('sound: the player\'s sound settings are put back', false, String(e && e.message));
    }
    sim._unlocking = origUnlocking;
    if (unplugged) {
      try {
        mx.limiter.connect(mx.ctx.destination);
      } catch (e) {
        /* nothing to plug back */
      }
    }
    delete synth.speak;
    delete synth.cancel;
    if (!hadSpeech) delete window.speechSynthesis;
    if (!hadUtterance) delete window.SpeechSynthesisUtterance;
  }
}
