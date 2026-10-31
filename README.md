# Island Flight Simulator

A browser flight simulator you can install and play offline. Take off from
Kestrel Island, learn to fly in the tutorial, complete three missions, and land
in anything from a blue-bird day to a thunderstorm.

Built with three.js. **Every texture and every sound in the game is generated in
code at load time** — there are no audio files to download and no textures, which
is why the whole thing is a few hundred kilobytes and works identically offline.
The one exception is the picture on each map's loading screen
(`assets/loading/<map>.jpg`, see *Loading screens* below), rendered from the game
itself.

---

## Running it locally

The game is made of ES modules, so it must be served over HTTP. Opening
`index.html` straight from Finder or Explorer will **not** work — browsers block
module imports from `file://` URLs.

**Easiest way** (Python 3 is pre-installed on macOS and Linux):

```bash
python3 serve.py
```

That starts a server on <http://localhost:8807> and opens your browser. Press
Ctrl+C to stop it. To use a different port: `python3 serve.py 3000`.

**With Node.js instead:**

```bash
npx serve .
# or
npx http-server -p 8807
```

**With any other web server:** point it at this folder. No build step, no
`npm install`, no bundler — the files are served exactly as they are.

Requires a browser with WebGL 2: Chrome, Edge, Firefox, or Safari 16+.

---

## Installing it as an app (offline play)

1. Open the game in Chrome or Edge.
2. Click **Install / Download game** on the start screen, or use the install
   icon in the address bar.
3. On iPhone/iPad: Share → *Add to Home Screen*.

Once installed it runs from your dock or home screen in its own window and works
with no internet connection at all. The service worker (`sw.js`) caches every
file during your first visit — it starts once your first flight begins (or after
half a minute on the menu), so the download never competes with the game loading
— and from then on a second visit works offline, even without installing.

---

