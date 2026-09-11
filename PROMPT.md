You are helping me build models for **Island Flight Simulator**, a browser flight simulator written in
three.js that I built for my school class. 29 kids have played it. I need better 3D models, and I need
them written as code, not downloaded.

## THE ONE RULE THAT MATTERS

**Everything in this game is generated in code. There are no asset files of any kind.** No `.glb`,
`.gltf`, `.obj`, `.fbx`, no `.png`/`.jpg` textures, no `.mp3`/`.wav` audio. Every mesh is built from
three.js primitives and every texture is painted with the Canvas 2D API at load time.

This is not a preference, it is the reason the game works: the whole thing is **1.2 MB**, it installs as
an app, and it runs offline with no network at all — which is how 29 children opened it at once on school
wifi. **If you suggest downloading a model or a texture, the answer is unusable.** Everything you give me
must be JavaScript that constructs geometry.

## TECHNICAL FACTS YOU NEED

- **three.js r169**, vendored locally, ES modules, no build step, no npm, no loaders.
- **Axes: −Z is forward (out of the nose), +Y is up, +X is out of the right wing.** Get this wrong and
  the aeroplane flies backwards.
- **Budget:** a few hundred triangles per model. Anything repeated (trees, buildings, lights) must be an
  `InstancedMesh`.
- **Style:** readable at 50–500 m in motion. Detail nobody sees at that range is wasted.
- Units are **metres**. Real-world scale throughout.

## THE HOUSE STYLE

Match this. Every model is a function returning a `THREE.Group`, with moving parts exposed on
`group.userData` so the game loop can drive them. Textures are functions that paint a canvas and are
cached by key.

```js
import * as THREE from '../vendor/three.module.js';

function metalMaterial(map, { roughness = 0.42, metalness = 0.35, color = 0xffffff } = {}) {
  return new THREE.MeshStandardMaterial({ map, roughness, metalness, color });
}

/** Hi-vis propeller blade paint, 128px, cached forever by key. */
export function propTexture() {
  return get('prop', () => {
    const S = 128;
    const c = canvas(S);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#1c1e22';
    ctx.fillRect(0, 0, S, S);
    ctx.fillStyle = '#f2c53d';          // tip band
    ctx.fillRect(0, 0, S, S * 0.08);
    return finish(c);
  });
}

export function createThing(opts = {}) {
  const g = new THREE.Group();
  // ...primitives only...
  g.userData.update = (dt, state) => { /* animate here */ };
  return g;
}
```

Comments in this project explain **why**, not what. If a number is unusual, say what goes wrong at other
values. Do not write `// set the position` above a line setting the position.

---

## WHAT I NEED, IN PRIORITY ORDER

### 1. A helicopter rotor system — START HERE
My helicopter **flies** correctly (it hovers, translates on cyclic, yaws on its tail rotor) but it is
**drawn by the propeller code**: a 4.2 m propeller on the nose, and no main rotor or tail rotor exists
anywhere. It flies like a helicopter and looks like an aeroplane.

Build me a light utility helicopter body and rotor system, roughly Bell JetRanger sized:
- Rounded glass-fronted cabin ~3 m long, two abreast, tapering into a slim tail boom ~4 m
- Main rotor **4.2 m radius** on a mast above the cabin: hub, 4 slender blades, and a translucent blur
  disc that fades in with rotor speed
- Blades **droop ~15° when stopped** and **cone up ~4° under load**
- Tail rotor ~0.8 m radius on the **left** side of the fin
- **Skids**, not wheels: two fore-aft tubes on angled cross-struts
- `userData.update(dt, { rotorRpm, collective, cyclicPitch, cyclicRoll })` — and the **whole disc must
  visibly tilt with cyclic**, because that is the visual explanation of why the machine is moving

### 2. A weapons practice range
My range mission scores you in metres from a bullseye, and **nothing is drawn there at all** — the target
is only a coordinate. Players are bombing an invisible target.

Concentric scoring circles on cleared pale ground: a 5 m dark bullseye, white rings at 25/50/100 m,
alternating quadrant paint so it reads from directly overhead (the only angle it is ever seen from), four
corner markers, a small spotting tower.

