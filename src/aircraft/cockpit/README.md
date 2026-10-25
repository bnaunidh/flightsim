# Cockpits — family table and framework API

Stage: COCKPIT FRAMEWORK + LIGHT AIRCRAFT (brief item 2). Branch `cockpit-core` off `dd8f921`.
A copy of this file lives in the repo at `src/aircraft/cockpit/README.md` (kept in step).

## 1. Inventory at dd8f921 (what every aircraft gets today)

There is ONE cockpit (`src/aircraft/cockpit.js`, `createCockpit({ highContrast, type })`). It picks a
"style" from `type.class` in `COCKPIT_STYLES` (trainer / tourer / airliner / fighter / carrier) — which only
changes the stick (yoke or centre stick), the levers (prop trio / 1 / 2 thrust levers), two colours and
the canvas panel layout ('classic' six-pack or 'glass' PFD). The 3D shell (box walls, two posts, a flat
roof, a 1.46 x 0.73 m canvas panel 1 m ahead) is the same box in every aeroplane and ignores the exterior:
classes with no style (Helicopter, Racer) silently get the trainer's (yoke + propeller levers in the
Skyhook and in Air Massimo).

Eye = where main.js seats the camera (`eyeFor(model, S.eye * S.scale)`), metres, model frame (-Z forward).
main.js places the cockpit group so its own `TRAINER_EYE (-0.24, 0.46, 0.06)` lands on that eye, at life
size (scale 1 / shape.scale on the civil models, 1 on fleet-pack models).

| type | name | class | FAMILY | today's cockpit (style / panel / stick) | eye (m) | exterior windscreen — drawn by |
|---|---|---|---|---|---|---|
| skylark | Skylark 172 | Trainer | **light** | trainer / six-pack / yoke + 3 levers | -0.24, 0.46, 0.06 | civil hull `models/skylark.js`: wrap-round windscreen z -0.99..-0.46 (ctr->ws, thin centre strip), 2 door windows a side (roof->belt), rear window behind the wing, roof = wing underside; firewall cap z -1.02 |
| courier | Kestrel Courier | Tourer | **light** | tourer / six-pack / yoke + 3 levers | -0.26, 0.48, -0.05 | civil hull `models/courier.js`: windscreen z -1.28..-0.66 (ctr->ws), 3 side windows a side (roof->belt), metal roof, low wing; firewall cap z -1.3 |
| tempest | Tempest WR-4 | Tourer | **light** (twin turboprop) | tourer / six-pack / yoke + 3 levers | -0.49, 0.74, -1.93 | civil hull `models/tempest.js` (x1.75): windscreen z -1.7..-1.32 (ctr->ws), flight-deck side windows z -1.26..-0.74 (fdTop->fdBot), survey window row behind; radome nose, NO firewall cap |
| meridian | Meridian 220 | Airliner | airliner | airliner / glass PFD / yoke + 2 thrust | -0.62, 0.62, -3.08 | civil hull `models/meridian.js` (x2.05): windscreen z -2.74..-2.44 + 2 flight-deck side windows; (pack when "fleet models" is on: canopy kind 'airliner' z -12.8..-10.25) |
| a320 | Airbus A320 | Airliner | airliner | airliner / glass / yoke + 2 | -0.52, 0.60, -13.35 | fleet pack `fleet/extra/airliners.js` (canopy null; windscreen panels on the nose) |
| b747 | Boeing 747 | Airliner | airliner | airliner / glass / yoke + 2 | -0.55, 3.55, -27.4 | fleet pack (upper deck) |
| a380 | Airbus A380 | Airliner | airliner | airliner / glass / yoke + 2 | -0.60, 0.90, -30.9 | fleet pack |
| vanguard | Vanguard F-1 | Fighter | fighter-jet | fighter / glass / centre stick + 1 | 0, 0.65, -3.1 | fleet pack `aircraft-combat.js`: bubble canopy z -4.55..-1.28, w .56 h .59 base .21 |
| osprey | Osprey CV | Carrier | fighter-jet | carrier / glass / centre stick + 1 | 0, 0.73, -2.85 | fleet pack: bubble z -4.26..-1.42, w .64 h .62 base .25 |
| nightjar | Nightjar B-2 | Fighter | fighter-jet (bomber flight deck) | fighter / glass / centre stick + 1 | -0.37, 0.54, -4.53 | fleet pack flying wing, canopy null (flush cockpit windows) |
| f22 | F-22 Raptor | Fighter | fighter-jet | fighter / glass / centre stick + 1 | 0, 1.02, -6.2 | fleet pack `fleet/extra/fighters.js`: bubble z -7.75..-3.6, w .52 h .78 base .62 |
| f35b | F-35B | Fighter | fighter-jet | fighter / glass / centre stick + 1 | 0, 1.02, -5.45 | fleet pack: bubble z -6.6..-3.6, w .5 h .72 base .62 |
| fa18 | F/A-18 Hornet | Carrier | fighter-jet | carrier / glass / centre stick + 1 | 0, 0.98, -5.9 | fleet pack: bubble z -7.1..-4.0, w .5 h .64 base .55 |
| massimo | Air Massimo | Racer | special (racer) | NO style -> trainer / six-pack / YOKE + prop levers | 0, 0.85, -6.8 | fleet pack: bubble z -8.3..-4.6, w .44 h .5 base .5 |
| harrier | Skyhook H-3 | Helicopter | special (helicopter) | NO style -> trainer / six-pack / YOKE + prop levers | -0.28, 0.50, -1.13 | Blender heli (`vehicles/blender-models.js`), else civil hull `models/skyhook.js`: wrap windscreen z -2.1..-1.0, chin windows, 2 doors a side |
| tpose | T-Pose Harrison | Racer | **excluded** (Harrison builder: view from his head; eject.js hides `sim.cockpit` in the cockpit view) | — | 0, 2.7, -0.34 | none |

