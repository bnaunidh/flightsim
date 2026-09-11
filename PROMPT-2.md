# Island Flight Simulator — second model pack

Thank you for the first pack. It is wired into the game and it works: the axis
convention was right, the vendored Three was byte-identical, all seven IDs
matched, and the game's 75-check self-test passes with your models driving both
the player's aeroplane and the ones parked on the apron. The breakaway crash
system is the best thing in it.

**But the models it replaced still look better, and we have switched back to
them.** Your fleet is still in the game, behind a dev-mode passcode, so it can
be compared side by side at any time. This document explains exactly why, and
what the second pack needs.

Everything below is measured or photographed in the running game, not guessed.

---

## 0. The rules, unchanged

- Three.js **r169**, the copy already in the game at `src/vendor/three.module.js`.
  One instance. No second copy.
- **Everything procedural.** No model files, no texture images, no audio files,
  no CDN, no npm, no build step. Canvas 2D for textures, Web Audio for sound.
  The whole game is 1.2 MB and works offline on a school laptop; that is the
  point of it.
- **−Z forward, +Y up, +X right.** You got this right. Keep it.
- Full-size metres. Scale 1.
- The audience is **10 to 12 years old**, and it is played on school
  Chromebooks and iPads.
- Keep `createGameAircraft(options, legacyFactory)` and its fallback argument
  exactly as it is. That design is why the first pack was a one-file
  integration instead of a merge conflict.

---

## 1. Why the old models still win — this is the most important section

It is not detail. Your models have **more** detail than ours: pitot masts,
boarding steps, VHF antennas, exhaust stubs, cowling inlets. They also use 60%
fewer triangles (1,732 against 4,378 for the trainer), which is a genuine win.

The problem is **volume**. Side by side on the runway:

- **The wings are flat plates.** Head-on, they read as sheets of paper. Ours
  have visible thickness at the root that tapers to a thin tip, so the wing
  reads as an object rather than a cut-out.
- **The fuselage is slab-sided.** Ours is a rounded loft — the cabin roof
  blends into the spine instead of meeting it at an edge.
- **The cabin glazing is a dark flat wedge** sitting on top of the body. Ours
  is a bright rounded greenhouse with framed panes that follows the body's
  curve.
- **The fin and tailplane are thin flat plates.** Same problem as the wings.
- **The struts and gear legs are wires.** Ours are chunky enough to read at a
  distance, which matters because the undercarriage is the part a ten-year-old
  looks at most — it is what tells them whether they have landed.

So: **spend the triangles you saved on rounding the primary shapes, not on more
small parts.** An aerofoil section with real thickness, a lofted fuselage with
a blended cabin, a canopy with curvature, gear legs with some weight to them.
If you have to delete every antenna and boarding step to afford it, delete
them — nobody has ever noticed them, and everybody notices a paper wing.

A useful test: render the aeroplane head-on at 200 pixels wide. If the wings
disappear, it is not finished.

The four specific fixes from the first round still stand and are listed in
`PACK-FEEDBACK.md`, which you should read alongside this. Briefly: the
propeller disc keeps spinning on a settled wreck; the strike-point search picks
the canopy for impacts from below; `buildAircraft` takes a colour where the
game has a livery scheme object; nothing is cached between instances.

---

## 1b. The aeroplanes look like they have no engine

This is the most-reported thing after the helicopter, and it is true of both
the old models and yours.

A propeller aeroplane's nose is currently a smooth cone with a spinner on the
front. There is nothing that says an engine lives in there. A real light
aircraft nose is one of the busiest parts of the aeroplane and it is all
readable at a glance:

- **A cowling that is a distinct shape from the fuselage** — wider, with a
  definite seam or lip where it joins, and a slight droop.
- **Cooling inlets**: two dark mouths either side of the spinner. These are
  the single strongest "there is an engine in there" signal there is.
- **Exhaust stubs** poking out under the cowl, in dark metal, with a soot
  stain on the belly behind them.
- **Cowl fasteners / a hinge line**, and a separate oil-filler hatch.
- **A spinner that is a real polished cone**, with the blade roots visibly
  entering it rather than floating in front.
- **Heat shimmer** off the exhaust at high power, and **exhaust flame** visible
  at night on a hard climb.

On the jets:

- **Intakes that are open holes with a lip and a visible duct going in** — at
  the moment a fighter is a smooth tube. Splitter plates on the side intakes.
- **A nozzle that is a real ring with petals**, not a flat disc, and that opens
  and closes with throttle.
- **The nozzle glows** with power, and the afterburner lights as a proper
  flame cone with shock diamonds in it.

On the twins:

- **Nacelles that look like engines**, not like tubes: cowl lips, exhaust,
  oil-cooler intakes, and a visible firewall where the nacelle meets the wing.
  The nacelle must also be visibly *narrower* than the fuselage — one of ours
  is currently 0.6 against the fuselage's 0.56, so the engine looks like a
  barrel swallowing the wing.

All of this should be driven by state you already receive: `rpm` for the glow,
the shimmer, the nozzle and the flame; `engineOn` for whether any of it is
alive at all.

---

## 2. Cockpit interiors — a real one per aircraft

Right now the game scales **one** instrument panel into all eight aeroplanes.
The trainer's cabin and the airliner's flight deck are the same room at
different sizes, which is obviously wrong the moment you switch.

Wanted, per aircraft, as a separate factory so the game can attach it inside
the airframe:

- **A panel that matches the aeroplane.** Six round dials and a yoke in the
  trainer. A glass flight deck with two big screens, a thrust-lever quadrant
  and an overhead panel in the airliner. A HUD glass and a centre stick in the
  fighter. Not the same panel three sizes.
- **The inside of the airframe you are sitting in** — window frames in the
  right places, doorposts, the wing root visible out of the side window on a
  low-wing aeroplane and above you on a high-wing one. This is the thing that
  most sells "I am in a different aeroplane".
- **Seats, belts, a coaming, a floor.** Empty seats beside you.
- **Instruments that read real values** from the state the bridge already gets:
  airspeed, altitude, vertical speed, heading, attitude, rpm, fuel, flaps,
  gear. They can be canvas textures redrawn each frame, or geometry needles —
  your call, but they must move.
- **Night lighting**: the panel lights up, the glass reflects it.
- The eye point for each, published the way you already publish
  `flightGeometry.eye`. That field is the only reason the last round's eye
  problem was fixable from outside — eight metres out on the airliner, which
  put the pilot in the cabin looking at the back of the flight-deck wall.

---

## 3. The helicopter is not a helicopter

This is the one that matters most.

The game has a rotorcraft: **`id: 'harrier'`, "Skyhook H-3"**. It is one of
four games in the main menu's switcher (Flight / Heli / Boat / Car), so it is
not a side item — it is a headline. It flies correctly: it hovers, the
collective works, the cyclic points it.

**It is drawn as an aeroplane.** It has wings and a propeller on the nose.
There is no rotor.

Your pack does contain `createHelicopter`, and it is a good model — but it is
not in `planeDefinitions`, so `createFleetAircraft('harrier')` throws
`Unknown fleet aircraft`, and the game can only reach it from your standalone
workshop.

**Wanted:** an entry in `aircraftDefinitions` with `id: 'harrier'`, built
through the same `buildAircraft` path as the aeroplanes so it gets the same
materials, strike points, `flightGeometry` and breakaway sections.

It must animate from the state the bridge already receives:

| State | Effect |
|---|---|
| `rpm` | main rotor speed; blades blur into a disc above about 60% |
| `rpm` at 0 | blades droop about −15° and stop, visibly |
| `controls.pitch` / `controls.roll` | the whole disc tilts (cyclic) |
| `controls.yaw` | tail rotor pitch, and the tail rotor spins |
| load factor | a few degrees of upward coning under load |

And it needs the things that say "helicopter" at a glance: a tail boom with a
real tail rotor, skids or wheels under a belly, a bubble cockpit, a mast and
swashplate you can see turning, and a slight nose-down attitude in the hover.

---

## 4. The boat and the car have no models

The boat is currently **eight untextured boxes**. A white box hull, a dark box
deck, a smaller box cabin, and a cone for a bow. At any distance it is a brick
on the sea. The car is the same idea with wheels.

These are two of the four games. They need the same treatment as the aircraft.

### Boat — "Kestrel Launch", a fast harbour launch about 7.5 m long

- A real planing hull: chines, a sheer line, a pointed bow, a flat transom, a
  rubbing strake along the side.
- A windscreen, a helm with a wheel, two seats, grab rails, cleats, a small
  mast with a navigation lamp.
- An outboard or a stern drive, visibly turning with the steering.
- **Animation**: bow rises as it gets on the plane, heels into turns, bounces
  on the swell, and throws spray off the chines. The wake must persist behind
  it in world space, not be stuck to the hull.
- Named breakaway sections so it can be wrecked: `bow`, `cabin`, `drive`.

### Car — "Airfield Runabout", a small airside van or 4×4

- Wheel arches with the wheels recessed into them, not sticking out on sticks.
- Windows you can see through into an empty cabin with seats and a wheel.
- Mirrors, number plate, lights, a roof beacon, opening doors.
- **Animation**: wheels roll and steer, suspension compresses over bumps,
  it leans in turns, brake lights, indicators, the beacon rotates, and it
  kicks up dust on grass.
