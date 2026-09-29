# The Blender-built vehicles

Three of the game's vehicles are modelled in Blender, by script, from an empty
factory scene. Nothing in these folders is hand-edited geometry: each
`build.py` builds the model, saves a `.blend`, exports a `.glb`, re-imports the
`.glb` into a fresh scene and asserts its own fit numbers before it finishes.

| Folder | Game vehicle | Exported file | Ships as |
| --- | --- | --- | --- |
| `skyhook/` | the helicopter (`harrier`, *Skyhook H-3*) | `skyhook.glb` | `assets/models/skyhook.glb` |
| `courier-van/` | the car (*Island Courier Van*) | `courier_van.glb` | `assets/models/courier-van.glb` |
| `kestrel-launch/` | the boat (*Kestrel Launch*) | `kestrel_launch.glb` | `assets/models/kestrel-launch.glb` |

The game reads the `.glb` files with `src/vehicles/glb.js` (no GLTFLoader) and
dresses them in `src/vehicles/blender-models.js`. `tools/model-viewer.html`
shows each one lit the way the game lights it; `node tests/features/models.mjs`
checks that each one parses, is inside its triangle budget and still meets the
physics where the game code says it should.

## Rebuild and re-export

Blender 5.2 (the files were exported by *Khronos glTF Blender I/O v5.2.40*).
Keep the thread count down (`-t 4`), because the game is played on the same
machine it is built on.

```bash
B=/Applications/Blender.app/Contents/MacOS/Blender

# The helicopter. A few seconds; 31,540 triangles.
(cd tools/blender/skyhook && "$B" -t 4 --background --factory-startup --python build.py)
cp tools/blender/skyhook/skyhook.glb assets/models/skyhook.glb

# The van. A few seconds; 21,872 triangles.
(cd tools/blender/courier-van && "$B" -t 4 --background --factory-startup --python build.py)
cp tools/blender/courier-van/courier_van.glb assets/models/courier-van.glb

# The launch. Also writes kestrel_launch.js (bake_module.py), which the game
# does NOT use: it reads the .glb like the other two. 24,189 triangles.
(cd tools/blender/kestrel-launch && "$B" -t 4 --background --factory-startup --python build.py)
cp tools/blender/kestrel-launch/kestrel_launch.glb assets/models/kestrel-launch.glb

# Then prove the copies still fit the game, and bump CACHE_VERSION in sw.js so
# installed copies fetch the new files.
node tests/features/models.mjs
```

Review renders (not needed to ship) come from each folder's `render.py`,
which opens the saved `.blend`:

```bash
(cd tools/blender/skyhook && "$B" -t 4 --background --factory-startup --python render.py -- r6)
(cd tools/blender/courier-van && "$B" -t 4 --background --factory-startup --python render.py -- art4)
(cd tools/blender/kestrel-launch && "$B" -t 4 --background kestrel_launch.blend --python render.py -- art4)
```

The `.blend`, `.glb`, `renders/` and `kestrel_launch.js` a build leaves beside
the script are ignored by git (`.gitignore` here). Only the copies in
`assets/models/` are shipped. The van and the launch letter their liveries with
macOS system fonts (`/System/Library/Fonts/Supplemental/`). Elsewhere the van
falls back to Blender's built-in font by itself (`font()` in its build.py);
the launch needs `FONT_PATH` pointed at a bold sans.

## Axes

All three are modelled with Blender +Y forward, +Z up, +X starboard, and
exported +Y up, which is the game's own frame: -Z forward, +Y up, +X right.
Every root sits at the game's own origin for that vehicle, so the game puts the
model where the physics is with no offset:

- **Skyhook**: the aircraft origin. Skid contacts at the gear points
  (`types.js`, shape x `scale` 1.25), rotor hub at `power.y/z` x 1.25, disc
  radius 4.2 = `SPEC.rotorRadius`. Drawn at final scale, so the game wraps it
  in a 1.25 group to match the cockpit and eye maths that assume a scaled
  airframe.
- **Courier van**: the body origin, 0.06 m (`rideHeight`) above the road.
  Wheel centres at x +-0.95, z +-1.35, radius 0.345.
- **Kestrel launch**: on the design waterline at the centre of flotation. The
  root's glTF `extras.fit` carries what the game needs to pose her on the sea:
  the cockpit sole corners and motor-well lip it keeps dry, the hull sections
  (her bottom, and where the bow wave cuts her) and her planing lift. The pose
  itself is the game's (`src/vehicles/surface.js`, `fitHull`); the recipe's
  scale factors (0.4 of the sea, 0.75 of the trim, 0.55 of the heel) describe
  damping surface.js already does, and are not applied a second time.
