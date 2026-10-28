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
