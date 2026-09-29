/**
 * The silly things in the goofy missions, drawn from primitives and a few
 * small canvases.
 *
 * Deliberately cartoonish and deliberately BIG — a rubber duck the size of a
 * shed, a seagull with a seven-metre span — because the missions are about
 * finding them from an aeroplane, and a life-size duck is invisible from 500
 * feet. Polygon counts are kept low (spheres at 16 x 12) and repeated things
 * are instanced (the gull flock is one draw call, the smoke trail is one
 * draw call), because the class flies this on 2019 Chromebooks.
 *
 * Every builder makes its own geometry and materials, so the mission that
 * owns it can dispose all of it when it is over (see props.js). Nothing here
 * is a collider: flying into a giant bee is a way to follow it, not a crash.
 */

import * as THREE from '../../vendor/three.module.js';

const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.05, ...extra });

function tex(w, h, paint) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  paint(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function mesh(geo, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

function glowSprite(color, size, opacity = 0.9) {
  const t = tex(64, 64, (g) => {
    const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    r.addColorStop(0, 'rgba(255,255,255,1)');
    r.addColorStop(0.3, 'rgba(255,255,255,0.5)');
    r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r;
    g.fillRect(0, 0, 64, 64);
  });
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false }));
  s.scale.setScalar(size);
  return s;
}

/** A sign that always faces you: white card, bold words. */
export function makeSign(lines, { width = 40, bg = '#ffffff', fg = '#1b2433', border = '#ffd23f' } = {}) {
  const rows = Array.isArray(lines) ? lines : [lines];
  const W = 512;
  const H = 96 + rows.length * 84;
  const t = tex(W, H, (g) => {
    g.fillStyle = border;
    g.fillRect(0, 0, W, H);
    g.fillStyle = bg;
    g.fillRect(12, 12, W - 24, H - 24);
    g.fillStyle = fg;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    // Shrink the type until the longest line fits: "GRANDMA ROSA!" at 64 px
    // ran off the edge of the card.
    let size = 64;
    for (; size > 28; size -= 4) {
      g.font = `bold ${size}px sans-serif`;
      const widest = Math.max(...rows.map((r) => {
        const m = g.measureText(r);
        return m && Number.isFinite(m.width) ? m.width : 0;
      }));
      if (widest <= W - 48) break;
    }
    rows.forEach((r, i) => g.fillText(r, W / 2, 48 + 42 + i * 84));
  });
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: true }));
  s.scale.set(width, (width * H) / W, 1);
  return s;
}

/* ------------------------------------------------------------ duck -- */

/** A rubber duck, head towards -Z. `size` is roughly its length in metres. */
export function makeDuck(size = 4) {
  const g = new THREE.Group();
  g.name = 'rubber-duck';
  const yellow = std(0xffd21f, { roughness: 0.35 });
  const orange = std(0xff8a1f, { roughness: 0.4 });
  const black = std(0x111111, { roughness: 0.3 });
  const s = size / 4;
  const body = mesh(new THREE.SphereGeometry(1.3 * s, 16, 12), yellow, 0, 1.1 * s, 0.2 * s);
  body.scale.set(1, 0.72, 1.3);
  g.add(body);
  const head = mesh(new THREE.SphereGeometry(0.78 * s, 16, 12), yellow, 0, 2.15 * s, -0.85 * s);
  g.add(head);
  const beak = mesh(new THREE.SphereGeometry(0.42 * s, 12, 8), orange, 0, 2.0 * s, -1.6 * s);
  beak.scale.set(1.1, 0.42, 1.2);
  g.add(beak);
  for (const x of [-0.36, 0.36]) g.add(mesh(new THREE.SphereGeometry(0.13 * s, 8, 6), black, x * s, 2.42 * s, -1.45 * s));
  const tail = mesh(new THREE.ConeGeometry(0.45 * s, 0.9 * s, 10), yellow, 0, 1.55 * s, 1.75 * s);
  tail.rotation.x = -0.9;
  g.add(tail);
  return g;
}

