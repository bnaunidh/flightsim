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
stretched airliner is built). Every file comes out with NO images: the
airliners are painted at run time with the game's own parody liveries.

Not shipped, and why:
- Concorde: the download has an airline's titles and tail stripes modelled
  into the geometry (no repaint removes them).
- F-16: no type in the roster it would stand for.
- Cessna 172 (the Skylark): one untextured material with no glazing to tell
  apart, over the game's oldest model (model.js), which is the one every
  first flight uses; left for a pass of its own.
- ATR 72: no ATR in the roster (the Q400 is the turboprop).
