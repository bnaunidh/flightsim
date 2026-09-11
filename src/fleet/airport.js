/** Airport furniture and range models. Metres; -Z forward, +Y up. No asset requests. */
import * as THREE from '../vendor/three.module.js';
import { makeModel, addBox, addCylinder, addSphere, addPlane, addInstanced,
  makeMaterial, paintTexture, registerPart, finishModel, seedRandom, tubeBetween } from './common.js';

const TAU = Math.PI * 2;
const clamp = THREE.MathUtils.clamp;
const vector = (v, fallback = [0, 0, 0]) => Array.isArray(v) ? new THREE.Vector3(...v) :
  new THREE.Vector3(v?.x ?? fallback[0], v?.y ?? fallback[1], v?.z ?? fallback[2]);
const matrix = (p, s = [1, 1, 1], r = [0, 0, 0]) => new THREE.Matrix4().compose(
  new THREE.Vector3(...p), new THREE.Quaternion().setFromEuler(new THREE.Euler(...r)), new THREE.Vector3(...s));
const assembly = (parent, name) => { const g = new THREE.Group(); g.name = name; parent.add(g); return g; };
function localWind(parent, input, fallback = [5, 0, 2]) {
  parent.updateWorldMatrix(true, false);
  return vector(input, fallback).applyQuaternion(parent.getWorldQuaternion(new THREE.Quaternion()).invert());
}
const flat = (g, parent, name, w, h, pos, mat) => {
  const p = addPlane(g, parent, name, w, h, pos, mat); p.rotation.x = -Math.PI / 2; return p;
};
function noise(ctx, w, h, seed, count = 1800, alpha = .11) {
  const rnd = seedRandom(seed);
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = rnd() < .5 ? `rgba(20,23,22,${rnd() * alpha})` : `rgba(240,238,223,${rnd() * alpha})`;
    ctx.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 5, 1 + rnd() * 4);
  }
}
function industrialTexture(kind = 'metal', color = '#999d98', label = '') {
  return paintTexture(`airport-industrial-${kind}-${color}-${label}`, 512, 512, (ctx, w, h) => {
    ctx.fillStyle = color; ctx.fillRect(0, 0, w, h);
    if (kind === 'metal') {
      for (let x = 0; x < w; x += 16) {
        const gr = ctx.createLinearGradient(x, 0, x + 16, 0);
        gr.addColorStop(0, '#ffffff18'); gr.addColorStop(.45, '#00000005'); gr.addColorStop(1, '#00000035');
        ctx.fillStyle = gr; ctx.fillRect(x, 0, 16, h);
      }
      for (let y = 24; y < h; y += 144) {
        ctx.fillStyle = '#292d3055'; ctx.fillRect(0, y, w, 2);
        for (let x = 8; x < w; x += 32) { ctx.fillStyle = '#292d3077'; ctx.fillRect(x, y - 2, 3, 4); }
      }
    } else {
      ctx.strokeStyle = '#292c2840'; ctx.lineWidth = 2;
      for (let y = 0; y < h; y += 64) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
    }
    const r = seedRandom(92);
    for (let i = 0; i < 80; i++) {
      const x = r() * w, y = h - r() ** 2 * h * .3;
      ctx.fillStyle = '#5b432326'; ctx.fillRect(x, y, 1 + r() * 8, 4 + r() * 28);
    }
    noise(ctx, w, h, 611, 2400, .15);
    if (label) {
      ctx.fillStyle = '#ddd9cb'; ctx.fillRect(64, 180, 384, 104);
      ctx.fillStyle = '#252c31'; ctx.textAlign = 'center'; ctx.font = 'bold 36px sans-serif';
      ctx.fillText(label, w / 2, 242);
    }
  });
}
function signTexture(text, background = '#d9b24c', foreground = '#292c29') {
  return paintTexture(`airport-sign-${text}-${background}-${foreground}`, 512, 256, (ctx, w, h) => {
    ctx.fillStyle = background; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = foreground; ctx.lineWidth = 10; ctx.strokeRect(14, 14, w - 28, h - 28);
    ctx.fillStyle = foreground; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const rows = text.split('\n'); ctx.font = `bold ${rows.length > 1 ? 47 : 68}px sans-serif`;
    rows.forEach((row, i) => ctx.fillText(row, w / 2, h / 2 + (i - (rows.length - 1) / 2) * 60, w - 44));
  });
}
function sign(g, parent, name, text, size, pos, color) {
  return addPlane(g, parent, name, ...size, pos, makeMaterial(g, {
    map: signTexture(text, color), roughness: .82, side: THREE.DoubleSide,
  }));
}
function hut(g, parent, name, width = 3.2, depth = 3, height = 2.8) {
  const p = assembly(parent, name);
  const wall = makeMaterial(g, { map: industrialTexture('metal', '#9b9e94'), roughness: .85 });
  const roof = makeMaterial(g, { map: industrialTexture('metal', '#626a68'), roughness: .7, metalness: .25 });
  addBox(g, p, 'walls', [width, height, depth], [0, height / 2, 0], wall);
  addBox(g, p, 'overhanging-roof', [width + .5, .18, depth + .5], [0, height + .1, 0], roof);
  const door = makeMaterial(g, { color: 0x48544f, map: industrialTexture('metal', '#788078'), roughness: .85 });
  addBox(g, p, 'door', [.82, 2.05, .045], [-width * .23, 1.04, -depth / 2 - .03], door);
  const glass = makeMaterial(g, { color: 0x667b7f, metalness: .4, roughness: .13, envMap: null });
  addBox(g, p, 'window', [width * .42, .75, .035], [width * .21, 1.75, -depth / 2 - .035], glass);
  return p;
}

