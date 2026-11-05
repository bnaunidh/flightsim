/**
 * The hiding places, drawn: a farm shed, a cave hangar in a hillside, an old
 * bunker, a hangar at the far end of an airfield and a lift in the carrier's
 * deck — each with a door that opens and closes, lights inside that come on,
 * the secret plane parked in it, and the one clue outside that gives it away.
 *
 * A HIDEOUT is built in its own frame: the floor at y = 0, the door at
 * z = -d/2 looking down -Z (the way the site's heading points), the back
 * wall at +d/2. The group is put on the site and turned to its heading, so
 * nothing here needs to know which way the door faces in the world.
 *
 * CHEAP. Every box of a building is one Batch (airport-kit.js): one draw
 * call for the shell, one for the lining that lights up, one for the lamps,
 * one for the door, and the aeroplane baked to a handful. The lights are not
 * lights: three.js charges every lit material on screen for every light in
 * the scene, so "the lights come on" is the lining's colour and the lamps'
 * glow easing up — no PointLight, no shader recompile, and nothing that
 * flashes (a steady fade, under a second, whatever Reduce flashing says:
 * it is not a flash, and it never blinks).
 *
 * Solid: the walls, the back and the roof are terrain.js obstacles; the
 * floor is a platform (heightAt reads it, so the walker and the wheels stand
 * on the floor, not the hillside under it); the door is one more obstacle
 * whose bottom rises with the door.
 */

import * as THREE from '../../vendor/three.module.js';
import { Batch, vcMaterial, trs, layer, canvas, canvasTexture, bakeModel, disposeBake } from '../../world/airport-kit.js';

const D2R = Math.PI / 180;

/* ------------------------------------------------------------------ */
/* Paint                                                               */
/* ------------------------------------------------------------------ */

const PALETTE = {
  shed: { wall: 0x8a3b2c, trim: 0xe7e1d2, roof: 0x5b6066, floor: 0x8f8a80, door: '#9aa3a8' },
  cave: { wall: 0x6c6862, trim: 0x8e8b84, roof: 0x5d5a55, floor: 0x7e7b75, door: '#7c858c' },
  bunker: { wall: 0x9c9a91, trim: 0x7b7a73, roof: 0x5f6b45, floor: 0x85837b, door: '#6f7a63' },
  far: { wall: 0xc4cad0, trim: 0x5d646b, roof: 0x8e959c, floor: 0x9a9da0, door: '#b9c2ca' },
  hatch: { wall: 0x3a3f45, trim: 0xe8c547, roof: 0x3a3f45, floor: 0x2b3036, door: '#4a5058' },
};

const texCache = new Map();
/** Corrugated ribs across a door (horizontal), drawn once and shared by image. */
function doorImage(hex) {
  if (texCache.has(hex)) return texCache.get(hex);
  const c = canvas(64, 128);
  const g = c.getContext('2d');
  g.fillStyle = hex;
  g.fillRect(0, 0, 64, 128);
  for (let y = 0; y < 128; y += 16) {
    const gr = g.createLinearGradient ? g.createLinearGradient(0, y, 0, y + 16) : null;
    if (gr && gr.addColorStop) {
      gr.addColorStop(0, 'rgba(255,255,255,0.18)');
      gr.addColorStop(0.5, 'rgba(0,0,0,0.05)');
      gr.addColorStop(1, 'rgba(0,0,0,0.25)');
      g.fillStyle = gr;
    }
    g.fillRect(0, y, 64, 16);
  }
  texCache.set(hex, c);
  return c;
}

/** A soft dark streak for tyre tracks: dark in the middle, nothing at the edges. */
let trackTex = null;
function trackTexture() {
  if (trackTex) return trackTex;
  const c = canvas(32, 8);
  const g = c.getContext('2d');
  if (g.createLinearGradient) {
    const gr = g.createLinearGradient(0, 0, 32, 0);
    if (gr && gr.addColorStop) {
      gr.addColorStop(0, 'rgba(40,30,20,0)');
      gr.addColorStop(0.5, 'rgba(40,30,20,0.85)');
      gr.addColorStop(1, 'rgba(40,30,20,0)');
      g.fillStyle = gr;
    }
  }
  g.fillRect(0, 0, 32, 8);
  trackTex = canvasTexture(c, { repeat: true });
  return trackTex;
}

/* ------------------------------------------------------------------ */
/* The hideout                                                         */
/* ------------------------------------------------------------------ */

/**
 * @param spot   ./data.js entry
 * @param site   ./sites.js site
 * @param type   the aeroplane inside (a roster type)
 * @param opts   { makeModel(type) -> Object3D, ground(x, z) -> metres (the drawn ground), windDeg }
 */
