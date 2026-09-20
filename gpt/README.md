# Island Flight Simulator

A browser flight simulator you can install and play offline. Take off from
Kestrel Island, learn to fly in the tutorial, complete three missions, and land
in anything from a blue-bird day to a thunderstorm.

Built with three.js. **Every texture and every sound in the game is generated in
code at load time** — there are no image or audio files to download, which is why
the whole thing is a few hundred kilobytes and works identically offline.

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
file on first load, so even without installing, a second visit works offline.

---

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
| Show controls | `H` |
| Mute | `M` |
| Pause | `Esc` |

Every key can be reassigned in **Settings → Controls**. Mouse flying and
gamepads are supported too (Settings → Flying).

**How do I slow down?** Hold `Ctrl` (or `↓`) to reduce power. `Space` is the
wheel brakes and only works on the ground. `F` lowers the flaps, which lets you
fly slowly on the approach.

---

## What is in the game

- **Tutorial** — nine guided steps from starting the engine to landing.
- **Island Circuit** — take off, fly five checkpoint rings, land.
- **Mango Cay Delivery** — carry supplies 8 km, parachute them onto a target, come home.
- **Storm Approach** — a 24 kt crosswind landing in a thunderstorm.
- **Free Flight** — any time of day, any weather, any wind.

Weather covers midday / sunset / night crossed with clear / cloudy / rainy /
stormy, with adjustable wind speed and direction, real crosswind effects,
turbulence, gusts, drifting clouds and lightning.

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
    model.js            the aeroplane, lofted from aerofoil sections
    cockpit.js          cockpit interior and the live instrument panel
  flight/
    input.js            remappable keyboard, mouse flying, gamepad
    camera.js           cockpit / follow / orbit / wing / tower views
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

Code and generated assets: **CC0 1.0** (public domain) — copy it, change it,
share it, use it in your own projects.

Bundled three.js (`src/vendor/three.module.js`) remains under its own **MIT**
licence; the full text is in `src/vendor/three.LICENSE`.

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