/** White rings are at these radii in metres, not scaled approximations. */
export function createPracticeRange(opts = {}) {
  const g = makeModel('practice-range');
  const size = 224, px = 2048;
  const map = paintTexture('practice-range-5-25-50-100-v1', px, px, (ctx, w, h) => {
    ctx.fillStyle = '#b9b39b'; ctx.fillRect(0, 0, w, h);
    noise(ctx, w, h, 88, 36000, .15);
    const m = w / size, c = w / 2;
    for (let q = 0; q < 4; q++) {
      ctx.fillStyle = q % 2 ? '#a8a78c' : '#c8c3ab';
      ctx.beginPath(); ctx.moveTo(c, c); ctx.arc(c, c, 100 * m, q * Math.PI / 2, (q + 1) * Math.PI / 2); ctx.closePath(); ctx.fill();
    }
    ctx.fillStyle = '#363e3a'; ctx.beginPath(); ctx.arc(c, c, 5 * m, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#efeee1'; ctx.lineWidth = 1.25 * m;
    for (const radius of [25, 50, 100]) { ctx.beginPath(); ctx.arc(c, c, radius * m, 0, TAU); ctx.stroke(); }
    ctx.lineWidth = .45 * m;
    for (const a of [0, Math.PI / 2]) {
      ctx.beginPath(); ctx.moveTo(c - Math.cos(a) * 100 * m, c - Math.sin(a) * 100 * m);
      ctx.lineTo(c + Math.cos(a) * 100 * m, c + Math.sin(a) * 100 * m); ctx.stroke();
    }
    noise(ctx, w, h, 991, 16000, .08);
  });
  const ground = flat(g, g, 'scoring-ground', size, size, [0, .025, 0], makeMaterial(g, { map, roughness: 1 }));
  registerPart(g, 'target', 'Scoring target', [ground], { massKg: 10000 });
  const markerMat = makeMaterial(g, { map: signTexture('RANGE', '#d6cdb8'), roughness: .8 });
  const positions = [[-106, -106], [106, -106], [-106, 106], [106, 106]];
  const markers = addInstanced(g, g, 'corner-markers', new THREE.BoxGeometry(1, 1, 1), markerMat,
    positions.map(([x, z]) => matrix([x, 1.4, z], [2, 2.8, .3], [0, -Math.PI / 4, 0])));
  registerPart(g, 'cornerMarkers', 'Range corner markers', [markers], { massKg: 64 });
  const tower = assembly(g, 'spotting-tower'); tower.position.set(115, 0, 96);
  const steel = makeMaterial(g, { color: 0x636d63, roughness: .7, metalness: .3 });
  addInstanced(g, tower, 'tower-legs', new THREE.BoxGeometry(1, 1, 1), steel,
    [[-1.7, -1.7], [1.7, -1.7], [-1.7, 1.7], [1.7, 1.7]].map(([x, z]) => matrix([x, 2.7, z], [.17, 5.4, .17])));
  addBox(g, tower, 'platform', [4.1, .24, 4.1], [0, 5.4, 0], steel);
  const cab = hut(g, tower, 'spotter-cab', 3.6, 3.3, 2.35); cab.position.y = 5.52;
  const rungMatrices = [];
  for (let i = 0; i < 17; i++) rungMatrices.push(matrix([-1.95, .25 + i * .31, 0], [.07, .06, .8]));
  for (const z of [-.45, .45]) rungMatrices.push(matrix([-1.95, 2.75, z], [.08, 5.5, .08]));
  addInstanced(g, tower, 'access-ladder', new THREE.BoxGeometry(1, 1, 1), steel, rungMatrices);
  registerPart(g, 'spottingTower', 'Spotting tower', [tower], { massKg: 1400 });
  g.userData.scoringRadii = Object.freeze([5, 25, 50, 100]);
  g.userData.scorePoint = worldPoint => {
    g.updateWorldMatrix(true, false); const p = g.worldToLocal(vector(worldPoint));
    const distance = Math.hypot(p.x, p.z); return { distance, ring: [5, 25, 50, 100].find(r => distance <= r) ?? null };
  };
  return finishModel(g);
}

/** 1.8 m inert practice store. drop() transfers its motion into world coordinates. */
export function createPracticeBomb(opts = {}) {
  const g = makeModel('inert-practice-bomb');
  const blue = makeMaterial(g, { map: industrialTexture('paint', '#42759b'), roughness: .53, metalness: .28 });
  const finMat = makeMaterial(g, { color: 0x3b6889, roughness: .65, metalness: .3 });
  const body = assembly(g, 'body');
  const shaft = addCylinder(g, body, 'cylindrical-body', .125, .125, 1.38, 10, [0, 0, -.025], blue);
  shaft.rotation.x = Math.PI / 2;
  const nose = addSphere(g, body, 'rounded-nose', 1, 10, 5, [0, 0, -.715], blue); nose.scale.set(.125, .125, .185);
  const tail = addCylinder(g, body, 'tapered-tail', .055, .125, .395, 8, [0, 0, .7025], blue); tail.rotation.x = Math.PI / 2;
  const lug = addBox(g, body, 'suspension-lug', [.07, .09, .15], [0, .15, -.1], makeMaterial(g, { color: 0x444e55, metalness: .6, roughness: .4 }));
  registerPart(g, 'body', 'Blue inert practice store', [body], { massKg: opts.massKg ?? 18 });
  const finGeometry = new THREE.BoxGeometry(.012, .2, .34);
  const fp = finGeometry.attributes.position;
  for (let i = 0; i < fp.count; i++) fp.setZ(i, fp.getZ(i) + .2 * ((fp.getY(i) + .1) / .2));
  finGeometry.computeVertexNormals();
  const finMatrices = [];
  for (let i = 0; i < 4; i++) {
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), i * Math.PI / 2);
    const pos = new THREE.Vector3(0, .15, .53).applyQuaternion(q);
    finMatrices.push(new THREE.Matrix4().compose(pos, q, new THREE.Vector3(1, 1, 1)));
  }
  const fins = addInstanced(g, g, 'four-swept-fins', finGeometry, finMat, finMatrices);
  registerPart(g, 'tailFins', 'Four swept tail fins', [fins], { massKg: .8 });
  let falling = null, age = 0, hasReleasePose = false;
  const origin = new THREE.Vector3(), rotation = new THREE.Quaternion(), scale = new THREE.Vector3();
  const saved = { matrix: g.matrix.clone(), auto: true };
  function worldPose() {
    g.updateWorldMatrix(true, false); g.matrixWorld.decompose(origin, rotation, scale);
  }
  function writeWorld() {
    const w = new THREE.Matrix4().compose(origin, rotation, scale);
    if (g.parent) { g.parent.updateWorldMatrix(true, false); g.matrix.copy(g.parent.matrixWorld).invert().multiply(w); }
    else g.matrix.copy(w);
    g.matrix.decompose(g.position, g.quaternion, g.scale);
    g.matrixAutoUpdate = false; g.matrixWorldNeedsUpdate = true;
  }
  function resetDrop() {
    falling = null; age = 0;
    if (hasReleasePose) {
      g.matrix.copy(saved.matrix); g.matrix.decompose(g.position, g.quaternion, g.scale);
      g.matrixAutoUpdate = saved.auto; g.matrixWorldNeedsUpdate = true; hasReleasePose = false;
    }
    g.userData.dropState = null;
  }
  g.userData.drop = (state = {}) => {
    if (falling || g.userData.crashBody) return g.userData.dropState;
    const velocity = vector(state.worldVelocity), angularVelocity = vector(state.worldAngularVelocity, [.21, .08, .06]);
    if (![velocity, angularVelocity].every(v => [v.x, v.y, v.z].every(Number.isFinite)) ||
      !(state.groundHeight == null || Number.isFinite(state.groundHeight) || typeof state.groundHeight === 'function') ||
      (state.onHit != null && typeof state.onHit !== 'function')) throw new RangeError('Invalid drop velocity, terrain or onHit callback.');
    if (g.matrixAutoUpdate) g.updateMatrix(); worldPose();
    const e = g.matrixWorld.elements, x = new THREE.Vector3(e[0], e[1], e[2]), y = new THREE.Vector3(e[4], e[5], e[6]), z = new THREE.Vector3(e[8], e[9], e[10]);
    if (g.matrixWorld.determinant() <= 0 || scale.x < 1e-8 || Math.max(Math.abs(scale.y - scale.x), Math.abs(scale.z - scale.x)) > 1e-5 * scale.x ||
      Math.max(Math.abs(x.dot(y)), Math.abs(y.dot(z)), Math.abs(z.dot(x))) > 1e-5 * scale.x ** 2) throw new RangeError('Store drop requires positive uniform world scale.');
    saved.matrix.copy(g.matrix); saved.auto = g.matrixAutoUpdate; hasReleasePose = true;
    const groundHeight = typeof state.groundHeight === 'function' ? state.groundHeight : () => state.groundHeight ?? 0;
    g.updateWorldMatrix(true, true);
    const inverse = g.matrixWorld.clone().invert(), points = [], seen = new Set(), instance = new THREE.Matrix4();
    g.traverse(node => {
      if (!node.isMesh) return;
      for (let parent = node; parent && parent !== g; parent = parent.parent) if (!parent.visible) return;
      const base = inverse.clone().multiply(node.matrixWorld), attr = node.geometry.attributes.position;
      for (let j = 0; j < (node.isInstancedMesh ? node.count : 1); j++) {
        const transform = base.clone();
        if (node.isInstancedMesh) { node.getMatrixAt(j, instance); transform.multiply(instance); }
        for (let i = 0; i < attr.count; i++) {
          const p = new THREE.Vector3().fromBufferAttribute(attr, i).applyMatrix4(transform), key = p.toArray().map(n => n.toFixed(5)).join(',');
          if (!seen.has(key)) { seen.add(key); p.strikeId = node.userData.strikeId; points.push(p); }
        }
      }
    });
    falling = { velocity, angularVelocity, groundHeight, points, onHit: state.onHit, hit: false, released: true, elapsed: 0 };
    g.userData.dropState = falling; return falling;
  };
  g.userData.lug = lug;
  return finishModel(g, {
    update(dt) {
      if (!falling || falling.hit) return;
      const steps = Math.max(1, Math.ceil(Math.min(dt, .2) / (1 / 120))), h = Math.min(dt, .2) / steps;
      for (let i = 0; i < steps; i++) {
        age += h; falling.elapsed = age;
        // Quadratic aerodynamic drag damps tumble while gravity remains a world force.
        falling.velocity.y -= 9.81 * h;
        falling.velocity.multiplyScalar(1 / (1 + .003 * falling.velocity.length() * h));
        origin.addScaledVector(falling.velocity, h);
        falling.angularVelocity.multiplyScalar(Math.exp(-.045 * h));
        const spin = falling.angularVelocity.length();
        if (spin > 1e-7) rotation.premultiply(new THREE.Quaternion().setFromAxisAngle(falling.angularVelocity.clone().normalize(), spin * h)).normalize();
        let penetration = Infinity, contact = null;
        for (const point of falling.points) {
          if (g.userData.strikePoints[point.strikeId]?.detached) continue;
          const world = point.clone().multiplyScalar(scale.x).applyQuaternion(rotation).add(origin);
          const floor = falling.groundHeight(world.x, world.z), distance = world.y - floor;
          if (Number.isFinite(floor) && distance < penetration) { penetration = distance; contact = world; }
        }
        if (contact && penetration <= 0) {
          origin.y -= penetration; contact.y -= penetration; writeWorld();
          falling.hit = true; falling.released = false;
          const impact = { position: contact, velocity: falling.velocity.clone(), speed: falling.velocity.length(), elapsed: age, inert: true };
          const nextVelocity = falling.velocity.clone().multiplyScalar(.25);
          nextVelocity.y = Math.max(0, -falling.velocity.y * .08);
          g.userData.beginCrash({ groundHeight: falling.groundHeight, worldVelocity: nextVelocity,
            worldAngularVelocity: falling.angularVelocity, massKg: opts.massKg ?? 18 });
          falling.onHit?.(impact); break;
        }
        writeWorld();
      }
    }, reset: resetDrop,
  });
}