Light family = skylark, courier, tempest (this stage). Airliner, fighter-jet and special families keep
today's cockpit (the `generic` builder, unchanged) until their builders replace it.

## 2. Framework (src/aircraft/cockpit/ + the entry point src/aircraft/cockpit.js)

```
src/aircraft/cockpit.js          entry: createCockpit({ highContrast, type, model }) + re-exports
src/aircraft/cockpit/families.js FAMILY table, cockpitFamily(type), registerCockpitBuilder(), builderFor()
src/aircraft/cockpit/space.js    cockpitSpace(type, model): eye/scale maths; exteriorGroup(); glazingOf()
src/aircraft/cockpit/canopy.js   THE WINDOW-FRAME HOOK: interior skin/frames/reveals/glass from the exterior glazing
src/aircraft/cockpit/paint.js    shared canvas painting (bezels, dial faces, labels, needles, panel base)
src/aircraft/cockpit/gauges.js   steam gauges as static art + mesh needles/cards (no per-frame canvas uploads)
src/aircraft/cockpit/panel-canvas.js  InstrumentPanel: today's canvas panel (classic + glass PFD), kept as-is
src/aircraft/cockpit/common.js   shared 3D parts + behaviours: materials, warning lamps + master caution,
                                 rain on the glass, yoke / stick / levers / pedals, lighting, blackout
src/aircraft/cockpit/generic.js  today's cockpit, the fallback for every family without a builder
src/aircraft/cockpit/light.js    LIGHT family builder (skylark, courier, tempest)
```

### Choosing a builder
`createCockpit({ highContrast, type, model })` -> `builderFor(type)` -> `builder(ctx)` -> THREE.Group.
`ctx = { type, model, highContrast, family, space, glazing }`. Unknown/failed builder -> `generic` (a throw
in a family builder is caught, logged once, and the generic cockpit is built instead — a new builder can
never take the cockpit view away).

`registerCockpitBuilder(family, fn)` — a family stage adds its file and one import in cockpit.js.
`FAMILY` maps type ids (and classes as fallback) to 'light' | 'airliner' | 'jet' | 'heli' | 'racer' | 'none'.

### The group contract (what main.js, features and tests rely on — unchanged)
- group.name 'cockpit'; main.js positions/scales it so cockpit-local `TRAINER_EYE` is the pilot's eye.
- `userData.update(dt, ac, weather, sim?)` per frame while in the cockpit view (sim = the game; optional).
- `userData.panel` with `.texture` (selftest), `userData.panelFace` (mesh), `userData.warnings` (lamp list
  `{ key, label, mat }`, read by tests/playtest.js), `userData.family`, `userData.builder`.
