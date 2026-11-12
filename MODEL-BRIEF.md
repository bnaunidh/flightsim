# Island Flight Simulator — model & animation brief

Paste this whole file into ChatGPT. It describes every model in the game, what each one is *now*, and
what it should become.

---

## HARD CONSTRAINTS — read before anything else

(Rewritten 2026-11-11 to match the game as it is now. The old "no downloaded assets, primitives only,
a few hundred triangles" rules described the game before v60; they no longer hold.)

1. **Two kinds of model, and both matter.**
   - **The game's own (procedural) model** of every aircraft, vehicle and building is built in code from
     three.js primitives, and it is ALWAYS built: it is what flies — gear points, strike points, the
     camera frame, the cockpit cut-outs, the doors, the lamps and the crash/breakup pieces all read it.
     It is also what Low graphics, an offline first visit and a failed download show.
   - **A downloaded model** (CC BY 4.0, from Sketchfab) may be worn over it as a better-looking skin:
     the airliners, fighters, helicopters, trees, scenery and Last Flight Out's SCP cast do this today
     (`src/aircraft/real-models.js`, `tools/real-models/`). Each is fetched only when it is first
     needed and then kept for offline play; none is in the service worker's install list.
2. **No real liveries, logos or markings ship — ever.** A downloaded model's colour textures are always
   thrown away and the game paints it with its own parody liveries. Only *detail* maps (normal,
   roughness/metal, ambient occlusion) with no lettering or emblem in them may be kept, or shade baked
   from the model's shape (`tools/real-models/detail.py`). A model with an airline's titles or stripes
   modelled into its geometry cannot be used (that is why Concorde keeps the game's own).
3. **No audio files** (every sound is synthesised), and every other texture — terrain, sky, buildings,
   liveries — is painted with Canvas 2D at load time.
4. **three.js r169**, vendored, ES modules, **no build step and no npm at run time**. No GLTFLoader:
   the game reads GLB with its own reader (`src/vehicles/glb.js`), plus `src/aircraft/real-packed.js`
   for packed files (meshopt + KTX2, decoded with three's vendored `KTX2Loader` and meshopt decoder,
   loaded only when such a file is). Packing happens offline, in `tools/` (gltf-transform, toktx,
   Blender) — never in the game.
5. **Axes: −Z is forward (out of the nose), +Y is up, +X is out of the right wing.**
6. **Budgets.**
   - First load: `main.js`'s static import graph must stay at or under 1,494,347 B gzipped
     (`tests/features/farlands.mjs`); anything big is loaded on demand.
   - A procedural aircraft: a few thousand triangles (the 737's is about 7,400). Anything repeated
     (trees, buildings, lights) must be an `InstancedMesh`.
   - A downloaded aircraft file: under 1.5 MB plain, up to about 3 MB with detail maps (the 737 pilot
     is 0.56 MB, ~9,500 triangles).
   - On Low a real model must cost no more than 5% over the built-in one
     (`tests/features/real-models.browser.js`), and Low never decodes detail maps.
   - The school demo hardware is iPads (Safari, touch only) and Chromebooks: test there.
7. **Style:** readable at 50–500 m in motion beats detail up close; realistic, no cartoon effects.
8. **Deliverable shape (procedural):** an ES module exporting a function that returns a `THREE.Group`,
   with any moving part exposed on `group.userData` so the game can drive it. **(Downloaded):** a
   `tools/real-models/models.py` entry, processed by `process.py`, credited in
   `assets/models/LICENSES.md` and the Credits screen (`src/ui/credits.js`).

```js
import * as THREE from '../vendor/three.module.js';
export function createThing(opts = {}) {
  const g = new THREE.Group();
  // the procedural model: primitives
  g.userData.spin = (dt, rate) => { /* ... */ };
  return g;
}
```

---

# PART 1 — THE MODELS

## ★★★ TIER 1 — broken or missing, fix first

### 1. The helicopter has no rotor
**Now:** The Skyhook H-3 flies correctly — it hovers, translates on cyclic, spins on its tail rotor. But
it is *drawn by the propeller code*: a 4.2 m propeller on the **nose**, and **no main rotor and no tail
rotor exist at all**. It flies like a helicopter and looks like an aeroplane with a giant prop.

**Wanted:** A light utility helicopter, roughly Bell JetRanger sized. Rounded glass-fronted cabin ~3 m
long seating two abreast, tapering into a slim tail boom ~4 m long, ending in a vertical fin. Main rotor
4.2 m radius on a mast above the cabin: a hub, four slender blades that droop ~15° when stopped and cone
up ~4° under load, plus a translucent blur disc that fades in with rotor speed. Tail rotor ~0.8 m on the
left of the fin. Skids, not wheels — two fore-aft tubes on angled cross-struts.

### 2. The weapons range has no model
**Now:** The Weapons Range mission scores you in metres from a bullseye. `RANGE_TARGET` is **only a
coordinate — nothing is drawn there.** You are bombing an invisible target.

**Wanted:** Concentric scoring circles on cleared pale ground — a 5 m dark bullseye, then white rings at
25/50/100 m, four corner markers, and a small spotting tower. Alternating quadrant paint so it reads from
directly overhead, which is the only angle you ever see it from.

### 3. The practice bomb is a food crate
**Now:** The range drops the **supply crate** — a 1.4 m box with cargo straps and a parachute.

**Wanted:** An inert practice store. Slim body ~1.8 m long, ~0.25 m diameter, rounded nose, four swept
tail fins in a cruciform, a suspension lug on top. **Painted blue** — the real convention for a training
round. No parachute. It should tumble slightly as it falls.

### 4. Runway 18/36 has the wrong numbers painted on it
**Now:** The crosswind runway reuses the 09/27 texture verbatim, so **it has "09" and "27" painted on its
thresholds.** Anyone who looks down at it sees the wrong runway.

**Wanted:** Its own texture with 18/36 numerals, correct threshold bars and centreline.

### 5. The carrier has no angled deck
**Now:** The deck texture's comment claims it draws "the angled landing area" and actually draws a dashed
line straight down the middle, parallel to the keel. **The angled deck is the defining feature of a modern
carrier and it is absent.** The island is one grey box with a stick on top and **no windows anywhere** —
jarring beside the carefully glazed control tower. The arrester wires are 0.32 m diameter *pipes*, about
ten times overscale, floating 1.1 m above the deck with nothing holding them.

**Wanted:** A landing area angled ~9° to port with its own centreline and a painted touchdown zone; a
catapult track forward; a superstructure with glazed bridge and Pri-Fly levels, radar arrays and a mast;
wires at ~0.04 m on visible deck sheaves.

### 6. There is no fence
**Now:** Nothing separates airside from the island. The pavement simply stops and grass begins. No gate,
no guard post, no boundary of any kind — the most conspicuous absence at ground level.

**Wanted:** A chain-link perimeter on instanced posts, a vehicle gate, a small guard hut.

---

## ★★ TIER 2 — crude, and you look straight at them

### Trees — 4 triangles and one bitmap each
**Now:** Every tree is two crossed quads (4 triangles) with a 128×128 painted texture. Because the
texture cache keys by species, **all ~650 palms on the Kestrel coast are 650 copies of the same 128-pixel
drawing.** There is no trunk mesh anywhere — no cylinder, no volume.

**Wanted:** Keep the impostor for distance, but give the near band real geometry: a tapered trunk cylinder
with 2–3 bends, and 6–9 frond planes for palms / a blobby canopy for broadleaf. Three or four variants per
species so a grove is not one drawing repeated. Placement should cluster — dense in gullies, thin on
ridges, absent on rock.

### The delivery pad — the campaign objective is four flat quads
**Now:** A 240×44 untextured grey-green plane, a yellow ring and two crossing bars. **No texture at all.**
This is the thing the player aims at for the whole delivery mission.

**Wanted:** A worn grass/dirt strip with tyre marks and edge definition, a painted target with weathering,
a windsock, a few oil drums and a hut.

### The village huts — a ring of nine identical cones
**Now:** Nine identical boxes with cone roofs at exactly `(i/9)×2π` and three discrete radii. Mathematically
perfect in a way nothing built by people ever is; it reads as a ring of traffic cones.

**Wanted:** 12–15 huts, varied sizes and rotations, irregular spacing, clustered along a path, a few with
verandas, a shared central space, washing lines, a jetty.

### The fishing boats — the hull is a split pipe
**Now:** A half-open cylinder laid on its side. No bow, no stern, no taper, no sheer, no deck. Untextured.

**Wanted:** A proper small hull: pointed bow, flat transom, a sheer line, a low deckhouse, a mast with a
derrick, nets, nav lights so they exist at night.

### Player boat — "Kestrel Launch"
**Now:** Box hull 2.6×1.0×7.4, a 4-sided cone bow, a cabin box, a windscreen, two flat wake planes.

**Wanted:** A chined planing hull with a real bow entry and a flat transom; an outboard or sterndrive on
the transom; a helm console with a wheel and a seat; grab rails and cleats; nav lights (red port, green
starboard, white stern); a bow wave that lifts as she gets on the plane, plus a wash trail astern.

### Player car — "Airfield Runabout"
**Now:** Body box, cab box, four cylinders. The cab is opaque with glass only on its front and back faces.

**Wanted:** Wheel arches, headlights, tail lights, indicators, mirrors, a roof beacon, a visible interior
with seats and a wheel, a number plate, suspension travel.

### The town — boxes in flat grey hats
**Now:** Instanced boxes with a flat slab roof. No pitched roofs anywhere, no L-shapes, no courtyards,
balconies, chimneys or aerials. Every footprint is a rectangle.

**Wanted:** Three or four building archetypes with pitched and hipped roofs, chimneys, a church or a
landmark, varied footprints, and streets that read as streets from 1,000 ft.

### Hangars — two identical arches with no doors
**Now:** Two byte-identical half-cylinders with an open hole at the front and nothing inside.

**Wanted:** Sliding door leaves on tracks, a frame, a floor, an aircraft parked inside, lights.

### Fuel farm — two bare cylinders on the dirt
**Wanted:** Saddles, dished end caps, a containment bund, pipework, a pump house, ladders, hazard placards.

---

## ★ TIER 3 — flat things pretending to be solid

- **Waterfalls** — one flat plane per fall, fixed to the slope aspect and **never billboarded**, so from
  90° round it the waterfall becomes an edge-on line. Needs to face the camera, or be a curved sheet.
- **Reef** — a flat unlit ribbon lying *on top of* the water at y = 0.45 rather than under it.
- **Fields** — five flat colours, no texture: no furrows, no row direction, no crop variation.
- **Lava lake** — a good crack texture painted on a flat disc that never deforms. Wants convection cells
  and crust plates rafting apart.
- **Ash plume** — 340 copies of one 96-pixel grey circle; the physics is right, the art is one sprite.
- **Embers** — 90 copies of one radial blur, no colour variation from white-hot to dull red.
- **Crater light** — one point light with a **6 km radius**, so it is an orange wash over the entire
  island rather than a glow in the crater.
- **Signs** — every sign in the game is a blank coloured rectangle. The terminal name board is a 24 m
  glowing blue slab literally labelled `letters` in the source, with no text. Stand numbers are blank
  yellow squares. All trivially fixable with canvas text.

---

## ALREADY GOOD — leave these alone

The **control tower** (tapered shaft, glazed cab, mullions, railings), the **windsock** (already driven by
the real wind vector), the **PAPI** (genuinely simulated — it derives your actual glide angle), the
**runway 09/27 texture** (rubber deposits, centreline, threshold bars — the best man-made art in the
project), the **aurora** (custom shader, two sine folds, genuinely convincing), the **air bridges** as
objects, and the **fuel bowser**.

---

# PART 2 — ANIMATIONS

## Already animated — do not redo
Ailerons, flaps, elevator, rudder, landing-gear retraction, propeller spin and blur disc, jet nozzle glow,
windsock yaw and lift, PAPI colour transition, lava texture scroll, ash plume and ember particles.

## Wanted, in priority order

**1. Main and tail rotor.** Blocking — the model does not exist. Blades spin, blur disc fades in with
rotor speed, blades droop ~15° stopped and cone up ~4° under load, and the **whole disc visibly tilts with
cyclic** so you can see why the helicopter is moving.

**2. Things built to move that never move.** Three separate cases where the geometry exists specifically
so it could be animated and nothing ever drives it:
- **Air bridges** — built with two telescoping tunnel sections, a lifting column and a wheeled bogie,
  precisely so they "look like they can move". They never do. Wanted: extend, lift and rotate to meet a
  parked aircraft's door.
- **Ground vehicles** — the tug, baggage train and catering lift are stored in variables that nothing ever
  reads. Wanted: the tug tows an aircraft off a stand, the baggage train drives a circuit, the catering
  lift actually lifts (its scissor is frozen at a fixed angle).
- **Parked aircraft** — frozen at a single 16 ms tick. Wanted: beacons and strobes, drooping control
  surfaces, a slow APU exhaust shimmer.

**3. Suspension travel.** Wheels are rigid. They should compress on touchdown, absorb bumps on the grass,
and extend as the aircraft lifts off.

**4. Wheel spin-up smoke** — a puff at the moment of touchdown, once, scaled by descent rate.

**5. Boat wake and spray** — a bow wave that grows and lifts as she gets on the plane, a wash astern that
persists and fades, spray off the chines in a turn. Currently two flat planes that change opacity.

**6. Car lights** — brake lights on when braking, indicators with the steering, a rotating roof beacon.

**7. Rotating radar dish** — currently rotated onto its side and spun on the wrong axis, so it *tumbles*
rather than sweeping the horizon.

**8. Doors** — terminal doors, hangar doors, aircraft cabin doors on the parked aircraft.

**9. Flags and windsocks** — more than the single one that exists, and driven by the same wind vector.

---

# PART 3 — CRASH ANIMATIONS (yes, wanted)

**What exists:** debris, fire, smoke, scorch marks, and a water impact that throws a spray column and then
**detonates into a fuel fire 0.85 s later** (measured: light 0 → 2440, spray tint warming to flame).

**What is missing: the aircraft itself breaking up.** Right now the model vanishes and generic debris
appears.

1. **Airframe separation** — wings, tail and engines detach as distinct pieces and tumble independently,
   each with its own mass and drag, rather than being replaced by generic cubes.
2. **Progressive damage** — a bent propeller after a prop strike, a crumpled nose, a wing that tears but
   stays attached and drags.
3. **Cartwheel** — a wingtip strike should dig in and pivot the aircraft about that tip, not just stop it.
4. **Sinking** — in water, nose down, tail rising, then under, with a bubble stream and a spreading slick.
5. **Ramp strike** — hitting the back of the carrier is a specific, visually distinct failure.
6. **Rotor strike** — helicopter blades shatter and fly off individually. This is what actually happens.
7. **Boat capsize** — rolls onto its beam ends and floods rather than simply halting.
8. **Car roll** — currently a car that hits something just stops.

**Tone:** this is played by 9–11 year olds. Structural failure, fire and smoke are right. No injury, no
bodies, no gore. The existing crash system already gets this balance right — match it.

---

# PART 4 — SOUND EFFECTS

## Read this before sourcing anything

**The game currently contains zero audio files.** Every sound is synthesised live with the Web Audio API.
That is not an oversight — it is why the whole game is 1.2 MB, why it sounds identical offline, and why
every sample in it is original and safe to publish.

What is already synthesised, and genuinely good:

| Sound | How it is made |
|---|---|
| Piston engine | Built from the real physics: a four-cylinder at 2,400 rpm fires 80 times a second and its two-bladed prop slaps the air 80 times a second, so the sound is a firing tone plus a blade-slap layer, both tracking rpm continuously |
| Turbofan | Separate model — fan whine, core roar, and spool lag |
| Slipstream | Level *and brightness* both track airspeed, so 120 kt genuinely sounds fast. This is the main speed cue you have |
| Rain, thunder, tyres, gear | Filtered noise shaped per event |
| Stall warner | A reed horn that moans continuously as the wing approaches the stall, so you learn the sound rather than reading a label |
| ATC radio | A formant-filtered pulse train — the three-resonance model that makes a vowel sound human — through a 300–2800 Hz radio chain with squelch, clicks and dropouts. No TTS, no recordings |
| Music | Ambient pad |

## The honest trade-off, if you add files

**Synthesis wins** for anything that must track a continuous parameter. An engine loop downloaded from the
internet is pinned to one rpm; you have to pitch-shift it, and it always sounds pitch-shifted. The current
engine sound follows the throttle smoothly from idle to full power because it is *generated* from rpm.
Do not replace the engine, the slipstream, the jet or the stall warner with samples — you would be trading
down.

**Recordings win** for one-shots with complex spectra that never need to change: a thunder crack, a seagull,
a gull colony, a distant dog, a church bell, a crowd murmur in the terminal, a metallic clang. These are
genuinely hard to synthesise convincingly and cheap to store.

**What it costs:** every file has to be added to the `sw.js` precache list and `CACHE_VERSION` bumped, or
the game stops working offline — which is the property that made it work on 29 school laptops at once.
Budget maybe 300–500 KB of audio total, which roughly doubles the download.

## Sounds worth sourcing (one-shots only)

- Thunder — three or four variants, near crack and distant rumble
- Seagulls — individual calls and a distant colony loop
- Harbour ambience — water lapping, rigging clinking, a bell buoy
- Jungle/island birds for the inland areas
- A ship's horn for the carrier
- Crowd murmur and a tannoy chime for the terminal
- Metal clangs for the hangar and the arrester wire
- A car door, an indicator tick, a handbrake ratchet

## Where to get them, and the licence rule

Use only **CC0 / public domain** audio — this game is published on a public site and the whole project is
CC0, so anything with an attribution or non-commercial clause cannot go in it.

- **freesound.org** — filter by "Creative Commons 0". The largest useful source
- **BBC Sound Effects** (sound-effects.bbcrewind.co.uk) — free for personal and educational use, but
  **check the terms**, they are not CC0
- **Pixabay** and **Zapsplat** — free tiers, check attribution requirements per file

**Format:** mono `.ogg` (Opus) at 48 kHz, trimmed hard at both ends, normalised to about −3 dBFS. Mono is
correct because the game positions sounds in 3D itself; a stereo file cannot be panned properly. Keep each
one-shot under 100 KB.

**Do not** download anything that is a loop of an engine, a propeller, a jet, wind, or a stall warning.
Those already exist and are better than a sample would be, because they follow the aeroplane.