/* ------------------------------------------------- balloon and party -- */

/** A giant birthday balloon with "100" on it and a long ribbon. Origin at the balloon's middle. */
export function makeBalloon() {
  const g = new THREE.Group();
  g.name = 'birthday-balloon';
  const t = tex(512, 256, (c, w, h) => {
    c.fillStyle = '#e6283c';
    c.fillRect(0, 0, w, h);
    c.fillStyle = '#ffffff';
    c.font = 'bold 110px sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('100', w * 0.25, h * 0.5);
    c.fillText('100', w * 0.75, h * 0.5);
    c.fillStyle = 'rgba(255,255,255,0.35)';
    c.beginPath(); c.arc(w * 0.12, h * 0.3, 14, 0, Math.PI * 2); c.fill();
  });
  const skin = new THREE.MeshStandardMaterial({ map: t, roughness: 0.25, metalness: 0.1 });
  const ball = mesh(new THREE.SphereGeometry(6, 20, 14), skin);
  ball.scale.set(1, 1.18, 1);
  g.add(ball);
  const knot = mesh(new THREE.ConeGeometry(0.9, 1.4, 10), std(0xb81d2d), 0, -7.5, 0);
  g.add(knot);
  const ribbon = mesh(new THREE.CylinderGeometry(0.12, 0.12, 22, 5), std(0xffd23f), 0, -19, 0);
  g.add(ribbon);
  g.add(glowSprite(0xff5a6a, 30, 0.35));
  return g;
}

/** The party: a cake taller than a bus, with one enormous candle and hats round it. */
export function makeParty() {
  const g = new THREE.Group();
  g.name = 'party';
  const pink = std(0xff8fc6);
  const cream = std(0xfff3e0);
  const tiers = [[9, 3.6, pink], [7, 3.2, cream], [5, 3, pink]];
  let y = 0;
  for (const [r, h, m] of tiers) {
    g.add(mesh(new THREE.CylinderGeometry(r, r, h, 24), m, 0, y + h / 2, 0));
    y += h;
  }
  const candle = mesh(new THREE.CylinderGeometry(0.7, 0.7, 5, 10), std(0x58c6ff), 0, y + 2.5, 0);
  g.add(candle);
  const flame = glowSprite(0xffb347, 7, 1);
  flame.position.set(0, y + 5.8, 0);
  g.add(flame);
  g.userData.flame = flame;
  const hatMats = [std(0xffd23f), std(0x7ee8b2), std(0x58c6ff), std(0xff6a5a), std(0xc38cff)];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const hat = mesh(new THREE.ConeGeometry(1.1, 3, 10), hatMats[i % hatMats.length], Math.cos(a) * 15, 1.5, Math.sin(a) * 15);
    g.add(hat);
  }
  return g;
}

/* -------------------------------------------------------------- gulls -- */

/** One gull as a flat "M": body along Z, two wings. Flapping is done by scaling Y. */
function gullGeometry() {
  const v = new Float32Array([
    // left wing
    0, 0, -0.5, 0, 0, 0.6, -1.9, 0.35, 0.15,
    // left tip
    -1.9, 0.35, 0.15, -3.2, -0.2, 0.5, -1.6, 0.2, 0.55,
    // right wing
    0, 0, -0.5, 1.9, 0.35, 0.15, 0, 0, 0.6,
    // right tip
    1.9, 0.35, 0.15, 1.6, 0.2, 0.55, 3.2, -0.2, 0.5,
    // body
    0, 0.12, -1.2, -0.25, 0, 0.9, 0.25, 0, 0.9,
  ]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(v, 3));
  geo.computeVertexNormals();
  return geo;
}

/**
 * A flock as one instanced mesh.
 * @returns {{ mesh: THREE.InstancedMesh, set(i, pos, headingDeg, flap): void, commit(): void }}
 */