### 3. An inert practice bomb
The range currently drops a **food-aid supply crate** — a 1.4 m box with cargo straps and a parachute.
I need a practice store: slim body ~1.8 m long, ~0.25 m diameter, rounded nose, four swept cruciform tail
fins, a suspension lug on top. **Painted blue** — the real convention for an inert training round. No
parachute. It should tumble slightly as it falls.

### 4. Fix the fighter's engine and intakes
My fighter has **no air intakes at all** — the single most recognisable feature of a fast jet. Worse, its
one centreline nacelle is at radius 0.6 where the fuselage radius is 0.56, so the "engine" is a barrel
swallowing the rear fuselage, with an intake ring and a black throat disc embedded in the fuselage side.
I need proper side intakes, a buried engine, and a single tailpipe.

### 5. Trees with actual geometry
Every tree in the game is **two crossed quads — 4 triangles — with one 128×128 painted texture per
species**. There is no trunk mesh anywhere. Because the texture is cached by species, all ~650 palms on
one coastline are **650 copies of the same drawing**.

Keep the crossed-quad impostor for distance, but give me near-field geometry: a tapered trunk cylinder
with 2–3 bends, 6–9 frond planes for a palm, a blobby canopy for broadleaf. Three or four silhouette
variants per species. Must still be instanced.

### 6. A carrier with an angled deck
My carrier's deck texture comment claims to draw "the angled landing area" and actually draws a dashed
line **straight down the keel**. The angled deck is the defining feature of a modern carrier and it is
absent. The island superstructure is one grey box with a stick on top and **no windows at all**. The
arrester wires are 0.32 m diameter — about ten times overscale, so they are pipes — floating 1.1 m above
the deck with nothing holding them.

Angled landing area ~9° to port with its own centreline and touchdown zone; a catapult track forward; a
superstructure with glazed bridge and Pri-Fly levels, radar arrays and a mast; wires at ~0.04 m on visible
deck sheaves.

---

## ANIMATIONS I WANT

Already done, do not redo: ailerons, flaps, elevator, rudder, gear retraction, propeller spin and blur,
jet nozzle glow, windsock, PAPI.

Wanted:
1. Rotor spin, blur, droop and coning (blocked on #1 above)
2. **Things built to move that never move** — my air bridges have telescoping sections, a lifting column
   and a wheeled bogie, built specifically so they "look like they can move", and nothing ever drives
   them. Same for a pushback tug, a baggage train and a catering lift whose scissor is frozen at a fixed
   angle. I want them driven.
3. Suspension travel — wheels compress on touchdown and over bumps; currently rigid
4. Wheel spin-up smoke, once, scaled by descent rate
5. Boat bow wave that lifts as she gets on the plane, wash astern, spray off the chines in a turn
6. Car brake lights, indicators, rotating roof beacon

## CRASH ANIMATIONS

I already have debris, fire, smoke, scorch marks, and a water impact that throws a spray column and then
detonates into a fuel fire 0.85 s later. What is missing is **the aircraft itself breaking up** — right
now the model vanishes and generic debris appears.

- Wings, tail and engines detaching as distinct pieces that tumble independently with their own mass
- Progressive damage: a bent prop, a crumpled nose, a torn wing that stays attached and drags
- A wingtip strike that digs in and **cartwheels** the aircraft rather than stopping it
- Sinking in water: nose down, tail rising, then under, with bubbles and a spreading slick
- A helicopter rotor strike where the blades shatter and fly off individually
- Boat capsize, car roll

**Tone:** this is played by 9–11 year olds. Structural failure, fire and smoke are right. No injury, no
bodies, no gore.

---

## HOW TO ANSWER

Do **one item at a time**, starting with #1. For each:
- A complete ES module I can drop in, primitives only
- Real dimensions in metres, and say why you chose them
- Moving parts on `userData` with a clear update signature
- Tell me the approximate triangle count
- Flag anything you are unsure will look right, rather than asserting it will

Start with the helicopter rotor system. Ask me anything you need about the codebase first.