- `userData.stick` (jets) / `userData.throttle2` as before for the generic builder.

### space.js — the eye/scale maths, once
`cockpitSpace(type, model)` -> `{ k, eye, toLocal(v), exteriorGroup() }`:
k = 1 for fleet-pack models else `shape.scale`; eye in metres in the model frame (same `eyeFor` main.js uses).
`exteriorGroup()` is a Group inside the cockpit whose children are authored in the MODEL's own units
and frame (shape units for civil models), so interior geometry derived from the exterior lands exactly on it.

### canopy.js — the window-frame / canopy hook
`glazingOf(type, model)` describes the exterior glass the cockpit must match, from (in order):
1. the civil hull the exterior was lofted from (`model.userData.cabinHull`, set in model.js buildCivil;
   civil-kit.js hull() now exposes `glazing: { lines, windows, at(name, z) }`), or
2. the fleet pack's `config.canopy` (`{ kind, z0, z1, width, height, baseY }`), or
3. a default box cabin from the shape.
`interiorShell(glazing, opts)` builds, in exterior units: the inner skin (inset `t` from the outside skin,
wound inwards, vertex-coloured headliner / sidewall / carpet), the window OPENINGS cut on exactly the
exterior's window lines (grid aligned to them, so edges are clean), a dark FRAME band round every opening,
the REVEAL (the skin's thickness, inner edge to outer glass edge), front/back bulkheads from the section,
and the inside GLASS panes (rain droplets + a faint sheen) per opening. Returns
`{ group, windscreen: { z0, z1, baseY(x), ... }, sectionAt(z), halfWidthAt(z, y) }` for builders to fit the
panel, glareshield and posts.
Families with canopies (bubble, airliner flight deck) use the same entry point with their own glazing kind.

### Instruments — cheap by construction
- paint.js: static art painted ONCE into a canvas (bezels, faces, ticks, placards, radios).
- gauges.js: per frame only transforms/uniforms — needle meshes rotate, the attitude ball is a disc whose
  texture matrix moves (pitch) and turns (bank), the heading card turns, the slip ball slides. No canvas
  repaint, no texture upload per frame. Small number windows (e.g. altimeter drum) are a tiny canvas
  repainted at most 10 Hz only when the number changes.
- panel-canvas.js: the old 1600x800 canvas panel (30 Hz repaint) stays for the generic builder only.

### Behaviours every builder keeps (common.js)
warning lamps (ENGINE/FUEL/PITCH/ICE/GEAR/BRAKES/ENG ROUGH/TYRE from `ac.failures`, low fuel < 7.5 %) +
flashing MASTER CAUTION; gear / flap indicators; autopilot (AP lamp on the panel when `sim.autopilot.engaged`);
instrument blackout (`sim.instrumentBlackout > 0`, lightning or mayday: needles drop, faces go dark, lamps
off); rain droplets on the glass (`weather.cond.rain`, scroll with airspeed); the cockpit-camera toggle
(C / realistic cockpit — main.js only toggles `visible`); iPad (no hover/pointer dependence; same cost).

## 3. Light family (this stage)
From the pilot's seat, matching each exterior from inside: interior skin with the real window openings,
frames, door posts and centre strip, padded glare-shield sitting on the windscreen's lower edge, a
type-specific panel (six-pack in front of the left seat, radio stack, engine gauges, switches), two yokes,
throttle/mixture plungers (Skylark), throttle/prop/mixture + gear lever (Courier), twin power/condition
quadrant (Tempest), flap lever + indicator, trim wheel, fuel selector, rudder pedals, seats, wet compass,
sun visors, eyeball vents, door handles.

## 4. Proof
First-person shots of every light type (day, dusk, rain) vs dd8f921; cockpit frame time with 4x CPU throttle;
node checks (tests/features/cockpits.mjs) + browser checks (tests/features/cockpits.browser.js in CHECKS);
one full self-test at the end.

## 5. Cockpits v2 (feat/cockpits-v2, 2026-10-16): every family has its own room

The owner, after looking at another game's cockpit: "can you look at their cockpit model and look at it and
make it better for us". Reference shots of that game's F/A-18, F-22 and 777 were taken (looked at, nothing
copied). What makes theirs read well: a strong canopy bow framing the top of the view, the HUD's two posts and
glass standing on a thick padded glareshield, square screens in chunky bezels with push-buttons, real content on
the screens (map, pitch ladder, engine dials), the 777's mode-control panel on the glareshield with live
numbers. Where theirs is weak, and ours now is not: one fighter cockpit shared by every jet (even the bow is
painted the same blue), frames that match no exterior, no sun or shadow inside, flat green-only screens, an
airliner with no overhead, no pedestal, no seats and no sense of size.

