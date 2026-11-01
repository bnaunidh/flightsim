/**
 * The holidays at the home field (the owner, 2026-11-01: "nov 1st its time to
 * get ready for christmas"): a big tree on the terminal's kerb side with a star
 * and bulbs, a string of lights along the terminal's roof edge, and a ring of
 * them round the control tower's gallery.
 *
 * WHEN: Settings → Graphics → Holiday decorations. 'auto' (the default) is
 * December 1st to January 6th by the device's own clock, so nothing changes
 * before then (the class demo is November 4th); 'on' and 'off' are the
 * player's. ?festive=1 in the address turns it on for a test.
 *
 * FLASH-SAFE: the bulbs are steady. No twinkle, no chase, nothing that blinks.
 * CHEAP: one tree (seven meshes) and one Points draw for every bulb, built once
 * per world and only while the decorations are on; Low graphics gets it too.
 */
import * as THREE from '../vendor/three.module.js';
import { registerExtension } from '../game/extensions.js';
import { airportLayout } from '../world/airport-layout.js';
import { groundHeightAt } from '../world/terrain.js';

/** Month (0-based) and day the 'auto' season runs from and to, inclusive. */
export const SEASON = { from: [11, 1], to: [0, 6] };
export const TREE = { height: 11, tiers: 6, baseR: 4.2, bulbs: 96, kerb: 16 };
const BULB_GAP = 1.6;
const MAX_ROOF_BULBS = 260;
const TOWER_BULBS = 40;
/** Warm white most of all, then the classic red, green, gold and blue. */
const BULB_COLOURS = [0xfff1d6, 0xfff1d6, 0xfff1d6, 0xff4a3d, 0x3fd06a, 0xffc94a, 0x5a8cff];

/** Is a date inside the holiday season (December 1st to January 6th)? */
export function inSeason(date) {
  const m = date.getMonth();
  const d = date.getDate();
  if (m === SEASON.from[0]) return d >= SEASON.from[1];
  if (m === SEASON.to[0]) return d <= SEASON.to[1];
  return false;
}

/** Are the decorations up, for this setting ('auto' | 'on' | 'off') on this date? */
export function decorationsOn(setting, date, forced) {
  if (forced) return true;
  if (setting === 'on') return true;
  if (setting === 'off') return false;
  return inSeason(date);
}

function forcedByUrl() {
  try {
    return /[?&]festive=1\b/.test(location.search);
  } catch {
    return false;
  }
}

const S = {
  forced: forcedByUrl(),
  group: null,
  built: null,
  stats: { trees: 0, bulbs: 0 },
};

let _bulbTex = null;
function bulbTexture() {
  if (_bulbTex) return _bulbTex;
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.3, 'rgba(255,255,255,0.85)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 32, 32);
  _bulbTex = new THREE.CanvasTexture(c);
  _bulbTex.colorSpace = THREE.SRGBColorSpace;
  return _bulbTex;
}

/** A small LCG, so the bulbs' colours are the same every build (and in the tests). */
function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function addBulb(pos, col, x, y, z, rnd) {
  pos.push(x, y, z);
  const c = new THREE.Color(BULB_COLOURS[Math.floor(rnd() * BULB_COLOURS.length)]);
  col.push(c.r, c.g, c.b);
}

function buildTree(x, y, z, pos, col, rnd) {
  const tree = new THREE.Group();
  tree.name = 'Holiday tree';
  const needles = new THREE.MeshStandardMaterial({ color: 0x1e4a2b, roughness: 0.92, flatShading: true });
  const bark = new THREE.MeshStandardMaterial({ color: 0x4a3322, roughness: 1 });
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, 1.6, 8), bark);
  trunk.position.y = 0.8;
  tree.add(trunk);
  const H = TREE.height;
  const tierH = (H - 1.2) / TREE.tiers;
  for (let i = 0; i < TREE.tiers; i++) {
    const t = i / (TREE.tiers - 1);
    const r = TREE.baseR * (1 - t * 0.82);
    const cone = new THREE.Mesh(new THREE.ConeGeometry(r, tierH * 1.7, 12), needles);
    cone.position.y = 1.2 + i * tierH + tierH * 0.85;
    cone.rotation.y = i * 0.7;
    tree.add(cone);
  }
  const star = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.55, 0),
    new THREE.MeshStandardMaterial({ color: 0xffd27a, emissive: 0xffc04a, emissiveIntensity: 1.1, roughness: 0.4, metalness: 0.3 })
  );
  star.position.y = H + 0.6;
  star.scale.set(1, 1.35, 0.45);
  tree.add(star);
  tree.position.set(x, y, z);
  // Bulbs on a spiral down the cones' outside.
  for (let i = 0; i < TREE.bulbs; i++) {
    const t = i / TREE.bulbs;
    const h = 1.6 + t * (H - 2.2);
    const r = TREE.baseR * (1 - ((h - 1.2) / (H - 1.2)) * 0.9) * 0.92;
    const a = t * Math.PI * 2 * 7;
    addBulb(pos, col, x + Math.cos(a) * r, y + h, z + Math.sin(a) * r, rnd);
  }
  return tree;
}

