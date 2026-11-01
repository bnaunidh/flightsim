"""
The real scenery (tools/real-models/scenery.py): where each download is, who
made it (CC BY 4.0, as the in-game Credits and assets/models/LICENSES.md
print it), and how it is baked.

  src        file in INBOX (the downloads, vetted; never committed)
  axes       source axes -> game axes ('x,y,z' = as is; '-z,y,x' etc.)
  height / length / width   the size it is scaled to (uniformly), metres
  baseCentre a tree: centred on its trunk's foot, not on its crown
  dropMats / dropNodes / keepNodes   what ships ('Name*' prefix, '*part' substring)
  parts      part -> {mats, nodes, textured, thin, colours, colour, spin, ...}
             textured: the picture ships (the leaves' alpha cut-out), WebP <= leafPx
             thin: the share of leaf cards kept (whole cards, at random)
             spin: a wheel that turns (its hub and axis go in the file's extras)
"""
SF = 'https://sketchfab.com/3d-models/'

SCENERY = {
    # ---------------------------------------------------------------- trees --
    # Unit height: the game's tree instances carry the tree's height in their scale, as
    # scenery.js's own trees (treeGeometry) are built one unit tall.
    'tree-palm': dict(
        src='tree-palm/tree-palm.glb', height=1.0, baseCentre=True,
        title='Coconut Palm', author='evolveduk (@evolveduk)', url=SF + '26e787f2ff2e4c0fb004c3b0210805a3',
        credit='"Coconut Palm" by evolveduk (@evolveduk), CC BY 4.0, ' + SF + '26e787f2ff2e4c0fb004c3b0210805a3',
        parts={'leaves': dict(mats=['Tree_2Mat'], textured=True, thin=0.8, bend=0.6, cutoff=0.26), 'bark': dict(mats=['*'], colours=6, cluster=0.006)},
        changes='bark painted one colour per triangle from its own texture; fronds kept as a 512 px cut-out; some fronds thinned; unit height',
    ),
    'tree-pine': dict(
        src='tree-pine/tree-pine.glb', height=1.0, baseCentre=True,
        title='Pine Tree', author='evolveduk (@evolveduk)', url=SF + 'd45218a3fab349e5b1de040f29e7b6f9',
        credit='"Pine Tree" by evolveduk (@evolveduk), CC BY 4.0, ' + SF + 'd45218a3fab349e5b1de040f29e7b6f9',
        parts={'leaves': dict(mats=['Tree_1Mat'], textured=True, bend=0.7, cutoff=0.22), 'bark': dict(mats=['*'], colours=6, cluster=0.006)},
        changes='bark painted one colour per triangle from its own texture; needles kept as a 512 px cut-out; unit height',
    ),
    'tree-birch': dict(
        src='tree-birch/tree-birch.glb', height=1.0, baseCentre=True,
        title='Birch tree', author='evolveduk (@evolveduk)', url=SF + 'aa842dffd9654d33b8b91170ce83c172',
        credit='"Birch tree" by evolveduk (@evolveduk), CC BY 4.0, ' + SF + 'aa842dffd9654d33b8b91170ce83c172',
        parts={'leaves': dict(mats=['birch_leaf_1Mat'], textured=True, bend=0.75, cutoff=0.22), 'bark': dict(mats=['*'], colours=6, cluster=0.006)},
        changes='bark painted one colour per triangle from its own texture; leaves kept as a 512 px cut-out; unit height',
    ),
    'tree-oak': dict(
        src='tree-oak/tree-oak.glb', height=1.0, baseCentre=True,
        title='Oak tree', author='massive-graphisme (@greg-l)', url=SF + '3dc59560f2d24345bdbe65c44636453b',
        credit='"Oak tree" by massive-graphisme (@greg-l), CC BY 4.0, ' + SF + '3dc59560f2d24345bdbe65c44636453b',
        parts={'leaves': dict(mats=['branches_projection'], textured=True, bend=0.8, cutoff=0.32, gain=[2.05, 2.45, 1.55]), 'bark': dict(mats=['*'], colours=6, cluster=0.011, tint=[0.78, 0.8, 0.86])},
        changes='bark painted one colour per triangle from its own texture; leaf cards kept as a 512 px cut-out (alpha-tested, not blended); unit height',
    ),
}

