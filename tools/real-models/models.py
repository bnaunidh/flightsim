"""
The real models: where each one comes from, who made it (CC BY 4.0 credit,
as the in-game Credits and assets/models/LICENSES.md print it), and how
process.py fits it to the game's airframe of the same type.

  src      file in INBOX (the downloads, vetted; never committed)
  rot      source axes -> game axes (process.py ROT)
  drop     source materials to leave out ('Name*' = prefix)
  roles    source material -> role, where the name says what it is
           ('auto' = sort by where it sits on the airframe)
  cabinWindows  'drop': the source's own cabin-window geometry is left out
           (the game paints its own row, at the game's window positions)
"""
import os
INBOX = os.path.expanduser('~/Desktop/flightsim-models-inbox')

SF = 'https://sketchfab.com/3d-models/'
MODELS = {
    'belugaxl': dict(
        src='belugaxl/belugaxl.glb', rot='y180',
        credit='"Airbus_beluga_xl" by rylanmorris (@darkadoo), CC BY 4.0, ' + SF + '4aaa48591b434701966f95f75f7651ef',
        drop=['Root', 'Material'],
        fit='wing',
    ),
    'a321': dict(
        src='a321/a321.glb', rot='y180',
        credit='"Airbus a321-271nx" by piggyrockstar15, CC BY 4.0, ' + SF + 'ad5ce46a9082436d9049718f838f6ace',
        drop=['eyes_togglable', 'iris', 'pupil', 'iris.001', 'pupil.001', 'Material.001', 'Material.003'],
        roles={'cockpit_glass': 'glass', 'engine_cowling': 'auto', 'Material.*': 'window'},
        cabinWindows='drop',
    ),
    'b737': dict(
        src='b737max/b737max.glb', rot='y180',
        credit='"737 MAX Lion Air" by Sofyan Kurniawan (@sofyankurniawan), CC BY 4.0, ' + SF + '2747cad8b4c64122abe992c9ad1e8bd1',
        drop=['Roda', 'Landing_Gear', 'Plane_Egnine'],
        roles={'Jendela': 'window', 'Engine': 'duct', 'Black': 'dark', 'Engine.001': 'engine', 'Egnine_737': 'engine'},
        cabinWindows='drop',
    ),
    'b787': dict(
        src='b787/b787.glb', rot='y180',
        credit='"Boeing 787-9" by Nobilis 2 (@nobilishornet2), CC BY 4.0, ' + SF + 'b6711e2e698e4e469675c1154a50b7a3',
    ),
    'a350': dict(
        src='a350/a350.glb', rot='y180',
        credit='"Airbus A350" by jhag (@jhag), based on "A350 QTR" by paperscan, CC BY 4.0, ' + SF + 'cfa2836ead8c4278a199a7d34a87f02e',
    ),
    'b777': dict(
        src='b777/scene.gltf', rot='x-nose',
        # The source is drawn as a shorter 777 (length/span 0.91; the -300ER is
        # 1.14): the cabin is stretched ahead of and behind the wing, as the
        # real -300 was built from the -200, so the wing, engines and tail keep
        # their size against the fuselage's section.
        # The wing root's leading edge (0.355 of the source's length) on the game's (z -8.7).
        plugs=[(0.10, 0.34), (0.57, 0.86)], plugAnchor=(0.355, -8.7),
        roles={'Engines': 'engine'},
        credit='"Boeing 777 Airplane" by K-Sto Creations (@K_StoCreations), CC BY 4.0, ' + SF + '43847f1a45ff43b180955dfd0cce3f19',
    ),
    'a380': dict(
        src='a380/a380.glb', rot='none',
        credit='"Airbus A380" by Brout (@davidbroutian), CC BY 4.0, ' + SF + '98d21f9c8104445f814cef47ef992889',
    ),
    'b747': dict(
        src='b747/b747.glb', rot='x+nose',
        credit='"Boeing 747-8i" by AF267 (@jsong.js.us), GeoFS team, CC BY 4.0, ' + SF + 'cd1977bedc32412fa1ce2cda23520b84',
        drop=['rubber', 'wheel', 'light-red', 'light-green', 'light-white'],
        roles={'window': 'window'},
        cabinWindows='drop',
    ),
    'q400': dict(
        src='q400/q400.glb', rot='y180',
        credit='"Bombardier Dash Q400 - Qantas Link" by Sofyan Kurniawan (@sofyankurniawan), CC BY 4.0, ' + SF + '5b13a73be7d74161a3a9f9ce982a8345',
        drop=['Wheels', 'Landing_Gear'],
        roles={'Windows': 'window', 'Glass': 'window', 'Airplane_Color_Engine': 'engine', 'Yellow_Metalic': 'prop'},
        dropProps=True,
        cabinWindows='drop',
    ),
    # NOT SHIPPED (src/aircraft/real-models.js leaves it out): the download has an
    # airline's titles and tail stripes modelled into the fuselage and fin geometry.
    'concorde': dict(
        ship=False,
        src='concorde/scene.gltf', rot='x-nose',
        credit='"Concorde free with interior" by Zihan Chi (@zihanchi), CC BY 4.0, ' + SF + '16bd3e8a17b345caace9449331709f2e',
        # The download is mostly its cabin (seats, carpet, walls) and wears British
        # Airways' stripes: only the airframe's own materials are kept.
        keep=['FrontColor', 'Color_000', 'black', 'LightGray', 'M_96_96_96', 'M_0135_DarkGray', 'Color_C01'],
        fit='wing',
        interiorD=0.8,
        # four engines in two box nacelles: not round, and the game's are where they are
        refineEngines=False, boxEngines=True, engR=1.7, engFront=0.6, engBack=0.6,
        noseGearZ=4.0, mainGearZ=5.0, mainGearX=2.6,
        gearPieces=-2.0,  # any piece entirely below 2 m under the centreline: the source's own gear
    ),
    'a10': dict(
        src='a10/a10.glb', rot='none',
        credit='"A-10 Thunderbolt II" by AIRMAN Magazine (@AIRMANMagazine), CC BY 4.0, ' + SF + '9521ff6ba5d448958ea45a89e94ab23d',
        # the stores under the wings (the game hangs its own) and the wheels; USAF markings were textures, all removed
        drop=['Alternatefile5Material', 'Alternatemidwheel', 'AlternatewheelMaterial'],
        roles={'AlternateRWing': 'glass'},
        interiorD=0.75,
        cabinAt=(0.2, 0.3),
        engLen=1.15,  # the tailplane is right behind the nacelles
        cluster=0.03,  # 37,000 flat-shaded triangles of fine detail: welded to 3 cm
    ),
}
