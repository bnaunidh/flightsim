/**
 * The four courses, drawn — and on the minimap. ../race.js calls
 * buildCourse() once per world and paintCourse() every frame.
 *
 *   rings  the Ring Rally: big rings on striped poles, a start grid painted
 *          on the runway, a chequered finish ring (as it always was);
 *   hoops  the Skyhook Sprint: small orange-and-white hoops low over the
 *          grass on short poles, the grid painted as eight helipads;
 *   road   the Fenwick Grand Prix: a gate over the road at each checkpoint —
 *          two posts and a numbered banner, a line across the tarmac — and a
 *          chequered banner and line for the start and finish; grid boxes on
 *          the road behind it;
 *   buoys  the Lagoon Regatta: two orange buoys a gate, a numbered flag
 *          floating over the middle; the finish buoys chequered.
 *
 * The next gate is yellow and breathing, the one after blue, the ones passed
 * this lap faint green — the same colours for all four.
 */

import * as THREE from '../../vendor/three.module.js';
import * as RR from './rules.js';

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

function canvas(w, h, paint) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (g && typeof g.fillRect === 'function') paint(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function numberTex(n, fin = false) {
  return canvas(128, 128, (g) => {
    if (typeof g.arc !== 'function') return;
    g.fillStyle = fin ? '#111' : '#ffd23f';
    g.strokeStyle = '#1b1030';
    g.lineWidth = 8;
    g.beginPath();
    g.arc(64, 64, 54, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    g.fillStyle = fin ? '#fff' : '#1b1030';
    g.font = `900 ${fin ? 34 : 68}px "Arial Black", Impact, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(fin ? 'FINISH' : String(n), 64, 68);
  });
}

export function checkerTex(rx = 4, ry = 1) {
  const t = canvas(256, 16, (g) => {
    for (let i = 0; i < 32; i++) {
      for (let j = 0; j < 2; j++) {
        g.fillStyle = (i + j) % 2 ? '#111111' : '#ffffff';
        g.fillRect(i * 8, j * 8, 8, 8);
      }
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx, ry);
  return t;
}

/** A banner's face: the number big, twice, on white — or "FINISH" on the chequers. */
function bannerTex(n, fin) {
  return canvas(512, 64, (g, w, h) => {
    if (fin) {
      for (let i = 0; i < 32; i++) for (let j = 0; j < 4; j++) {
        g.fillStyle = (i + j) % 2 ? '#111' : '#fff';
        g.fillRect(i * 16, j * 16, 16, 16);
      }
      g.fillStyle = 'rgba(17,17,17,0.85)';
      g.fillRect(170, 6, 172, 52);
    } else {
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#ff5a4f';
      g.fillRect(0, 0, w, 7);
      g.fillRect(0, h - 7, w, 7);
    }
    g.font = `900 ${fin ? 34 : 44}px "Arial Black", Impact, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = fin ? '#fff' : '#1b1030';
    if (fin) g.fillText('FINISH', w / 2, h / 2 + 2);
    else {
      g.fillText(String(n), w * 0.2, h / 2 + 2);
      g.fillText(String(n), w * 0.8, h / 2 + 2);
      g.font = '800 26px "Arial Black", Impact, sans-serif';
      g.fillText('GATE', w / 2, h / 2 + 2);
    }
  });
}

function helipadTex() {
  return canvas(128, 128, (g) => {
    if (typeof g.arc !== 'function') return;
    g.strokeStyle = '#ffffff';
    g.lineWidth = 9;
    g.beginPath();
    g.arc(64, 64, 54, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = '#ffd23f';
    g.fillRect(38, 34, 13, 60);
    g.fillRect(77, 34, 13, 60);
    g.fillRect(38, 58, 52, 12);
  });
}

const Z = new THREE.Vector3(0, 0, 1);

/**
 * Build a course into `group`. Returns the handle paintCourse() needs:
 * { course, frames, gates: [{ tint: [materials], pulse: object3D, fin }] }.
 */
export function buildCourse(course, group, heightAt) {
  if (!course || typeof document === 'undefined') return null;
  const frames = RR.ringFrames(heightAt, course);
  const n = frames.length;
  const view = { course, frames, gates: [] };
  const style = course.style || 'rings';
  const postMat = new THREE.MeshBasicMaterial({ color: 0xf2f2f2 });
  const stripeMat = new THREE.MeshBasicMaterial({ color: 0xff5a4f });
  const ground = (x, z) => Math.max(0, heightAt(x, z));

  frames.forEach((f, i) => {
    const fin = i === n - 1;
    const gate = { tint: [], pulse: null, fin, base: 0xffffff };
    if (style === 'rings' || style === 'hoops') {
      const hoop = style === 'hoops';
      const mat = new THREE.MeshBasicMaterial(fin ? { map: checkerTex(), toneMapped: false } : { color: 0xffffff, transparent: true, opacity: 0.7, toneMapped: false });
      const ring = new THREE.Mesh(new THREE.TorusGeometry(f.r, fin ? (hoop ? 1.3 : 2.4) : hoop ? 1.1 : 2.0, 10, 48), mat);
      ring.position.set(f.x, f.y, f.z);
      ring.quaternion.setFromUnitVectors(Z, new THREE.Vector3(f.nx, f.ny, f.nz));
      ring.name = `race-ring-${i + 1}`;
      group.add(ring);
      gate.tint.push(mat);
      gate.pulse = ring;
      // A striped pole down to the ground, so a ring in the sky says how high it is.
      const gy = ground(f.x, f.z);
      const h = Math.max(1, f.y - f.r - gy);
      const bands = Math.max(2, Math.round(h / (hoop ? 2 : 6)));
      for (let b = 0; b < bands; b++) {
        const seg = new THREE.Mesh(new THREE.CylinderGeometry(hoop ? 0.3 : 0.55, hoop ? 0.3 : 0.55, h / bands, 8), b % 2 ? stripeMat : postMat);
        seg.position.set(f.x, gy + (h / bands) * (b + 0.5), f.z);
        group.add(seg);
      }
      const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: numberTex(i + 1, fin), transparent: true, depthWrite: false }));
      label.position.set(f.x, f.y + f.r + (hoop ? 4 : 7), f.z);
      label.scale.setScalar(fin ? (hoop ? 7 : 11) : hoop ? 5.5 : 9);
      group.add(label);
    } else if (style === 'road') {
      const [a, b] = RR.gateEnds(f);
      const ya = ground(a.x, a.z);
      const yb = ground(b.x, b.z);
      const top = Math.max(ya, yb, ground(f.x, f.z)) + 6.5;
      for (const [p, y0] of [[a, ya], [b, yb]]) {
        const hgt = top + 0.8 - y0;
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, hgt, 8), postMat);
        post.position.set(p.x, y0 + hgt / 2, p.z);
        group.add(post);
      }
      const bmat = new THREE.MeshBasicMaterial({ map: bannerTex(i + 1, fin), side: THREE.DoubleSide, toneMapped: false });
      const banner = new THREE.Mesh(new THREE.PlaneGeometry(f.w * 2, 1.8), bmat);
      banner.position.set(f.x, top, f.z);
      // Facing the driver coming at it, so its number reads the right way round.
      banner.quaternion.setFromUnitVectors(Z, new THREE.Vector3(-f.nx, 0, -f.nz));
      banner.name = `race-gate-${i + 1}`;
      group.add(banner);
      gate.tint.push(bmat);
      gate.pulse = banner;
      // And a line across the road under it: chequered for the start and finish.
      const lmat = new THREE.MeshBasicMaterial(fin ? { map: checkerTex(6, 1), transparent: true, depthWrite: false } : { color: 0xffffff, transparent: true, opacity: 0.8, depthWrite: false });
      const line = new THREE.Mesh(new THREE.PlaneGeometry(fin ? 2.4 : 0.7, 11), lmat);
      line.rotation.x = -Math.PI / 2;
      // Thin along the way you drive, eleven metres across it.
      line.rotation.z = Math.PI / 2 - Math.atan2(f.nx, -f.nz);
      line.position.set(f.x, ground(f.x, f.z) + 0.12, f.z);
      group.add(line);
      if (!fin) gate.tint.push(lmat);
      const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: numberTex(i + 1, fin), transparent: true, depthWrite: false }));
      label.position.set(f.x, top + 3.4, f.z);
      label.scale.setScalar(fin ? 5.5 : 4.2);
      group.add(label);
    } else if (style === 'buoys') {
      const ends = RR.gateEnds(f);
      const bmat = new THREE.MeshBasicMaterial(fin ? { map: checkerTex(2, 2), toneMapped: false } : { color: 0xff8a1f, toneMapped: false });
      // Big — a kid sees them from the harbour mouth.
      const buoyGeo = new THREE.CylinderGeometry(1.9, 2.3, 3.4, 14);
      const capGeo = new THREE.ConeGeometry(1.9, 2.4, 14);
      for (const p of ends) {
        const buoy = new THREE.Group();
        const body = new THREE.Mesh(buoyGeo, bmat);
        body.position.y = 1.0;
        const cap = new THREE.Mesh(capGeo, bmat);
        cap.position.y = 3.9;
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 4.5, 6), postMat);
        pole.position.y = 6.6;
        buoy.add(body, cap, pole);
        buoy.position.set(p.x, 0, p.z);
        buoy.userData.bob = Math.random() * 6;
        buoy.name = `race-buoy-${i + 1}`;
        group.add(buoy);
        (view.bobbers || (view.bobbers = [])).push(buoy);
      }
      gate.tint.push(bmat);
      const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: numberTex(i + 1, fin), transparent: true, depthWrite: false }));
      label.position.set(f.x, 10, f.z);
      label.scale.setScalar(fin ? 10 : 8);
      group.add(label);
      gate.pulse = label;
      gate.pulseBase = fin ? 10 : 8;
    }
    gate.base = fin ? 0xffffff : style === 'buoys' ? 0xff8a1f : 0xffffff;
    view.gates.push(gate);
  });

  // The start grid.
  const boxMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false });
  if (style === 'rings') {
    // The grid, painted on the runway: a white box for each place (as it always was).
    for (let i = 0; i < 8; i++) {
      const s = RR.gridSlot(i, course);
      const y = ground(s.x, s.z) + 0.08;
      for (const [dx, dz, w, l] of [[0, -3, 7, 0.4], [0, 3, 7, 0.4], [-3.5, 0, 0.4, 6.4]]) {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(w, l), boxMat);
        m.rotation.x = -Math.PI / 2;
        m.position.set(s.x + dx, y, s.z + dz);
        group.add(m);
      }
    }
  }
  if (style === 'road') {
    for (let i = 0; i < 8; i++) {
      const s = RR.gridSlot(i, course);
      const y = ground(s.x, s.z) + 0.12;
      const h = (s.heading * Math.PI) / 180;
      const fx = Math.sin(h);
      const fz = -Math.cos(h);
      const L = 2.4;
      const W = 1.2;
      // Two lines across (front and back) and one down the side: an open box, as painted on a real grid.
      // A plane turned by -h lies with its width across the road and its length along it.
      for (const [du, dv, w, l] of [[L, 0, W * 2, 0.3], [-L, 0, W * 2, 0.3], [0, -W, 0.3, L * 2 + 0.3]]) {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(w, l), boxMat);
        m.rotation.x = -Math.PI / 2;
        m.rotation.z = -h;
        m.position.set(s.x + fx * du - fz * dv, y, s.z + fz * du + fx * dv);
        group.add(m);
      }
    }
  }
  if (style === 'rings') {
    const line = new THREE.Mesh(new THREE.PlaneGeometry(2.5, 30), new THREE.MeshBasicMaterial({ map: checkerTex(), transparent: true, depthWrite: false }));
    line.rotation.x = -Math.PI / 2;
    line.position.set(course.grid.x + 12, ground(course.grid.x + 12, 0) + 0.1, course.grid.z);
    group.add(line);
  }
  if (style === 'hoops') {
    const padMat = new THREE.MeshBasicMaterial({ map: helipadTex(), transparent: true, depthWrite: false });
    for (let i = 0; i < 8; i++) {
      const s = RR.gridSlot(i, course);
      const pad = new THREE.Mesh(new THREE.PlaneGeometry(9, 9), padMat);
      pad.rotation.x = -Math.PI / 2;
      pad.rotation.z = -(s.heading * Math.PI) / 180;
      pad.position.set(s.x, ground(s.x, s.z) + 0.12, s.z);
      group.add(pad);
    }
  }
  return view;
}