**Closed the tab by accident?** (Ctrl+W is one key away from Ctrl, "less
power".) The browser asks first while a flight is on, and a running mission or
lesson is checkpointed every few seconds: the next visit within two hours shows
**Resume your mission?** on the start screen — the same mission at the start of
the step you were on, the aeroplane where it was. What the earlier steps had
gathered is not kept; Free Flight has nothing to resume and the Story has its
own save. The code is `src/game/checkpoint.js`.

## Controls

| Action | Keys |
| --- | --- |
| Pitch down / up | `W` / `S` |
| Roll left / right | `A` / `D` |
| Rudder left / right | `Q` / `E` |
| More power / less power | `Shift` / `Ctrl` (or `↑` / `↓`) |
| Wheel brakes | `Space` |
| Landing gear | `G` |
| Flaps down / up | `F` / `V` |
| Start / stop engine | `I` |
| Change camera | `C` |
| Look behind | `B` (hold) |
| Release cargo | `X` |
| Fire a heat-seeker (military jets, once locked) | `\` |
| Lock on: pick the next target in front (guns and missiles) | `Home` |
| Drop flares (military jets; everyone in the Heat-Seeker disaster) | `4` |
| Show controls | `H` |
| Mute | `M` |
| Pause | `Esc` |

Every key can be reassigned in **Settings → Controls** — in every game, not
just the aeroplane: one fold per game (Flying, Weapons, Helicopter, Boat, Car, Rocket,
On foot, Multiplayer & PvP, Fun Stuff, Missions & events, View, Game), the one
you are playing first. Click a key, press the new one (Esc cancels); a key that
already does something in the same game asks "swap them?". Each fold has its
own Reset, and **Reset all keys** puts everything back. The hints on screen and
the `H` card always name your keys. Mouse flying and gamepads are supported
too (Settings → Flying).

### Flight sticks, throttles and rudder pedals

Every controller plugged in is read at once — a sidestick, a throttle quadrant
and a set of pedals each show up as their own device. Press a button on each
one first (browsers only list a controller after it has been used). An Xbox or
PlayStation pad works exactly as before. Recognised sim gear gets a built-in
profile: the **Thrustmaster TCA Sidestick Airbus** and **TCA Quadrant Airbus**
(two thrust levers with the IDLE / CL / FLX-MCT / TOGA detents, reverse below
idle, engine master switches), **Thrustmaster pedals** (rudder and two toe
brakes that brake each side), and best guesses for joystick-with-throttle
sets and yokes. **Settings → Controls → Controllers** lists every device with
live meters; *Assign* and move the lever you want for roll, pitch, rudder,
throttle (one lever or engine 1 / engine 2), the toe brakes, the speedbrake
or the flaps; invert, deadzone, curve, calibrate; and bind any button to any
action by pressing it. It is saved per device; *Reset to defaults* puts the
profile back. The code is `src/flight/controllers.js`.

A thrust lever takes the throttle only once it has **synced**: at idle, or
passing through the power the game has set (a key, a spawn in the air). Until
then the HUD says "Move the throttle lever to idle to take control", and an
engine start never takes power from a lever sitting at climb — the aeroplane
stays on its stand with the parking brake held. A key on the power makes the
lever sync again, so the keyboard and the lever never fight. In a
single-engined aeroplane the further-forward of a quadrant's two levers is the
power (one lever at the stop is 100%, not half); a twin takes the average and
flies the split. Pedals or a stick that rest a little off centre have that
rest taken as their centre once they have sat still for a moment.

**How do I slow down?** Hold `Ctrl` (or `↓`) to reduce power. `Space` is the
wheel brakes and only works on the ground. `F` lowers the flaps, which lets you
fly slowly on the approach.

---

Mission words quote the aeroplane you are actually flying: "lift off at
{Vr} knots" in the mission files becomes 55 in the Skylark and the airliner's
own number in an airliner (`src/game/speed-text.js`).

## What is in the game

- **Story — Signal Zero** — a 12-chapter story across every vehicle, from the
  Story card on any game's front page. Chapter 1, *The Glint*: race a rival
  through a midnight squall to photograph a fireball off Condor Rock, then land
  on the clifftop strip. It autosaves at every checkpoint, so you can leave
  whenever you like and **Continue** picks up exactly there with a "previously
  on…". A first-timer gets three one-line flying prompts (power, nose,
  bank) in the first minute; "I know how to fly" skips them.
  Voices are text and subtitles; cutscenes are short and skippable;
  Reduce flashing is respected. Chapters 2–12 arrive in later updates.
- **Tutorial** — nine guided steps from starting the engine to landing.
- **Island Circuit** — take off, fly five checkpoint rings, land.
- **Mango Cay Delivery** — carry supplies 8 km, parachute them onto a target, come home.
- **Storm Approach** — a 24 kt crosswind landing in a thunderstorm.
- **Free Flight** — any time of day, any weather, any wind.

Weather covers midday / sunset / night crossed with clear / cloudy / rainy /
stormy, with adjustable wind speed and direction, real crosswind effects,
turbulence, gusts, drifting clouds and lightning.

**Heat-seeking missiles** — every military jet (the Vanguard, Osprey, Nightjar,
F-22, F-35B and F/A-18; not airliners, trainers or helicopters) carries exactly
three, hung where you can see them under the wings and belly, and the screen
says `MSL 3/3`. A ring ahead of the nose is the seeker, about 20 degrees across:
hold a drone in it for a second and the box closes and turns red, then fire
(`\`, or the FIRE MSL button on a touch screen). The missile burns for a moment,
coasts on a white trail and steers by proportional navigation, so it flies to
where the target will be — and it can be beaten by flares or by a hard turn at
short range. Land and stop at an airbase or a carrier (or start a new flight)
and the three come back. Targets are drones only: the drones of Air Force One -
Under Attack, orange practice drones (the pause menu's Targets, or a tick on the
Free Flight screen), and another player's aeroplane only when PvP is on for you
both. Never civilian traffic, airliners or Air Force One.

**The gunsight and the lock key** — a military jet (or any aeroplane while PvP is
on for you) has a clean sight where the nose points: a dot inside a ring, with
twelve range ticks that light up as a locked target comes into the gun's reach
(all twelve means in range). Press `Home` (the LOCK button on a touch screen) and
it takes the next target in front of you, nearest the nose first — a drone, a
practice drone, a meteor, or another player with PvP on, never civilian traffic or
Air Force One — and lets go after the last. The target gets a box with its range
(an arrow round the middle of the screen when it is off the screen) and a **lead
pipper**: where the nose has to point, counting the pellet's speed, your own speed
and the target's, for a burst to meet it. Put the dot on the pipper and fire. The
same box serves the heat-seekers: a drone you locked is the only one the seeker
works on, and the box goes yellow, then red. No guns, no sight.

**Meteors need guns** — only a plane with guns can zap a meteor (`Z`, or ZAP): the
military jets. In a Courier, a trainer, an airliner or a helicopter the zap says
"You need a plane with guns to shoot meteors." Meteor Shower and Guard the Town
hand you the Osprey, a carrier jet that has them; Rock Dodger (you dodge) and the
photo run (the Tempest, a camera plane) are as they were.

**The Heat-Seeker disaster** (Free Flight: arm it before departure or set it off
from the pause menu's Disasters — never random) — for a minute or so unmanned
launchers fire heat-seeking missiles at you, one or two at a time. You get
"MISSILE LAUNCH — break left and pop flares", an arrow on the screen pointing at
each missile, and eight pairs of flares in any aircraft (`4`, or the FLARES
button). Pop them when the missile is close and break hard. A hit damages the
nearest part of the aircraft; a big one means eject or a forced landing. Nobody
is ever hurt.

Two flight models: **simplified** (the aeroplane levels its wings, holds its
height, coordinates the rudder and refuses to stall) and **realistic** (all of
that switched off).

---

## Project layout

```
index.html              page shell and loading screen
manifest.webmanifest    PWA manifest
sw.js                   service worker — precaches everything for offline play
serve.py                tiny local web server
styles/main.css         all interface styling
icons/                  generated app icons
tests/selftest.js       headless self-test (see below)
src/
  main.js               entry point: renderer, game states, frame loop
  core/
    noise.js            deterministic PRNG + value/fractal noise
    storage.js          settings, progress and best scores in localStorage
  render/
    textures.js         every texture in the game, drawn with Canvas 2D
  world/
    weather.js          time of day, cloud/rain conditions, wind and gusts
    sky.js              sky dome shader, sun, stars, scene lighting
    terrain.js          island height function, mesh chunks, ground queries
    water.js            ocean planes and coastline foam
    airport.js          runway, taxiways, buildings, lighting, working PAPI
    scenery.js          palms, town, lighthouse, delivery pad, boats
    clouds.js           instanced billboard clouds and overcast decks
    precip.js           rain
  aircraft/
    physics.js          6-DOF flight model, landing gear, scoring
    reheat.js           the fast jets' afterburners, sound barrier and q-limit
    model.js            the aeroplane, lofted from aerofoil sections
    cockpit.js          cockpit interior and the live instrument panel
  flight/
    input.js            the one key registry (every game's and feature's keys), mouse, gamepad
    camera.js           cockpit / follow / orbit / wing / tower / flyby views, sized to each airframe
  audio/
    index.js            facade over the whole audio system
    mixer.js            AudioContext, five volume buses, noise sources
    engine.js           piston engine and propeller synthesis
    ambience.js         slipstream, rain, thunder, tyres, gear
    atc.js              radio: formant chatter, squelch, static, interference
    alerts.js           stall warner, gear horn, chimes
    music.js            ambient pad
  game/
    runner.js           drives the tutorial and the missions
    missions.js         the three missions
    tutorial.js         the flight-school lesson
    markers.js          checkpoint rings and the cargo crate
    atc-director.js     decides when ATC should speak
  ui/
    hud.js              heads-up display
    menus.js            start screen, missions, settings, credits, debrief
    credits.js          asset credits and licences
```

---

## Loading screens

Starting a flight from the menus puts up a full-screen picture of the map you are
going to, its name in big letters, what you are flying, a tip (in your own keys)
and a slim progress bar. It stays about three seconds, or as long as the map takes
to build if that is longer; any key or tap skips it after one second. It covers
Free Flight, the lessons, missions, Story chapters, multiplayer joins and the boat
and the van, and it is not shown for a restart on the same map. It makes no sound,
and nothing on it flashes: it fades in and out slowly, and the slow zoom on the
picture stops with Settings → reduced motion.

- The code is `src/features/loading-screens.js` (when, and what the bar means),
  `src/ui/loading-screen.js` (the screen) and `src/ui/loading-tips.js` (the tips).
- A browser driven by a robot (the test suites) skips it. `?loading=1` in the
  address forces it on, `?loading=0` off, and `sim.loading.enabled` is the switch.
- A map that is built from OpenStreetMap says so with `osm: true` (or its own
  `attribution` line) in `maps.js`, and its screen shows "© OpenStreetMap contributors".
- The pictures are made from the game by `tools/loading-art/`: `capture.mjs` renders
  each map's camera spot (`spots.mjs`) in golden light, `pack.py` grades them and
  fits each in 250 KB. `capture.mjs` also records where each picture's subject is
  (`src/ui/loading-focus.js`, generated) so a phone held upright crops round the
  aeroplane, boat or van. A new map needs a spot in `spots.mjs`, and
  `tests/features/loading-screens.mjs` fails until it has its picture.

---

## Running the self-test

The game ships with a headless test suite that flies it for you — take-off,
climb, turns, stalls, landings in calm air and in an 18 kt crosswind with rain,
all twelve weather combinations, every camera, the tutorial, all three missions,
save data and the offline plumbing.

Open the game, then in the browser console:

```js
const { runSelfTest } = await import('./tests/selftest.js');
const results = await runSelfTest(window.__sim);
console.table(results.checks);
```

`window.__sim` also exposes `step(seconds)`, `snapshot()`, `key(code, down)` and
`override` for driving the simulator by hand.

---

## Licence

© thankdapro. Plain-language licence in [`LICENSE`](LICENSE): anyone may use,
copy, change, share and build on the game — in Roblox games and assets too —
**with credit to thankdapro**. You may copy the game; please give us credit
(thankdapro).

Bundled three.js (`src/vendor/three.module.js`) remains under its own **MIT**
licence; the full text is in `src/vendor/three.LICENSE`.

Any SCP Foundation-based content (the Site on Nunatak Reach, the Class-D
transfer mission and the Last Flight Out mission) is **CC BY-SA 3.0** by the SCP Wiki community
([scpwiki.com](https://scpwiki.com)), not under the game licence.

Inspired by PTFS (Pilot Training Flight Simulator) and the Google Earth flight
simulator. All airlines in the game are parody and not affiliated with any real
company.

Full asset-by-asset credits are in the in-game **Credits & licences** screen.

### A note on the ATC voices

**The default has no text-to-speech, no AI-generated voice, and bundles no
recordings.** The radio calls are indistinct formant-filtered chatter — the
acoustic shape of speech without any words — pushed through a realistic radio
chain (300–2800 Hz band, soft clipping, squelch bursts, relay clicks,
heterodyne interference and dropouts). The words are shown as subtitles.

**Settings → Sound → ATC voices** offers three options:

| Option | What it does |
| --- | --- |
| **Radio chatter** (default) | The synthesised voice described above. No TTS. |
| **Your device's speech voice** | Your operating system's own speech synthesiser. This **is** text-to-speech, which is why it is opt-in and not the default. Nothing is generated by a model and nothing is downloaded — it is the same voice your computer already uses. |
| **Recordings I have added myself** | Plays clips you put in `assets/atc/`. The game ships with none. |

The synthesised radio and the recordings both run through the same radio chain,
so a real clip sits in the same acoustic space as everything else. Any line you
have not recorded falls back to the synthesised voice.

To add recordings, see [`assets/atc/README.md`](assets/atc/README.md) — it
covers the manifest format, offline caching, and which licences are safe to
redistribute.