export class Hideout {
  constructor(spot, site, type, opts = {}) {
    this.spot = spot;
    this.site = site;
    this.type = type;
    this.kind = spot.kind;
    this.open = 0;
    this.target = 0;
    this.light = 0;
    this.lightsOn = false;
    this.lightsTouched = false;
    this.ground = opts.ground || (() => site.floorY);
    this.group = new THREE.Group();
    this.group.name = `secret:${spot.id}`;
    this.world = new THREE.Group();
    this.world.name = `secret:${spot.id}:outside`;
    this.group.position.set(site.x, site.floorY, site.z);
    this.group.rotation.y = -site.headingDeg * D2R;
    this.h = site.headingDeg;
    this.cos = Math.cos(this.h * D2R);
    this.sin = Math.sin(this.h * D2R);
    this.obstacles = [];
    this.materials = [];
    this.geometries = [];
    this.textures = [];
    this.lift = 0;
    const P = PALETTE[this.kind] || PALETTE.shed;
    this.pal = P;
    if (this.kind === 'hatch') this.buildHatch(P);
    else this.buildShell(P);
    // The aeroplane is built the first time the door opens: nobody pays for a plane behind a shut door.
    this.makeModel = opts.makeModel;
    this.buildClue(spot.clue, P, opts);
    this.setOpen(0, true);
    this.setLight(0, true);
  }

  /** Ship-or-site local (x right, z back) to world (x, z). */
  toWorld(lx, lz, out = {}) {
    out.x = this.site.x + lx * this.cos - lz * this.sin;
    out.z = this.site.z + lx * this.sin + lz * this.cos;
    return out;
  }

  mat(m) {
    this.materials.push(m);
    return m;
  }

  geo(g) {
    if (g) this.geometries.push(g);
    return g;
  }

  /* ---------------------------------------------------------- shell -- */

