# Sound audit, v77.8 (Nov 6, 2026)

Every number below came from the game's real audio classes rendered offline
(tests/features/sound-lab.js). dBFS. "Speaker" is the level above 250 Hz: what an
iPad or a Chromebook can actually play. Nobody has heard any of this.

## Engines

| | total | speaker | note |
|---|---|---|---|
| prop idle, outside | -6.8 | -36.9 | total is an 11 Hz tone: nobody can hear it, and it leans on the limiter |
| prop full power | -5.0 | -17.1 | |
| jet idle, outside | -39.1 | -48.9 | a parked jet is almost silent |
| jet full power | -19.4 | -20.6 | |
| jet cruise | -27.2 | -29.6 | |
| rotor hover (full) | -28.8 | -34.7 | 17 dB under the prop on a tablet; the slap sits at 95-260 Hz |
| rotor idle | -33.0 | -41.6 | |

- **Engines do not differ by type at all.** Three synths: prop, jet, rotor. 44 aircraft share
  them. A Skylark and a Q400 are the same sound. An A320, a 747, an F-22 and Concorde are the
  same sound, with the same spool. Only the rotor reads its type (blade-pass rate).
- **Wrong synth on start and stop.** main.js calls `audio.engine.playStart/playStop` whatever
  you fly, so a jet start is a piston starter motor. The jet's own start peaks at -30.
- **Prop idle rpm is wrong.** The code comment says 800 rpm at idle, the sum gives 526.
- **The firing tone is a single steady buzz**: no cylinder unevenness.
- **Afterburner has no sound.** `ac.burner` is never read. Nor is `ac.reverse`.
- **No doppler, no distance.** Tower and flyby views sound exactly like chase.

## Cockpit against outside

| | outside | cockpit |
|---|---|---|
| prop cruise | -5.5 / centroid 65 Hz | -5.4 / 54 Hz |
| jet cruise | -27.2 / 1333 Hz | -29.1 / 256 Hz |
| rotor cruise | -30.0 / 251 Hz | -30.3 / 167 Hz |

Prop and rotor cockpits lose some top end and no level. Same wind filter either way.

## Airflow

- **Wind stops at 200 kt.** 200, 300, 450, 600 and 900 kt all measure -28.2. A fighter at Mach 1
  has the wind of a Skylark in a dive.
- Gear and flaps add nothing: gear down + full flap at 150 kt is -31.9, the clean figure.
- Nothing for spoilers, nothing for buffet near the stall.

## Events

| event | peak | length | verdict |
|---|---|---|---|
| flaps | -38 | 0.28 s | effectively silent; also the sound used for a store release and a parachute |
| touchdown, soft | -20 | 0.14 s | thin, one saw-wave blip for the chirp, no rumble after |
| touchdown, hard | -15 | 0.18 s | same |
| gear | -22 | 2.1 s, then a thunk on a real-time timer | 156 Hz centroid, speaker -41; same for a Cessna and a 747 |
| splash | -3.8 | 0.5 s | the loudest thing in the game, centroid 8 kHz: a hiss |
| crash | -10 | 0.5 s | fine, keep it short (Tomm1z rule) |
| jet start | -30 | 0.8 s | see above |

## Missing

Seatbelt chime. Cockpit switch clicks. Door thunks. Sinking. Runway joints under the wheels.
A cabin bed that changes with speed (it reads rpm only and is 8 dB under anything else).
Traffic has no doppler. The radio has no bed of its own.

## Limits and iPad

- Everything at once at full sliders peaks at +0.1 dBFS, one clipped sample. The limiter is a
  compressor, not a ceiling.
- All three aeroplane synths run all the time at zero gain. So does rain with no rain.
- **Unlock on touch is not covered.** The listeners are `pointerdown` and `keydown`. In the HTML
  spec a touch `pointerdown` is not an activation event (`pointerup` and `touchend` are), so on
  touch `ctx.resume()` is called outside a gesture. `ensure()` awaits that promise, it may never
  settle, `_unlocking` stays true, every later unlock returns early, and the game has no sound
  for the session. tools/cdp.mjs already records the same hang on Chrome.
- After a tab switch, iOS leaves the context `interrupted`. `mixer.resume()` only answers
  `suspended`, and `unlockAudio` returns at once once started, so nothing wakes it.
- A one-shot fired while the context is suspended queues on the frozen clock and all of them
  play together on resume.

## After v78-sound

Same renders, same scale. Speaker level (dBFS above 250 Hz), outside view.

| | before | after |
|---|---|---|
| prop idle / full | -36.9 / -17.1 | -31.1 / -15.9 (Skylark) |
| turboprop full | same as the prop | -16.5, its own sound |
| jet idle | -48.9 | -32.8 (A320), -34.1 (747), -36.3 (F-22) |
| jet full | -20.6 | -20.4 (A320), -19.7 (747), -19.4 (F-22) |
| jet cruise | -29.6 | -24.9 |
| rotor full | -34.7 | -25.0 |
| jet cruise, cockpit | -34.2 | -31.7 |
| 90% spool | one value for all | F-22 2.0 s, A320 4.0 s, 747 5.9 s |
| wind 200 / 450 / 900 kt | -28.2 all | -28.5 / -24.2 / -21.8 |
| flaps peak | -38 | -22 |
| splash peak | -3.8 | -12 |
| everything at once | +0.1, one clipped sample | -0.18 ceiling, none clipped |

Audio render cost is unchanged (about 550 ms per 10 s on both). `audio.update()` is about 0.03 ms a frame on both.

Still weak on paper: all of it is synth until recordings arrive. Engine loops have no cylinder or
turbulence detail a real recording has. Rotor sub-thump is below any tablet speaker. The radio
has no bed. Traffic is one voice. The gear and flap motors are sawtooths through a filter and are
the sounds most likely to read as fake.