| family | builder | types | the room is cut from |
|---|---|---|---|
| light | light.js | skylark, courier, tempest | the civil hull (canopy.js interiorShell) |
| jet / racer | jet.js | vanguard, osprey, f22, f35b, fa18, massimo; nightjar (two-seat deck) | the pack's canopy ellipsoid (`config.canopy`); the Nightjar's four flat panes |
| airliner | flightdeck.js + deck-skin.js | meridian, a320, b747, a380 | the exterior's hull and its six panes in (z, s) (`userData.flightDeck.hull/quads`, airliner-parts.js glazing) |
| heli | heli.js | harrier | the Skyhook hull (models/skyhook.js `skyhookHull()`, also when the Blender model draws the outside) |
| none | — | tpose | (his own head) |

Shared: `kit.js` (PBR finishes, bezels, seats, sticks, levers, painted switch panels, `mergeStatic` — every part
that never moves merged per material — and `seeThrough`, which hides the exterior's tinted canopy and dummy seat
from a camera inside it, per draw), `displays.js` (PFD, ND, EICAS, systems, MCP/FCU, CDU, jet ADI/HSI, moving
map from the minimap's own chart, engines/fuel/stores, UFC, the racer's screen, the HUD), `DisplayBus` (each
screen ~12 Hz, the one that has waited longest first, at most two a frame; no DOM per frame).

Per type: jets get a bubble canopy with sill rails and (F/A-18, Osprey, F-35) a bow with mirrors, a HUD with
its combiner and posts (the F-35 a helmet-style frameless one), the type's screen layout (hornet / viper /
raptor / panoramic / racer), consoles, a centre or side stick, a throttle, an ejection seat's edges and handle.
Airliners: a glareshield across the windscreens' sills with the MCP/FCU and EFIS panels, six screens
(PFD/ND each side, EICAS and systems centre), the pedestal with one thrust lever per engine, flap and speed
brake levers, CDUs, Boeing trim wheels, yokes (747, Meridian) or side-sticks (A320, A380), two seats, side
consoles with tillers, the overhead panel, the aft bulkhead with the door, breakers and the observer's seat.
The helicopter: chin bubbles at the pilot's feet, a hood over a narrow console, the six, dual tach, torque,
TOT, fuel and a small map, cyclic, collective (rises with the lever), pedals.

Light: the sun's shadow map is pulled in to 16 m round the pilot's eye while the cockpit view is up (sky.js
`setShadowReach`), so frames and the glareshield throw sharp shadows inside. Head look: the mouse with free
look (as before), and a finger dragged across the picture in the cockpit view (input.js `touchLook`).

Checks: tests/features/cockpits.mjs section 7 (every type has its builder; screens read the sim's own
numbers; no geometry within 10 cm of the eye in either view; canopy/panes open and no daylight through the
tub or the walls; the HUD's scale from its distance; the exterior glass hidden from inside only; lamps,
blackout, controls).

### Seen in the game (what the real renderer showed, and the fixes)
- The exteriors run on through the cockpits (a fighter's fuselage bulges up under its canopy; the 747's main
  deck runs under its upper-deck flight deck; the Blender helicopter has a cabin of its own; the Skylark's
  airframe behind the head). `kit.js carveExterior(model, box)`: every exterior mesh reaching into the
  cockpit's box carries six clipping planes (clipIntersection) that are moved onto the box for a camera inside
  it — and for the sun's shadow while it is — and out of the way for every other camera: one shader, no
  per-draw switch. Meshes wholly inside the box are not drawn while the camera is in the seat
  (`userData.viewing(seated)`, called by main.js every frame). main.js sets `renderer.localClippingEnabled`.