- Named breakaway sections: `bonnet`, `doors`, `wheels`.

---

## 5. Each game needs its own dashboard

When you switch games, the HUD stays an aeroplane's HUD. The boat shows a speed
in knots and an *altimeter*. The car shows an *altimeter*. It is the wrong
instrument panel bolted to the wrong vehicle.

Wanted — designed as instrument panels, drawn procedurally, one per game:

- **Boat**: speed in knots, heading, **depth under the keel** (this one
  matters — she draws about a metre and running aground should be a thing you
  can see coming), engine revs, fuel, and a small chart view.
- **Car**: speed in km/h, a rev counter, gear, fuel, a handbrake light, and a
  little airfield map showing which taxiway you are on.
- **Helicopter**: rotor rpm (with a red low-rotor band), torque, a vertical
  speed indicator with much finer resolution than an aeroplane's, radar
  altitude in feet under 500, and a hover indicator — a moving dot showing
  drift, which is the single most useful instrument in a hover.
- **Aeroplane**: what it has now.

Give each one both a full and a minimal variant; the game already has a
"minimal HUD" setting.

---

## 6. Missions and maps for the other three games

Right now all eleven missions are flying missions. The boat and the car are
free-roam only, which means after two minutes there is nothing to do.

### Boat missions
Harbour pilot: guide a ship in through marked channel buoys. Rescue: reach a
position, pick someone up, bring them back within a time limit. Fishing run:
find the marks, stay in the shallows, come home before the weather. Race: a
buoyed course against the clock.

### Car missions
Follow-me: lead a landing aeroplane from the runway to its stand without
losing it. Runway inspection: drive the full length and find the debris. Fuel
run: get the bowser to the right stand before the aeroplane needs it. Time
trial around the perimeter road.

### A city map
The game has five maps and they are all island, volcano or grassland. A **city
map** would change everything for the car and the boat both — streets to drive,
a river and a harbour to take the boat up, a downtown to fly between.

Wanted: a city generator, not a fixed city — the game generates everything.

- A street grid with blocks of varying size, avenues, and some irregularity so
  it is not graph paper.
- **Buildings of real variety**: towers with setbacks, mid-rise blocks with
  cornices and fire escapes, low shops with awnings and signs, warehouses,
  a stadium, a church or clock tower as a landmark, rooftop plant, water
  tanks, aerials, helipads.
- Windows that light up at night, unevenly, and a few that flicker.
- Streets with markings, crossings, kerbs, street lights, traffic lights,
  parked cars, and trees.
- A river with bridges, a waterfront with docks, cranes, moored boats.
- A downtown airport or a riverside strip so an aeroplane has somewhere to go.
- All of it instanced where possible — the whole map has to fit the same
  triangle and draw-call budget as the island.

---

## 7. Buildings, generally

Beyond the city, the game needs a proper building kit it can place anywhere:

- Houses in several styles, with pitched, hipped and flat roofs, chimneys,
  porches, garages, gardens, fences.
- Shops and a high street with signage — canvas text, no font files.
- Farm buildings, barns, silos, greenhouses.
- Industrial: warehouses, a factory with stacks, storage tanks, a quarry.
- Civic: a school, a hospital with a helipad, a fire station, a church.
- Every one with a damaged variant, because things get flown into.

They must accept a ground height function and sit on sloping terrain properly,
and they must take a seed so the same place looks the same every time you fly
there.

---

## 8. Tornadoes

The game has tornadoes, selectable by EF rating (EF0 to EF5), and they are one
of the most popular things in it. The current one is a cone of particles.

Wanted, a real one:

- A **condensation funnel** that reaches from the cloud base to the ground,
  with the funnel's width and how far down it reaches driven by the EF number —
  an EF1 is a thin rope that may not fully touch down, an EF5 is a wedge wider
  than it is tall.
- A **debris cloud at the base**, bigger and dirtier with the rating, picking
  up the colour of what it is crossing: brown over fields, grey over the town,
  white spray over water.
- **Rotation you can see** at several speeds — the funnel surface turning, the
  debris orbiting faster near the core, and the whole thing translating across
  the map.
- **Sub-vortices** on the big ones: two or three smaller funnels orbiting
  inside the main one. This is what makes an EF5 look different from a big EF3
  rather than just wider.
- A **wall cloud** above it and a lowered, rotating cloud base.
- **Things thrown**: debris that gets picked up when the funnel crosses
  something and is flung out — a sheet of roofing, a fence panel, a tree.
- A waterspout variant over the sea.

