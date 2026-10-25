/**
 * The moving parts a real aeroplane has that the pack's airframes did not —
 * added to every pack-drawn type in one place, from the same wing, body,
 * gear and engine numbers the airframe itself was lofted from, so nothing
 * here has to be drawn twice or kept in step by hand.
 *
 *   spoilers    panels on the upper wing over the flap span, hinged at their
 *               front edge along the (swept) hinge line. Ground spoilers come
 *               up on touchdown with the thrust levers at idle, as the real
 *               auto-spoilers do; in the air the brakes are the speedbrake
 *               and raise them halfway.
 *   slats       the leading edge over most of the span, a shell that rides
 *               forward and down and droops as the flaps go out (slats come
 *               out at the first flap stage).
 *   Fowler flaps the pack's flaps rotate; an airliner's also run aft and down
 *               on their tracks. Added as a translation on the same nodes.
 *   bay doors   the doors over the wheel wells, hinged at the bay's edge:
 *               open while the leg is moving, shut when it is stowed and shut
 *               again once it is down and locked, the way a transport's
 *               forward doors do (the leg doors that hang beside the strut
 *               are drawn by the airframes already).
 *   reversers   the translating sleeve on a turbofan, sliding aft to uncover
 *               the cascade: on the ground, fast, with the brakes on; stowed
 *               again below taxi speed. Only engines that are turbofans with a
 *               fan cowl (the airliner kit's).
 *   wheels      spin at the ground speed, and wind down on their own in the
 *               air instead of stopping dead at lift-off.
 *   heat haze   a faint rippling haze behind each jet nozzle under power —
 *               High and Ultra only (a draw call an engine), never a flash.
 *
 * Everything is a THREE.Group with one mesh in it, so the core's static
 * batching (which merges meshes inside a group and never across groups)
 * leaves each one a hinge of its own: one draw call per moving part.
 * Triangles per type: about 100 for the slats, 12 for the spoilers, 48 for
 * the doors, 40 per reverser, 4 per haze.
 *
 * Driven by the pack's own `state` (aircraft-game-bridge.js): rpm, gear,
 * flaps, brakes, throttle, onGround, groundSpeed, airspeed. The hooks for the
 * tests are on the finished model: `userData.realism` lists every node.
 */
import * as THREE from '../vendor/three.module.js';
import { highQuality } from '../aircraft/model-quality.js';
import { seatDoorsOnSkin } from '../aircraft/bay-door-seat.js';

const clamp = THREE.MathUtils.clamp;
const mix = (a, b, t) => a + (b - a) * t;
const X = new THREE.Vector3(1, 0, 0);
const QT = new THREE.Quaternion();

/**
 * Turn a hinge group about its OWN local X (the hinge line) by `angle` from
 * its rest orientation. Not rotation.x: on a group whose rest quaternion
 * lines its X up with a swept, dihedralled hinge, the Euler's x is a turn
 * about the PARENT's X, which swings the hinge line itself — an A380's
 * outboard slat rose five and a half metres off the wing that way.
 */
function turnHinge(node, rest, angle) {
  node.quaternion.copy(rest).multiply(QT.setFromAxisAngle(X, angle));
}

/** NACA-style half thickness at chord fraction e, the pack's own formula (aircraft-core segment()). */
const halfThick = (thick, e) => 0.5 * thick * Math.max(0.045, 10 * (0.2969 * Math.sqrt(e) - 0.126 * e - 0.3516 * e * e + 0.2843 * e ** 3 - 0.1015 * e ** 4));

/** The wing at span fraction t: chord, leading edge z, mid y, thickness. */
function wingAt(w, t) {
  return {
    chord: mix(w.rootChord, w.tipChord, t),
    le: w.rootZ + (w.sweep || 0) * t,
    mid: w.rootY + (w.dihedral || 0) * t,
    thick: mix(w.thickness || 0.12, w.tipThickness || 0.045, t),
  };
}