export function makeFlock(n, scale = 2.2) {
  // A little emissive, because seen from underneath — which is how you see
  // a gull you are overtaking — a double-sided wing is lit from the wrong
  // side and came out nearly black. Real gulls are white underneath.
  const m = new THREE.InstancedMesh(
    gullGeometry(),
    new THREE.MeshLambertMaterial({ color: 0xf6f7f9, emissive: 0x70767e, side: THREE.DoubleSide }),
    n
  );
  m.name = 'seagulls';
  m.frustumCulled = false;
  const d = new THREE.Object3D();
  return {
    mesh: m,
    set(i, pos, headingDeg, flap) {
      d.position.copy(pos);
      d.rotation.set(0, -(headingDeg * Math.PI) / 180, 0);
      d.scale.set(scale, scale * flap, scale);
      d.updateMatrix();
      m.setMatrixAt(i, d.matrix);
    },
    commit() {
      m.instanceMatrix.needsUpdate = true;
    },
  };
}

/** The finish line: two poles and a chequered banner. */
export function makeFinish(width = 60) {
  const g = new THREE.Group();
  g.name = 'finish';
  const pole = std(0xe8ecef);
  for (const x of [-width / 2, width / 2]) g.add(mesh(new THREE.CylinderGeometry(0.8, 0.8, 40, 8), pole, x, 20, 0));
  const t = tex(256, 64, (c, w, h) => {
    const s = 16;
    for (let y = 0; y < h; y += s) {
      for (let x = 0; x < w; x += s) {
        c.fillStyle = ((x + y) / s) % 2 ? '#111' : '#fff';
        c.fillRect(x, y, s, s);
      }
    }
  });
  const banner = new THREE.Mesh(new THREE.PlaneGeometry(width, 10), new THREE.MeshBasicMaterial({ map: t, side: THREE.DoubleSide }));
  banner.position.set(0, 35, 0);
  g.add(banner);
  return g;
}

/* ---------------------------------------------------------------- cow -- */

/** Daisy. Life size, black and white, nose towards -Z. */
export function makeCow() {
  const g = new THREE.Group();
  g.name = 'daisy-the-cow';
  const hide = tex(128, 64, (c, w, h) => {
    c.fillStyle = '#f7f7f2';
    c.fillRect(0, 0, w, h);
    c.fillStyle = '#1a1a1a';
    for (const [x, y, r] of [[20, 20, 12], [60, 40, 16], [96, 16, 10], [110, 48, 9], [40, 54, 7]]) {
      c.beginPath(); c.ellipse(x, y, r * 1.4, r, 0.4, 0, Math.PI * 2); c.fill();
    }
  });
  const body = new THREE.MeshStandardMaterial({ map: hide, roughness: 0.8 });
  const dark = std(0x1a1a1a);
  const pink = std(0xf2a7b6);
  g.add(mesh(new THREE.BoxGeometry(1.2, 1.1, 2.3), body, 0, 1.35, 0));
  g.add(mesh(new THREE.BoxGeometry(0.7, 0.7, 0.8), body, 0, 1.75, -1.45));
  g.add(mesh(new THREE.BoxGeometry(0.72, 0.36, 0.3), pink, 0, 1.52, -1.92));
  for (const x of [-0.3, 0.3]) {
    const horn = mesh(new THREE.ConeGeometry(0.08, 0.35, 6), std(0xefe6cf), x, 2.2, -1.4);
    horn.rotation.z = -x * 1.5;
    g.add(horn);
  }
  for (const [x, z] of [[-0.42, -0.85], [0.42, -0.85], [-0.42, 0.85], [0.42, 0.85]]) {
    g.add(mesh(new THREE.BoxGeometry(0.24, 0.9, 0.24), body, x, 0.45, z));
    g.add(mesh(new THREE.BoxGeometry(0.26, 0.12, 0.26), dark, x, 0.06, z));
  }
  g.add(mesh(new THREE.SphereGeometry(0.28, 10, 8), pink, 0, 0.72, 0.5));
  const tail = mesh(new THREE.CylinderGeometry(0.04, 0.04, 1, 5), dark, 0, 1.3, 1.25);
  tail.rotation.x = 0.35;
  g.add(tail);
  return g;
}