- The fleet landing spot sat halfway along the nose (beside the pilot) and floodlit the panel; its beam starts
  at the nose tip now (model-adapter.js addLights). The lamp sprite stays where the model puts it.
- Airliner screens sit low under the big windows, so a cockpit may set `userData.viewPitchDeg` (how far down
  the cockpit view looks; camera.js `cockpitPitchDeg`): the airliners work it out so the realistic view
  holds the screens (A320 about 14), capped at 15 (`VIEW_PITCH_MAX`; at the old cap of 20 the 747's and
  the Q400's horizons sat a fifth of the way down the picture); everything else keeps 8.
- The eye sits where the exterior's config says (`eye` in src/aircraft/extra/*.js, types.js for the civil
  kit): the wave-9 views lane moved the An-225, C-5, C-17, B-1B, Concorde, 737, Q400, Meridian and Courier
  eyes (and widened four giants' windscreen inboard corners) so each has 8+ degrees of clear windscreen
  above the eye line and the nose drops away 8+ degrees below it. tests/features/cockpits.mjs holds the
  bands (`VIEW_BANDS`) and measures them the way the checker did: rays from the eye, 0.5 degrees apart.
  It also holds the captain's PFD in the default view (90 % of it in the cockpit view, 60 % in the
  realistic one): the panel hangs under the sill, so an eye pushed far forward or up for the view over
  the nose loses the screens off the bottom of the picture (the first C-17/737/Q400/Meridian moves did).
- Cost: screens repaint only when what they show changed (a signature of the numbers they draw, at least
  once a second), at their own rates, on 3/4-size canvases; only parts big enough to see cast shadows.