/** Layout keeps the original 09/27 proportions, markings, rubber and asphalt palette. */
export function runwayTexture({ near = '18', far = '36' } = {}) {
  const designator = value => { const t = String(value).padStart(2, '0'); if (!/^(0[1-9]|[12][0-9]|3[0-6])[LCR]?$/.test(t)) throw new RangeError('Runway designators must be 01–36 with optional L/C/R.'); return t; };
  near = designator(near); far = designator(far);
  return paintTexture(`airport-runway-${near}-${far}`, 512, 1536, (ctx, W, H) => {
    ctx.fillStyle = '#43464b'; ctx.fillRect(0, 0, W, H);
    noise(ctx, W, H, 91, 34000, .2);
    const rnd = seedRandom(3);
    for (const zone of [H * .14, H * .86]) for (let i = 0; i < 520; i++) {
      const x = W * .5 + (rnd() - .5) * W * .5, y = zone + (rnd() - .5) * H * .07;
      ctx.fillStyle = `rgba(20,20,22,${.03 + rnd() * .07})`;
      ctx.beginPath(); ctx.ellipse(x, y, 6 + rnd() * 26, 2 + rnd() * 7, 0, 0, TAU); ctx.fill();
    }
    const paint = 'rgba(240,240,234,.92)'; ctx.fillStyle = paint;
    ctx.fillRect(W * .08, H * .02, 8, H * .96); ctx.fillRect(W * .92 - 8, H * .02, 8, H * .96);
    for (let y = H * .1; y < H * .9; y += 76) ctx.fillRect(W / 2 - 5, y, 10, 46);
    for (let k = 0; k < 8; k++) {
      const bw = W * .055, x = W * .14 + k * bw * 1.55;
      ctx.fillRect(x, H * .028, bw, H * .035); ctx.fillRect(x, H - H * .063, bw, H * .035);
    }
    for (const y of [H * .115, H - H * .15]) {
      ctx.fillRect(W * .26, y, 26, H * .035); ctx.fillRect(W * .74 - 26, y, 26, H * .035);
    }
    for (const [text, y, flip] of [[near, H * .085, false], [far, H * .915, true]]) {
      ctx.save(); ctx.translate(W / 2, y); if (flip) ctx.rotate(Math.PI);
      ctx.fillStyle = paint; ctx.font = 'bold 150px "Arial Black", Arial, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, 0, 0, 340); ctx.restore();
    }
    // Opaque scuffs keep the whole mesh solid instead of punching holes through pavement.
    for (let i = 0; i < 900; i++) {
      ctx.fillStyle = `rgba(67,70,75,${.05 + rnd() * .2})`;
      ctx.beginPath(); ctx.arc(rnd() * W, rnd() * H, 1 + rnd() * 5, 0, TAU); ctx.fill();
    }
  });
}
export function createRunway(opts = {}) {
  const g = makeModel('runway-18-36');
  const width = opts.width ?? 44, length = opts.length ?? 900;
  const pavement = flat(g, g, 'runway-surface', width, length, [0, .04, 0], makeMaterial(g, {
    map: runwayTexture(opts), roughness: .92, metalness: .02,
  }));
  g.userData.dimensions = { width, length };
  registerPart(g, 'surface', 'Runway pavement', [pavement], { massKg: width * length * 80 });
  return finishModel(g);
}

