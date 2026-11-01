# Real models

Downloaded CC BY 4.0 models, turned into files the game can wear over its own
aeroplanes and vehicles (`src/aircraft/real-models.js`). Credits: in-game
Credits screen and `assets/models/LICENSES.md`.

The downloads live in `~/Desktop/flightsim-models-inbox/<folder>/` (vetted,
not committed). Nothing here runs code from them: `gltfio.py` reads model and
image data only.

    node tools/real-models/ref.mjs <id> ...        # the game's airframe of that type -> ref/<id>.json
    python3 tools/real-models/process.py <id> ...  # -> assets/models/real/<id>.glb
    python3 tools/real-models/process.py <id> --view /tmp/x_%.png   # draw the roles, side/top/front
    python3 tools/real-models/vehicles.py          # -> assets/models/real/vehicles.glb
    python3 tools/real-models/helis.py [id ...]    # -> assets/models/real/{uh60,ch47,ah64,vh3d}.glb
    python3 tools/real-models/scenery.py [id ...]  # -> assets/models/real/scenery/<id>.glb (trees, buildings, scenery)
    node tests/features/real-models.mjs            # hold the files to their rules

`models.py` says, per type, where the download is, how to turn it to the
game's axes, what to leave out, which source materials are what, and how to
fit it (`fit: 'wing'` keeps the fuselage round and stretches only the wings to
the span; `plugs` lengthens the cabin ahead of and behind the wing, as a
stretched airliner is built; `bodyZFrom` keeps a shortened one's wing and
engines at the length the download was drawn at -- the A320 from the A321neo).
A source drawn with its control surfaces deflected or its own pylons on has
`hinges` / `wedges` / `bends` and `dropPieces` (the A-10; a wedge's
`teBelowLe` keeps its trailing edge in line with the flaps'), and
`coreEnvelope` keeps a tapering nacelle's outside out of its dark core.
`noseD` keeps a flight deck that stands proud of the game's from being sorted
as wing (the A320/A321neo). What the sort cannot mend is drawn both sides at
run time (`real-models.js`: `cowlBothSides`, `skinBothSides`). Every file comes
out with NO images: the airliners are painted at run time with the game's own
parody liveries.

Not shipped, and why:
- Concorde: the download has an airline's titles and tail stripes modelled
  into the geometry (no repaint removes them).
- F-16: no type in the roster it would stand for.
- Cessna 172 (the Skylark): looked at again for v75 and still not shipped.
  The download is a work in progress ("Cessna 172 (WIP)"): one material, no
  glazing to tell apart, so the Skylark's per-plane liveries (stripes,
  registration) would come out as one flat paint and its windows as body.
  And the Skylark is drawn by the game's oldest model (model.js), not the
  fleet kit: it has no fleet bridge, fuselage profile or hidden layer for
  real-models.js to wear a skin over (ref.mjs reads nothing from it), so
  shipping it means new plumbing in the first-flight plane. Not clearly
  better than the procedural Skylark, so it keeps its own.
- ATR 72: no ATR in the roster (the Q400 is the turboprop).

Batch 3 (2026-10-31): the fighters and the helicopters.
- F-22, F-35B, F/A-18: `fit: 'uniform'` -- ONE scale from the real span, nose
  on the game's nose. Their fleet models are drawn 2-4 m longer than the real
  aeroplanes; fitting each axis to them flattened and stretched the real
  shapes. The procedural afterburner flames and heat haze stay in view and
  move to the real tail while the skin is on (`real-models.js` `keep`,
  `shiftNodes`). The sources' own gear, pylons and boarding ladders go as
  pieces (`dropPieces`); the F/A-18's nozzles are given (`engines`), the
  sort could not find two in its one-piece tail. The F-22's mirrored half is
  wound inside out: drawn both sides.