### Second pass (2026-10-17): what the shots and the frame clock found
- **Needles that did not move.** `mergeStatic` took every gauge needle off its pivot into the room's merged
  mesh (the Skyhook's whole panel, the Vanguard's standby three): the pivot turned, the needle stayed
  painted where it was built. Everything in gauges.js that moves is flagged `userData.dynamic`, and a part
  hidden at build time (an OFF flag, a dead screen's cover, a lamp) is never merged. The node check now
  watches what a flight moves and fails on any of it with nothing left to draw.
- **The Tempest's power and condition levers** started with no position, eased to NaN on the first frame
  and were never drawn. The NaN check read last frame's matrices; it refreshes them first now.
- **The guidance rails** (navguide.js) are drawn without the depth test so they glow over hills; from the
  seat that painted two cyan stripes across every panel. In the cockpit view they take the depth test.
- **The Hornet's centre** (F/A-18, Osprey): the bare panel between the DDIs read as a dead screen in the
  sun; it is the up-front keypad now, painted once into the panel (no draw).
- **The Courier's air vent** hung in the side window (its roof is too narrow outboard of the visor); it goes
  inboard there.

#### The cost, made no more than the follow view's
| what | where | draws saved |
|---|---|---|
| merge at all (the light builder never did) | light.js | Skylark 85 -> 62 meshes |
| merge inside every moving part, in its own frame (`keepApart` for seats) | kit.js mergeStatic | 2-6 |
| the panel's hubs and fittings merge with the room | jet, flightdeck, heli | Skyhook 42 -> 36 |
| every needle of a panel is ONE mesh, its vertices moved on the CPU only when a pivot turned | gauges.js `_batch` | 9-13 |
| every moving part (yokes, sticks, levers, pedals) is one SKINNED mesh per material, the parts its bones: the GPU moves each piece by its part's own transform; the originals stay in the tree on layer 31 (no camera, shadow or ray) | kit.js `batchMovers`, cockpit.js | 6-15 |
| the cockpit's solid parts draw first (render order -100, after the sky): the panel fills the depth buffer before the island, so a chip that shades in draw order skips the terrain behind it | cockpit.js `COCKPIT_FIRST` | (GPU) |

#### Measured (2026-10-17, Medium, realistic cockpit view vs the follow view)
Headless Chrome on the M1 Pro (ANGLE/Metal), 1280 x 713, world built at Medium; 8 interleaved blocks of 24
frames per view, each frame `sim.update(1/60)` + draw + a 1-pixel readback (so "frame" includes the GPU).
Medians; the Mac was busy with other builders' browsers, so +-0.3 ms is noise. Scratch script:
`scratchpad/cp2/verify.mjs` (open, shots, then timing in one browser).

| type | draws follow / cockpit | CPU ms follow / cockpit | frame ms follow / cockpit | frame mean follow / cockpit |
|---|---|---|---|---|
| Skylark | 259 / 264 | 4.2 / 4.6 | 9.4 / 9.6 | 12.5 / 10.7 |
| Courier | 261 / 275 | 4.1 / 4.5 | 9.1 / 9.1 | 12.3 / 10.9 |
| Skyhook | 261 / 266 | 4.1 / 4.6 | 9.5 / 10.1 | 10.1 / 10.7 |
| F/A-18 | 311 / 278 | 4.7 / 5.1 | 10.2 / 10.6 | 15.7 / 18.7 |
| F-22 | 305 / 273 | 4.7 / 5.0 | 10.7 / 9.9 | 13.4 / 11.0 |
| 747 | 310 / 270 | 4.7 / 4.8 | 10.8 / 9.9 | 12.5 / 11.9 |
| A320 | 287 / 271 | 4.5 / 4.8 | 10.2 / 9.2 | 12.6 / 11.6 |

Before this pass the Skylark's cockpit was 290 draws and the jets' about 280; the whole frame is now the
follow view's within the noise, and the mean frame is lower in the cockpit for five of the seven. What is
left on the CPU side (0.1-0.5 ms) is the cockpit's own update (its screens, ~0.1 ms) and its shadow
casters; on a chip that shades in draw order the cockpit-first draw order also skips the terrain under
the panel, which the M1 (a tile renderer that already hides it) cannot show.

## 6. Every aircraft, sized by the real one (w8-cockpit, 2026-10-24)

The fleet added after v67 had no row in the family table and fell to the generic box. Now every type
has its family room, cut from its own exterior (`.claude/devtools/briefs/cockpit-refs.md` holds the
reference photographs, licences and the layout notes each room follows):

| types | family | what the photographs added |
|---|---|---|
| b737, a321, b787, a350, b777, q400, concorde, belugaxl, dreamlifter, an225, c5, c17, b1b | airliner (flightdeck.js) | per-type `AIRLINER` character: yoke / side-stick / **centre stick** (C-17, B-1B), one thrust lever per engine (six on the An-225), the Q400's **condition levers**, an **overhead HUD** (787, C-17), screen sizes, map ranges, the maker's colours; the B-1B's exterior (lancer.js) now publishes its deck hull + panes like the airliners |
| a10 | jet (jet.js) | `JET.a10`: Hornet-style MFCDs round the UFC, centre stick, two throttles, grey-green, no bow |
| bell407, r44, h145, aw139, uh60, ch47, ah64 | heli (heli.js) | per-type `HELIS`: **glass** (PFD + map screens in front of the pilot) on the H145/AW139/UH-60/CH-47/AH-64, round dials on the Bell and the R44, the Apache's **tandem** seat (no second seat or pedals; its panel close and low under the divider between the two canopies, its own canopy glass to the top from inside, no overhead strip, the view pitched 20 degrees down to the screens), a panel wide enough to reach the Black Hawk's and Chinook's outboard seats; the UH-60's and CH-47's eyes lowered under their roofs (extra/helis.js) |

Checks (tests/features/cockpits.mjs): every roster type in the table and in the Low budget (≤ 60 draws,
≤ 40k triangles, ≤ 10 screens, two repaints a frame); each airliner's deck width within 45–100 % of the
published fuselage width and ordered regional < narrow < wide; the real controls per type (stick kind,
lever count, condition levers, HUD); gear lever and levers move; chin windows sampled on each hull's own
lines. Browser (cockpits.browser.js): b777, q400, c17, b1b, a10 and uh60 join the game-side check.
Measured on the node build: airliners 48–53 draws / 19–25k triangles, jets 24–33 / 10–12k, helicopters
26–30 / 12–33k (the Chinook's long hull is the biggest room).
