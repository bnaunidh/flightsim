# Model files and their licences

## Made for this game

`skyhook.glb`, `courier-van.glb`, `kestrel-launch.glb` — built by script in
`tools/blender/` for Island Flight Simulator. Game licence (`LICENSE`, credit
thankdapro).

## Third-party models (CC BY 4.0) — `real/`

Every file in `real/` is a derivative of a model published on Sketchfab under
the **Creative Commons Attribution 4.0 International** licence
(<https://creativecommons.org/licenses/by/4.0/>). The credit below is also on
the in-game Credits screen (`src/ui/credits.js`) and inside each file
(`extras.credit` on its root node).

**Changes made for the game** (`tools/real-models/process.py`): every source
texture and image removed — the aeroplanes are painted at run time with the
game's own parody liveries, so no real airline, maker or military marking is
shipped; landing gear, lights, propellers and cabin interiors removed (the game
draws its own moving parts); geometry merged by part, rescaled and in places
stretched to the game's airframes (a 777 cabin lengthened to the -300ER, the
A321neo's shortened to an A320, wing
spans fitted); normals quantised.

| File | Model | Creator | Source |
|---|---|---|---|
| `real/belugaxl.glb` | "Airbus_beluga_xl" | rylanmorris (@darkadoo) | https://sketchfab.com/3d-models/4aaa48591b434701966f95f75f7651ef |
| `real/a321.glb` | "Airbus a321-271nx" | piggyrockstar15 | https://sketchfab.com/3d-models/ad5ce46a9082436d9049718f838f6ace |
| `real/a320.glb` | "Airbus a321-271nx" (cabin shortened to the A320's) | piggyrockstar15 | https://sketchfab.com/3d-models/ad5ce46a9082436d9049718f838f6ace |
| `real/b737.glb` | "737 MAX Lion Air" | Sofyan Kurniawan (@sofyankurniawan) | https://sketchfab.com/3d-models/2747cad8b4c64122abe992c9ad1e8bd1 |
| `real/b787.glb` | "Boeing 787-9" | Nobilis 2 (@nobilishornet2) | https://sketchfab.com/3d-models/b6711e2e698e4e469675c1154a50b7a3 |
| `real/a350.glb` | "Airbus A350" | jhag (@jhag), based on "A350 QTR" by paperscan | https://sketchfab.com/3d-models/cfa2836ead8c4278a199a7d34a87f02e |
| `real/b777.glb` | "Boeing 777 Airplane" | K-Sto Creations (@K_StoCreations) | https://sketchfab.com/3d-models/43847f1a45ff43b180955dfd0cce3f19 |
| `real/a380.glb` | "Airbus A380" | Brout (@davidbroutian) | https://sketchfab.com/3d-models/98d21f9c8104445f814cef47ef992889 |
| `real/b747.glb` | "Boeing 747-8i" | AF267 (@jsong.js.us), GeoFS team | https://sketchfab.com/3d-models/cd1977bedc32412fa1ce2cda23520b84 |
| `real/q400.glb` | "Bombardier Dash Q400 - Qantas Link" | Sofyan Kurniawan (@sofyankurniawan) | https://sketchfab.com/3d-models/5b13a73be7d74161a3a9f9ce982a8345 |
| `real/a10.glb` | "A-10 Thunderbolt II" | AIRMAN Magazine (@AIRMANMagazine) | https://sketchfab.com/3d-models/9521ff6ba5d448958ea45a89e94ab23d |
| `real/vehicles.glb` (tug, tractor) | "Aircraft tractor lowpoly model" | propmaker1 (@menX1151) | https://sketchfab.com/3d-models/2e9a078c365243c888f4c70f85be7b85 |
| `real/vehicles.glb` (cart) | "Airport baggage equipment (cart) lowpoly" | propmaker1 (@menX1151) | https://sketchfab.com/3d-models/7ae8444bb5044376a04ee7bb0664ff39 |
| `real/vehicles.glb` (road traffic) | "Free Low Poly Vehicles Pack" | RgsDev (@rgsdev) | https://sketchfab.com/3d-models/cb7640039e7a40679a53be705ebff50e |

The vehicles (`tools/real-models/vehicles.py`): textures sampled to one colour
per triangle (no lettering survives), paint baked white where the game tints
each vehicle, sized to the game's own vehicles, the game's towbar and beacon
added to the tug.

The names in the source titles are the uploaders' own; the airline liveries
they refer to (Lion Air, QantasLink, Qatar) are **not** in these files, nor the A-10's
national insignia and serials (they were textures).

The source downloads are not in this repository. To rebuild a file, put the
download in `~/Desktop/flightsim-models-inbox/<folder>/` and run
`node tools/real-models/ref.mjs <id>` then `python3 tools/real-models/process.py <id>`
(the vehicles: `python3 tools/real-models/vehicles.py`).

## Scenery models (CC0 1.0) — `scenery/`

Every file in `scenery/` is a derivative of a model published by Poly Haven
under **CC0 1.0** (public domain, <https://creativecommons.org/publicdomain/zero/1.0/>);
credited anyway, here and on the Credits screen. **Changes made for the game**
(`tools/scenery-models/process.py`, Blender): pieces joined, decimated to
500-1,800 triangles, the diffuse texture baked into vertex colours, textures
and UVs removed, one plain material.

| File | Model | Creator | Source |
|---|---|---|---|
| `scenery/rock-face.glb` | "Rock Face 01" | Dario Barresi | https://polyhaven.com/a/rock_face_01 |
| `scenery/boulder.glb` | "Boulder 01" | Rico Cilliers | https://polyhaven.com/a/boulder_01 |
| `scenery/quiver-tree.glb` | "Quiver Tree 01" | Rico Cilliers, James Ray Cock, Dario Barresi | https://polyhaven.com/a/quiver_tree_01 |
| `scenery/pier-section.glb` | "Modular Wooden Pier" (section 02) | Rico Cilliers | https://polyhaven.com/a/modular_wooden_pier |
| `scenery/utility-pole.glb` | "Modular Electricity Poles" (pole, crossarm, insulators, cap) | James Ray Cock | https://polyhaven.com/a/modular_electricity_poles |