- C-5 Galaxy: an airliner like the others (livery-painted, fitted to the
  fleet model's fuselage).
- UH-60, CH-47, AH-64 and Marine One (the VH-3D, worn as the AW101 Merlin):
  `helis.py`. The game keeps its own rotors (blades, blur discs, spool-up),
  moved onto the real mast and tail-rotor hub (the file's `extras.hubs`).
  Painted in the file in the game's colour for the type, the texture's
  shading kept as a ratio: no insignia or serial survives. The AW101's
  'ROYAL AIR FORCE' letters and roundels are geometry: the letters are left
  out, the roundels painted as the airframe round them.
- NOT shipped: the AV-8B Harrier II download. The game's 'harrier' is the
  Skyhook H-3, a civil HELICOPTER (rotor flight model, rotor disc, hoist,
  its own Blender model); a jump jet worn over it would show a jet under a
  spinning rotor. It stays the Skyhook. (C-17: not downloaded, 218k tris;
  the game's own has the cargo ramp Last Flight Out uses.)

Batches 4-5 (2026-10-31): trees, buildings and scenery (`scenery.py`, settings
in `scenery_models.py`; run time in `src/world/real-scenery.js`,
`real-trees.js`, `real-buildings.js` -- all fetched only at Medium and up,
after the menu; Low keeps the game's own).
- Trees: palm, pine, birch, oak, unit height, drawn close to the camera in
  place of the game's own instanced trees (real-trees.js); the World Map's
  distant cards were drawn from them (tree-cards.webp).
- Airport fire station (airport.js `isolate`: its own batches, hidden when the
  real one stands in its footprint), the fuel truck (in vehicles.glb, swapped
  into the apron's instanced trucks), the air base's guard posts, garage and
  watchtowers (one pack, added by the radar), country houses (a third of a
  town's ordinary houses, scenery.js addTown `realHouses`), sailboats (the
  yachts at sea and on the moorings), farm wind pumps (features.js fields;
  the wheel turns about its own hub).
- NOT shipped: the control tower (a plain square shaft under a box cab --
  plainer than the game's own -- and its tiled textures came out black), the
  hangar (a closed shell; the game's hangars open their doors and park
  aeroplanes inside), the lighthouse (a storybook scene, not a realistic
  lighthouse).

Batch 6 (2026-11-01): the SCP Foundation models for Last Flight Out (`scp.py`,
settings and credits in `scp_models.py`; run time in `src/features/scp-models.js`,
imported by `src/features/scp-escape.js` only when a run of the mission is built,
files fetched then and never precached).

    python3 tools/real-models/scp.py [id ...]     # -> assets/models/real/scp/<id>.glb
    python3 tools/real-models/scp.py <id> --view /tmp/x_%.png
    node tests/features/scp-models.mjs

- The five SCPs breach as their sectors go dark (682 A, 939 B, 106 C, 096 E,
  173 F; D shows nothing) and are at the ends of their routes when the breach
  reaches the strip; they stand still whenever anybody is near, and the
  mission's rules and timings are untouched (the test runs a seed with and
  without them). 173 moves only off screen; 096 sits, head bowed over its
  knees, its back to the strip (`calm` in scp_models.py turns its red streaks
  to grey: nothing reads as blood); 106 rises out of the yard, sinks and rises further on;
  682 (unrigged) sways down its length as it crawls.
- Rigs (`skin.py`): 096, 106 and 939 keep their skin. The file carries the
  joints' matrices per clip frame (game frame x joint, 16-bit), so the game
  plays them with three.js's SkinnedMesh and no glTF loader. Clips are in
  place; a walk's own speed is measured from the foot on the ground and the
  game plays it at the speed it moves (no sliding feet).
- The guard (rig, no clips, T-pose) is baked static at ease; it and the hazmat
  suit (unrigged) are the POSTED figures at the ramp and the gate. The boarders
  stay the game's own walking figures; the Site staff among them carry the
  clipboard, and the sealed cart carries the containment case.
- The gunship orbits the Site (not solid, never fires) with the game's own
  rotor (blur disc, anti-strobe cap) on the download's hubs, and leaves when
  the breach reaches the strip.
- Left out of the batch on purpose (BATCH-6-SCP.md): anything ripped from other
  games, gore, and the heavy containment chambers and keycards.