function fenceTexture() {
  return paintTexture('airport-chain-link', 128, 128, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h); ctx.strokeStyle = '#687270'; ctx.lineWidth = 3;
    for (let i = -128; i <= 256; i += 32) {
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + 128, 128); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i - 128, 128); ctx.stroke();
    }
    ctx.strokeStyle = '#c4c9bf'; ctx.lineWidth = 1;
    for (let i = -128; i <= 256; i += 32) { ctx.beginPath(); ctx.moveTo(i + 2, 0); ctx.lineTo(i + 130, 128); ctx.stroke(); }
  }, { repeat: [4, 3] });
}
export function createPerimeterFence(opts = {}) {
  const g = makeModel('perimeter-fence');
  const length = Math.max(12, opts.length ?? 84), height = opts.height ?? 2.5, gateWidth = clamp(opts.gateWidth ?? 7, 3, length / 2);
  const wire = makeMaterial(g, { map: fenceTexture(), transparent: true, alphaTest: .2, side: THREE.DoubleSide, roughness: .7, metalness: .4, depthWrite: true });
  const metal = makeMaterial(g, { color: 0x777f7c, roughness: .5, metalness: .6 });
  const posts = [], panels = [], topRails = [];
  for (const side of [-1, 1]) {
    const distance = (length - gateWidth) / 2, count = Math.ceil(distance / 3.5), span = distance / count;
    for (let i = 0; i <= count; i++) posts.push(matrix([side * (gateWidth / 2 + i * span), height / 2, 0], [.07, height + .3, .07]));
    for (let i = 0; i < count; i++) {
      const x = side * (gateWidth / 2 + (i + .5) * span);
      panels.push(matrix([x, height / 2, 0], [span, height, 1]));
      topRails.push(matrix([x, height - .04, 0], [span, .06, .06]));
    }
  }
  const p = addInstanced(g, g, 'fence-posts', new THREE.CylinderGeometry(1, 1, 1, 5), metal, posts);
  const mesh = addInstanced(g, g, 'chain-link-panels', new THREE.PlaneGeometry(1, 1), wire, panels);
  const rails = addInstanced(g, g, 'fence-top-rails', new THREE.BoxGeometry(1, 1, 1), metal, topRails);
  registerPart(g, 'fencePosts', 'Perimeter posts', [p], { massKg: posts.length * 8 });
  registerPart(g, 'chainLink', 'Chain-link mesh and rail', [mesh, rails], { massKg: panels.length * 5 });
  const gates = [];
  for (const side of [-1, 1]) {
    const gate = assembly(g, `${side < 0 ? 'left' : 'right'}-gate`); gate.position.x = side * gateWidth / 2;
    const localX = -side * gateWidth / 4;
    addPlane(g, gate, 'gate-mesh', gateWidth / 2, height - .15, [localX, height / 2, .015], wire);
    addInstanced(g, gate, 'gate-frame', new THREE.BoxGeometry(1, 1, 1), metal, [
      matrix([localX, .15, 0], [gateWidth / 2, .08, .08]), matrix([localX, height, 0], [gateWidth / 2, .08, .08]),
      matrix([0, height / 2, 0], [.08, height, .08]), matrix([-side * gateWidth / 2, height / 2, 0], [.08, height, .08]),
    ]);
    registerPart(g, side < 0 ? 'gateLeft' : 'gateRight', side < 0 ? 'Left gate leaf' : 'Right gate leaf', [gate], { massKg: 36 }); gates.push(gate);
  }
  const guard = hut(g, g, 'guard-hut', 3, 3.2, 2.8); guard.position.set(gateWidth / 2 + 3, 0, -3);
  sign(g, guard, 'access-placard', 'AIRSIDE\nAUTHORISED ONLY', [1.6, .8], [0, 2.3, -1.63]);
  registerPart(g, 'guardHut', 'Airside guard hut', [guard], { massKg: 1100 });
  let opening = clamp(opts.gateOpen ?? 0, 0, 1);
  g.userData.gates = gates;
  return finishModel(g, {
    update(dt, state = {}) {
      opening = THREE.MathUtils.damp(opening, clamp(state.gateOpen ?? opts.gateOpen ?? 0, 0, 1), 3, dt);
      gates[0].rotation.y = -opening * Math.PI / 2; gates[1].rotation.y = opening * Math.PI / 2;
    }, reset() { opening = 0; gates.forEach(x => x.rotation.y = 0); },
  });
}

