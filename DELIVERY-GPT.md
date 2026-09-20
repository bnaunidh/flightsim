# Island Flight Simulator — delivery

The complete edited game is in `island-flight-sim/`. The Desktop original is untouched. This is a focused refinement of the existing game: 32 maps and all eight selectable aircraft remain available.

**Final result: 146/146 checks passed.** The original also passed 146/146. Neither test file was changed. See `verification/selftest.json` and `verification/baseline-selftest.json` for every assertion.

## What changed

- Kestrel and Kestrel Port have low ground around the existing runways, with hills away from both approach axes. Runway, spawn, mission and island-index references stay intact. Approach-corridor cuts fall to zero in the measured window.
- Raven Crag's Sentinel Knoll, Meridian, Fenwick and Airfield Perimeter have more relief. Fenwick streets bend while retaining shared junctions; elevations follow the revised terrain, with an 8.50% maximum authored grade and at most 0.24 m adjustment from sampled terrain before road application.
- Delta shoal centres, spacing and radii vary. Flat Rock is broader, with a continuous low plateau around its strips and rescue apron.
- Courier, Meridian, Tempest and Skyhook have distinct fuselage/cabin details, visible seats and controls. Meridian gains a fuller passenger cabin, Tempest a radar nose, Skyhook a slimmer tail boom and turbine housing. Civil details are batched by material. Vanguard and Osprey gain small cockpit details; fleet glazing is clearer. Skylark and Nightjar retain their existing geometry.
- Nine existing submerged lighthouse origins were moved onto land, listed below.
- The silhouette exporter now expands instanced windows and wheels and skips geometry hidden by ancestors.

## Maps: measured results

Land-height standard deviation and peak use a 48×48 grid within a circular region of 85% of the first island's radius, excluding submerged points. These are sampled values, not exact mathematical extrema. Raven Crag's first island is Sentinel Knoll, not its distant mountains.

| Map | Height SD, metres before → after | Sampled peak, metres before → after |
|---|---:|---:|
| kestrel | 79.21 → 42.84 | 364.51 → 217.35 |
| kestrel-port | 76.65 → 42.78 | 364.51 → 217.35 |
| ravencrag | 5.29 → 11.86 | 45.27 → 73.29 |
| meridian | 6.44 → 13.42 | 53.67 → 91.48 |
| town | 6.81 → 10.95 | 49.60 → 74.33 |
| airfieldperimeter | 8.96 → 11.75 | 64.87 → 80.31 |
| stacks | 2.77 → 2.56 | 22.00 → 26.55 |

Kestrel approach-cut measurement: a 128×128 grid over ±1.15 island radii, comparing the same map with both corridor lengths set to zero. The denominator is uncut land; a cut means more than 1 m. Kestrel: **28.56% → 0.00%**, maximum **290.85 → 0.00 m**. Kestrel Port: **29.35% → 0.00%**. The brief's 23% uses an unspecified sampling window; this report provides its reproducible definition.

All 32 scenery constructors completed. Every runway centreline, including second runways, was sampled at 41 points: maximum elevation error **0.000 m**. All lighthouse origins are now above water. `verification/map-audit.json` contains per-map results. Authored roads can differ from their declared height near airport pads or overlapping roads; this is inherited terrain precedence. Final maximum point residual is 4.779 m on Kestrel including the airport blend; the original was 4.501 m. The unchanged regression suite accepts these points and confirms road connectivity.

Height-function benchmark on this Mac, Node v26: median **1,125 → 1,029 ns/sample** in a deterministic Kestrel ±2,600 m window, 400,000 samples per round, two warm-up rounds and five measured rounds. This is not an FPS benchmark or a promise of Chromebook performance.

## Aircraft: measured through the game adapter

Counts include repeated instances, exclude hidden ancestors and nearly invisible transparent effects, and use the resting model pose. Physics, gear contact points, camera eye points, scale and wing-strike dimensions are unchanged.