# ------------------------------------------------------- airport and base --
SCENERY.update({
    # The control tower: its interior (stairs, lift, floors, ceilings, doors, lamps) left out;
    # sized at run time to the procedural tower's height (world/real-buildings.js).
    # NOT SHIPPED (README): a plain square shaft under a box cab, far plainer than the game's own
    # tower and its textures tiled past what one colour a triangle can carry (it came out black).
    'tower': dict(
        ship=False,
        src='tower/tower.glb', height=1.0,
        title='Air Control Tower – Full Interior + Exterior', author='AVALMesh (@AVALMesh)', url=SF + '56c7d128be4e4717b98e94467413de66',
        credit='"Air Control Tower – Full Interior + Exterior" by AVALMesh (@AVALMesh), CC BY 4.0, ' + SF + '56c7d128be4e4717b98e94467413de66',
        dropMats=['Stairs', 'Railing', 'Floor_2', 'Ceiling_1', 'Ceiling', 'Door', 'Door_and_Elevator', 'Elevator', 'Light', 'New_Material', 'Elevator_2', 'ELe_Green', 'ELe_Red'],
        parts={'glass': dict(mats=['glass'], colour=[0.16, 0.24, 0.3], metal=0.5, rough=0.08), 'body': dict(mats=['*'], colours=10)},
        changes='interior (stairs, lift, floors, ceilings, doors, lamps) removed; textures replaced by one colour per triangle; unit height',
    ),
    # NOT SHIPPED: a closed shell; the game's hangars open their doors and park aeroplanes inside.
    'hangar': dict(
        ship=False,
        src='hangar/hangar.glb', height=1.0,
        title='j type hanger', author='ElectricL (@ElectricLeo)', url=SF + 'd86713d61b4941378a6ad21569e0cbac',
        credit='"j type hanger" by ElectricL (@ElectricLeo), CC BY 4.0, ' + SF + 'd86713d61b4941378a6ad21569e0cbac',
        parts={'body': dict(mats=['*'], colours=10, doubleSided=True)},
    ),
    'firestation': dict(
        src='firestation/firestation.glb', height=1.0,
        title='Fire Station No. 1', author='CommonSpence (@commonspence)', url=SF + '87edf04deb28434993274d9f05070865',
        credit='"Fire Station No. 1" by CommonSpence (@commonspence), CC BY 4.0, ' + SF + '87edf04deb28434993274d9f05070865',
        parts={'body': dict(mats=['*'], colours=12)},
    ),
    # (shipped in vehicles.glb instead: tools/real-models/vehicles.py 'fuelTruck', swapped into the
    # apron's instanced trucks like the tugs and carts)
    'fueltruck': dict(
        ship=False,
        src='fueltruck/fueltruck.glb', length=1.0,
        title='Airport Fuel Truck', author='Nguyentuannghia 64 (@nguyentuannghia17a)', url=SF + '15a96ac34ece464480a9b8620dc3a3d3',
        credit='"Airport Fuel Truck" by Nguyentuannghia 64 (@nguyentuannghia17a), CC BY 4.0, ' + SF + '15a96ac34ece464480a9b8620dc3a3d3',
        dropMats=['material_0'],
        parts={'body': dict(mats=['*'], colours=10)},
    ),
    # NOT SHIPPED: a storybook scene (a crooked tower on a rock heap, barrels, a cannon), not a real
    # lighthouse; the game's own red-and-white tower is the realistic one.
    'lighthouse': dict(
        ship=False,
        src='lighthouse/lighthouse.glb', height=1.0,
        title='The Lighthouse', author='cotman sam (@cotman_sam)', url=SF + '1a85945dd2a840f594bf6cb003176a54',
        credit='"The Lighthouse" by cotman sam (@cotman_sam), CC BY 4.0, ' + SF + '1a85945dd2a840f594bf6cb003176a54',
        dropMats=['Material_371'],
        parts={'body': dict(mats=['*'], colours=12)},
    ),
})

# The air base's pieces, from the one pack (real size: the pack is in metres).
_MB = dict(src='milbase/milbase.glb', scale=1.0,
           title='GAME READY MILITARY BASE ASSET PACK', author='Oxygen3D (@oxygen3d)', url=SF + '47c0a32b43bf42abbb743458fbd95114',
           credit='"GAME READY MILITARY BASE ASSET PACK" by Oxygen3D (@oxygen3d), CC BY 4.0, ' + SF + '47c0a32b43bf42abbb743458fbd95114')
SCENERY.update({
    'base-outpost': dict(_MB, keepNodes=['Military_Outpost_1*'], parts={'body': dict(mats=['*'], colours=10)}),
    'base-watchtower': dict(_MB, keepNodes=['Watchtower_1*'], parts={'body': dict(mats=['*'], colours=8)}),
    'base-garage': dict(_MB, keepNodes=['Garage_Military*'], parts={'body': dict(mats=['*'], colours=10)}),
})

# ---------------------------------------------------------------- scenery --
SCENERY.update({
    # A country house (village and farm houses, mixed in with the town's own): its ground plane left out.
    'house': dict(
        src='house/house.glb', width=12.0,
        title='House', author='SpatialNeglect (@jeandiz)', url=SF + 'e70c4aebc911429ba9a894b38146892c',
        credit='"House" by SpatialNeglect (@jeandiz), CC BY 4.0, ' + SF + 'e70c4aebc911429ba9a894b38146892c',
        dropMats=['ground'],
        # lifted a little: sampled, its painted boards came out a shade duller than the town's houses
        parts={'glass': dict(mats=['windows'], colours=4, cluster=0.07), 'body': dict(mats=['*'], colours=12, lighten=1.3, cluster=0.04)},
    ),
    'sailboat': dict(
        src='sailboat/sailboat.glb', length=10.0,
        title='Sailboat', author='Sergei (@sergeif)', url=SF + '76d0b1e24be14d2f9a524bfce3001aeb',
        credit='"Sailboat" by Sergei (@sergeif), CC BY 4.0, ' + SF + '76d0b1e24be14d2f9a524bfce3001aeb',
        # its texture is a dim grey: lifted, the sails and the hull come out white as a yacht's are
        parts={'body': dict(mats=['*'], colours=6, doubleSided=True, lighten=2.4)},
        notes='bow at +z; the waterline 1.6 m above the keel (y = 0)',
    ),
    # A farm wind pump: the wheel (blades and hub) its own part, turning about its own axis.
    'windmill': dict(
        src='windmill/windmill.glb', height=12.0,
        title='Vintage Wind Turbine - GameAsset - Free Download', author='DavidFalke (@davidfalke)', url=SF + '3e0ca3c6fdf14badbb5750220e6ca7ee',
        credit='"Vintage Wind Turbine - GameAsset - Free Download" by DavidFalke (@davidfalke), CC BY 4.0, ' + SF + '3e0ca3c6fdf14badbb5750220e6ca7ee',
        parts={'wheel': dict(nodes=['schaufeln*', 'f*nfstern*'], colours=4, spin=True, doubleSided=True), 'body': dict(mats=['*'], colours=8, doubleSided=True)},
    ),
})