/** Next gate yellow and breathing, the one after blue, the rest white; passed ones faint. */
export function paintCourse(view, k, racing, dt = 0) {
  if (!view || !view.gates.length) return;
  const n = view.gates.length;
  const t = now() / 1000;
  const course = view.course;
  const next = racing ? RR.ringOf(k, course) : -1;
  const lapPassed = racing ? k % n : 0;
  const buoys = course.style === 'buoys';
  for (let i = 0; i < n; i++) {
    const g = view.gates[i];
    let colour = g.base;
    let opacity = racing ? 0.45 : 0.7;
    let scale = 1;
    if (i === next) {
      colour = 0xffd23f;
      opacity = 1;
      scale = 1 + 0.06 * Math.sin(t * 6);
    } else if (racing && i === (next + 1) % n) {
      colour = 0x58c6ff;
      opacity = 0.85;
    } else if (racing && i < lapPassed) {
      colour = 0x9dff7a;
      opacity = 0.25;
    }
    for (const m of g.tint) {
      if (g.fin && !m.map) continue;
      if (g.fin) {
        // The chequers: tinted yellow when they are next, plain otherwise.
        m.color.setHex(i === next ? 0xffd23f : 0xffffff);
        continue;
      }
      m.color.setHex(colour);
      if (m.transparent) m.opacity = buoys ? 1 : opacity;
    }
    if (g.pulse) {
      if (g.pulseBase) g.pulse.scale.setScalar(g.pulseBase * scale);
      else g.pulse.scale.setScalar(scale);
    }
  }
  if (view.bobbers) {
    for (const b of view.bobbers) b.position.y = Math.sin(t * 1.6 + b.userData.bob) * 0.25 - 0.3;
  }
}

