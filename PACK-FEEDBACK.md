# Island Flight Model Pack — feedback after wiring it into the game

**Short version: it is good, it is in the game, and it flies.** Seven aircraft,
75/75 on the game's own self-test with the pack driving every model, and fewer
triangles than the models it replaced. Below is what I checked, what needs
changing, and what to build next.

Nothing here is style opinion. Every number is measured in the running game.

---

## 1. What was checked, and passed

| Check | Result |
|---|---|
| Axis convention | **−Z forward, +Y up** — correct, and stated in the source. This is the one that would have been fatal. |
| Vendored Three | `src/vendor/three.module.js` is **byte-identical** to the game's r169. No second copy loaded. |
| Aircraft IDs | `skylark, courier, meridian, tempest, vanguard, osprey, nightjar` — all seven match the game's own IDs exactly. |
| Self-test | **75/75** with the fleet driving the player aircraft and every parked aircraft on the apron. |
| Control surfaces | Ailerons, flaps, elevators, rudder all move with the stick. |
| Gear | Retracts and hides correctly; `gearPos 1 → 0` drives it. |
| Propeller | Blades and motion disc both work in flight. |
| Liveries | The game's accent colour reaches the tail, wingtips and nacelles. |

### Triangle counts (measured, six instances each)

| Aircraft | Pack | The model it replaced | Change |
|---|---|---|---|
| Skylark 172 | **1,732** | 4,378 | −60% |
| Meridian 220 | **1,998** | 5,076 | −61% |
| Vanguard F-1 | **1,506** | 4,308 | −65% |

Meshes per aircraft: **45**, the same as before — so draw calls did not regress.
Materials: 67 per six aircraft vs 72. Build time: ~3.7 ms vs ~2.5 ms.
This is a straight win. Do not trade it away for more detail.

### Crash behaviour, once it was given a real contact point

| How it hit | What came off |
|---|---|
| Nose-first dive, 63 m/s closing | `nose` detaches, severity 1.0 |
| Tail-first, 48 m/s | `tail`, `leftElevator`, `rightElevator`, `verticalFin` — the whole dependent chain |
| Heavy landing, 26 m/s | `fuselage` crushed, severity 0.87, nothing detaches |

The dependency chain (fin depends on tail) is the best thing in the pack.

---

## 2. How it was integrated — please target this seam in future

**The installer was not run.** `install-fleet.py` checks the four files it
patches against two audited revisions and refuses on local edits. The game has
moved on since those revisions, so it would have refused — correctly. That
refusal is good behaviour; keep it.

Instead the pack sits behind one adapter, `src/aircraft/model-adapter.js`,
which presents the game's existing factory signature:

```js
createAircraftModel({ type, livery }) -> THREE.Group with userData.update(dt, ac, weather)
```

It calls `createGameAircraft` for the seven IDs the pack covers and falls back
to the game's own `model.js` for anything else, including if the pack fails to
import. **Please keep `createGameAircraft(options, legacyFactory)` and its
fallback argument exactly as they are** — that design is what made this a
one-file integration instead of a merge conflict.

Two more bridge functions are wired: `synchronizeGameAircraft` (so the crash
body owns the transform) and `beginGameAircraftCrash`. `configurePlayerAircraft`
is **not** wired yet — see item 3.6.

---

## 3. Changes needed, most important first

### 3.1 The helicopter is not in the fleet, and it needs to be

`createHelicopter` exists in `helicopter.js` and is a good model, but it is not
in `planeDefinitions`, so `createFleetAircraft('harrier')` throws
`Unknown fleet aircraft`. It is only reachable from the standalone workshop
catalog.

The game's rotorcraft is **`id: 'harrier'`, name "Skyhook H-3"** — and it is now
one of four games in the main menu's switcher (Flight / Heli / Boat / Car), so
it is no longer a side item. It is the one aircraft a beginner is most likely
to pick.

**Wanted:** an eighth entry in `aircraftDefinitions` with `id: 'harrier'`, built
through the same `buildAircraft` path as the others so it gets the same
materials, strike points, `flightGeometry` and breakaway sections. The existing
helicopter geometry is fine; it is the plumbing that is missing.

It must animate from the same state the bridge already receives: `rpm` drives
rotor speed and blur, `controls.pitch/roll` tilt the disc, `controls.yaw` drives
the tail rotor, and a stopped rotor should droop.

### 3.2 The propeller disc keeps spinning after the crash

Measured on a settled wreck: `rpm 0`, `engineOn false`, `crashed true`, and
`Propeller motion disc` still `visible: true` at `opacity 0.24`.

Once `gameCrash` is set, the bridge stops calling the normal `update()` and only
advances debris and impact, so the disc freezes at whatever opacity it had when
the aeroplane hit. An upside-down wreck with a spinning propeller is the single
most obviously wrong thing in the whole integration.

**Wanted:** when a crash begins, force the propulsion visuals to their dead
state — disc hidden, blades stopped, jet glow off — and keep them there.

### 3.3 The strike-point search ignores which side was hit