| Aircraft | Triangles before → after | Mesh objects before → after | Resting span / length, metres; ratio |
|---|---:|---:|---:|
| Kestrel Courier | 3,912 → 3,360 | 38 → 32 | 12.79 / 7.95 = 1.608 |
| Skyhook H-3 | 4,356 → 3,648 | 45 → 36 | 5.30 / 10.57 = 0.502 |
| Meridian 220 | 5,018 → 4,596 | 42 → 44 | 28.78 / 17.99 = 1.600 |
| Nightjar B-2 | 1,128 → 1,128 | 39 → 39 | 33.50 / 13.07 = 2.563 |
| Osprey CV | 1,698 → 1,742 | 51 → 53 | 13.28 / 12.81 = 1.037 |
| Skylark 172 | 5,064 → 5,064 | 62 → 62 | 12.38 / 7.20 = 1.720 |
| Tempest WR-4 | 4,080 → 3,512 | 43 → 34 | 25.97 / 14.79 = 1.756 |
| Vanguard F-1 | 1,526 → 1,570 | 43 → 45 | 9.98 / 14.11 = 0.707 |

Skyhook's 5.30 m span is the static pose's X extent; its rotating main-rotor disc diameter remains **10.50 m**. These ratios describe the game's original proportions. This light-edit pass does not recalibrate them to real manufacturer dimensions; in particular, Meridian remains unusually compact for a regional airliner. Skylark remains slightly above the nominal 5,000-triangle target, unchanged at 5,064.

The supplied exporter previously counted an instanced batch only once. That understated the original Meridian (4,682 versus 5,018) and Nightjar (1,032 versus 1,128). Before/after values here use the corrected exporter on both source trees.

## Referenced data and files

No map IDs, aircraft IDs, place IDs, pad IDs, mission-facing names, existing island indices, or mission definitions were renamed or removed. New hill islands are appended. The town's road coordinates and heights, Delta shoal coordinates/radii, island terrain parameters, and lighthouse coordinates changed. The terrain, road rendering, charts, scenery and jobs read those fields normally.

| Map | Lighthouse [x, z], before → after | New sampled height |
|---|---|---:|
| airbase | [-7000, -5200] → [-5269, -3747] | 8.41 m |
| sfo | [-5200, -2600] → [-4412, -2461] | 6.01 m |
| lax | [-3600, 6400] → [-3218, 6018] | 13.27 m |
| skerries | [-1035, -475] → [-1035, -715] | 6.27 m |
| longbank | [-411, -1105] → [-504, -1453] | 6.05 m |
| town | [-1700, 700] → [-1400, 700] | 13.84 m |
| delta | [950, -6100] → [1088, -6076] | 5.78 m |
| ravencrag | [900, 0] → [630, 72] | 8.71 m |
| mountainpass | [-1350, 0] → [-1230, 0] | 22.58 m |

Complete changed runtime/tool files:

- `src/world/maps.js`
- `src/aircraft/model.js`
- `src/aircraft/models/civil-details.js`
- `src/fleet/aircraft-core.js`
- `src/fleet/aircraft-textures.js`
- `sw.js`
- `tools/silhouette.mjs`

`civil-details.js` is the only new runtime module. The offline cache version is `maps-models-20260920`; all 100 precache entries exist, and all source JavaScript is listed. Cached files total 4,138,760 bytes, excluding the directory entry. No external assets, package dependencies, build step or second Three.js instance were added.

## Included evidence and use

- `verification/maps-contact-sheet.png`: all 32 maps.
- `verification/aircraft-three-views.png`: plan, side and front for all eight aircraft.
- `verification/heightfields/`: sampled terrain grids.
- `verification/model-geometry/`: exported verification triangles, not runtime model assets.
- `verification/measurements.json`: before/after figures.
- `verification/selftest.json`: the final 146/146 result.
- `aircraft-preview.html`: interactive browser inspection of the eight models, served from this output folder.

Run the game with the existing `island-flight-sim/serve.py`, or serve this output folder with Python's HTTP server and open `/island-flight-sim/`. Open `/aircraft-preview.html` on the same server to inspect models. ES modules require an HTTP server; opening the HTML directly from disk is not the supported launch method.

For regression reproduction, load a fresh local server port, start the game with a normal user click (audio requires activation), then run the unchanged self-test exactly as described in the brief, with `window.__sim.renderer.render = () => {}`. The verification server used for this delivery injected a start button and saved results; it did not modify game code or assertions.

Actual Chromebook/iPad frame rates, a disconnected iPad install, exhaustive manual play of every mission, and real-aircraft dimensional calibration were not verified. Browser previews and geometry drawings were reviewed; the automated suite uses the renderer stub, so its pass is not a pixel-level visual test. An inherited scenery warning about a missing quay flat occurs in the 32-map construction audit without stopping construction; no new missing-file or import errors were found.
