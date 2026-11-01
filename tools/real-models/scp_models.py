"""
Batch 6, the SCP Foundation models for Nunatak Reach's Site and "Last Flight
Out" (tools/real-models/scp.py bakes them; src/features/scp-models.js wears
them). Credits as the in-game Credits screen and assets/models/LICENSES.md
print them: each model CC BY 4.0 as labelled on Sketchfab; the SCP
characters themselves are SCP Foundation content by the SCP Wiki community,
CC BY-SA 3.0 (LICENSE, "SCP FOUNDATION CONTENT").

  src       file in INBOX (the downloads, vetted; never committed)
  kind      'static' (one pose, vertex colours) | 'rig' (a skinned mesh and
            the clips the game plays: in place, the joints' matrices per frame)
  axes      source axes -> game axes (-Z forward, +Y up)
  height / length / width / scale   the size, metres (uniform)
  pose      'rig' downloads baked static: the clip and time, and joint
            rotations laid over it (a T-pose stood with its arms down)
  clips     game name -> source clip ('ground' is the one the feet stand on)
  parts     part -> {mats, nodes, colour}: a part of its own (a rotor), or
            one colour for a material with no picture (the crate)
"""
SF = 'https://sketchfab.com/3d-models/'
BYSA = 'SCP Foundation content by the SCP Wiki community, CC BY-SA 3.0, scpwiki.com'


def credit(title, author, key):
    return f'"{title}" by {author}, CC BY 4.0, {SF}{key}; {BYSA}'


SCP_MODELS = {
    # The statue. It moves only while nobody is looking (src/features/scp-models.js).
    'scp-173': dict(
        src='scp-173/scp-173.glb', kind='static', axes='x,y,z', height=2.05, colours=8,
        title='SCP-173', author='ThatJamGuy', url=SF + 'e4ef798fb0284b31bf90bad0d3bc7fc8',
        used='Last Flight Out: the statue loose on the Site',
    ),
    # Seated, head bowed over its knees, the whole mission, its back to the strip (the teen rule: its face is
    # never turned to the camera; `calm`: the source's red streaks on its hands, chest and mouth read as blood,
    # so they are turned to grey grime).
    'scp-096': dict(
        src='scp-096/scp-096.glb', kind='rig', axes='-x,y,-z', scale=1.0, colours=10, calm=0.85,
        clips={'sit': 'Sit'}, ground='sit', fps=10,
        title='SCP-096', author='ThatJamGuy', url=SF + '86f6620d460945ef9992ea19126c675e',
        used='Last Flight Out: the one sitting by the west fence',
    ),
    'scp-106': dict(
        src='scp-106/scp-106.glb', kind='rig', axes='-x,y,-z', scale=1.0, colours=10,
        clips={'walk': 'Walk', 'idle': 'Idle', 'rise': 'Spawn'}, ground='walk', fps=10,
        title='SCP-106', author='ThatJamGuy', url=SF + '21296abb0a224acea2bce6cdd6005289',
        used='Last Flight Out: the old man rising out of the yard',
    ),
    # Unrigged: its body sways side to side as it crawls (a vertex wave at run time).
    'scp-682': dict(
        src='scp-682/scp-682.glb', kind='static', axes='-z,y,x', length=10.0, colours=10,
        title='Scp 682', author='cg097', url=SF + 'effff1cd246542919a0aad70eaad8bc5',
        used='Last Flight Out: the big reptile coming round the fence',
    ),
    'scp-939': dict(
        src='scp-939/scp-939.glb', kind='rig', axes='-x,y,-z', scale=1.5, colours=10,
        clips={'walk': 'Walk', 'idle': 'Idle 1'}, ground='walk', fps=12,
        title='SCP-939', author='ThatJamGuy', url=SF + '1b99ae814fad47ebb558076e8b5beb49',
        used='Last Flight Out: the one prowling the east fence',
    ),
    # A rig with no clips, drawn in a T-pose: stood at ease, arms down, baked static.
    'guard': dict(
        src='guard/guard.glb', kind='static', rigged=True, axes='x,y,z', height=1.82, colours=10,
        pose=dict(clip=None, t=0, over={'mixamorig:LeftArm*': ('x', 76), 'mixamorig:RightArm*': ('x', 76),
                                        'mixamorig:LeftForeArm*': ('z', 12), 'mixamorig:RightForeArm*': ('z', -12)}),
        title='SCP Foundation Guard', author='ThatJamGuy', url=SF + '11134bf497ba46eba645274511ff14f7',
        used='Last Flight Out: Foundation guards at the ramp and the gate',
    ),
    'hazmat': dict(
        src='hazmat/hazmat.glb', kind='static', axes='-x,y,-z', height=1.8, colours=8,
        title='Hazmat (SCP Containment Breach)', author='SCPGames', url=SF + '6361b4474c9b4e65b88b23cda4640a7c',
        used='Last Flight Out: hazmat staff at the ramp',
    ),
    # Rotors are parts of their own: the game spins its own (blur disc and all) on their hubs.
    'apache': dict(
        src='apache/apache.glb', kind='static', axes='x,y,z', width=14.63, colours=8,
        parts={'rotor': dict(mats=['Material01.001']), 'tailrotor': dict(mats=['Material01.002'])},
        title='Apache (SCP Containment Breach)', author='SCPGames', url=SF + 'aafe3d3091d44412ad710068a9b99b5d',
        used='Last Flight Out: the task force gunship circling the Site',
    ),
    # No pictures in the download: painted by part. Unit height (scaled at run time: a cart's case, a cage by the ramp).
    'crate-173': dict(
        src='crate-173/crate-173.glb', kind='static', axes='x,y,z', height=1.0, colours=6,
        parts={'body': dict(mats=['containment_doors'], colour=[0.42, 0.45, 0.47]),
               'frame': dict(mats=['dirtymetal'], colour=[0.26, 0.24, 0.22]),
               'band': dict(nodes=['173box.b3d_red*'], colour=[0.62, 0.16, 0.12]),
               'base': dict(mats=['misc'], colour=[0.18, 0.18, 0.19])},
        title='SCP 173 Box (SCP Containment Breach)', author='SCPGames', url=SF + '48ecf48e25884d11876d58cd35f8f4b7',
        used='Last Flight Out: the sealed containment cases on the carts and by the ramp',
    ),
    'clipboard': dict(
        src='clipboard/clipboard.glb', kind='static', axes='x,y,z', length=0.32, colours=4,
        title='Clipboard (SCP Containment Breach)', author='SCPGames', url=SF + 'f26829100fcc45de99e2b99385ef9bc9',
        used='Last Flight Out: the loadmaster\'s clipboard at the ramp',
    ),
}

for k, v in SCP_MODELS.items():
    v['credit'] = credit(v['title'], v['author'], v['url'].rsplit('/', 1)[1])
