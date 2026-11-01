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
| `real/f22.glb` | "Lockheed Martin F-22 "Raptor"" | andertan (@andertan) | https://sketchfab.com/3d-models/7e7b3c372e374dda98e70208d09cfdcf |
| `real/f35b.glb` | "Lockheed Martin F-35B Lightning II" | AF267 (@jsong.js.us) | https://sketchfab.com/3d-models/5d54a6af45974ad386ae74d42b33374a |
| `real/fa18.glb` | "F-18" | Ryan.Qin (@Ryan.Qin) | https://sketchfab.com/3d-models/c0c1051b7dff4fe3b67597d60ce11b6c |
| `real/c5.glb` | "c-5B galaxy" | piggyrockstarYT (@piggyrockstar15) | https://sketchfab.com/3d-models/11832529d5f7499b9ef24ce0383a69bf |
| `real/uh60.glb` | "US Army UH-60M Black Hawk low poly model" | Yi Tsung Lee (@WTigerTw) | https://sketchfab.com/3d-models/854bf0feee5b42dc92ac5329976f7942 |
| `real/ch47.glb` | "Helicopter Low Poly - Chinook CH-47" | Machine Meza (@maurib98) | https://sketchfab.com/3d-models/72b5123bda964e9aa5343384734977e2 |
| `real/ah64.glb` | "AH-64 Apache Attack Helicopter Low Poly" | A Certain Duck (@TheOminousDuck) | https://sketchfab.com/3d-models/34986214decd4b3db90e91f12e624d78 |
| `real/vh3d.glb` | "Agusta Westland Merlin AW101" | CloudHubOmniTeam (@cloudhub) | https://sketchfab.com/3d-models/10ce28cff53d40d5b7feb9a017a02806 |
| `real/vehicles.glb` (fuel truck) | "Airport Fuel Truck" | Nguyentuannghia 64 (@nguyentuannghia17a) | https://sketchfab.com/3d-models/15a96ac34ece464480a9b8620dc3a3d3 |

The helicopters (`tools/real-models/helis.py`: `uh60`, `ch47`, `ah64`, and `vh3d`, Marine
One worn as the AW101 Merlin): every texture sampled to one colour per triangle and repainted
in the game's colour for the type (no national insignia, serial or unit marking survives; the
AW101's modelled 'ROYAL AIR FORCE' letters left out and its roundels painted over), the rotors
removed (the game spins its own), scaled to the real length. The fighters (`f22`, `f35b`,
`fa18`) as the A-10: no images, scaled at one scale from the real span, their own landing gear
and pylons removed.

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

## Trees, buildings and scenery (CC BY 4.0) — `real/scenery/`

Every file in `real/scenery/` is a derivative of a model published on Sketchfab under the
**Creative Commons Attribution 4.0 International** licence (<https://creativecommons.org/licenses/by/4.0/>).
The credit is also on the in-game Credits screen and inside each file (`extras.credit` on its root node).

**Changes made for the game** (`tools/real-models/scenery.py`, settings in `tools/real-models/scenery_models.py`):
every texture sampled to one colour per triangle and snapped to a small palette (no lettering, logo or
insignia survives), except a tree's leaves, whose cut-out picture is re-encoded as a small WebP beside the
file (`*-leaf.webp`); interiors, ground planes and lettering geometry removed; small detail welded;
scaled uniformly and turned to the game's axes. `tree-cards.webp` is the real oak, pine and palm drawn
from the side and from above for the World Map's distant tree cards.

| File | Model | Creator | Source |
|---|---|---|---|
| `real/scenery/tree-palm.glb` | "Coconut Palm" | evolveduk (@evolveduk) | https://sketchfab.com/3d-models/26e787f2ff2e4c0fb004c3b0210805a3 |
| `real/scenery/tree-pine.glb` | "Pine Tree" | evolveduk (@evolveduk) | https://sketchfab.com/3d-models/d45218a3fab349e5b1de040f29e7b6f9 |
| `real/scenery/tree-birch.glb` | "Birch tree" | evolveduk (@evolveduk) | https://sketchfab.com/3d-models/aa842dffd9654d33b8b91170ce83c172 |
| `real/scenery/tree-oak.glb` | "Oak tree" | massive-graphisme (@greg-l) | https://sketchfab.com/3d-models/3dc59560f2d24345bdbe65c44636453b |
| `real/scenery/firestation.glb` | "Fire Station No. 1" | CommonSpence (@commonspence) | https://sketchfab.com/3d-models/87edf04deb28434993274d9f05070865 |
| `real/scenery/base-outpost.glb`, `real/scenery/base-watchtower.glb`, `real/scenery/base-garage.glb` (pieces of one pack) | "GAME READY MILITARY BASE ASSET PACK" | Oxygen3D (@oxygen3d) | https://sketchfab.com/3d-models/47c0a32b43bf42abbb743458fbd95114 |
| `real/scenery/house.glb` | "House" | SpatialNeglect (@jeandiz) | https://sketchfab.com/3d-models/e70c4aebc911429ba9a894b38146892c |
| `real/scenery/sailboat.glb` | "Sailboat" | Sergei (@sergeif) | https://sketchfab.com/3d-models/76d0b1e24be14d2f9a524bfce3001aeb |
| `real/scenery/windmill.glb` | "Vintage Wind Turbine - GameAsset - Free Download" | DavidFalke (@davidfalke) | https://sketchfab.com/3d-models/3e0ca3c6fdf14badbb5750220e6ca7ee |

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