/** Everything, for the home field's layout; null where the field has no terminal. */
export function buildDecorations(lay) {
  if (!lay || !lay.terminal || !lay.terminal.rect || !lay.frame) return null;
  const F = lay.frame;
  const T = lay.terminal;
  const rnd = lcg(1225);
  const pos = [];
  const col = [];
  const root = new THREE.Group();
  root.name = 'Holiday decorations';
  let trees = 0;

  // The tree: on the kerb side of the terminal, in the middle of it.
  const uMid = (T.u0 + T.u1) / 2;
  const tx = F.x(uMid);
  const tz = F.z(T.back + TREE.kerb);
  const ty = groundHeightAt(tx, tz);
  if (Number.isFinite(ty)) {
    root.add(buildTree(tx, ty, tz, pos, col, rnd));
    trees++;
  }

  // The terminal's roof edge, on the apron side.
  const roofY = (lay.elev || 0) + (T.H || 10) + 0.25;
  const n = Math.min(MAX_ROOF_BULBS, Math.floor((T.u1 - T.u0) / BULB_GAP));
  for (let i = 0; i <= n; i++) {
    const u = T.u0 + ((T.u1 - T.u0) * i) / Math.max(1, n);
    addBulb(pos, col, F.x(u), roofY, F.z(T.front - 0.3), rnd);
  }

  // A ring round the tower's gallery.
  const tw = lay.tower;
  if (tw && Number.isFinite(tw.x)) {
    const r = (tw.size || 12) * 0.5 + 0.4;
    const y = (lay.elev || 0) + (tw.H || 30) + 0.2;
    for (let i = 0; i < TOWER_BULBS; i++) {
      const a = (i / TOWER_BULBS) * Math.PI * 2;
      addBulb(pos, col, tw.x + Math.cos(a) * r, y, tw.z + Math.sin(a) * r, rnd);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const bulbs = new THREE.Points(
    geo,
    new THREE.PointsMaterial({
      size: 0.9,
      map: bulbTexture(),
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      sizeAttenuation: true,
      toneMapped: false,
    })
  );
  bulbs.name = 'Holiday lights';
  root.add(bulbs);
  return { root, trees, bulbs: pos.length / 3 };
}

function wanted(sim) {
  const setting = sim && sim.settings ? sim.settings.festive : 'auto';
  return decorationsOn(setting || 'auto', new Date(), S.forced);
}

function refresh(sim) {
  const on = wanted(sim);
  if (on && !S.built && S.group) {
    S.built = buildDecorations(airportLayout());
    if (S.built) {
      S.group.add(S.built.root);
      S.stats = { trees: S.built.trees, bulbs: S.built.bulbs };
    } else {
      S.built = { root: null, trees: 0, bulbs: 0 };
    }
  }
  if (S.built && S.built.root) S.built.root.visible = on;
}

registerExtension({
  id: 'festive',
  buildWorld(sim, group) {
    // The world's group is disposed with the world; the next build starts again.
    S.group = group;
    S.built = null;
    S.stats = { trees: 0, bulbs: 0 };
    refresh(sim);
  },
  startMode(sim) {
    refresh(sim);
  },
  update(sim) {
    // Settings → Graphics changed it: one string compare a frame.
    const setting = sim && sim.settings ? sim.settings.festive : 'auto';
    if (setting !== S.lastSetting) {
      S.lastSetting = setting;
      refresh(sim);
    }
  },
  devActions: [
    {
      label: 'Holiday decorations',
      hint: 'Put the tree and lights up now (or take them down)',
      run(sim) {
        S.forced = !S.forced;
        refresh(sim);
      },
    },
  ],
});

/** For the tests and the console. */
export function festiveDebug() {
  return {
    forced: S.forced,
    built: !!(S.built && S.built.root),
    visible: !!(S.built && S.built.root && S.built.root.visible),
    stats: { ...S.stats },
    refresh,
  };
}