/** A point on the wing surface (model metres): span fraction t, chord fraction e, +1 upper / -1 lower, lifted off the skin by `lift`. */
function wingPoint(w, side, t, e, face, lift = 0) {
  const a = wingAt(w, t);
  return new THREE.Vector3(side * (w.rootX + w.span * t), a.mid + face * (halfThick(a.thick, e) + lift), a.le + a.chord * e);
}

/**
 * A hinge along the wing: the straight line through the points at chord
 * fraction e from span t0 to t1 (straight because chord, sweep and dihedral
 * are all linear in t). Returns the group placed on it with its local X
 * along the line, and the inverse rotation to bake geometry into it.
 */
function hingeGroup(w, side, t0, t1, e, name, host, face = 0, lift = 0) {
  // On the mid-plane (a slat's leading edge), or on a face of the wing (a
  // spoiler hinges at its own front edge on the upper skin: a hinge in the
  // mid-plane swung that edge forward and into the wing as it rose).
  // Straight either way: the thickness is linear in t, and so is the skin.
  const p0 = wingPoint(w, side, t0, e, face || 1, lift);
  const p1 = wingPoint(w, side, t1, e, face || 1, lift);
  if (!face) {
    p0.y = wingAt(w, t0).mid;
    p1.y = wingAt(w, t1).mid;
  }
  const dir = p1.clone().sub(p0).normalize();
  const g = new THREE.Group();
  g.name = name;
  g.position.copy(p0).sub(host.offset);
  g.quaternion.setFromUnitVectors(X, dir);
  host.parent.add(g);
  return { g, inv: g.quaternion.clone().invert(), pivot: p0 };
}

/**
 * Where a wing's moving parts hang. Normally the wing section itself. A
 * swing wing (the B-1B, extra/lancer.js pinWing) has moved everything in the
 * section onto a pin at its pivot, which the sweep then turns: anything
 * added to the section afterwards would stay where it was drawn while the
 * wing swept away from under it — so it goes on the pin, in the pin's frame
 * (a translation only, at build).
 */
function wingHost(parts, side) {
  const wing = parts[side < 0 ? 'leftWing' : 'rightWing'];
  if (!wing) return null;
  const pin = wing.children.find((c) => c.isGroup && /wing pivot$/i.test(c.name));
  return pin ? { parent: pin, offset: pin.position.clone() } : { parent: wing, offset: new THREE.Vector3() };
}

