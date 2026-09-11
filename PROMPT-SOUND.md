You are helping me with **sound** for Island Flight Simulator, a browser flight simulator written in
three.js that I built for my school class. 29 kids have played it.

## THE RULE THAT DECIDES EVERYTHING

**The game currently contains ZERO audio files.** Every sound is synthesised live with the Web Audio API.

That is why the whole game is **1.2 MB**, installs as an app, and sounds identical offline with no network
at all — which is how 29 children ran it at once on school wifi. It is also why every sample in it is
original and safe to publish.

So this splits into two jobs, and **the first one matters far more**:

1. **Synthesis code** (Web Audio) for sounds that must track a continuously changing number — engine rpm,
   airspeed, rotor speed. This is most of what I need.
2. **A short list of one-shot recordings** to source, for sounds with complex spectra that never change.

**Do not offer me a downloaded loop for anything in job 1.** A downloaded engine loop is pinned to one rpm;
you have to pitch-shift it and it always sounds pitch-shifted. My existing engine follows the throttle
smoothly from idle to full power because it is *generated from rpm*, and that is strictly better.

---

## WHAT ALREADY EXISTS (do not rebuild these)

All synthesised, all good:

| Sound | How it works |
|---|---|
| **Piston engine** | Built from the real physics: a four-cylinder at 2,400 rpm fires 80 times a second, and its two-bladed prop slaps the air 80 times a second — so it is a harmonic-rich firing tone plus a blade-slap layer, both tracking rpm |
| **Turbofan** | Separate model: fan whine, core roar, spool lag |
| **Slipstream** | Level *and brightness* both track airspeed, so 120 kt genuinely sounds fast. This is the main speed cue the player has |
| **Rain, thunder, tyres, gear** | Filtered noise shaped per event |
| **Stall warner** | A reed horn that moans as the wing approaches the stall, so you learn the sound rather than reading a label |
| **ATC radio** | A formant-filtered pulse train — the three-resonance model that makes a vowel sound human — through a 300–2800 Hz radio chain with squelch, clicks and dropouts. No TTS, no recordings |
| **Ambient music pad** | |

Architecture: a `mixer.js` owns the `AudioContext` and five volume buses (engine, environment, ATC, alerts,
music). Each sound is a module exporting an object with `start()`, `stop()` and an `update(dt, state)` that
is called every frame. **Sound starts muted by default** — the game never surprises anyone with noise.

---

## JOB 1 — SYNTHESIS I NEED (priority order)

### 1. Helicopter rotor — nothing exists, and it is wrong right now
I added a helicopter. Its engine kind is `'prop'`, so **it currently plays the four-cylinder piston
aeroplane sound.** A helicopter that sounds like a Cessna.

A helicopter's sound is dominated by **blade slap**: a four-bladed main rotor at ~390 rpm passes a blade
6.5 times a second, and that thumping is the whole character — you hear a helicopter long before you see
it. Layered over that: a turbine whine an octave and a half up, and the tail rotor as a faster, thinner
buzz.

I need `update(dt, { rotorRpm, collective, airspeed, distance })`:
- Blade-slap rate tracking rotor rpm, sharpening under load (higher collective = harder slap)
- Turbine whine tracking rpm with spool lag
- Tail rotor as a separate faster component
- The slap should get *more* percussive at speed and in descent, which is when a real one is loudest

### 2. Boat — completely silent
I added a boat and **it makes no sound at all**: the drive loop returns before the audio update is called.
I need an outboard/sterndrive plus water:
- Engine note tracking throttle, with the rise in pitch as she comes onto the plane
- Hull slap against chop, rate tracking speed — this is the main speed cue on the water
- Bow wash, a broad filtered-noise band that opens up with speed
- The engine note should drop and the wash continue for a second when you chop the throttle

### 3. Car — also completely silent
Same problem. A small airside van:
- Engine with a sense of gear steps rather than one continuous rise
- Tyre roll on tarmac, and a distinctly different, rougher note on grass — the game already knows which
  surface you are on
- Brake squeal on hard braking

### 4. Tornado
The game has a tornado, EF0 to EF5, with real wind speeds. It is silent. A tornado is a broadband roar that
gets *lower* and more pressure-heavy as it closes, with debris cracks over the top. I need
`update(dt, { proximity, ef })` — proximity 0–1 and rating 0–5.

### 5. Volcano
There is an erupting volcano with lava and an ash plume, and it makes no sound. A low continuous rumble
near the crater, plus occasional deeper detonations during an eruption.

### 6. Arrester wire
Carrier landing: the run-out of a wire is a rising metallic zing that decelerates. A one-off, triggered by
an event, not a loop.

---

## JOB 2 — RECORDINGS TO SOURCE

Only for one-shots with complex spectra that never need to change. These are genuinely hard to synthesise
and cheap to store.

- Thunder — three or four variants, near crack and distant rumble
- Seagulls — individual calls, plus a distant colony loop
- Harbour ambience — water lapping, rigging clinking, a bell buoy
- Island birds for inland areas
- A ship's horn for the carrier
- Crowd murmur and a tannoy chime for the terminal
- Metal clangs for the hangar
- A car door, an indicator tick, a handbrake ratchet

**Licence rule — this is not optional.** The game is published on a public site and the whole project is
CC0, so **only CC0 / public domain** audio can go in it. Anything with an attribution or non-commercial
clause cannot be used.

- **freesound.org** — filter to "Creative Commons 0". Best source
- **Pixabay**, **Zapsplat** — free tiers, but check attribution per file
- **BBC Sound Effects** — free for personal/educational use but **not CC0**, so check the terms

**Format:** mono `.ogg` (Opus), 48 kHz, trimmed hard at both ends, normalised to about −3 dBFS, each under
100 KB. **Mono is required** — the game positions sounds in 3D itself and a stereo file cannot be panned.

**Cost I am accepting:** each file has to go in the `sw.js` precache list with `CACHE_VERSION` bumped, or
offline play breaks. Total audio budget ~300–500 KB, which roughly doubles the download. Keep the list
short and justify anything you add.

---

## HOUSE STYLE

```js
/**
 * What this is, and why it is built this way.
 * Comments explain WHY. If a number is unusual, say what goes wrong at other values.
 */
export function createRotorSound(ctx, busGain) {
  // ...nodes...
  return {
    start() {},
    stop() {},
    update(dt, { rotorRpm = 0, collective = 0 }) {},
  };
}
```

- Pure Web Audio — oscillators, noise buffers, biquads, gains, convolvers if needed
- No external files, no libraries
- Everything must be safe to call before the user has interacted (the context starts suspended)
- Ramp parameters with `setTargetAtTime`, never assign `.value` directly — it clicks

---

## HOW TO ANSWER

**One sound at a time**, starting with the helicopter rotor. For each:
- A complete ES module I can drop in
- The real-world numbers behind your choices (blade passage frequency, firing rate, etc.) and why
- The `update()` signature and what each parameter does
- Tell me what it will sound like, and flag anything you are unsure about rather than asserting it works

Start with the helicopter rotor. Ask me anything about the audio system first.