function appendWindsock(g, parent, opts = {}) {
  const p = assembly(parent, 'windsock');
  const height = opts.height ?? 6;
  const metal = makeMaterial(g, { color: 0x8b9290, roughness: .55, metalness: .6 });
  addCylinder(g, p, 'pole', .055, .09, height, 6, [0, height / 2, 0], metal);
  const yaw = assembly(p, 'wind-yaw'); yaw.position.y = height;
  const clothMap = paintTexture('airport-windsock-bands', 128, 256, (ctx, w, h) => {
    for (let i = 0; i < 5; i++) { ctx.fillStyle = i % 2 ? '#e5dfcc' : '#bd632f'; ctx.fillRect(0, i * h / 5, w, h / 5 + 1); }
    noise(ctx, w, h, 152, 1500, .08);
  });
  const mat = makeMaterial(g, { map: clothMap, roughness: .9, side: THREE.DoubleSide });
  const geo = new THREE.CylinderGeometry(.19, .42, 2.5, 8, 5, true);
  geo.rotateX(Math.PI / 2); geo.translate(0, 0, 1.25);
  g.userData.ownGeometry(geo);
  const rest = geo.attributes.position.array.slice(), sock = new THREE.Mesh(geo, mat); sock.name = 'striped-windsock'; yaw.add(sock);
  addCylinder(g, yaw, 'mouth-ring', .43, .43, .03, 8, [0, 0, 0], metal, true).rotation.x = Math.PI / 2;
  let t = 0;
  function update(dt, state = {}) {
    t += dt; const wind = localWind(p, state.wind ?? opts.wind);
    const speed = Math.hypot(wind.x, wind.z), lift = clamp(speed / 9, 0, 1);
    if (speed > .1) yaw.rotation.y = Math.atan2(wind.x, wind.z);
    const a = geo.attributes.position;
    for (let i = 0; i < a.count; i++) {
      const x = rest[i * 3], y = rest[i * 3 + 1], z = rest[i * 3 + 2], f = z / 2.5;
      a.setXYZ(i, x + Math.sin(t * (4 + speed * .4) - f * 6) * .07 * f * lift,
        y - (1 - lift) * 2 * f * f + Math.sin(t * 3.2 - f * 4) * .025 * f * lift, z * (.6 + .4 * lift));
    }
    a.needsUpdate = true; geo.computeVertexNormals(); geo.computeBoundingSphere();
  }
  return { group: p, yaw, sock, update, reset: () => { t = 0; update(0); } };
}
export function createWindsock(opts = {}) {
  const g = makeModel('windsock'), rig = appendWindsock(g, g, opts);
  registerPart(g, 'windsock', 'Windsock and mast', [rig.group], { massKg: 22 });
  Object.assign(g.userData, { yaw: rig.yaw, sock: rig.sock });
  return finishModel(g, { update(dt, state) { if (!g.userData.strikePoints.windsock.detached) rig.update(dt, state); }, reset: rig.reset });
}
export function createWindFlag(opts = {}) {
  const g = makeModel('wind-flag'), height = opts.height ?? 5;
  const metal = makeMaterial(g, { color: 0x919790, roughness: .6, metalness: .5 });
  const pole = addCylinder(g, g, 'flag-pole', .045, .065, height, 6, [0, height / 2, 0], metal);
  const yaw = assembly(g, 'flag-yaw'); yaw.position.y = height - .65;
  const geo = new THREE.PlaneGeometry(1.8, 1.05, 5, 2); geo.translate(.9, 0, 0); g.userData.ownGeometry(geo);
  const rest = geo.attributes.position.array.slice();
  const map = signTexture(opts.text ?? 'KESTREL', '#bfc3b4', '#374941');
  const flag = new THREE.Mesh(geo, makeMaterial(g, { map, side: THREE.DoubleSide, roughness: .95 })); flag.name = 'cloth'; yaw.add(flag);
  registerPart(g, 'pole', 'Flag pole', [pole], { massKg: 15 });
  registerPart(g, 'flag', 'Wind-driven flag', [yaw], { massKg: 1 });
  let t = 0; g.userData.flag = flag; g.userData.yaw = yaw;
  return finishModel(g, { update(dt, state = {}) {
    if (g.userData.strikePoints.flag.detached) return;
    t += dt; const w = localWind(g, state.wind ?? opts.wind), speed = Math.hypot(w.x, w.z), taut = clamp(speed / 8, 0, 1);
    if (speed > .1) yaw.rotation.y = Math.atan2(-w.z, w.x);
    const a = geo.attributes.position;
    for (let i = 0; i < a.count; i++) { const x = rest[i * 3], y = rest[i * 3 + 1], f = x / 1.8;
      a.setXYZ(i, x * (.35 + .65 * taut), y - (1 - taut) * f * .9, Math.sin(t * (3 + speed * .4) - x * 5) * .14 * f * taut); }
    a.needsUpdate = true; geo.computeVertexNormals(); geo.computeBoundingSphere();
  }, reset() { t = 0; } });
}