Before an explicit `partId` was plumbed through, **every** ground contact
selected `canopy`. A belly landing tore the canopy off. A wing-down impact tore
the canopy off. The canopy is on top of the aeroplane; nothing that hits the
ground from below should ever reach it first.

The search in `beginGameAircraftCrash` picks the strike point nearest the
contact, and with `worldNormal` defaulting to `(0,1,0)` the canopy sits nearest
the fuselage centre on most airframes.

**Wanted:** reject strike points on the far side of the contact plane — take the
dot product of (strike point − contact) against the impact normal and discard
anything pointing away from the surface. The game now passes a real
`worldPoint`, `worldNormal` and `partId`, so this is belt and braces, but a
model pack should not depend on the host getting it right.

### 3.4 `buildAircraft` takes a colour where the game has a scheme

`aircraft-core.js:10` reads `options.livery || options.paint || config.paint`
and expects a colour. The game's liveries are objects:

```js
{ id, name, base, accent, cheatline, tail, reg }
```

Passing one straight through would set the paint to `[object Object]`, so the
adapter currently flattens it to `base` + `accent` and **drops the cheatline,
the tail colour and the registration**. Three of the seven airline liveries lose
most of what makes them recognisable.

**Wanted:** accept a scheme object and honour all four fields. Two constraints
learned the hard way in this game:

- **The fin must be its own material.** A cheatline painted into the body
  texture UV-unwraps into a ring around the fuselage. That is why the game
  keeps a separate `tailMat`.
- **The registration is drawn text**, canvas-generated, no font files.

### 3.5 Nothing is cached between instances

Six Skylarks produced **270 unique geometries** and 67 unique materials — every
instance rebuilds everything. The apron parks several aircraft at once and each
one pays full price.

(The game's own factory has the same flaw, so this is not a regression — but the
pack is the one that should fix it.) A module-level cache keyed on
`(id, paint, accent)` for geometry, and on `(id, paint)` for textures, would cut
the airport build cost substantially. Anything that gets mutated per-instance —
damaged geometry, breakaway sections — has to stay out of the cache, or clone on
first damage.

### 3.6 `configurePlayerAircraft` mutates the live SPEC

It rewrites `spec.gearPoints` and `spec.hardPoints` in place. In this game
`SPEC` is a live ES-module binding that is hot-swapped when you change aircraft,
and the flight model, the taxi system and the crash detection all read it.
Mutating it from a model pack is a real risk, so it is not wired yet — the
visible wheels currently sit at the game's own gear positions.

**Wanted:** have it *return* the geometry rather than write it, so the host can
decide when to adopt it:

```js
const geo = fleetGeometryFor(model);   // { gearPoints, hardPoints, eye, wingSpan, bounds }
```

### 3.7 Small things

- Wrecks settle slightly **below** the terrain surface — the fuselage sinks into
  the grass. The settle height wants the visible hull radius, not the origin.
- The **Kestrel Courier reads as a utility aircraft, not a tourer** — the wing
  sits at or above the cabin floor and the glazing is oversized. A low-wing
  tourer has the wing below the door sill and a much smaller greenhouse.
- **Detached sections land undamaged.** A wing that has just been torn off an
  aeroplane is bent and crumpled at the root, not a clean straight panel lying
  flat. Even a slight bend and a torn root edge would sell it.
- The **fuselage itself never visibly deforms** — the dent system reports
  `movedVertices`, but at 63 m/s the nose should be visibly crushed, not just
  scuffed.

---

## 4. Models still wanted

In priority order. Everything procedural, no asset files, same conventions.

1. **`harrier` in the fleet** — see 3.1. This is the blocker.
2. **The Boat and the Car as fleet-grade models.** They are now first-class
   games in the menu switcher, and their current models are much simpler than
   the aircraft. `createPlayerBoat` and `createAirfieldRunabout` exist in the
   pack but have not been wired; they need the same treatment as the aircraft —
   a bridge that takes the game's vehicle state
   (`{ speedKts, heading, throttle, distanceM, crashed }`) and the same named
   breakaway sections. A boat that loses its deckhouse when you drive it into a
   cliff would be very popular with the people who test this.
3. **Weapons for the military missions.** The game has military aircraft behind
   a passcode and military missions, and no ordnance model at all. Wanted: a
   rack, a released store with inherited motion, and an impact. The brief's
   inert blue practice bomb exists — it needs an armed sibling with a visible
   fireball, and a countermeasure flare.
4. **A damaged/mid-air-breakup variant of the flying wing.** The Nightjar has no
   tail, so the tail dependency chain that makes the other six crashes good does
   nothing for it. It needs its own failure story: outboard elevons, then a
   wing panel.
5. **Cockpit interiors matched to each airframe.** The game scales one interior
   into all seven. The Meridian's flight deck and the Skylark's cabin should not
   be the same room.

---

## 5. One thing not to change

The workshop, the manifest, the per-module docs, the dry-run installer and the
render PNGs are all genuinely useful and made this evaluation take an hour
instead of a day. The revision check refusing to patch edited files is correct
behaviour. Keep all of it.
