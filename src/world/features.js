/**
 * Map features — the things that make each map the place its description says
 * it is.
 *
 * The five maps used to differ only in the shape of the ground and the colour
 * of the grass, so "volcanic" was a mountain, "coral atoll" was a sandy lump
 * and "Aurora Fjords" had no aurora. Everything here is per-map set dressing
 * driven by `features` in maps.js:
 *
 *   volcano     a lava lake in the crater, flows down the flanks, an ash
 *               column leaning downwind and embers after dark
 *   reef        the turquoise shallows that ring a tropical island, traced
 *               along the real coastline rather than drawn as a circle
 *   fields      farmland patchwork, so "grassland" reads as grassland
 *   waterfalls  meltwater off the fjord walls into the sea
 *   aurora      the northern lights, at night
 *
 * (The fjord snow line is not here — it is two lines in the terrain shader,
 * because snow is a property of the ground rather than an object on it.)
 *
 * Everything is procedural and everything is disposed by the caller through
 * `group`, in one piece, the same as the rest of the world.
 */

import * as THREE from '../vendor/three.module.js';
import { heightAt, MAP, ISLANDS } from './terrain.js';
import { fbm, makeRandom, clamp, smoothstep, lerp } from '../core/noise.js';

/* ------------------------------------------------------------------ */
/* Textures                                                            */
/* ------------------------------------------------------------------ */

function canvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return { c, g: c.getContext('2d') };
}