export function createDeliveryStrip(opts = {}) {
  const g = makeModel('delivery-strip');
  const map = paintTexture('airport-delivery-strip-240-44', 512, 2048, (ctx, w, h) => {
    ctx.fillStyle = '#7d8060'; ctx.fillRect(0, 0, w, h);
    const rnd = seedRandom(977);
    for (let i = 0; i < 3000; i++) {
      const x = w * .12 + rnd() * w * .76;
      ctx.fillStyle = `rgba(170,151,112,${.02 + rnd() * .09})`; ctx.fillRect(x, rnd() * h, rnd() * 30, 15 + rnd() * 120);
    }
    for (const x of [.35, .65]) { ctx.fillStyle = '#443e2b35'; ctx.fillRect(w * x, 60, 12, h - 120); }
    ctx.strokeStyle = '#d8ca9477'; ctx.lineWidth = 5; ctx.strokeRect(w * .09, 30, w * .82, h - 60);
    const rx = w * .31, ry = rx * h * 44 / (w * 240);
    ctx.strokeStyle = '#dac97a'; ctx.lineWidth = 9;
    ctx.beginPath(); ctx.ellipse(w / 2, h / 2, rx, ry, 0, 0, TAU); ctx.stroke();
    ctx.fillStyle = '#dac97a'; ctx.fillRect(w / 2 - 4, h / 2 - ry, 8, ry * 2); ctx.fillRect(w / 2 - rx, h / 2 - 3, rx * 2, 6);
    noise(ctx, w, h, 501, 42000, .19);
  });
  const surface = flat(g, g, 'worn-dirt-strip', 44, 240, [0, .035, 0], makeMaterial(g, { map, roughness: 1 }));
  registerPart(g, 'strip', 'Worn delivery strip', [surface], { massKg: 10000 });
  const shed = hut(g, g, 'delivery-hut', 5, 4, 3); shed.position.set(30, 0, 15);
  sign(g, shed, 'delivery-sign', 'ISLAND\nDELIVERY', [2.4, 1.2], [0, 2.2, -2.04]);
  registerPart(g, 'hut', 'Delivery hut', [shed], { massKg: 1800 });
  const drumMat = makeMaterial(g, { map: industrialTexture('paint', '#4b6570', 'OIL'), metalness: .4, roughness: .68 });
  const drums = addInstanced(g, g, 'oil-drums', new THREE.CylinderGeometry(.31, .31, .88, 8), drumMat,
    [[27, .44, 10], [27.75, .44, 10.2], [27.2, .44, 11]].map(p => matrix(p)));
  registerPart(g, 'drums', 'Oil drums', [drums], { massKg: 100 });
  const markers = addInstanced(g, g, 'edge-stones', new THREE.BoxGeometry(1, 1, 1), makeMaterial(g, { color: 0xc6c4ae, roughness: .98 }),
    Array.from({ length: 18 }, (_, i) => matrix([i % 2 ? 22 : -22, .12, -112 + Math.floor(i / 2) * 28], [.55, .24, 1.5])));
  registerPart(g, 'edgeMarkers', 'Strip edge markers', [markers], { massKg: 240 });
  const wind = appendWindsock(g, g, opts); wind.group.position.set(-29, 0, -36);
  registerPart(g, 'windsock', 'Delivery windsock', [wind.group], { massKg: 25 });
  g.userData.windsock = wind;
  return finishModel(g, { update(dt, state) { if (!g.userData.strikePoints.windsock.detached) wind.update(dt, state); }, reset: wind.reset });
}

