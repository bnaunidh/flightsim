# Island Flight Simulator — third model pack

Two things, and the first one is good news.

**Your military aeroplanes have won.** The Vanguard, the Osprey and the
Nightjar are now what the game ships by default — not behind a switch, not in
dev mode. They are the best-looking aeroplanes in the project and they beat
the ones this codebase draws itself. The Nightjar in particular: a real flying
wing with a sawtooth trailing edge, buried intakes and no fuselage anywhere in
it, which is exactly right and is the single hardest shape in the set.

**Your civil aeroplanes have not.** The Skylark, the Courier, the Meridian and
the Tempest still lose to the built-in ones, and the game now uses the
built-in ones for those four. Both sets stay in; the choice is per aeroplane
rather than per pack, because "which pack is better" turned out to be the
wrong question.

So this document is about one thing: **why the civil four lose, and what to
change.** It is not a rewrite request. The geometry underneath them is fine.
What is missing is almost entirely surface: how they take light.

---

## 0. The rules, unchanged

- Three.js **r169**, the copy already at `src/vendor/three.module.js`. One
  instance, no second copy.
- **Everything procedural.** No model files, no texture images, no audio
  files, no CDN, no npm, no build step. Canvas 2D for textures, Web Audio for
  sound. The whole game is about 1.2 MB and runs offline on a school laptop.
- **−Z forward, +Y up, +X right.** Full-size metres. Scale 1.
- Audience is 10 to 12 years old, on school Chromebooks and iPads. Whatever
  you add has to survive at 30 fps on integrated graphics.
- Keep `createGameAircraft(options, legacyFactory)` and its fallback argument.

---

## 1. Why yours look flatter than ours

They are lit differently, not built worse. Five specific things:

### 1.1 There is an environment map, and your materials are ignoring it

The game builds a real environment from its own procedural sky every time the
weather or the time of day changes:

```js
this.sky.buildEnvironment(this.renderer, this.scene);   // main.js
```

That produces a PMREM of the actual sky dome — blue above, ground bounce
below, sun where the sun is. Anything with `metalness > 0` picks it up for
free and starts behaving like painted metal: a bright band along the top of
the fuselage, a darker one underneath, and both moving as you roll.

Our materials are set up for it. Yours are largely matte, so they get none of
it and read as coloured plastic.

Use, as a baseline:

```js
// Painted airframe
new THREE.MeshStandardMaterial({
  map: skin,
  normalMap: panelNormal,
  normalScale: new THREE.Vector2(0.5, 0.5),
  roughness: 0.36,
  metalness: 0.40,
  envMapIntensity: 1.0,
});

// Anything that should not shine: gear doors, walkways, anti-glare panels
{ roughness: 0.62, metalness: 0.20 }

// Glass — a real physical material, not a tinted plane
new THREE.MeshPhysicalMaterial({
  color: 0xa8c6d8, roughness: 0.05, metalness: 0,
  transparent: true, opacity: 0.38, side: THREE.DoubleSide,
});
```

The single biggest change in this whole document is **metalness 0.4 and
roughness 0.36 on painted surfaces**. Try it before anything else; it costs
nothing and it is most of the gap.

### 1.2 Wings are lofted from an aerofoil, not extruded from a plate

Ours build every flying surface by lofting a NACA-style section along
spanwise stations, then `computeVertexNormals()`:

```js
loft([ {y, chord, offsetX, offsetY, twist, thick}, ... ], aerofoil(16, 0.075, 0.006))
```

Thickness 0.075 with 0.006 camber for fast aeroplanes, 0.135 / 0.025 for slow
ones. The result is a wing with a rounded leading edge and a sharp trailing
edge that catches a highlight along its whole length as it rolls. A plate —
even a tapered, swept, correctly-proportioned plate — has two flat faces and
one hard edge, and it goes from fully lit to fully dark in one step. That step
is what reads as "flat" at any distance.

This matters far less on your military aeroplanes, which is part of why they
win: a fighter's wing genuinely is thin and hard-edged.

### 1.3 Panel lines belong in a normal map, not in the colour

We draw panel lines, rivets and skin buckling into a **normal map** and leave
the colour texture almost clean. Lines drawn into colour stay put when the
light moves, which makes them read as printed decoration. In a normal map they
catch the sun on one side and shade on the other, and they move as you fly.
`normalScale` of 0.5 is plenty — at 1.0 an aeroplane looks quilted.

### 1.4 One material per aeroplane is one too few

Our airframes carry at least four: body, matte, glass, rubber — plus a
separate **tail material** when a scheme has a coloured fin. That last one is
not fussiness. A fin lofted with u around the section and v spanwise takes any
colour painted into the texture as a band wrapped *across* it, never as a
coloured tail, so the one marking that makes an airline recognisable in the
air cannot be done in the texture at all. It has to be a tinted material.