  buildShell(P) {
    const s = this.site;
    const W = s.w;
    const D = s.d;
    const H = s.h;
    const doorH = s.doorH;
    const doorW = W - (this.kind === 'far' ? 2.4 : 2.2);
    this.doorW = doorW;
    this.doorH = doorH;
    const t = this.kind === 'bunker' ? 0.9 : this.kind === 'cave' ? 0.8 : 0.28;
    const drop = Math.max(0.3, s.floorY - (s.groundLo != null ? s.groundLo : s.floorY) + 0.4);
    const shell = new Batch();
    // Floor slab and plinth down to the lowest ground under it.
    shell.box(W + 0.6, drop, D + 0.6, 0, -drop / 2 + 0.02, 0, P.floor);
    // Walls.
    shell.box(t, H, D, -W / 2 + t / 2, H / 2, 0, P.wall);
    shell.box(t, H, D, W / 2 - t / 2, H / 2, 0, P.wall);
    shell.box(W - 2 * t, H, t, 0, H / 2, D / 2 - t / 2, P.wall);
    // The front: posts either side of the door and the header over it.
    const post = (W - doorW) / 2;
    shell.box(post, doorH, t, -W / 2 + post / 2, doorH / 2, -D / 2 + t / 2, P.wall);
    shell.box(post, doorH, t, W / 2 - post / 2, doorH / 2, -D / 2 + t / 2, P.wall);
    shell.box(W, H - doorH, t, 0, doorH + (H - doorH) / 2, -D / 2 + t / 2, P.wall);
    // Trim round the door, so it reads as a door from a distance.
    shell.box(doorW + 0.5, 0.35, 0.18, 0, doorH + 0.18, -D / 2 - 0.06, P.trim);
    shell.box(0.25, doorH, 0.18, -doorW / 2 - 0.12, doorH / 2, -D / 2 - 0.06, P.trim);
    shell.box(0.25, doorH, 0.18, doorW / 2 + 0.12, doorH / 2, -D / 2 - 0.06, P.trim);
    // The roof.
    if (this.kind === 'shed' || this.kind === 'far') {
      const rise = W * (this.kind === 'shed' ? 0.2 : 0.1);
      const half = W / 2;
      const slope = Math.atan2(rise, half);
      const len = Math.hypot(half, rise) + 0.5;
      for (const sd of [-1, 1]) {
        const g = new THREE.BoxGeometry(len, 0.22, D + 0.9);
        const m = new THREE.Matrix4().compose(
          new THREE.Vector3((sd * half) / 2, H + rise / 2, 0),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -sd * slope)),
          new THREE.Vector3(1, 1, 1)
        );
        shell.add(g, m, P.roof);
        g.dispose();
      }
      for (const zz of [-D / 2, D / 2]) {
        shell.tri([-half, H, zz], [half, H, zz], [0, H + rise, zz], [0, 0], [1, 0], [0.5, 1], P.wall);
        shell.tri([half, H, zz], [-half, H, zz], [0, H + rise, zz], [0, 0], [1, 0], [0.5, 1], P.wall);
      }
      shell.box(0.5, 0.3, D + 1, 0, H + rise + 0.05, 0, P.trim);
      this.roofTop = H + rise;
    } else {
      shell.box(W + 0.4, 0.5, D + 0.4, 0, H + 0.25, 0, P.roof);
      this.roofTop = H + 0.5;
    }
    if (this.kind === 'bunker') this.dressBunker(shell, P, W, D, H);
    if (this.kind === 'cave') this.dressCave(shell, P, W, D, H);
    const shellMat = this.mat(vcMaterial({ roughness: this.kind === 'far' ? 0.6 : 0.88, metalness: this.kind === 'far' ? 0.3 : 0.05 }));
    const mesh = shell.mesh(shellMat, { name: 'secret-shell' });
    this.geo(mesh.geometry);
    this.group.add(mesh);
    this.shell = mesh;

    // The lining: what the lights fall on. Dark until they come on.
    const lining = new Batch();
    const e = 0.03;
    lining.box(0.04, H - 0.1, D - 2 * t - 0.1, -W / 2 + t + e, H / 2, 0, 0xffffff);
    lining.box(0.04, H - 0.1, D - 2 * t - 0.1, W / 2 - t - e, H / 2, 0, 0xffffff);
    lining.box(W - 2 * t - 0.1, H - 0.1, 0.04, 0, H / 2, D / 2 - t - e, 0xffffff);
    lining.box(W - 2 * t - 0.1, 0.04, D - 2 * t - 0.1, 0, H - 0.05, 0, 0xffffff);
    lining.flat(W - 2 * t - 0.1, D - 2 * t - 0.1, 0, 0.012, 0, 0xffffff);
    // A painted parking box on the floor.
    this.liningMat = this.mat(new THREE.MeshStandardMaterial({ vertexColors: true, color: 0x2a2d31, roughness: 0.9, metalness: 0.02 }));
    const lm = lining.mesh(this.liningMat, { cast: false, name: 'secret-lining' });
    this.geo(lm.geometry);
    this.group.add(lm);
    const paint = new Batch();
    const bw = Math.min(W - 3, (this.planeSpan || W - 4) + 1);
    paint.flat(bw, 0.18, 0, 0.03, -D / 2 + 2.2, 0xd9c02a);
    paint.flat(0.18, D - 4, -bw / 2, 0.03, 0.4, 0xd9c02a);
    paint.flat(0.18, D - 4, bw / 2, 0.03, 0.4, 0xd9c02a);
    this.paintMat = this.mat(layer(new THREE.MeshStandardMaterial({ vertexColors: true, color: 0x333333, roughness: 0.7 }), 'paint'));
    const pm = paint.mesh(this.paintMat, { cast: false, name: 'secret-paint' });
    this.geo(pm.geometry);
    this.group.add(pm);

    // Lamps under the roof: two rows of strips.
    const lamps = new Batch();
    const rows = this.kind === 'far' ? 3 : 2;
    for (let i = 0; i < rows; i++) {
      const z = -D / 2 + (D * (i + 1)) / (rows + 1);
      for (const sx of [-0.22, 0.22]) lamps.box(Math.max(1.2, W * 0.16), 0.14, 0.5, sx * W, H - 0.2, z, 0xffffff);
    }
    this.lampMat = this.mat(new THREE.MeshStandardMaterial({ color: 0x3a3a36, emissive: 0xfff1d0, emissiveIntensity: 0, roughness: 0.5 }));
    const lmp = lamps.mesh(this.lampMat, { cast: false, name: 'secret-lamps' });
    this.geo(lmp.geometry);
    this.group.add(lmp);

    // The light switch, by the door on the inside of the left wall.
    const sw = new Batch();
    sw.box(0.06, 0.32, 0.22, -W / 2 + t + 0.05, 1.35, -D / 2 + 1.4, 0xe8e4d8);
    sw.box(0.04, 0.12, 0.06, -W / 2 + t + 0.09, 1.38, -D / 2 + 1.4, 0xc8322a);
    const swm = sw.mesh(this.mat(vcMaterial({ roughness: 0.6 })), { cast: false, name: 'secret-switch' });
    this.geo(swm.geometry);
    this.group.add(swm);
    this.switchLocal = { x: -W / 2 + t + 0.6, z: -D / 2 + 1.4 };

    // The door: corrugated, rolling up into a drum under the header.
    const img = doorImage(P.door);
    const tex = canvasTexture(img, { repeat: true });
    this.textures.push(tex);
    this.doorTex = tex;
    this.ribs = Math.max(2, Math.round(doorH / 0.45));
    if (this.kind === 'bunker') {
      // Two blast-door leaves that slide apart.
      this.leaves = [];
      const lg = this.geo(new THREE.BoxGeometry(doorW / 2 + 0.2, doorH, 0.4));
      const lmat = this.mat(new THREE.MeshStandardMaterial({ map: tex, color: 0xffffff, roughness: 0.75, metalness: 0.35 }));
      tex.repeat.set(1, this.ribs / 2);
      for (const sd of [-1, 1]) {
        const m = new THREE.Mesh(lg, lmat);
        m.castShadow = true;
        m.name = 'secret-door';
        m.userData.side = sd;
        m.position.set((sd * (doorW / 2 + 0.2)) / 2, doorH / 2, -D / 2 - 0.25);
        this.group.add(m);
        this.leaves.push(m);
      }
      // The track the leaves run on, out past both posts.
      const tr = new Batch();
      tr.box(doorW * 2 + 1.6, 0.25, 0.3, 0, doorH + 0.15, -D / 2 - 0.5, 0x4f565e);
      const trm = tr.mesh(this.mat(vcMaterial({ roughness: 0.5, metalness: 0.4 })), { name: 'secret-track' });
      this.geo(trm.geometry);
      this.group.add(trm);
    } else {
      const dg = this.geo(new THREE.BoxGeometry(doorW, doorH, 0.12));
      dg.translate(0, -doorH / 2, 0);
      this.doorMat = this.mat(new THREE.MeshStandardMaterial({ map: tex, color: 0xffffff, roughness: 0.7, metalness: 0.35 }));
      const door = new THREE.Mesh(dg, this.doorMat);
      door.position.set(0, doorH, -D / 2 + t * 0.5);
      door.castShadow = true;
      door.name = 'secret-door';
      this.group.add(door);
      this.door = door;
      const drum = new Batch();
      drum.cyl(0.38, 0.38, doorW, 0, 0, 0, 0x5d646b, 12, { matrix: trs(0, doorH + 0.4, -D / 2 + t + 0.3, 0).multiply(new THREE.Matrix4().makeRotationZ(Math.PI / 2)) });
      const dm = drum.mesh(this.mat(vcMaterial({ roughness: 0.5, metalness: 0.4 })), { cast: false, name: 'secret-drum' });
      this.geo(dm.geometry);
      this.group.add(dm);
    }

    // Solid. World boxes, axis-aligned (the building is).
    const yb = this.site.floorY;
    const what = this.kind === 'hatch' ? 'You hit the deck hatch' : 'You flew into a building';
    const wall = (lx0, lx1, lz0, lz1, y0, y1) => {
      const a = this.toWorld(lx0, lz0);
      const b = this.toWorld(lx1, lz1);
      const o = { x0: Math.min(a.x, b.x), x1: Math.max(a.x, b.x), z0: Math.min(a.z, b.z), z1: Math.max(a.z, b.z), y0: yb + y0, y1: yb + y1, what };
      this.obstacles.push(o);
      return o;
    };
    wall(-W / 2, -W / 2 + t, -D / 2, D / 2, -1, H);
    wall(W / 2 - t, W / 2, -D / 2, D / 2, -1, H);
    wall(-W / 2, W / 2, D / 2 - t, D / 2, -1, H);
    wall(-W / 2, -W / 2 + post, -D / 2, -D / 2 + t, -1, doorH);
    wall(W / 2 - post, W / 2, -D / 2, -D / 2 + t, -1, doorH);
    wall(-W / 2, W / 2, -D / 2, D / 2, H, this.roofTop + 0.3);
    wall(-W / 2, W / 2, -D / 2, -D / 2 + t, doorH, H);
    // The door itself: its bottom rises as it opens.
    this.doorBox = wall(-doorW / 2, doorW / 2, -D / 2 - (this.kind === 'bunker' ? 0.45 : 0.05), -D / 2 + t + 0.1, 0, doorH);
    this.interiorLocal = { x0: -W / 2 + t, x1: W / 2 - t, z0: -D / 2 + t, z1: D / 2 - t };
  }

  /** Earth banked up both sides and the back, grass over the top: a bunker you might walk past. */
  dressBunker(b, P, W, D, H) {
    const earth = 0x6b6a4a;
    const grass = 0x5f7a43;
    for (const sd of [-1, 1]) {
      // A wedge: a box sheared by putting it on its edge at 40 degrees.
      const g = new THREE.BoxGeometry(H * 1.25, H * 1.25, D - 1.2);
      const m = new THREE.Matrix4().compose(
        new THREE.Vector3(sd * (W / 2 + H * 0.25), H * 0.18, 0.6),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, sd * 0.78)),
        new THREE.Vector3(1, 1, 1)
      );
      b.add(g, m, earth);
      g.dispose();
    }
    const g = new THREE.BoxGeometry(W + 1.5, H * 1.25, H * 1.25);
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(0, H * 0.18, D / 2 + H * 0.25),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0.78, 0, 0)),
      new THREE.Vector3(1, 1, 1)
    );
    b.add(g, m, earth);
    g.dispose();
    b.box(W + 1.2, 0.6, D + 0.6, 0, H + 0.6, 0.3, grass);
    // A low concrete apron lip in front, and the stencilled number over the door.
    b.box(W + 1, 0.15, 1.2, 0, 0.06, -D / 2 - 0.7, 0x8f8d86);
  }

  /** Rock round the portal and over the roof: a door in the hillside, not a box against it. */
  dressCave(b, P, W, D, H) {
    let seed = 0;
    for (const ch of this.spot.id) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    const rock = [0x6f6a62, 0x7a756c, 0x625e57, 0x857f75];
    const boulder = (x, y, z, r) => {
      const g = new THREE.DodecahedronGeometry(r, 0);
      const m = new THREE.Matrix4().compose(
        new THREE.Vector3(x, y, z),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(rnd() * 3, rnd() * 3, rnd() * 3)),
        new THREE.Vector3(1 + rnd() * 0.4, 0.7 + rnd() * 0.4, 1 + rnd() * 0.4)
      );
      b.add(g, m, rock[Math.floor(rnd() * rock.length)]);
      g.dispose();
    };
    // The portal: a heavy concrete frame proud of the face.
    b.box(W + 1.4, 1.4, 1.2, 0, H - 0.2, -D / 2 - 0.3, 0x9a968e);
    b.box(1.2, H, 1.2, -W / 2 - 0.1, H / 2, -D / 2 - 0.3, 0x9a968e);
    b.box(1.2, H, 1.2, W / 2 + 0.1, H / 2, -D / 2 - 0.3, 0x9a968e);
    // Boulders along the top and down both sides, larger towards the back.
    for (let i = 0; i < 14; i++) {
      const f = i / 13;
      boulder(-W / 2 + f * W, H + 0.8 + rnd() * 1.2, -D / 2 + 1.2 + rnd() * 3, 1.6 + rnd() * 1.2);
    }
    for (let i = 0; i < 18; i++) {
      boulder(-W / 2 + rnd() * W, H + 1 + rnd() * 1.5, -D / 2 + 4 + rnd() * (D - 2), 2.2 + rnd() * 1.6);
    }
    for (const sd of [-1, 1]) {
      for (let i = 0; i < 8; i++) {
        boulder(sd * (W / 2 + 1 + rnd() * 1.5), 0.6 + rnd() * (H - 1), -D / 2 + 0.6 + rnd() * D, 1.4 + rnd() * 1.3);
      }
    }
  }

  /* ---------------------------------------------------------- hatch -- */

  buildHatch(P) {
    const s = this.site;
    const W = s.w;
    const D = s.d;
    this.doorW = W;
    this.doorH = 0;
    const deck = new Batch();
    // The yellow hazard border and the pit under the doors.
    deck.box(W + 1.2, 0.08, 0.6, 0, 0.04, -D / 2 - 0.3, P.trim);
    deck.box(W + 1.2, 0.08, 0.6, 0, 0.04, D / 2 + 0.3, P.trim);
    deck.box(0.6, 0.08, D, -W / 2 - 0.3, 0.04, 0, P.trim);
    deck.box(0.6, 0.08, D, W / 2 + 0.3, 0.04, 0, P.trim);
    // The control post on the port side, where you stand to work it.
    deck.box(0.6, 1.2, 0.5, -W / 2 - 2, 0.6, -D / 2 + 3, 0x5d646b);
    deck.box(0.5, 0.3, 0.06, -W / 2 - 2, 1.05, -D / 2 + 2.73, 0xe8c547);
    const dm = deck.mesh(this.mat(vcMaterial({ roughness: 0.7, metalness: 0.2 })), { cast: false, name: 'secret-hatch-rim' });
    this.geo(dm.geometry);
    this.group.add(dm);
    this.switchLocal = { x: -W / 2 - 2.6, z: -D / 2 + 3 };
    // The pit: dark, seen only once the doors are apart.
    const pit = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(W, D)), this.mat(layer(new THREE.MeshStandardMaterial({ color: 0x15181c, roughness: 1 }), 'pavement')));
    pit.rotation.x = -Math.PI / 2;
    pit.position.y = 0.035;
    pit.name = 'secret-pit';
    this.group.add(pit);
    this.pit = pit;
    // Two doors, sliding apart across the deck.
    const img = doorImage(P.door);
    const tex = canvasTexture(img, { repeat: true });
    tex.repeat.set(1, 6);
    this.textures.push(tex);
    const lg = this.geo(new THREE.BoxGeometry(W / 2, 0.14, D));
    const lmat = this.mat(new THREE.MeshStandardMaterial({ map: tex, color: 0xffffff, roughness: 0.8, metalness: 0.3 }));
    this.leaves = [];
    for (const sd of [-1, 1]) {
      const m = new THREE.Mesh(lg, lmat);
      m.name = 'secret-door';
      m.userData.side = sd;
      m.position.set((sd * W) / 4, 0.09, 0);
      this.group.add(m);
      this.leaves.push(m);
    }
    // The lift the plane stands on, under the deck until the doors part.
    const lift = new THREE.Mesh(this.geo(new THREE.BoxGeometry(W - 0.6, 0.3, D - 0.6)), this.mat(new THREE.MeshStandardMaterial({ color: 0x4a5058, roughness: 0.8, metalness: 0.3 })));
    lift.name = 'secret-lift';
    lift.position.y = -8;
    this.group.add(lift);
    this.liftMesh = lift;
    // Lamps round the pit's edge, under the deck lip.
    const lamps = new Batch();
    for (let i = 0; i < 6; i++) {
      const f = (i + 0.5) / 6 - 0.5;
      lamps.box(1.2, 0.06, 0.2, f * W, 0.07, -D / 2 + 0.15, 0xffffff);
      lamps.box(1.2, 0.06, 0.2, f * W, 0.07, D / 2 - 0.15, 0xffffff);
    }
    this.lampMat = this.mat(new THREE.MeshStandardMaterial({ color: 0x3a3a36, emissive: 0xfff1d0, emissiveIntensity: 0, roughness: 0.5 }));
    const lmp = lamps.mesh(this.lampMat, { cast: false, name: 'secret-lamps' });
    this.geo(lmp.geometry);
    this.group.add(lmp);
    this.liningMat = null;
    this.interiorLocal = { x0: -W / 2, x1: W / 2, z0: -D / 2, z1: D / 2 };
    this.roofTop = 0;
  }

  /* ---------------------------------------------------------- plane -- */

  buildPlane(makeModel) {
    if (!makeModel || !this.type) return;
    let model = null;
    try {
      model = makeModel(this.type);
    } catch (e) {
      console.warn(`[secrets] could not build the ${this.type.id} for ${this.spot.id}`, e);
      return;
    }
    if (!model) return;
    try {
      if (model.userData && typeof model.userData.update === 'function') {
        model.userData.update(0.016, {
          controls: { pitch: 0, roll: 0, yaw: 0, throttle: 0, brakes: 1 }, rpm: 0, flaps: 0, gearPos: 1, gearDown: true,
          onGround: true, groundSpeed: 0, agl: 0, engineOn: false,
        }, { isNight: false, cond: { cloud: 0 } });
      }
    } catch (e) {
      /* a model that will not pose parked is still fine to look at */
    }
    const bake = bakeModel(model);
    this.bake = bake;
    const g = new THREE.Group();
    g.name = `secret-plane:${this.type.id}`;
    for (const p of bake.parts) {
      const m = new THREE.Mesh(p.geometry, p.material);
      m.castShadow = true;
      m.receiveShadow = true;
      g.add(m);
    }
    // Wheels on the floor, the middle of the aeroplane in the middle of the floor, nose to the door.
    const box = bake.box;
    const mid = (box.min.z + box.max.z) / 2;
    this.planeLocal = { x: 0, z: -mid + 0.4, y: -box.min.y };
    g.position.set(0, this.planeLocal.y, this.planeLocal.z);
    this.planeSpan = box.max.x - box.min.x;
    this.planeLength = box.max.z - box.min.z;
    this.group.add(g);
    this.plane = g;
  }

  /** Where the aeroplane's centre is in the world, and which way it points (out of the door). */
  planeWorld() {
    if (!this.planeLocal) return null;
    const p = this.toWorld(this.planeLocal.x, this.planeLocal.z);
    return { x: p.x, z: p.z, headingDeg: this.h, y: this.site.floorY + (this.kind === 'hatch' ? this.lift : 0) };
  }

  /** Where a flight in it starts: in front of the door, on the ground outside (the deck, for the hatch). */
  spawnWorld() {
    if (this.kind === 'hatch') {
      // On the deck beside the lift, pointing the way the ship does.
      const p = this.toWorld(0, 0);
      return { x: p.x, z: p.z, headingDeg: (this.h + 90) % 360 };
    }
    const len = this.planeLength || 10;
    const out = this.site.d / 2 + len / 2 + 4;
    const p = this.toWorld(0, -out);
    return { x: p.x, z: p.z, headingDeg: this.h };
  }

  /* ---------------------------------------------------------- clues -- */

  buildClue(clue, P, opts) {
    const s = this.site;
    if (clue === 'light') {
      // A thin line of warm light under the door, and a dim lamp over it. Steady.
      const b = new Batch();
      if (this.kind === 'hatch') {
        b.box(this.site.w * 0.6, 0.04, 0.12, 0, 0.1, 0, 0xffffff);
      } else {
        b.box(this.doorW * 0.92, 0.07, 0.05, 0, 0.05, -s.d / 2 - 0.03, 0xffffff);
        b.box(0.5, 0.2, 0.25, 0, this.doorH + 0.7, -s.d / 2 - 0.15, 0xffffff);
      }
      this.clueMat = this.mat(new THREE.MeshStandardMaterial({ color: 0x3a3226, emissive: 0xffc46b, emissiveIntensity: 0.8, roughness: 0.6 }));
      const m = b.mesh(this.clueMat, { cast: false, name: 'secret-clue-light' });
      this.geo(m.geometry);
      this.group.add(m);
    } else if (clue === 'tracks' && this.kind !== 'hatch') {
      // Two wheel ruts from the door out across the grass, lying on the ground as drawn.
      const pos = [];
      const uv = [];
      const idx = [];
      const run = 34;
      const steps = 17;
      const half = 0.32;
      for (const lat of [-1.7, 1.7]) {
        const base = pos.length / 3;
        for (let i = 0; i <= steps; i++) {
          const lz = -s.d / 2 - 0.5 - (run * i) / steps;
          for (const e of [-half, half]) {
            const w = this.toWorld(lat + e + Math.sin(i * 0.7) * 0.15, lz);
            pos.push(w.x, this.ground(w.x, w.z) + 0.06, w.z);
            uv.push(e < 0 ? 0 : 1, (i * run) / steps / 2);
          }
          if (i < steps) {
            const a = base + i * 2;
            idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
          }
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      g.computeVertexNormals();
      g.computeBoundingSphere();
      const mat = this.mat(layer(new THREE.MeshStandardMaterial({ map: trackTexture(), transparent: true, opacity: 0.55, depthWrite: false, roughness: 1, color: 0xffffff }), 'decal'));
      const m = new THREE.Mesh(this.geo(g), mat);
      m.name = 'secret-clue-tracks';
      m.receiveShadow = true;
      this.world.add(m);
    } else if (clue === 'windsock') {
      // A windsock on a pole beside it, where there is no airfield to need one.
      const w = this.kind === 'hatch' ? this.toWorld(-s.w / 2 - 4, -s.d / 2 + 6) : this.toWorld(s.w / 2 + 3.5, -s.d / 2 - 2);
      const gy = this.kind === 'hatch' ? s.floorY : this.ground(w.x, w.z);
      const b = new Batch();
      b.cyl(0.09, 0.12, 6.5, 0, 0, 0, 0xdedede, 8);
      const pole = b.mesh(this.mat(vcMaterial({ roughness: 0.6 })), { name: 'secret-windsock-pole' });
      this.geo(pole.geometry);
      pole.position.set(w.x, gy, w.z);
      this.world.add(pole);
      const sock = new THREE.Group();
      sock.position.set(w.x, gy + 6.3, w.z);
      const cg = this.geo(new THREE.CylinderGeometry(0.45, 0.2, 2.6, 10, 1, true));
      cg.rotateX(Math.PI / 2);
      cg.translate(0, 0, 1.3);
      const sm = new THREE.Mesh(cg, this.mat(new THREE.MeshStandardMaterial({ color: 0xff7a1a, roughness: 0.8, side: THREE.DoubleSide })));
      sm.name = 'secret-windsock';
      sock.add(sm);
      this.world.add(sock);
      this.sock = sock;
    }
  }

  /* ---------------------------------------------------------- moving -- */

  setOpen(v, force = false) {
    const o = Math.max(0, Math.min(1, v));
    if (!force && Math.abs(o - this.open) < 1e-4) return;
    this.open = o;
    if (this.door) {
      this.door.scale.y = Math.max(0.03, 1 - o);
      if (this.doorTex) this.doorTex.repeat.set(1, Math.max(0.2, this.ribs * (1 - o)));
    }
    if (this.leaves) {
      for (const l of this.leaves) {
        const sd = l.userData.side;
        if (this.kind === 'hatch') l.position.x = (sd * this.site.w) / 4 + sd * (this.site.w / 2 + 0.4) * o;
        else l.position.x = (sd * (this.doorW / 2 + 0.2)) / 2 + sd * (this.doorW / 2 + 0.3) * o;
      }
    }
    if (this.doorBox) this.doorBox.y0 = this.site.floorY + (this.kind === 'bunker' ? (o > 0.92 ? this.doorH : 0) : this.doorH * o);
    if (this.kind === 'hatch' && this.pit) this.pit.visible = o > 0.01;
    // The aeroplane is only drawn when there is a door open to see it through.
    if (o > 0.01 && !this.plane && this.makeModel) {
      this.buildPlane(this.makeModel);
      this.makeModel = null;
    }
    if (this.plane) this.plane.visible = o > 0.01 || !!this.forceShow;
  }

  setLight(v, force = false) {
    const l = Math.max(0, Math.min(1, v));
    if (!force && Math.abs(l - this.light) < 1e-4) return;
    this.light = l;
    if (this.lampMat) this.lampMat.emissiveIntensity = 1.6 * l;
    if (this.liningMat) {
      // From a dim grey-brown to a warm light grey: what the lamps fall on.
      const a = 0.16 + 0.62 * l;
      this.liningMat.color.setRGB(a * 1.02, a, a * 0.94);
    }
    if (this.paintMat) {
      const a = 0.25 + 0.75 * l;
      this.paintMat.color.setRGB(a, a, a);
    }
  }

  /** Each frame: the door eases to where it is wanted, the lights to on or off. */
  update(dt, windDeg = null) {
    if (this.open !== this.target) {
      // A quarter of the opening in a little under a second for a shed, slower for the big ones.
      const rate = (this.kind === 'far' ? 0.16 : this.kind === 'hatch' ? 0.22 : 0.3) * dt;
      const o = this.open < this.target ? Math.min(this.target, this.open + rate) : Math.max(this.target, this.open - rate);
      this.setOpen(o);
    }
    const want = this.lightsOn ? 1 : 0;
    if (this.light !== want) {
      // Up in about a second, steadily: no flicker, no blink.
      const k = dt * 1.2;
      this.setLight(this.light < want ? Math.min(want, this.light + k) : Math.max(want, this.light - k));
    }
    if (this.kind === 'hatch' && this.plane && this.liftMesh) {
      // The lift brings the aeroplane up once the doors are apart, and takes it down before they close.
      const up = this.target > 0.5 && this.open > 0.85 ? 1 : 0;
      const cur = this.liftT || 0;
      const nt = up ? Math.min(1, cur + dt * 0.25) : Math.max(0, cur - dt * 0.35);
      this.liftT = nt;
      const y = -9 * (1 - nt);
      this.lift = y;
      this.liftMesh.position.y = y - 0.15;
      this.plane.position.y = this.planeLocal.y + y;
      this.liftMesh.visible = this.open > 0.01;
      // The doors may not shut on it.
      if (this.target < 0.5 && nt > 0.02) this.setOpen(Math.max(this.open, 0.9));
    }
    if (this.sock && Number.isFinite(windDeg)) {
      // The sock streams downwind: the wind comes FROM windDeg.
      this.sock.rotation.y = -windDeg * D2R;
    }
  }

  /** Is (x, z) inside the building (or on the lift)? */
  inside(x, z, pad = 0) {
    const dx = x - this.site.x;
    const dz = z - this.site.z;
    const lx = dx * this.cos + dz * this.sin;
    const lz = -dx * this.sin + dz * this.cos;
    const r = this.interiorLocal;
    return lx > r.x0 - pad && lx < r.x1 + pad && lz > r.z0 - pad && lz < r.z1 + pad;
  }

  /** Local coordinates of a world point. */
  toLocal(x, z) {
    const dx = x - this.site.x;
    const dz = z - this.site.z;
    return { x: dx * this.cos + dz * this.sin, z: -dx * this.sin + dz * this.cos };
  }

  dispose() {
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    for (const t of this.textures) t.dispose();
    if (this.bake) disposeBake(this.bake);
    if (this.group.parent) this.group.parent.remove(this.group);
    if (this.world.parent) this.world.parent.remove(this.world);
  }
}