function parkedLightPlane(g, parent) {
  const p = assembly(parent, 'parked-aircraft');
  const paint = makeMaterial(g, { map: industrialTexture('paint', '#c3c6be'), roughness: .58, metalness: .2 });
  const dark = makeMaterial(g, { color: 0x334c55, metalness: .5, roughness: .12 });
  const fus = addSphere(g, p, 'fuselage', 1, 8, 5, [0, 1.1, 0], paint); fus.scale.set(.62, .65, 3.7);
  const wing = addBox(g, p, 'wing', [10.4, .12, 1.2], [0, 1.55, .05], paint);
  addBox(g, p, 'stabilizer', [3.6, .09, .7], [0, 1.4, 2.8], paint);
  addBox(g, p, 'tail-fin', [.12, 1.1, .9], [0, 1.95, 2.85], paint);
  const glass = addSphere(g, p, 'cockpit-glazing', 1, 8, 4, [0, 1.4, -.8], dark); glass.scale.set(.52, .52, .8);
  const tire = makeMaterial(g, { color: 0x2b2e2c, roughness: .95 });
  addInstanced(g, p, 'wheels', new THREE.CylinderGeometry(.3, .3, .17, 6), tire,
    [[-.95, .32, .1], [.95, .32, .1], [0, .32, -2.3]].map(pos => matrix(pos, [1, 1, 1], [0, 0, Math.PI / 2])));
  const beaconMat = makeMaterial(g, { color: 0x763b2e, emissive: 0xff3921, emissiveIntensity: 0 });
  addBox(g, p, 'beacon', [.16, .14, .16], [0, 2.5, 2.85], beaconMat);
  return { group: p, wing, beaconMat };
}
export function createHangar(opts = {}) {
  const g = makeModel('sliding-door-hangar');
  const width = opts.width ?? 24, depth = opts.depth ?? 22, wallHeight = opts.wallHeight ?? 6.2;
  const roofHeight = wallHeight + width * .17;
  const cladding = makeMaterial(g, { map: industrialTexture('metal', '#919994'), roughness: .76, metalness: .28 });
  const frameMat = makeMaterial(g, { color: 0x48585d, roughness: .55, metalness: .48 });
  const shell = assembly(g, 'hangar-shell');
  addBox(g, shell, 'left-wall', [.2, wallHeight, depth], [-width / 2, wallHeight / 2, 0], cladding);
  addBox(g, shell, 'right-wall', [.2, wallHeight, depth], [width / 2, wallHeight / 2, 0], cladding);
  addBox(g, shell, 'rear-wall', [width, wallHeight, .2], [0, wallHeight / 2, depth / 2], cladding);
  const roofSlope = Math.atan((roofHeight - wallHeight) / (width / 2));
  const roofSpan = Math.hypot(width / 2, roofHeight - wallHeight);
  addInstanced(g, shell, 'pitched-roof', new THREE.BoxGeometry(1, 1, 1), cladding, [
    matrix([-width / 4, (wallHeight + roofHeight) / 2, 0], [roofSpan + .4, .2, depth + .8], [0, 0, roofSlope]),
    matrix([width / 4, (wallHeight + roofHeight) / 2, 0], [roofSpan + .4, .2, depth + .8], [0, 0, -roofSlope]),
  ]);
  // Four-sided cones, flattened into the gables, preserve primitive-only geometry.
  const gableGeo = new THREE.CylinderGeometry(0, 1, 1, 4, 1, false);
  gableGeo.rotateY(Math.PI / 4);
  addInstanced(g, shell, 'gable-panels', gableGeo, cladding, [-1, 1].map(side =>
    matrix([0, (wallHeight + roofHeight) / 2, side * depth / 2], [width / Math.SQRT2, roofHeight - wallHeight, .16])));
  registerPart(g, 'shell', 'Hangar walls and roof', [shell], { massKg: 15000 });
  const floor = addBox(g, g, 'concrete-floor', [width, .15, depth], [0, .075, 0], makeMaterial(g, { map: industrialTexture('paint', '#99988e'), roughness: .96 }));
  registerPart(g, 'floor', 'Hangar concrete floor', [floor], { massKg: 28000 });
  const frame = assembly(g, 'front-frame');
  addInstanced(g, frame, 'uprights-and-track', new THREE.BoxGeometry(1, 1, 1), frameMat, [
    matrix([-width / 2, wallHeight / 2, -depth / 2], [.28, wallHeight, .28]),
    matrix([width / 2, wallHeight / 2, -depth / 2], [.28, wallHeight, .28]),
    matrix([0, wallHeight, -depth / 2 - .18], [width + 3, .22, .22]),
    matrix([0, .15, -depth / 2 - .18], [width + 3, .07, .12]),
  ]);
  sign(g, frame, 'hangar-number', opts.name ?? 'HANGAR 02', [5, 1.15], [0, wallHeight + .8, -depth / 2 - .2], '#d7d6c9');
  registerPart(g, 'doorFrame', 'Door tracks and frame', [frame], { massKg: 1200 });
  const doors = [], panelWidth = width / 4;
  for (let i = 0; i < 4; i++) {
    const door = assembly(g, `door-leaf-${i + 1}`); door.position.set(-width / 2 + panelWidth * (i + .5), wallHeight / 2, -depth / 2 - .24 - i * .06);
    addBox(g, door, 'sliding-panel', [panelWidth - .07, wallHeight - .18, .12], [0, 0, 0], cladding);
    registerPart(g, `door${i + 1}`, `Sliding hangar door ${i + 1}`, [door], { massKg: 240 }); doors.push(door);
  }
  const plane = parkedLightPlane(g, g); plane.group.position.set(0, .15, 1.8);
  registerPart(g, 'parkedAircraft', 'Parked light aircraft', [plane.group], { massKg: 730 });
  const lightMat = makeMaterial(g, { color: 0xe1ddc4, emissive: 0xffedbc, emissiveIntensity: 0, roughness: .5 });
  const lighting = assembly(g, 'hangar-lighting');
  const lamps = addInstanced(g, lighting, 'ceiling-lights', new THREE.BoxGeometry(1, 1, 1), lightMat,
    [[-6, wallHeight + .7, -4], [6, wallHeight + .7, -4], [-6, wallHeight + .7, 6], [6, wallHeight + .7, 6]].map(p => matrix(p, [2, .12, .5])));
  const actualLight = new THREE.PointLight(0xffedbc, 0, 26, 2); actualLight.position.set(0, wallHeight - 1, 1); lighting.add(actualLight);
  registerPart(g, 'lights', 'Hangar ceiling lights', [lighting], { massKg: 30 });
  let opening = clamp(opts.doorOpen ?? .8, 0, 1), t = 0;
  function pose() {
    doors.forEach((door, i) => { const home = -width / 2 + panelWidth * (i + .5), side = i < 2 ? -1 : 1;
      const stowed = side * (width / 2 - panelWidth / 2 + .6); door.position.x = THREE.MathUtils.lerp(home, stowed, opening); });
  }
  pose(); Object.assign(g.userData, { doors, lights: lightMat, parkedAircraft: plane.group });
  return finishModel(g, { update(dt, state = {}) {
    t += dt; opening = THREE.MathUtils.damp(opening, clamp(state.doorOpen ?? opts.doorOpen ?? .8, 0, 1), 1.2, dt); pose();
    const on = state.lightsOn ?? true; lightMat.emissiveIntensity = on ? 2 : 0; actualLight.intensity = on ? 110 : 0;
    plane.beaconMat.emissiveIntensity = (t % 1.6 < .12 && state.parkedPower !== false) ? 4 : 0;
  }, reset() { t = 0; opening = opts.doorOpen ?? .8; pose(); } });
}