It also needs to be driven from outside: the game already knows the EF number,
the position, the heading and speed, and what terrain it is over.

---

## 9. Weapons — the B-2 and the military missions

The game has a military side behind a passcode: a **Nightjar B-2** flying wing,
and four military missions including a scored weapons range.

**There are no weapons.** The weapons range mission currently drops a **cargo
crate with a parachute**. That is the whole bombing system.

Wanted:

- **A bomb bay in the Nightjar** that opens and closes, with the stores visible
  on racks inside.
- **A proper bomb model.** The game now has one — X on a military aeroplane
  drops an inert practice store that keeps the aeroplane's forward speed and
  runs about 750 m ahead before it lands — but it is a cylinder, a half-sphere
  nose and four box fins, built in twenty minutes to prove the mechanic. It
  needs a real one:
  - A 1.8 m body with a proper ogive nose and a tapered tail cone.
  - **Four swept fins in a cruciform**, with a fin-can ring joining them at the
    back, which is the detail that makes a bomb look like a bomb.
  - A **suspension lug** and an **arming vane** on the nose that spins after
    release.
  - Painted markings: a blue practice store with a white band and a stencilled
    weight, an olive live one with yellow bands.
  - **Animation**: it noses down onto its flight path as drag builds, tumbles
    if released too slowly, and the arming vane spins up.
  - Your pack already contains `createPracticeBomb`; it is not reachable from
    the game because it lives in `airport.js` rather than being exported as a
    droppable store. Give it its own factory with an `update(dt, state)` and an
    `impact()` so the game can just drop it.
- **A live bomb**, the same shape in olive drab, that explodes: a flash, a
  fireball that rises and darkens into a smoke column, a dust ring that runs
  outward along the ground, a crater and scorch mark that stays, and debris.
- **Release behaviour**: it falls away with the aeroplane's own velocity, noses
  down as drag builds, and tumbles if released too slowly. Releasing it should
  visibly lighten the aeroplane.
- **A bomb sight** — a simple impact-point marker on the ground that moves as
  you fly, so a ten-year-old can learn that you release *before* the target.
- **A practice range worth bombing**: a bullseye with scoring rings, quadrant
  markers, hulks and old vehicles as targets, a spotting tower.
- **Countermeasures**: a flare dispenser that throws burning flares behind the
  aeroplane. Purely visual, and enormously popular.

Nothing here should be gory or aimed at people. Targets are markers, vehicles
and structures on a range.

---

## 9b. Different aeroplanes want different places to fly from

Everything used to fly from the same tropical island strip — the trainer, the
airliner and the bomber. That undercuts all three.

A military air base has now been built into the game (**Ironhead Air Base**: a
3.2 km runway on a dry plain, hardened shelters, earth revetments, blast walls
and a radar that turns), and the military missions fly from it. It is behind
the same passcode as the military aircraft.

What is wanted from you is the same idea carried much further, as a **base kit**
rather than one base:

- **Military field**: hardened shelters, revetments, blast walls, a fuel farm
  in a bund, arming pads, a control tower with a different shape from the
  civil one, alert sheds at the runway threshold, arrestor gear, a radar.
- **Big civil airport**: piers with air bridges, a terminal with real signage,
  cargo sheds, a de-icing pad, hold-short markings, taxiway signage.
- **Bush strip**: a dirt runway, a windsock on a pole, one shed, fuel drums,
  a couple of tied-down light aircraft.
- **Carrier**: already partly there, but it wants a deck crew, tie-downs,
  a jet blast deflector that raises, and a catapult shuttle that runs.
- **City airport**: short runway hemmed in by buildings, which is the one that
  makes a city map worth flying in.

Each as a factory that takes a position and a runway heading and builds itself
around them, so any of them can be dropped onto any map.

## 10. Priority order

1. **The helicopter that is actually a helicopter** (§3) — it is one of the
   four games and it currently has a propeller on the nose.
2. **Engines you can see** (§1b) — cowlings, inlets, exhausts, nozzles. This
   is the one the players themselves keep raising.
3. **Aircraft shapes with volume** (§1) — the models only go back in when they
   beat what is already there.
4. **Boat and car models** (§4) — two more of the four games, currently boxes.
5. **A real bomb model and the B-2's bay** (§9).
6. **Per-game dashboards** (§5).
7. **Cockpit interiors** (§2).
8. **Tornadoes** (§8).
9. **The base kit** (§9b) — different aeroplanes flying from different places.
10. **The city map and the building kit** (§6, §7) — the biggest piece, and
    the one that changes the game most.

Deliver in that order, one at a time if it helps. The first pack arrived all at
once and it took a full day to work out what was good in it; something small
that lands and works is worth more than everything at once.