/* ---------------------------------------------------------------- UFO -- */

/**
 * A flying saucer with a little green passenger, a ring of lights that goes
 * round, and two things hidden until the story needs them: a sign asking the
 * way to the beach, and a pair of sunglasses.
 */
export function makeUfo() {
  const g = new THREE.Group();
  g.name = 'ufo';
  const hull = std(0xc7ced8, { metalness: 0.75, roughness: 0.25 });
  const saucer = mesh(new THREE.SphereGeometry(10, 24, 12), hull);
  saucer.scale.set(1, 0.26, 1);
  g.add(saucer);
  const rim = mesh(new THREE.TorusGeometry(10, 0.7, 8, 32), std(0x8d96a3, { metalness: 0.8, roughness: 0.3 }));
  rim.rotation.x = Math.PI / 2;
  g.add(rim);
  const dome = mesh(
    new THREE.SphereGeometry(4.2, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x9dffd0, transparent: true, opacity: 0.45, roughness: 0.05, emissive: 0x2a8a60, emissiveIntensity: 0.6 })
  );
  dome.position.y = 2;
  g.add(dome);
  // The alien: a green head with big eyes and two antennae.
  const green = std(0x6be36b, { emissive: 0x1d5e1d, emissiveIntensity: 0.4 });
  const alien = new THREE.Group();
  alien.add(mesh(new THREE.SphereGeometry(1.3, 14, 10), green, 0, 3.4, 0));
  for (const x of [-0.5, 0.5]) {
    alien.add(mesh(new THREE.SphereGeometry(0.42, 10, 8), std(0x0b0b0b, { roughness: 0.15 }), x, 3.6, -1.05));
    const ant = mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.3, 5), green, x * 0.8, 4.9, 0);
    ant.rotation.z = -x * 0.6;
    alien.add(ant);
    alien.add(mesh(new THREE.SphereGeometry(0.2, 8, 6), std(0xffe45c, { emissive: 0xffc400, emissiveIntensity: 1 }), x * 1.2, 5.55, 0));
  }
  const shades = new THREE.Group();
  const lens = std(0x050505, { roughness: 0.1, metalness: 0.6 });
  for (const x of [-0.5, 0.5]) {
    const l = mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.1, 12), lens, x, 3.6, -1.25);
    l.rotation.x = Math.PI / 2;
    shades.add(l);
  }
  shades.visible = false;
  alien.add(shades);
  g.add(alien);
  // The lights round the rim, as one group so they can spin.
  const ring = new THREE.Group();
  const bulbs = [std(0xff5c5c, { emissive: 0xff3030, emissiveIntensity: 1.6 }), std(0x5cf0ff, { emissive: 0x30d0ff, emissiveIntensity: 1.6 }), std(0xfff05c, { emissive: 0xffd030, emissiveIntensity: 1.6 })];
  const bulbGeo = new THREE.SphereGeometry(0.55, 8, 6);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    ring.add(mesh(bulbGeo, bulbs[i % 3], Math.cos(a) * 9.6, -0.3, Math.sin(a) * 9.6));
  }
  g.add(ring);
  const glow = glowSprite(0x9dffd0, 60, 0.4);
  glow.position.y = -2;
  g.add(glow);
  // The beam: a soft cone underneath, on when it is hovering.
  const beam = new THREE.Mesh(
    new THREE.ConeGeometry(9, 40, 20, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xb6ffdc, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
  );
  beam.position.y = -21;
  g.add(beam);
  const sign = makeSign(['WHERE IS', 'THE BEACH?'], { width: 30 });
  sign.position.set(0, 24, 0);
  sign.visible = false;
  g.add(sign);
  g.userData = { ring, beam, sign, shades, alien, glow };
  return g;
}