function asTexture(c, { wrapS = THREE.RepeatWrapping, wrapT = THREE.ClampToEdgeWrapping } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = wrapS;
  t.wrapT = wrapT;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/**
 * Molten rock: a dark basalt crust with a glowing crack network through it.
 *
 * Ridged noise (1 - |2n - 1|) is what makes the cracks: it peaks along the
 * zero crossings of the underlying noise field, which is exactly the branching
 * web that cooling lava breaks into.
 */
function lavaTexture(seed = 7) {
  const S = 256;
  const { c, g } = canvas(S);
  const img = g.createImageData(S, S);
  const d = img.data;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const n = fbm(x / 26, y / 26, { octaves: 4, gain: 0.55, seed });
      const ridge = 1 - Math.abs(n * 2 - 1);
      // Sharpen the ridges into cracks, and let a slower field open some of
      // them into wider pools.
      const pool = smoothstep(0.52, 0.78, fbm(x / 70, y / 70, { octaves: 2, seed: seed * 3 }));
      const heat = clamp(Math.pow(ridge, 5) * 1.5 + pool * 0.55, 0, 1);
      const crust = 22 + fbm(x / 9, y / 9, { octaves: 3, seed: seed * 5 }) * 26;
      const i = (y * S + x) * 4;
      // Black crust → deep red → orange → white-hot in the middle of a crack.
      d[i] = crust + heat * 255;
      d[i + 1] = crust * 0.55 + Math.pow(heat, 1.5) * 210;
      d[i + 2] = crust * 0.5 + Math.pow(heat, 4) * 190;
      d[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return asTexture(c, { wrapT: THREE.RepeatWrapping });
}

/**
 * A lava flow, mapped along its length: white-hot where it leaves the crater,
 * cooling to black crust at the toe. Baking the cooling into the texture is
 * what lets one material draw a flow that glows at the top and not the bottom.
 */
function lavaFlowTexture(seed = 11) {
  const W = 256;
  const H = 64;
  const { c, g } = canvas(W, H);
  const img = g.createImageData(W, H);
  const d = img.data;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = x / W; // 0 at the vent, 1 at the toe
      const v = y / H; // across the flow
      const n = fbm(x / 20, y / 12, { octaves: 3, seed });
      const ridge = 1 - Math.abs(n * 2 - 1);
      // Cools along its length, and the edges chill before the middle does.
      const cool = Math.pow(1 - u, 1.7) * (1 - Math.pow(Math.abs(v * 2 - 1), 2.2) * 0.85);
      const heat = clamp(Math.pow(ridge, 3.5) * 1.3 * cool + cool * 0.35, 0, 1);
      const crust = 16 + n * 26;
      const i = (y * W + x) * 4;
      d[i] = crust + heat * 255;
      d[i + 1] = crust * 0.5 + Math.pow(heat, 1.6) * 200;
      d[i + 2] = crust * 0.45 + Math.pow(heat, 4.5) * 170;
      d[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return asTexture(c);
}

/** A soft round puff, for ash and smoke. */
function smokeSprite() {
  const S = 96;
  const { c, g } = canvas(S);
  const img = g.createImageData(S, S);
  const d = img.data;
  const mid = S / 2;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const r = Math.hypot(x - mid, y - mid) / mid;
      // Break the circle up so a cluster of these does not read as bubbles.
      const lump = fbm(x / 16, y / 16, { octaves: 3, seed: 21 });
      const a = clamp((1 - r) * 1.25 - 0.35 + lump * 0.5, 0, 1);
      const i = (y * S + x) * 4;
      const shade = 190 + lump * 60;
      d[i] = shade;
      d[i + 1] = shade;
      d[i + 2] = shade;
      d[i + 3] = Math.pow(a, 1.6) * 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A plain radial glow, for embers and the aurora's soft edge. */
function glowSprite() {
  const S = 64;
  const { c, g } = canvas(S);
  const grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.35, 'rgba(255,215,150,0.75)');
  grd.addColorStop(1, 'rgba(255,120,40,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * Reef: mottled coral in bright shallow water. `u` runs around the island and
 * `v` from the beach out to open water, so the alpha ramp down `v` is what
 * makes the reef fade into the sea instead of ending at a hard line.
 */
function reefTexture() {
  const W = 256;
  const H = 128;
  const { c, g } = canvas(W, H);
  const img = g.createImageData(W, H);
  const d = img.data;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const v = y / (H - 1);
      // Tileable around the island: blend the two ends of the noise field.
      const n1 = fbm(x / 26, y / 20, { octaves: 4, seed: 31 });
      const n2 = fbm((x - W) / 26, y / 20, { octaves: 4, seed: 31 });
      const n = lerp(n1, n2, smoothstep(0.72, 1, x / W));
      // Coral heads near the beach, sand channels further out.
      const coral = smoothstep(0.42, 0.72, n) * (1 - smoothstep(0.35, 0.95, v));
      const a = (1 - smoothstep(0.0, 1.0, v)) * (0.55 + coral * 0.75) * (0.75 + n * 0.5);
      const i = (y * W + x) * 4;
      d[i] = 170 + coral * 70;
      d[i + 1] = 240 - coral * 30;
      d[i + 2] = 225 - coral * 60;
      d[i + 3] = clamp(a, 0, 1) * 255;
    }
  }
  g.putImageData(img, 0, 0);
  return asTexture(c);
}

/** Falling water: vertical streaks that scroll downwards. */
function waterfallTexture() {
  const W = 64;
  const H = 128;
  const { c, g } = canvas(W, H);
  const img = g.createImageData(W, H);
  const d = img.data;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      // Stretched noise: long vertically, fine horizontally = falling water.
      const n = fbm(x / 3.2, y / 26, { octaves: 3, seed: 41 });
      const edge = 1 - Math.pow(Math.abs((x / (W - 1)) * 2 - 1), 2.4);
      const a = clamp(n * 1.5 - 0.35, 0, 1) * edge;
      const i = (y * W + x) * 4;
      d[i] = 240;
      d[i + 1] = 248;
      d[i + 2] = 255;
      d[i + 3] = a * 255;
    }
  }
  g.putImageData(img, 0, 0);
  return asTexture(c, { wrapT: THREE.RepeatWrapping });
}

/* ------------------------------------------------------------------ */
/* Geometry helpers                                                    */
/* ------------------------------------------------------------------ */

/**
 * Where the island actually meets the sea, bearing by bearing.
 *
 * The coastlines are wobbled by noise, so a circle drawn at `isl.radius` sits
 * out in open water on one side and up the beach on the other. Marching in
 * until the ground breaks the surface and then bisecting finds the real thing,
 * and costs a few thousand height samples once at build time.
 */
function coastline(isl, bearings = 96) {
  const out = [];
  const step = isl.radius * 0.02;
  for (let b = 0; b < bearings; b++) {
    const a = (b / bearings) * Math.PI * 2;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    let r = isl.radius * 1.5;
    const min = isl.radius * 0.15;
    while (r > min && heightAt(isl.cx + ca * r, isl.cz + sa * r) < 0) r -= step;
    let lo = r;
    let hi = r + step;
    for (let i = 0; i < 7; i++) {
      const mid = (lo + hi) / 2;
      if (heightAt(isl.cx + ca * mid, isl.cz + sa * mid) > 0) lo = mid;
      else hi = mid;
    }
    out.push((lo + hi) / 2);
  }
  return out;
}

/** A closed band between two radii-per-bearing arrays, lying flat at `y`. */
function bandGeometry(cx, cz, inner, outer, y, uRepeat = 12) {
  const n = inner.length;
  const pos = [];
  const uv = [];
  const idx = [];
  for (let b = 0; b <= n; b++) {
    const i = b % n;
    const a = (b / n) * Math.PI * 2;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    pos.push(cx + ca * inner[i], y, cz + sa * inner[i]);
    uv.push((b / n) * uRepeat, 0);
    pos.push(cx + ca * outer[i], y, cz + sa * outer[i]);
    uv.push((b / n) * uRepeat, 1);
  }
  for (let b = 0; b < n; b++) {
    const a = b * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/* ------------------------------------------------------------------ */

export class MapFeatures {
  constructor(scene, quality = 'high') {
    this.group = new THREE.Group();
    this.group.name = 'features';
    this.t = 0;
    this.quality = quality;

    /** Animated bits, collected so `update` does not have to walk the tree. */
    this.lavaMaps = [];
    this.plumes = [];
    this.craterLights = [];
    this.auroraMats = [];
    this.fallMaps = [];
    this.reefMats = [];

    const f = MAP.features || {};
    const density = quality === 'low' ? 0.35 : quality === 'medium' ? 0.7 : quality === 'ultra' ? 1.7 : 1;

    if (f.reef) this.buildReef(f.reef);
    if (f.fields) this.buildFields(f.fields, density);
    if (f.waterfalls) this.buildWaterfalls(f.waterfalls);
    if (f.aurora) this.buildAurora(f.aurora);
    for (const v of f.volcano || []) this.buildVolcano(v, density);

    scene.add(this.group);
  }

  /* -------------------------------------------------------------- reef -- */

  buildReef(cfg) {
    const tex = reefTexture();
    for (const index of cfg.islands || [0]) {
      const isl = ISLANDS[index];
      if (!isl) continue;
      const shore = coastline(isl, 96);
      const inner = shore.map((r) => r * 0.985);
      const outer = shore.map((r) => r * (1 + (cfg.width || 0.25)));
      // Just above the sea rather than below it: the ocean is opaque, and from
      // the air a reef reads as bright colour lying *on* the water anyway.
      const geo = bandGeometry(isl.cx, isl.cz, inner, outer, 0.45, Math.round(isl.radius / 220));
      const mat = new THREE.MeshBasicMaterial({
        map: tex,
        color: new THREE.Color(cfg.colour || 0x4fd6c0),
        transparent: true,
        opacity: cfg.bright ?? 0.62,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: true,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = 'reef';
      // After the sea (renderOrder 1 and 2 are the swell and the surf).
      mesh.renderOrder = 3;
      this.group.add(mesh);
      this.reefMats.push(mat);
    }
  }

  /* ------------------------------------------------------------ fields -- */

  /**
   * Farmland. One merged mesh with per-vertex colour: a few dozen crop patches
   * lying on the ground, which is the difference between "a green plain" and
   * somewhere people actually live.
   */
  buildFields(cfg, density) {
    const rnd = makeRandom(4242);
    const crops = [
      [0.62, 0.66, 0.34], // pasture
      [0.78, 0.72, 0.32], // ripe barley
      [0.52, 0.58, 0.28], // dark green
      [0.46, 0.38, 0.27], // ploughed earth
      [0.84, 0.79, 0.46], // stubble
    ];
    const pos = [];
    const col = [];
    const idx = [];
    let base = 0;
    const want = Math.round((cfg.count || 60) * density);

    for (let guard = 0, made = 0; guard < want * 12 && made < want; guard++) {
      const a = rnd() * Math.PI * 2;
      const r = Math.sqrt(rnd()) * cfg.radius;
      const cx = cfg.cx + Math.cos(a) * r;
      const cz = cfg.cz + Math.sin(a) * r;
      const w = 180 + rnd() * 420;
      const d = 180 + rnd() * 420;
      const rot = rnd() * Math.PI;
      // Not on the airfield, not in the sea, not on a slope no tractor would
      // climb, and not in the approach corridor where it would look odd.
      if (Math.abs(cx) < 1100 && cz > -560 && cz < 520) continue;
      const h0 = heightAt(cx, cz);
      if (h0 < 6) continue;
      const e = 60;
      const slope =
        Math.hypot(heightAt(cx + e, cz) - heightAt(cx - e, cz), heightAt(cx, cz + e) - heightAt(cx, cz - e)) /
        (2 * e);
      if (slope > 0.10) continue;

      const crop = crops[(rnd() * crops.length) | 0];
      const shade = 0.9 + rnd() * 0.22;
      const N = 5;
      const ca = Math.cos(rot);
      const sa = Math.sin(rot);
      let drowned = false;
      const verts = [];
      for (let iy = 0; iy <= N && !drowned; iy++) {
        for (let ix = 0; ix <= N; ix++) {
          const lx = (ix / N - 0.5) * w;
          const lz = (iy / N - 0.5) * d;
          const x = cx + lx * ca - lz * sa;
          const z = cz + lx * sa + lz * ca;
          const y = heightAt(x, z);
          if (y < 4) {
            drowned = true;
            break;
          }
          verts.push(x, y + 0.35, z);
        }
      }
      if (drowned) continue;
      pos.push(...verts);
      for (let i = 0; i < (N + 1) * (N + 1); i++) col.push(crop[0] * shade, crop[1] * shade, crop[2] * shade);
      for (let iy = 0; iy < N; iy++) {
        for (let ix = 0; ix < N; ix++) {
          const a0 = base + iy * (N + 1) + ix;
          idx.push(a0, a0 + N + 1, a0 + 1, a0 + 1, a0 + N + 1, a0 + N + 2);
        }
      }
      base += (N + 1) * (N + 1);
      made++;
    }

    if (!pos.length) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.95,
        metalness: 0,
        // The patches sit a few centimetres over the terrain; the offset stops
        // them shimmering against it at a distance.
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      })
    );
    mesh.receiveShadow = true;
    this.group.add(mesh);
  }

  /* -------------------------------------------------------- waterfalls -- */

  buildWaterfalls(count) {
    const tex = waterfallTexture();
    const rnd = makeRandom(9091);
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.fallMaps.push(tex);
    let made = 0;
    for (let guard = 0; guard < count * 300 && made < count; guard++) {
      // Look for a steep face close to the water: that is where a fjord
      // waterfall lands.
      const isl = ISLANDS[1 + ((rnd() * Math.max(1, ISLANDS.length - 1)) | 0)] || ISLANDS[0];
      const a = rnd() * Math.PI * 2;
      const r = isl.radius * (0.85 + rnd() * 0.3);
      const x = isl.cx + Math.cos(a) * r;
      const z = isl.cz + Math.sin(a) * r;
      const top = heightAt(x, z);
      if (top < 90 || top > 520) continue;
      if (Math.abs(x) < 2600 && Math.abs(z) < 900) continue; // not over the approach
      const e = 40;
      const gx = heightAt(x + e, z) - heightAt(x - e, z);
      const gz = heightAt(x, z + e) - heightAt(x, z - e);
      const slope = Math.hypot(gx, gz) / (2 * e);
      if (slope < 0.75) continue;
      // Downhill, so the fall hangs off the face rather than through it.
      const dl = Math.hypot(gx, gz) || 1;
      const dx = -gx / dl;
      const dz = -gz / dl;

      const w = 12 + rnd() * 16;
      const drop = top;
      const geo = new THREE.PlaneGeometry(w, drop);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x + dx * 12, drop / 2, z + dz * 12);
      mesh.rotation.y = Math.atan2(dx, dz);
      mesh.userData.uvRepeat = drop / 90;
      this.group.add(mesh);

      // Spray where it hits the water.
      const spray = new THREE.Mesh(
        new THREE.CircleGeometry(w * 1.5, 14),
        new THREE.MeshBasicMaterial({ color: 0xdfefff, transparent: true, opacity: 0.35, depthWrite: false })
      );
      spray.rotation.x = -Math.PI / 2;
      spray.position.set(x + dx * 12, 0.5, z + dz * 12);
      this.group.add(spray);
      made++;
    }
  }

  /* ------------------------------------------------------------ aurora -- */

  /**
   * The northern lights: tall ribbons of light that ripple along their length.
   * Additive, so they brighten the sky rather than sitting in front of it, and
   * they only come out at night.
   */
  buildAurora(cfg) {
    const colour = new THREE.Color(cfg.colour || 0x4dffa8);
    const colour2 = new THREE.Color(cfg.colour2 || 0x7a5cff);
    for (let i = 0; i < 4; i++) {
      const geo = new THREE.PlaneGeometry(26000, 2400, 90, 6);
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uColour: { value: colour },
          uColour2: { value: colour2 },
          uOpacity: { value: 0 },
          uSeed: { value: i * 3.7 },
        },
        vertexShader: `
          uniform float uTime;
          uniform float uSeed;
          varying vec2 vUv;
          varying float vWave;
          void main() {
            vUv = uv;
            vec3 p = position;
            // Two slow waves along the ribbon: one folds it, one shifts the
            // curtain sideways. Together they never quite repeat.
            float w = sin(p.x * 0.00042 + uTime * 0.19 + uSeed) * 620.0
                    + sin(p.x * 0.00017 - uTime * 0.11 + uSeed * 2.3) * 900.0;
            vWave = sin(p.x * 0.0009 + uTime * 0.32 + uSeed);
            p.z += w;
            p.y += sin(p.x * 0.00031 + uTime * 0.14) * 260.0;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
          }`,
        fragmentShader: `
          uniform vec3 uColour;
          uniform vec3 uColour2;
          uniform float uOpacity;
          uniform float uTime;
          varying vec2 vUv;
          varying float vWave;
          void main() {
            // Bright along the bottom edge, fading up — real curtains are lit
            // from below where the particles are densest.
            float v = vUv.y;
            float body = pow(1.0 - v, 1.6) * smoothstep(0.0, 0.12, v);
            // Vertical striations that drift along the curtain.
            float ray = 0.55 + 0.45 * sin(vUv.x * 260.0 + uTime * 0.5 + vWave * 3.0);
            ray *= 0.6 + 0.4 * sin(vUv.x * 61.0 - uTime * 0.23);
            // Ends taper off so the ribbon has no visible edge.
            float ends = smoothstep(0.0, 0.09, vUv.x) * (1.0 - smoothstep(0.91, 1.0, vUv.x));
            vec3 col = mix(uColour, uColour2, pow(v, 1.3));
            gl_FragColor = vec4(col * body * ray * ends * uOpacity, 1.0);
          }`,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: true,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(0, (cfg.height || 2600) + i * 380, -5000 - i * 2600);
      mesh.rotation.y = (i - 1.5) * 0.16;
      mesh.renderOrder = -1; // behind the clouds
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.auroraMats.push(mat);
    }
  }

  /* ----------------------------------------------------------- volcano -- */

  buildVolcano(cfg, density) {
    const isl = ISLANDS.find((i) => i.name === cfg.island);
    if (!isl) return;
    const rimR = isl.craterRadius || isl.radius * 0.12;
    const floorY = heightAt(isl.cx, isl.cz);
    const rimY = heightAt(isl.cx + rimR, isl.cz);

    if (cfg.lake) this.buildLavaLake(isl, rimR, floorY);
    if (cfg.flows) this.buildLavaFlows(isl, rimR, cfg.flows);
    if (cfg.plume) this.buildPlume(isl, rimR, rimY, density);
    if (cfg.embers) this.buildEmbers(isl, rimR, floorY, density);

    // One light over the crater. It does very little in daylight and turns the
    // whole summit orange after dark, which is the entire point of it.
    const light = new THREE.PointLight(0xff5a1e, 0, rimR * 26, 2);
    light.position.set(isl.cx, floorY + rimR * 0.4, isl.cz);
    this.group.add(light);
    this.craterLights.push({ light, base: cfg.plume ? 900 : 320 });
  }

  buildLavaLake(isl, rimR, floorY) {
    const tex = lavaTexture(isl.seed);
    tex.repeat.set(3, 3);
    const geo = new THREE.CircleGeometry(rimR * 0.82, 48);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x120806,
      emissive: 0xffffff,
      emissiveMap: tex,
      emissiveIntensity: 1.5,
      map: tex,
      roughness: 0.75,
      metalness: 0,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'lavaLake';
    // Sit just above the crater floor. The bowl is flat in the middle, so the
    // lake lies in it rather than hovering over a slope.
    mesh.position.set(isl.cx, floorY + 2.5, isl.cz);
    this.group.add(mesh);
    this.lavaMaps.push({ tex, speed: 0.012, mat, pulse: 0.35 });
  }

  buildLavaFlows(isl, rimR, count) {
    const tex = lavaFlowTexture(isl.seed);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x120806,
      emissive: 0xffffff,
      emissiveMap: tex,
      emissiveIntensity: 1.25,
      map: tex,
      roughness: 0.9,
      metalness: 0,
      side: THREE.DoubleSide,
    });
    this.lavaMaps.push({ tex, speed: 0.03, mat, pulse: 0.2 });

    const rnd = makeRandom(isl.seed * 17);
    for (let f = 0; f < count; f++) {
      let bearing = (f / count) * Math.PI * 2 + rnd() * 0.5;
      const pos = [];
      const uv = [];
      const idx = [];
      const steps = 42;
      const reach = isl.radius * 0.72;
      let ok = true;
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        // Flows wander as they run, and the wander grows further down.
        bearing += (rnd() - 0.5) * 0.06 * t;
        const r = lerp(rimR * 0.95, reach, Math.pow(t, 0.92));
        const ca = Math.cos(bearing);
        const sa = Math.sin(bearing);
        const x = isl.cx + ca * r;
        const z = isl.cz + sa * r;
        // Wider than they were. A 30 m ribbon down a 3 km flank is a thread
        // from anywhere you actually fly; these read as rivers of lava.
        const half = lerp(28, 10, t);
        // Across the flow, perpendicular to the bearing.
        const px = -sa;
        const pz = ca;
        const lx = x + px * half;
        const lz = z + pz * half;
        const rx = x - px * half;
        const rz = z - pz * half;
        const ly = heightAt(lx, lz);
        const ry = heightAt(rx, rz);
        if (ly < 4 || ry < 4) {
          // Ran into the sea — stop here rather than draw lava on the water.
          if (s < 6) ok = false;
          break;
        }
        // Riding 1.5 m proud keeps it out of the ground on the steep bits.
        pos.push(lx, ly + 1.5, lz, rx, ry + 1.5, rz);
        uv.push(t, 0, t, 1);
      }
      const pairs = pos.length / 6;
      if (!ok || pairs < 6) continue;
      for (let s = 0; s < pairs - 1; s++) {
        const a = s * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      const flow = new THREE.Mesh(geo, mat);
      flow.name = 'lavaFlow';
      this.group.add(flow);
    }
  }

  /**
   * The ash column.
   *
   * Points with a small custom shader, because the plume needs per-particle
   * opacity and the stock points material cannot fade one particle without
   * fading all of them.
   */
  buildPlume(isl, rimR, rimY, density) {
    const count = Math.round(340 * density);
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const size = new Float32Array(count);
    const alpha = new Float32Array(count);
    const state = [];
    for (let i = 0; i < count; i++) {
      state.push({ age: (i / count) * 46, life: 40 + (i % 7) * 3, spin: i * 1.7 });
      pos[i * 3] = isl.cx;
      pos[i * 3 + 1] = rimY;
      pos[i * 3 + 2] = isl.cz;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1));

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: smokeSprite() },
        uColour: { value: new THREE.Color(0x5b524b) },
        uOpacity: { value: 1 },
      },
      vertexShader: `
        attribute float aSize;
        attribute float aAlpha;
        varying float vAlpha;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          // Fade the whole column out at long range: it is a local effect and
          // at 15 km it should be part of the haze, not a hard grey blob.
          vAlpha = aAlpha * (1.0 - smoothstep(11000.0, 19000.0, -mv.z));
          gl_PointSize = clamp(aSize * (320.0 / max(1.0, -mv.z)), 1.0, 780.0);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform sampler2D uMap;
        uniform vec3 uColour;
        uniform float uOpacity;
        varying float vAlpha;
        void main() {
          vec4 t = texture2D(uMap, gl_PointCoord);
          float a = t.a * vAlpha * uOpacity;
          if (a < 0.004) discard;
          gl_FragColor = vec4(uColour * t.rgb, a);
        }`,
      transparent: true,
      depthWrite: false,
    });

    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    this.group.add(points);
    this.plumes.push({ points, geo, state, isl, rimR, rimY, count, mat });
  }

  buildEmbers(isl, rimR, floorY, density) {
    const count = Math.round(90 * density);
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const size = new Float32Array(count);
    const alpha = new Float32Array(count);
    const state = [];
    for (let i = 0; i < count; i++) {
      state.push({ age: (i / count) * 9, life: 7 + (i % 5), spin: i * 2.3 });
      pos[i * 3] = isl.cx;
      pos[i * 3 + 1] = floorY;
      pos[i * 3 + 2] = isl.cz;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: glowSprite() }, uOpacity: { value: 1 } },
      vertexShader: `
        attribute float aSize;
        attribute float aAlpha;
        varying float vAlpha;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vAlpha = aAlpha * (1.0 - smoothstep(4000.0, 9000.0, -mv.z));
          gl_PointSize = clamp(aSize * (320.0 / max(1.0, -mv.z)), 1.0, 220.0);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform sampler2D uMap;
        uniform float uOpacity;
        varying float vAlpha;
        void main() {
          vec4 t = texture2D(uMap, gl_PointCoord);
          float a = t.a * vAlpha * uOpacity;
          if (a < 0.01) discard;
          gl_FragColor = vec4(t.rgb, a);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    this.group.add(points);
    this.plumes.push({ points, geo, state, isl, rimR, rimY: floorY, count, mat, ember: true });
  }

  /* ------------------------------------------------------------ update -- */

  update(dt, weather) {
    this.t += dt;
    const night = weather && weather.isNight ? 1 : 0;
    // Dusk counts as half dark for the glow — sunset is when a volcano looks
    // its best and the ember map opens at sunset.
    const dark = weather && weather.time === 'sunset' ? 0.55 : night;

    // Molten rock crawls. Scrolling the texture is what sells it as liquid.
    for (const l of this.lavaMaps) {
      l.tex.offset.y = (l.tex.offset.y - dt * l.speed) % 1;
      l.tex.offset.x = (l.tex.offset.x + dt * l.speed * 0.35) % 1;
      /*
       * A slow breathing pulse, brighter at night.
       *
       * The daylight floor used to be 1.1, which against a bright sky and a
       * sunlit ash slope was almost nothing — the flows were there, and you
       * genuinely could not see them. Molten rock is around 1,100 °C; it does
       * not stop glowing because the sun is up. 2.9 in daylight reads as lava
       * from the circuit, and it still climbs at dusk and after dark.
       */
      const pulse = 1 + Math.sin(this.t * 0.55) * l.pulse * 0.35;
      l.mat.emissiveIntensity = (2.9 + dark * 2.0) * pulse * (l.boost || 1);
    }

    for (const c of this.craterLights) {
      c.light.intensity = c.base * (0.18 + dark * 1.5) * (0.85 + Math.sin(this.t * 0.8) * 0.15);
    }

    // Falling water scrolls downwards.
    for (const t of this.fallMaps) t.offset.y = (t.offset.y - dt * 1.4) % 1;

    // Aurora: night only, brought up and down gently so it does not snap on.
    if (this.auroraMats.length) {
      const want = night ? 1 : weather && weather.time === 'sunset' ? 0.35 : 0;
      for (const m of this.auroraMats) {
        m.uniforms.uTime.value = this.t;
        const cur = m.uniforms.uOpacity.value;
        m.uniforms.uOpacity.value = cur + (want - cur) * Math.min(1, dt * 0.6);
      }
    }

    if (this.plumes.length) this.updatePlumes(dt, weather);
  }

  updatePlumes(dt, weather) {
    const wind = weather ? weather.windVector(new THREE.Vector3()) : new THREE.Vector3();
    for (const p of this.plumes) {
      const pos = p.geo.attributes.position.array;
      const size = p.geo.attributes.aSize.array;
      const alpha = p.geo.attributes.aAlpha.array;
      for (let i = 0; i < p.count; i++) {
        const s = p.state[i];
        s.age += dt;
        if (s.age > s.life) {
          s.age = 0;
          // Respawn somewhere on the vent, not all from one point.
          const a = (s.spin * 7.3) % (Math.PI * 2);
          const r = p.rimR * 0.6 * ((s.spin * 3.1) % 1);
          pos[i * 3] = p.isl.cx + Math.cos(a) * r;
          pos[i * 3 + 1] = p.rimY + 4;
          pos[i * 3 + 2] = p.isl.cz + Math.sin(a) * r;
        }
        const t = s.age / s.life;
        if (p.ember) {
          // Embers shoot up fast, slow down, and burn out.
          const rise = 46 * (1 - t) * dt;
          pos[i * 3 + 1] += rise;
          pos[i * 3] += (wind.x * 0.5 + Math.sin(this.t * 1.7 + s.spin) * 6) * dt;
          pos[i * 3 + 2] += (wind.z * 0.5 + Math.cos(this.t * 1.3 + s.spin) * 6) * dt;
          size[i] = lerp(26, 6, t);
          alpha[i] = Math.pow(1 - t, 1.5) * 0.9;
        } else {
          // Ash rises hard out of the vent, then loses its buoyancy and gets
          // carried away downwind — which is why a plume leans over.
          const rise = lerp(58, 6, Math.pow(t, 0.7)) * dt;
          pos[i * 3 + 1] += rise;
          const drift = 0.25 + t * 1.5;
          pos[i * 3] += (wind.x * drift + Math.sin(this.t * 0.25 + s.spin) * 5) * dt;
          pos[i * 3 + 2] += (wind.z * drift + Math.cos(this.t * 0.21 + s.spin) * 5) * dt;
          size[i] = lerp(120, 620, Math.pow(t, 0.8));
          // Dense and dark at the vent, thinning as it spreads.
          alpha[i] = Math.sin(Math.min(1, t * 1.15) * Math.PI) * 0.42;
        }
      }
      p.geo.attributes.position.needsUpdate = true;
      p.geo.attributes.aSize.needsUpdate = true;
      p.geo.attributes.aAlpha.needsUpdate = true;
    }
  }
}