### 1.5 Smooth where it is smooth, sharp where it is sharp

`computeVertexNormals()` on a lofted hull gives you smooth shading for free.
Where a real aeroplane has a crease — a wing root fairing, a canopy rail, the
step down to a gear door — build the crease as geometry rather than smoothing
across it. Getting this the wrong way round in either direction is instantly
visible: a smooth aeroplane with a faceted nose looks cheap, and a faceted
aeroplane with a smooth wing looks unfinished.

---

## 2. What we want next: damage you can see, where you were hit

This is the one new feature, and it is the thing the class asks for most.

The game already tracks damage per part. When you are shot at, or you clip
something, `physics.js` does:

```js
ac.takeHit(part, severity, reason)
// part: 'leftWing' | 'rightWing' | 'nose' | 'tail' | 'fuselage' | 'gear'
// severity: 0..1 added to that part's running total
```

and emits `EVENTS.DAMAGE` with `{ part, severity, level, reason }`, where
`level` is that part's total, 0 to 1. The flight model already responds: a hurt
wing loses lift and rolls you towards it, a hurt tail loses pitch and yaw
authority.

**What is missing is that you cannot see it.** The aeroplane that has been shot
through the left wing looks exactly like the one that has not. Your pack
already has the hardest half of this built — `registerPart`, `strikePoints`,
and breakaway sections that come off in a crash. What we need is the part of
the scale below "it comes off":

```js
model.userData.showDamage(part, level)   // level 0..1, called on every change
```

- **0.0 – 0.25** — scorching and soot streaking aft from the hit, a few small
  holes. Nothing structural.
- **0.25 – 0.6** — a panel gone or peeled back, torn skin with bright metal at
  the edges, the paint burnt off around it.
- **0.6 – 1.0** — a hole you can see through, a control surface hanging, thin
  smoke trailing from the part. (Smoke on the damaged part only, please, not
  on the aeroplane generally.)

Rules for it:

- **It must be on the part named**, not a generic "damaged aeroplane" look.
  Being told "left wing" by the panel and seeing the scorch on the left wing
  is the whole point; putting it anywhere else is worse than nothing.
- **Procedural, like everything else.** Canvas-drawn decals on a damage layer,
  or geometry you already have with a second material — your choice.
- **It must be reversible.** `showDamage(part, 0)` restores the part, because
  the game repairs the aeroplane on restart without rebuilding the model.
- **It must cost nothing when undamaged**, which is almost every frame of
  almost every flight. Build the damage layer lazily on the first hit.
- **Keep it survivable-looking.** Everybody walks away in this simulator. It
  should look like an aeroplane that has been hit, not like a war grave.

If `showDamage` is present we will call it; if it is absent nothing breaks.

---

## 3. Smaller things, in order of how much they would help

1. **The Meridian's cabin.** It is a wedge. An airliner fuselage is a tube
   with a round cross-section, a nose that comes to a blunt point and a tail
   cone that rises. Ours lathes a 13-point profile — that is the whole
   technique, and it is nine lines of code.
2. **Windows on the skin, not beside it.** Our airliner asks the hull for its
   half-width at each station and puts each window on the surface there, so the
   line follows the taper aft. A window row at a fixed offset from the
   centreline hangs in the air once the body starts narrowing.
3. **Propellers.** Ours are two real blades plus a blur disc that fades in with
   rpm; below about 600 rpm you see blades, above it you see the disc.
4. **Undercarriage that reaches.** Check every strut against the surface it
   attaches to. We have had a nacelle come up through a wing and an aeroplane
   nose into the runway from getting this wrong by 30 cm.
5. **Lights.** The pack's aeroplanes have no navigation lights of their own —
   the game hangs its own on afterwards (`glowSprite`). If you would rather own
   them, they are red to port, green to starboard, white at the tail, and a
   strobe that fires twice a second.

---

## 4. How to check your work

The game has a 84-check self-test and a playtest sweep:

```js
const { runSelfTest } = await import('/tests/selftest.js');
await runSelfTest(window.__sim);

const { runPlaytest } = await import('/tests/playtest.js');
await runPlaytest(window.__sim);
```

Both drive the real game headlessly through take-off, climb, stalls, landings,
every weather preset, every camera and every mission. If your pack is in and
those pass, the models are wired correctly. They will not tell you whether the
aeroplanes look right — that is what section 1 is for.

One last measurement to take before you send anything: put your aeroplane and
ours side by side on the apron, at midday, clear weather, and roll the camera
around both. Everything in section 1 is visible in that one comparison, which
is how we found all of it.