/* --------------------------------------------------------- marshmallow -- */

/**
 * A marshmallow on a stick, to hang under the aeroplane. Toast goes 0..1 on
 * two sides; burning puts a flame on it.
 */
export function makeMarshmallow() {
  const g = new THREE.Group();
  g.name = 'marshmallow';
  const stick = mesh(new THREE.CylinderGeometry(0.07, 0.07, 3.4, 6), std(0x8b5a2b), 0, 1.7, 0);
  g.add(stick);
  // Two halves, one per side, so each side can be toasted on its own —
  // which is the whole joke of the mission: you have to turn it over.
  const sideA = std(0xfbf8f0, { roughness: 0.9 });
  const sideB = std(0xfbf8f0, { roughness: 0.9 });
  const halfA = mesh(new THREE.CylinderGeometry(0.8, 0.8, 1.3, 12, 1, false, 0, Math.PI), sideA);
  const halfB = mesh(new THREE.CylinderGeometry(0.8, 0.8, 1.3, 12, 1, false, Math.PI, Math.PI), sideB);
  // Stand it on its side on the stick, halves facing left and right.
  halfA.rotation.x = halfB.rotation.x = Math.PI / 2;
  g.add(halfA, halfB);
  const flame = glowSprite(0xff7a1a, 4.5, 1);
  flame.position.y = 0.4;
  flame.visible = false;
  g.add(flame);
  const white = new THREE.Color(0xfbf8f0);
  const gold = new THREE.Color(0xd9953a);
  const burnt = new THREE.Color(0x2a1a10);
  const tone = (mat, t) => {
    if (t <= 1) mat.color.copy(white).lerp(gold, t);
    else mat.color.copy(gold).lerp(burnt, Math.min(1, t - 1));
  };
  g.userData = {
    setToast(a, b) {
      tone(sideA, a);
      tone(sideB, b);
    },
    setBurning(on) {
      flame.visible = on;
    },
    flame,
  };
  return g;
}

/* ------------------------------------------------------------ ice cream -- */

/** The world's biggest ice cream cone: a waffle cone and three scoops that shrink as they melt. */
export function makeIceCream() {
  const g = new THREE.Group();
  g.name = 'ice-cream';
  const waffle = tex(64, 64, (c) => {
    c.fillStyle = '#d99a4e';
    c.fillRect(0, 0, 64, 64);
    c.strokeStyle = '#a8692a';
    c.lineWidth = 3;
    for (let i = -64; i < 128; i += 12) {
      c.beginPath(); c.moveTo(i, 0); c.lineTo(i + 64, 64); c.stroke();
      c.beginPath(); c.moveTo(i + 64, 0); c.lineTo(i, 64); c.stroke();
    }
  });
  waffle.wrapS = waffle.wrapT = THREE.RepeatWrapping;
  waffle.repeat.set(3, 2);
  const cone = mesh(new THREE.ConeGeometry(1.0, 2.6, 16), new THREE.MeshStandardMaterial({ map: waffle, roughness: 0.9 }), 0, 1.6, 0);
  cone.rotation.x = Math.PI;
  g.add(cone);
  const scoops = [];
  const cols = [0xff9ec4, 0xfff4d6, 0x7b4a2a];
  for (let i = 0; i < 3; i++) {
    const s = mesh(new THREE.SphereGeometry(0.95, 16, 12), std(cols[i], { roughness: 0.7 }), 0, 3.1 + i * 1.25, 0);
    g.add(s);
    scoops.push(s);
  }
  const cherry = mesh(new THREE.SphereGeometry(0.32, 10, 8), std(0xd0142c, { roughness: 0.2 }), 0, 6.05, 0);
  g.add(cherry);
  g.userData = {
    setMelt(m) {
      const k = Math.max(0.25, 1 - m * 0.7);
      for (let i = 0; i < 3; i++) {
        scoops[i].scale.set(k * (1 + m * 0.25), k, k * (1 + m * 0.25));
        scoops[i].position.y = 3.1 + i * 1.25 * k;
      }
      cherry.position.y = 3.1 + 2 * 1.25 * k + 0.95 * k;
    },
  };
  return g;
}