/** A surface patch in the hinge's frame: rows of chord fractions, columns of span fractions, one face of the wing. */
function patchGeometry(w, side, ts, es, face, lift, hinge) {
  const cols = ts.length;
  const rows = es.length;
  const pos = [];
  const uv = [];
  const idx = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const p = wingPoint(w, side, ts[c], es[r], face, lift).sub(hinge.pivot).applyQuaternion(hinge.inv);
    pos.push(p.x, p.y, p.z);
    uv.push(c / (cols - 1), r / (rows - 1));
  }
  for (let r = 0; r < rows - 1; r++) for (let c = 0; c < cols - 1; c++) {
    const a = r * cols + c;
    const b = a + 1;
    const d = a + cols;
    const e = d + 1;
    // Wound so the face's normal points out of the wing (upper faces up); the port side is mirrored in x.
    if ((face > 0) === (side > 0)) idx.push(a, d, b, b, d, e);
    else idx.push(a, b, d, b, e, d);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

const range = (a, b, n) => Array.from({ length: n }, (_, i) => mix(a, b, i / (n - 1)));

/** The pack's body profile at z: [half width, half height, centre y]. */
function profileOf(body) {
  return (z) => {
    let k = 0;
    while (k < body.length - 2 && body[k + 1][0] < z) k++;
    const a = body[k];
    const b = body[k + 1];
    const t = clamp((z - a[0]) / (b[0] - a[0]), 0, 1);
    return [mix(a[1], b[1], t), mix(a[2], b[2], t), mix(a[3] || 0, b[3] || 0, t)];
  };
}

/** Types whose real wing has no leading-edge slats (the Dash 8's is plain; Concorde's is an ogee). */
const NO_SLATS = new Set(['q400', 'concorde', 'massimo']);
/**
 * Kinds that carry wing spoilers and slats at all: the fighters' speedbrakes
 * are not on the wing, and the B-1B's swing wing (kind 'bomber') is drawn by
 * extra/lancer.js to its own planform, narrower than the core's, so devices
 * laid out from the core's numbers would stand past its swept tip.
 */
const WING_DEVICES = new Set(['airliner', 'transport']);

/* ------------------------------------------------------------------ *
 * Heat haze
 * ------------------------------------------------------------------ */

/** The haze group's scale when it is off: as good as nothing, never exactly zero (a zero scale makes a singular matrix). */
const HAZE_OFF = 1e-4;

const HAZE_VERT = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const HAZE_FRAG = `
  uniform float t; uniform float k; varying vec2 vUv;
  void main(){
    // Ripples drifting aft (+v), fading along the plume and at its sides; never a flash: k ramps with the power setting.
    float w = sin(vUv.y * 34.0 - t * 9.0 + sin(vUv.x * 19.0 + t * 4.0) * 1.6) * 0.5 + 0.5;
    float edge = smoothstep(0.0, 0.25, vUv.x) * smoothstep(1.0, 0.75, vUv.x);
    float a = w * (1.0 - vUv.y) * (1.0 - vUv.y) * edge * k * 0.14;
    if (a < 0.003) discard;
    gl_FragColor = vec4(0.86, 0.88, 0.9, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

function hazeMaterial(model) {
  const m = new THREE.ShaderMaterial({
    uniforms: { t: { value: 0 }, k: { value: 0 } },
    vertexShader: HAZE_VERT,
    fragmentShader: HAZE_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    // Not read by the shader; it is what the break-up's survey reads to tell an effect from airframe (game/breakup-mesh.js isEffect).
    opacity: 0.2,
  });
  m.name = 'Aircraft_heat_haze';
  return model.userData.ownMaterial(m);
}

/* ------------------------------------------------------------------ *
 * The layer
 * ------------------------------------------------------------------ */

/**
 * @param ctx   the decorator context aircraft-core hands its decorators
 * @param rig   { wheels, engines, controlNodes } — the core's own lists
 * @returns     what was added, by node, for userData.realism
 */
export function applyRealism(ctx, rig) {
  const { model, config: c, materials, parts, registerAnimation } = ctx;
  const out = { spoilers: [], slats: [], fowler: [], bayDoors: [], reversers: [], haze: [], wheels: [] };
  const own = (geo) => model.userData.ownGeometry(geo);
  const dyn = (name, geo, mat, parent) => {
    const m = new THREE.Mesh(own(geo), mat);
    m.name = name;
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  };
  const w = c.wing;
  const kind = c.kind || 'light';
  const devices = !!w && w.flaps !== false && WING_DEVICES.has(kind);
  const span2 = w ? 2 * (w.rootX + w.span) : 0;

  /* ---- spoilers ---- */
  if (devices) {
    const mat = model.userData.ownMaterial(materials.wing.clone());
    mat.side = THREE.DoubleSide;
    mat.name = 'Aircraft_spoiler';
    const panels = span2 > 45 ? [[0.17, 0.3], [0.32, 0.45], [0.47, 0.57]] : [[0.17, 0.36], [0.38, 0.57]];
    for (const side of [-1, 1]) {
      const host = wingHost(parts, side);
      if (!host) continue;
      const h = hingeGroup(w, side, 0.17, 0.57, 0.6, side < 0 ? 'Port spoilers' : 'Starboard spoilers', host, 1, 0.012);
      for (const [t0, t1] of panels) dyn('Spoiler panel', patchGeometry(w, side, range(t0, t1, 2), [0.6, 0.755], 1, 0.012, h), mat, h.g);
      out.spoilers.push({ node: h.g, side, restQ: h.g.quaternion.clone(), angle: 0 });
    }
  }

  /* ---- slats ---- */
  if (devices && !NO_SLATS.has(c.id)) {
    for (const side of [-1, 1]) {
      const host = wingHost(parts, side);
      if (!host) continue;
      const t0 = 0.14;
      const t1 = 0.95;
      const h = hingeGroup(w, side, t0, t1, 0, side < 0 ? 'Port slats' : 'Starboard slats', host);
      const ts = range(t0, t1, 5);
      const es = [0, 0.03, 0.07, 0.13];
      const upper = patchGeometry(w, side, ts, es, 1, 0.012, h);
      const lower = patchGeometry(w, side, ts, es, -1, 0.012, h);
      // One mesh: the two faces share the material and the hinge.
      const merged = mergeTwo(upper, lower);
      upper.dispose();
      lower.dispose();
      dyn('Leading edge slat', merged, materials.wing, h.g);
      const mid = wingAt(w, (t0 + t1) / 2);
      // Forward and down. The group's position is in its parent's frame (the
      // wing section, or a swing wing's pin: model axes either way), so the
      // direction is in model axes too, not the hinge's own.
      const fwd = new THREE.Vector3(0, -0.4, -1).normalize();
      out.slats.push({ node: h.g, side, rest: h.g.position.clone(), restQ: h.g.quaternion.clone(), fwd, travel: mid.chord * 0.085, droop: 0.3, angle: 0 });
    }
  }

  /* ---- Fowler travel on the flaps ---- */
  if (devices) {
    const a = wingAt(w, 0.35);
    for (const [id, s] of Object.entries(rig.controlNodes || {})) {
      if (s.kind !== 'flap') continue;
      out.fowler.push({ node: s.node, rest: s.node.position.clone(), aft: a.chord * 0.1, down: a.chord * 0.03 });
    }
  }

  /* ---- bay doors ---- */
  const gearSpec = c.gear;
  if (gearSpec && gearSpec.retractable && Array.isArray(rig.wheels)) {
    const profile = profileOf(c.body);
    const n = c.body.length;
    const cutZ = c.body[Math.max(1, Math.min(n - 3, Math.round(n * 0.2)))][0];
    const doorMat = materials.skin;
    for (const leg of rig.wheels) {
      const at = leg.node.position;
      const r = leg.radius;
      const [, ry, cy] = profile(at.z);
      let y = cy - ry;
      if (w && Math.abs(at.x) > w.rootX) {
        const a = wingAt(w, clamp((Math.abs(at.x) - w.rootX) / w.span, 0, 1));
        y = Math.min(y, a.mid - halfThick(a.thick, 0.4));
      }
      y = Math.min(y, at.y) - 0.02;
      const parent = (!leg.side && at.z < cutZ && parts.nose) || parts.fuselage || model;
      const len = leg.side ? Math.max(r * 2.6, Math.abs(leg.rel[2]) + r * 2) : r * 4 + 0.3;
      if (!leg.side) {
        // Two doors, hinged at the bay's edges, swinging down and out.
        const hw = r * 1.05;
        for (const s of [-1, 1]) {
          const g = new THREE.Group();
          g.name = s < 0 ? 'Nose bay door (port)' : 'Nose bay door (starboard)';
          g.position.set(at.x + s * hw, y, at.z + r * 0.4);
          parent.add(g);
          const geo = new THREE.BoxGeometry(hw, 0.03, len);
          geo.translate(-s * hw * 0.5, 0, 0);
          dyn('Bay door', geo, doorMat, g);
          out.bayDoors.push({ node: g, sign: -s, leg: leg.id });
        }
      } else {
        // One door on the outboard edge of the well, swinging down.
        const hw = r * 1.9;
        const g = new THREE.Group();
        g.name = leg.side < 0 ? 'Port main bay door' : 'Starboard main bay door';
        g.position.set(at.x + leg.side * hw * 0.5, y, at.z + leg.rel[2] * 0.5);
        parent.add(g);
        const geo = new THREE.BoxGeometry(hw, 0.03, len);
        geo.translate(-leg.side * hw * 0.5, 0, 0);
        dyn('Bay door', geo, doorMat, g);
        out.bayDoors.push({ node: g, sign: leg.side, leg: leg.id });
      }
    }
    // Onto the skin that is really there (see bay-door-seat.js): the gear, the doors and the wing devices are not skin.
    const notSkin = new Set();
    for (const leg of rig.wheels) leg.node.traverse((o) => notSkin.add(o));
    for (const list of [out.bayDoors, out.spoilers, out.slats]) for (const d of list) d.node.traverse((o) => notSkin.add(o));
    seatDoorsOnSkin(model, out.bayDoors.map((d) => ({ obj: d.node })), (o) => notSkin.has(o) || !!(o.material && o.material.transparent));
  }

  /* ---- thrust reversers ---- */
  if (kind === 'airliner' && Array.isArray(rig.engines)) {
    for (const e of rig.engines) {
      const cfg = e.config;
      if (cfg.kind !== 'jet' || cfg.buried) continue;
      const cowl = e.node.children.find((m) => m.name === 'Fan cowl');
      if (!cowl) continue;
      const R = cfg.radius;
      const L = cfg.length;
      const zf = cfg.z - L / 2;
      // The cascade, dark, a touch proud of the cowl, where the sleeve covers it when stowed.
      const cascade = new THREE.CylinderGeometry(R * 0.985, R * 0.95, L * 0.13, 14, 1, true);
      cascade.rotateX(Math.PI / 2);
      cascade.translate(cfg.x, cfg.y, zf + L * 0.505);
      // In a group of its own (one draw call, and only while it shows): with the sleeve hidden at rest, a dark band left on the cowl would be a stripe on every engine.
      const cg = new THREE.Group();
      cg.name = 'Reverser cascade';
      e.node.add(cg);
      const cas = dyn('Reverser cascade', cascade, materials.dark, cg);
      cas.castShadow = false;
      // The sleeve: the aft part of the fan cowl, 3% proud of it, sliding aft on its tracks.
      const g = new THREE.Group();
      g.name = 'Reverser sleeve';
      e.node.add(g);
      const sleeve = new THREE.CylinderGeometry(R * 1.005, R * 0.9, L * 0.27, 14, 1, true);
      sleeve.rotateX(Math.PI / 2);
      sleeve.translate(cfg.x, cfg.y, zf + L * 0.575);
      // The cowl's skin runs v along the cowl (airliner-kit turbofan: lip 0.04 L
      // to nozzle 0.7 L); the sleeve takes the same v for its z, so it carries
      // on the cowl's paint (no ring of its own, the grime at the back).
      {
        const sp = sleeve.attributes.position;
        const su = sleeve.attributes.uv;
        for (let i = 0; i < su.count; i++) su.setY(i, Math.min(1, Math.max(0, (sp.getZ(i) - (zf + 0.04 * L)) / (0.66 * L))));
      }
      dyn('Reverser sleeve skin', sleeve, cowl.material, g);
      out.reversers.push({ node: g, cascade: cg, travel: L * 0.16 });
    }
  }

  /* ---- heat haze: every nozzle's plume in ONE mesh (one draw call for the whole aeroplane) ---- */
  if (highQuality() && Array.isArray(rig.engines)) {
    const quads = [];
    for (const e of rig.engines) {
      const cfg = e.config;
      if (cfg.kind !== 'jet') continue;
      const R = cfg.radius || 0.5;
      const L = cfg.length || 2;
      const z0 = cfg.z + L * (cfg.buried ? 0.5 : 0.62);
      const len = R * 5;
      // Two crossed quads along the plume: the v axis runs aft.
      const a = new THREE.PlaneGeometry(R * 1.6, len);
      a.rotateX(-Math.PI / 2);
      a.translate(0, 0, len / 2);
      const b = a.clone();
      b.rotateZ(Math.PI / 2);
      for (const q of [a, b]) {
        q.translate(cfg.x, cfg.y, z0);
        quads.push(q);
      }
    }
    if (quads.length) {
      const mat = hazeMaterial(model);
      let geo = quads[0];
      for (let i = 1; i < quads.length; i++) geo = mergeTwo(geo, quads[i]);
      const g = new THREE.Group();
      g.name = 'Heat haze';
      // Built shrunk to nothing: the core measures the airframe's bounds (the
      // nose and tail strike points) after this layer, and a five-metre plume
      // behind the nozzles is not airframe. Scaled up only under power.
      g.scale.setScalar(HAZE_OFF);
      model.add(g);
      const m = dyn('Heat haze', geo, mat, g);
      m.castShadow = false;
      m.receiveShadow = false;
      m.userData.effect = true;
      out.haze.push({ node: g, mat, engines: quads.length / 2 });
    }
  }

  /*
   * At rest every one of these lies on the skin it was drawn from (a shut
   * door under the belly, a flat spoiler, a stowed slat or sleeve) and adds
   * nothing to the picture but a draw call: so it is hidden until it moves,
   * and the parked airliners on the apron and the traffic, which build the
   * same models, pay for none of them. The animation shows each part only
   * while it is out (below).
   */
  for (const list of [out.spoilers, out.slats, out.bayDoors, out.reversers]) for (const d of list) d.node.visible = false;
  for (const r of out.reversers) r.cascade.visible = false;

  /* ---- wheels: their own spin ---- */
  for (const leg of rig.wheels || []) out.wheels.push({ leg, omega: 0 });

  /* ---- drive it all ---- */
  const st = { spoiler: 0, reverser: 0, airborneT: 0, groundT: 0, time: 0 };
  registerAnimation((dt, state) => {
    st.time += dt;
    const k = 1 - Math.exp(-dt * 12);
    const flaps = clamp(state.flaps || 0, 0, 1);
    const gear = clamp(state.gear ?? 1, 0, 1);
    const onGround = !!state.onGround;
    const gs = state.groundSpeed || 0;
    const brakes = clamp(state.brakes || 0, 0, 1);
    const throttle = clamp(state.throttle ?? 0, 0, 1);
    const rpm = clamp(state.rpm || 0, 0, 1);
    if (onGround) {
      st.groundT += dt;
      st.airborneT = 0;
    } else {
      st.airborneT += dt;
      st.groundT = 0;
    }

    // Spoilers: ground spoilers full on a landing roll with the levers at idle; the brakes are the speedbrake in the air.
    let wantSp = 0;
    if (onGround && gs > 18 && throttle < 0.3) wantSp = 1;
    else if (!onGround && brakes > 0.2 && st.airborneT > 1) wantSp = 0.5;
    const spRate = wantSp > st.spoiler ? 0.8 : 1.2;
    st.spoiler += clamp(wantSp - st.spoiler, -spRate * dt, spRate * dt);
    for (const s of out.spoilers) {
      s.angle = -s.side * st.spoiler * 0.85;
      turnHinge(s.node, s.restQ, s.angle);
      s.node.visible = st.spoiler > 1e-3;
    }

    // Slats ride out with the first stage of flap.
    const slat = clamp(flaps * 1.6, 0, 1);
    for (const s of out.slats) {
      s.node.position.copy(s.rest).addScaledVector(s.fwd, s.travel * slat);
      s.angle = -s.side * s.droop * slat;
      turnHinge(s.node, s.restQ, s.angle);
      s.node.visible = slat > 1e-3;
    }
    // Fowler flaps: aft and down on their tracks (the pack rotates them; this is the rest of the motion).
    for (const f of out.fowler) f.node.position.set(f.rest.x, f.rest.y - f.down * flaps, f.rest.z + f.aft * flaps);

    // Bay doors: open while the leg travels, shut at both ends.
    const doorOpen = clamp(Math.min(gear, 1 - gear) * 8, 0, 1);
    for (const d of out.bayDoors) {
      d.node.rotation.z = mix(d.node.rotation.z, d.sign * doorOpen * 1.45, k);
      d.node.visible = Math.abs(d.node.rotation.z) > 0.01;
    }

    // Reversers: out on the roll with the brakes on, back in below taxi speed.
    let wantRev = st.reverser;
    if (onGround && gs > 25 && brakes > 0.25) wantRev = 1;
    if (!onGround || gs < 17 || brakes < 0.05) wantRev = 0;
    st.reverser += clamp(wantRev - st.reverser, -dt / 1.2, dt / 1.2);
    for (const r of out.reversers) {
      r.node.position.z = r.travel * st.reverser;
      r.node.visible = st.reverser > 1e-3;
      r.cascade.visible = r.node.visible;
    }

    // Heat haze: with power, never in a flash; off below High.
    const hi = highQuality();
    for (const h of out.haze) {
      const show = hi && rpm > 0.3;
      h.node.visible = show;
      h.node.scale.setScalar(show ? 1 : HAZE_OFF);
      h.mat.uniforms.t.value = st.time;
      h.mat.uniforms.k.value = clamp((rpm - 0.3) / 0.7, 0, 1);
    }

    // Wheels: at the ground speed on the ground, winding down in the air (the pack stopped them dead).
    for (const q of out.wheels) {
      const r = Math.max(0.08, q.leg.radius);
      if (onGround) q.omega = gs / r;
      else q.omega *= Math.exp(-dt / 3.5);
      if (q.omega > 0.01 && !onGround) q.leg.wheel.rotation.x += q.omega * dt;
    }
  });

  return out;
}

/** Two indexed geometries with position/uv into one. */
function mergeTwo(a, b) {
  const pa = a.attributes.position;
  const pb = b.attributes.position;
  const pos = new Float32Array((pa.count + pb.count) * 3);
  pos.set(pa.array, 0);
  pos.set(pb.array, pa.count * 3);
  const uv = new Float32Array((pa.count + pb.count) * 2);
  if (a.attributes.uv) uv.set(a.attributes.uv.array, 0);
  if (b.attributes.uv) uv.set(b.attributes.uv.array, pa.count * 2);
  const ia = a.index ? Array.from(a.index.array) : Array.from({ length: pa.count }, (_, i) => i);
  const ib = b.index ? Array.from(b.index.array) : Array.from({ length: pb.count }, (_, i) => i);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex([...ia, ...ib.map((i) => i + pa.count)]);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Compile the materials of the parts that are hidden at rest (this layer's,
 * or the civil builder's: userData.parts), while they are shown for the
 * compile: renderer.compile only sees what is visible, and a part first
 * drawn on the landing roll (a spoiler's double-sided material) or revealed
 * by a crash would compile its program on that very frame — the hitch the
 * crash-freeze check counts. Called with the crash's own warm-up
 * (features/breakup.js warmShaders), on the flight's first frame.
 */
export function warmHiddenParts(renderer, model, camera, scene) {
  const u = model && model.userData;
  if (!u || !renderer || typeof renderer.compile !== 'function') return 0;
  const nodes = [];
  const R = u.realism;
  if (R) {
    for (const k of ['spoilers', 'slats', 'bayDoors', 'reversers', 'haze']) for (const d of R[k] || []) nodes.push(d.node);
    for (const r of R.reversers || []) if (r.cascade) nodes.push(r.cascade);
  }
  const P = u.parts;
  if (P) for (const k of ['spoilers', 'bayDoors', 'reversers']) for (const d of P[k] || []) if (d && d.obj) nodes.push(d.obj);
  if (!nodes.length) return 0;
  const was = nodes.map((n) => n.visible);
  for (const n of nodes) n.visible = true;
  try {
    for (const n of nodes) renderer.compile(n, camera, scene);
  } finally {
    nodes.forEach((n, i) => {
      n.visible = was[i];
    });
  }
  return nodes.length;
}