export function createFuelFarm(opts = {}) {
  const g = makeModel('fuel-farm'), tankCount = clamp(Math.floor(opts.tankCount ?? 2), 1, 6);
  const tankMat = makeMaterial(g, { map: industrialTexture('paint', '#c4c4b7', 'JET A-1'), roughness: .6, metalness: .45 });
  const steel = makeMaterial(g, { color: 0x5c6865, roughness: .55, metalness: .58 });
  const concrete = makeMaterial(g, { map: industrialTexture('paint', '#8c9085'), roughness: .95 });
  const width = tankCount * 4.8 + 2.5;
  const bund = assembly(g, 'containment-bund');
  addBox(g, bund, 'bund-floor', [width, .2, 14], [0, .1, 0], concrete);
  addInstanced(g, bund, 'containment-walls', new THREE.BoxGeometry(1, 1, 1), concrete, [
    matrix([0, .75, -7], [width, 1.5, .3]), matrix([0, .75, 7], [width, 1.5, .3]),
    matrix([-width / 2, .75, 0], [.3, 1.5, 14]), matrix([width / 2, .75, 0], [.3, 1.5, 14]),
  ]);
  registerPart(g, 'bund', 'Fuel containment bund', [bund], { massKg: 12000 });
  const saddles = [], pipes = [], rungs = [];
  for (let i = 0; i < tankCount; i++) {
    const x = (i - (tankCount - 1) / 2) * 4.8, tank = assembly(g, `tank-${i + 1}`); tank.position.x = x;
    const cylinder = addCylinder(g, tank, 'horizontal-tank', 1.6, 1.6, 7.2, 10, [0, 2.5, 0], tankMat); cylinder.rotation.x = Math.PI / 2;
    // Ellipsoidal caps give the vessel dished ends without torus-heavy geometry.
    for (const side of [-1, 1]) {
      const cap = addSphere(g, tank, `${side < 0 ? 'front' : 'rear'}-dished-end`, 1, 10, 5, [0, 2.5, side * 3.6], tankMat); cap.scale.set(1.6, 1.6, .42);
    }
    addCylinder(g, tank, 'inspection-hatch', .4, .4, .12, 8, [0, 4.13, 0], steel);
    sign(g, tank, 'hazard-placard', 'FLAMMABLE\nNO SMOKING', [1.7, .85], [0, 2.4, -4.03], '#dcbe65');
    registerPart(g, `tank${i + 1}`, `Fuel tank ${i + 1}`, [tank], { massKg: 1100 });
    for (const z of [-2.4, 2.4]) saddles.push(matrix([x, .6, z], [2.8, 1.1, .55]));
    pipes.push(matrix([x, .55, -5.4], [.14, .14, 3.2]));
    for (let j = 0; j < 12; j++) rungs.push(matrix([x + 1.72, .35 + j * .31, 0], [.07, .055, .8]));
    for (const z of [-.46, .46]) rungs.push(matrix([x + 1.72, 2.05, z], [.08, 4.1, .08]));
  }
  const saddleMesh = addInstanced(g, g, 'tank-saddles', new THREE.BoxGeometry(1, 1, 1), concrete, saddles);
  registerPart(g, 'saddles', 'Tank support saddles', [saddleMesh], { massKg: 1200 * tankCount });
  const pipeGroup = assembly(g, 'pipework');
  addInstanced(g, pipeGroup, 'tank-feed-pipes', new THREE.BoxGeometry(1, 1, 1), steel, pipes);
  tubeBetween(g, pipeGroup, 'common-manifold', [-width / 2, .6, -6], [width / 2 + 4, .6, -6], .11, steel, 6);
  const valves = addInstanced(g, pipeGroup, 'valve-handwheels', new THREE.TorusGeometry(.19, .035, 4, 8), steel,
    Array.from({ length: tankCount }, (_, i) => matrix([(i - (tankCount - 1) / 2) * 4.8, .94, -5.8], [1, 1, 1], [-Math.PI / 2, 0, 0])));
  registerPart(g, 'pipework', 'Fuel pipes and valves', [pipeGroup], { massKg: 120 });
  const ladders = addInstanced(g, g, 'tank-access-ladders', new THREE.BoxGeometry(1, 1, 1), steel, rungs);
  registerPart(g, 'ladders', 'Tank access ladders', [ladders], { massKg: 44 * tankCount });
  const pump = hut(g, g, 'pump-house', 4, 4, 3.2); pump.position.set(width / 2 + 4, 0, -3.5);
  sign(g, pump, 'pump-sign', 'FUEL\nPUMP HOUSE', [2.3, 1.15], [0, 2.4, -2.04], '#d1cbbb');
  registerPart(g, 'pumpHouse', 'Fuel pump house', [pump], { massKg: 2500 });
  g.userData.valves = valves;
  return finishModel(g);
}

export const previewModels = [
  { id: 'practice-range', label: 'Practice range · 5 / 25 / 50 / 100 m', create: () => createPracticeRange(), damagePart: 'spottingTower' },
  { id: 'practice-bomb', label: 'Blue inert practice store', create: () => createPracticeBomb(), damagePart: 'tailFins' },
  { id: 'runway-18-36', label: 'Runway 18 / 36', create: () => createRunway(), damagePart: 'surface' },
  { id: 'perimeter-fence', label: 'Airside fence and vehicle gate', create: () => createPerimeterFence({ length: 36 }), updateState: { gateOpen: .7 }, damagePart: 'gateLeft' },
  { id: 'delivery-strip', label: 'Weathered delivery strip', create: () => createDeliveryStrip(), updateState: { wind: { x: 6, z: 3 } }, damagePart: 'hut' },
  { id: 'hangar', label: 'Sliding hangar doors and parked aircraft', create: () => createHangar(), updateState: { doorOpen: 1, lightsOn: true }, damagePart: 'door1' },
  { id: 'fuel-farm', label: 'Fuel farm, bund and pipework', create: () => createFuelFarm(), damagePart: 'tank1' },
  { id: 'windsock', label: 'Wind-driven windsock', create: () => createWindsock(), updateState: { wind: { x: 6, z: 2 } }, damagePart: 'windsock' },
  { id: 'wind-flag', label: 'Wind-driven flag', create: () => createWindFlag(), updateState: { wind: { x: 5, z: 1 } }, damagePart: 'flag' },
];