/* ------------------------------------------------------------- bubbles -- */

/**
 * Bubbles as sprites: a bubble looks the same from every side, so a flat
 * picture that always faces you is exactly right and costs one quad. One
 * shared texture — a thin rainbow rim and a window-shaped highlight.
 */
export function makeBubbleMaterial() {
  const t = tex(128, 128, (c) => {
    const cx = 64;
    const r = c.createRadialGradient(cx, cx, 36, cx, cx, 62);
    r.addColorStop(0, 'rgba(255,255,255,0.02)');
    r.addColorStop(0.7, 'rgba(160,220,255,0.18)');
    r.addColorStop(0.86, 'rgba(255,170,230,0.55)');
    r.addColorStop(0.93, 'rgba(170,255,210,0.7)');
    r.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = r;
    c.fillRect(0, 0, 128, 128);
    c.strokeStyle = 'rgba(255,255,255,0.85)';
    c.lineWidth = 6;
    c.beginPath(); c.arc(cx, cx, 44, Math.PI * 1.1, Math.PI * 1.45); c.stroke();
    c.fillStyle = 'rgba(255,255,255,0.8)';
    c.beginPath(); c.arc(40, 38, 5, 0, Math.PI * 2); c.fill();
  });
  return new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false });
}

/* ----------------------------------------------------------------- bee -- */

/** The world's biggest bumblebee, about eight metres long, head towards -Z. */
export function makeBee() {
  const g = new THREE.Group();
  g.name = 'giant-bee';
  const stripes = tex(16, 128, (c, w, h) => {
    for (let i = 0; i < 8; i++) {
      c.fillStyle = i % 2 ? '#141414' : '#ffc61a';
      c.fillRect(0, (i * h) / 8, w, h / 8);
    }
  });
  const bodyGeo = new THREE.SphereGeometry(2.2, 18, 16);
  bodyGeo.rotateX(Math.PI / 2);
  const body = mesh(bodyGeo, new THREE.MeshStandardMaterial({ map: stripes, roughness: 0.75 }));
  body.scale.set(1, 0.9, 1.55);
  g.add(body);
  const black = std(0x151515, { roughness: 0.5 });
  g.add(mesh(new THREE.SphereGeometry(1.55, 14, 12), black, 0, 0.3, -3.6));
  for (const x of [-0.75, 0.75]) {
    g.add(mesh(new THREE.SphereGeometry(0.6, 12, 8), std(0xffffff, { roughness: 0.2 }), x, 0.75, -4.7));
    g.add(mesh(new THREE.SphereGeometry(0.3, 8, 6), black, x, 0.8, -5.2));
    const ant = mesh(new THREE.CylinderGeometry(0.07, 0.07, 1.8, 5), black, x * 0.9, 2.1, -4.3);
    ant.rotation.x = -0.5;
    ant.rotation.z = -x * 0.5;
    g.add(ant);
  }
  const sting = mesh(new THREE.ConeGeometry(0.35, 1.3, 8), black, 0, 0, 3.9);
  sting.rotation.x = Math.PI / 2;
  g.add(sting);
  const wingMat = new THREE.MeshStandardMaterial({ color: 0xe8f6ff, transparent: true, opacity: 0.55, side: THREE.DoubleSide, roughness: 0.1, depthWrite: false });
  const wingGeo = new THREE.CircleGeometry(2.6, 16);
  wingGeo.scale(1, 0.6, 1);
  wingGeo.rotateX(-Math.PI / 2);
  const wings = [];
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.9, 1.8, -0.6);
    const w = new THREE.Mesh(wingGeo, wingMat);
    w.position.x = side * 2.4;
    pivot.add(w);
    g.add(pivot);
    wings.push({ pivot, side });
  }
  g.userData = {
    flap(t) {
      const a = Math.sin(t * 38) * 0.6;
      for (const w of wings) w.pivot.rotation.z = w.side * a;
    },
  };
  return g;
}