/**
 * The gates on a minimap: `toXY(x, z)` → [px, py, offTheEdge]. A ring is a
 * circle; a gate across a road or between buoys is a short bar. The next one
 * is yellow and big, and is pinned to the rim when it is off the edge.
 */
export function drawGates(g, toXY, view, next, scale = 1) {
  if (!view) return;
  view.frames.forEach((f, i) => {
    const [x, y, off] = toXY(f.x, f.z);
    if (off && i !== next) return;
    const hot = i === next;
    g.lineWidth = (hot ? 4 : 2.5) * scale;
    g.strokeStyle = hot ? '#ffd23f' : 'rgba(255,255,255,0.8)';
    g.fillStyle = 'rgba(8, 13, 22, 0.55)';
    if (f.shape === 'gate' && !off) {
      const [a, b] = RR.gateEnds(f);
      const [ax, ay] = toXY(a.x, a.z);
      const [bx, by] = toXY(b.x, b.z);
      // At least a few pixels long, however far out the map is zoomed.
      const dx = bx - ax;
      const dy = by - ay;
      const l = Math.hypot(dx, dy) || 1;
      const want = Math.max(l, (hot ? 14 : 10) * scale);
      const ux = (dx / l) * want * 0.5;
      const uy = (dy / l) * want * 0.5;
      g.lineCap = 'round';
      g.lineWidth = (hot ? 7 : 5) * scale;
      g.strokeStyle = 'rgba(8, 13, 22, 0.75)';
      g.beginPath();
      g.moveTo(x - ux, y - uy);
      g.lineTo(x + ux, y + uy);
      g.stroke();
      g.lineWidth = (hot ? 4 : 2.5) * scale;
      g.strokeStyle = hot ? '#ffd23f' : 'rgba(255,255,255,0.85)';
      g.beginPath();
      g.moveTo(x - ux, y - uy);
      g.lineTo(x + ux, y + uy);
      g.stroke();
      return;
    }
    g.beginPath();
    g.arc(x, y, (hot ? 9 : 6) * scale, 0, Math.PI * 2);
    g.fill();
    g.stroke();
  });
}