/** A flower big enough for that bee. */
export function makeFlower() {
  const g = new THREE.Group();
  g.name = 'giant-flower';
  g.add(mesh(new THREE.CylinderGeometry(0.8, 1.1, 16, 8), std(0x3f9b3a), 0, 8, 0));
  const petal = std(0xff7ab8, { roughness: 0.5 });
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const p = mesh(new THREE.SphereGeometry(3, 12, 8), petal, Math.cos(a) * 4, 16.5, Math.sin(a) * 4);
    p.scale.set(1.3, 0.35, 0.8);
    p.rotation.y = -a;
    g.add(p);
  }
  g.add(mesh(new THREE.CylinderGeometry(2.6, 2.6, 1.2, 16), std(0xffd21f), 0, 17, 0));
  for (const s of [-1, 1]) {
    const leaf = mesh(new THREE.SphereGeometry(2.2, 10, 6), std(0x4cb847), s * 2.4, 6, 0);
    leaf.scale.set(1.4, 0.25, 0.6);
    leaf.rotation.z = s * 0.4;
    g.add(leaf);
  }
  return g;
}

/* ---------------------------------------------------------- smoke trail -- */

/**
 * Display smoke, the kind air shows use — rainbow, because it is a school
 * fete. A ring buffer of puffs in one instanced mesh: emitting a puff writes
 * one matrix, and only the young puffs (still growing) are rewritten each
 * frame, so the cost does not grow with the length of the trail.
 */
export function makeSmokeTrail(max = 420) {
  const geo = new THREE.IcosahedronGeometry(1, 1);
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.75, depthWrite: false });
  const m = new THREE.InstancedMesh(geo, mat, max);
  m.name = 'smoke-trail';
  m.frustumCulled = false;
  m.count = 0;
  const born = new Float32Array(max);
  const px = new Float32Array(max);
  const py = new Float32Array(max);
  const pz = new Float32Array(max);
  const d = new THREE.Object3D();
  const col = new THREE.Color();
  let next = 0;
  let clock = 0;
  let hue = 0;
  const GROW = 3.5;
  const write = (i) => {
    const age = clock - born[i];
    const s = 1.6 + Math.min(age, GROW) * 2.4;
    d.position.set(px[i], py[i], pz[i]);
    d.scale.setScalar(s);
    d.updateMatrix();
    m.setMatrixAt(i, d.matrix);
  };
  return {
    mesh: m,
    emit(pos) {
      const i = next;
      next = (next + 1) % max;
      if (m.count < max) m.count++;
      born[i] = clock;
      px[i] = pos.x;
      py[i] = pos.y;
      pz[i] = pos.z;
      hue = (hue + 0.011) % 1;
      col.setHSL(hue, 0.85, 0.62);
      m.setColorAt(i, col);
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
      write(i);
      m.instanceMatrix.needsUpdate = true;
    },
    update(dt) {
      clock += dt;
      let any = false;
      for (let i = 0; i < m.count; i++) {
        if (clock - born[i] <= GROW + 0.1) {
          write(i);
          any = true;
        }
      }
      if (any) m.instanceMatrix.needsUpdate = true;
    },
  };
}

/** Big scorecards over the tower. */
export function makeScorecards() {
  const g = new THREE.Group();
  g.name = 'scorecards';
  const scores = ['9.5', '9.8', '10', '3'];
  scores.forEach((s, i) => {
    const card = makeSign([s], { width: 16, border: i === 3 ? '#ff6a5a' : '#58c6ff' });
    card.position.set((i - 1.5) * 19, 0, 0);
    g.add(card);
  });
  return g;
}
