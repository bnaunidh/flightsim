/**
 * BREAK POINTS — where an aircraft comes apart, and how much of it does.
 *
 * The owner (2026-10-04): "add break points to all plane models, so if you
 * crash those parts break, depending on how close they are to which part
 * are crashed".
 *
 * This file is the pure part — no scene, no DOM — so tests/features/
 * breakup.mjs runs all of it in node:
 *
 *   ZONES          the break zones and how strong each is
 *   frameFor(type, config?)
 *                  where things are on THIS aircraft, in body metres (-Z
 *                  forward, +Y up, +X right, origin on the flight model's
 *                  centre of gravity — the frame its gear and strike points
 *                  are in). From the type's own `shape` (scaled the way the
 *                  drawing is scaled, including the airliners' z-convention)
 *                  or, for a model the fleet pack draws, from that model's
 *                  own build config, which is what was actually drawn.
 *   refineFrame(frame, survey)
 *                  the same, corrected against the drawn meshes themselves
 *                  (src/game/breakup-mesh.js surveys them): the real nose and
 *                  tail, the real fuselage width station by station, the real
 *                  fin, rotor and gear — so a drawing and a description that
 *                  disagree cannot put the wing tip in the fuselage zone.
 *   layoutFor(frame)
 *                  the zones that exist on it, the tree they hang in (an
 *                  outer wing hangs on the inner, a fin on the rear fuselage)
 *                  and classify(x, y, z, hint): which zone a point is in.
 *                  breakup-mesh.js runs every triangle of every mesh through
 *                  it (centroid), which is what makes this work for the
 *                  procedural models and the Blender ones alike without
 *                  touching a single model builder.
 *   planBreak(layout, hit, boxes)
 *                  an impact -> what happens to each zone. The zone nearest
 *                  the contact takes the whole blow; the others take less
 *                  the further they are from it, over a reach that grows with
 *                  the energy. How hard is the closing speed at the point
 *                  that touched (and a little of the scrape), so a wing tip
 *                  clipping the grass snaps the outer wing and nothing else,
 *                  a belly landing folds the gear, a nose-first dive crushes
 *                  the nose and can break the fuselage, and a big enough hit
 *                  takes everything. The blow travels through the airframe;
 *                  the scrape only grinds what is down on the surface beside
 *                  the contact (a fast wheels-up landing scrapes the belly,
 *                  it does not snap the fin off).
 *   lostFrom(layout, plan)
 *                  the pieces that came off, as the flight model's `lost`
 *                  record (../aircraft/damage-handling.js reads it).
 *
 * SCHOOL-SAFE: nothing here ever breaks a person. T-Pose Harrison is a man
 * flying in a T-pose; he has zones like any aircraft (so he can be hit in
 * the "wing" and steer on it) but every one is `soft` — his arms and legs
 * never come off and never bend. He gets a dusting and dizzy stars instead
 * (src/features/breakup.js). The cockpit is in the core, which never comes
 * away: whoever flies it walks away (or parachutes, in the sky).
 */

/* ------------------------------------------------------------------ *
 * The zones
 * ------------------------------------------------------------------ */

/**
 * Strength in J/kg of closing energy at the zone (see planBreak).
 *   bend     above this the zone is bent (a wing tip up, a fin over, a prop
 *            curled back, the nose crushed)
 *   detach   above this it comes off as a piece of its own
 *   fold     gear only: the legs fold up under the belly
 * `survivable` zones can come off and leave an aeroplane you can still fly
 * (with the damage model on); the rest only ever come off in a crash.
 */
export const ZONES = {
  nose: { label: 'Nose and cockpit section', kind: 'body', bend: 8, detach: 140, survivable: false },
  core: { label: 'Centre fuselage', kind: 'body', bend: 45, detach: Infinity, survivable: false },
  rear: { label: 'Rear fuselage', kind: 'body', bend: 25, detach: 160, survivable: false },
  wingInnerL: { label: 'Left wing, inner', kind: 'wing', side: -1, bend: 18, detach: 70, fuel: true, survivable: false },
  wingOuterL: { label: 'Left wing, outer', kind: 'wing', side: -1, bend: 4, detach: 11, survivable: true },
  wingInnerR: { label: 'Right wing, inner', kind: 'wing', side: 1, bend: 18, detach: 70, fuel: true, survivable: false },
  wingOuterR: { label: 'Right wing, outer', kind: 'wing', side: 1, bend: 4, detach: 11, survivable: true },
  fin: { label: 'Tail fin', kind: 'tail', bend: 5, detach: 16, survivable: true },
  tailplaneL: { label: 'Left tailplane', kind: 'tail', side: -1, bend: 4, detach: 13, survivable: true },
  tailplaneR: { label: 'Right tailplane', kind: 'tail', side: 1, bend: 4, detach: 13, survivable: true },
  gearN: { label: 'Nose gear', kind: 'gear', fold: 4, detach: 45, survivable: true },
  gearL: { label: 'Left main gear', kind: 'gear', side: -1, fold: 4, detach: 45, survivable: true },
  gearR: { label: 'Right main gear', kind: 'gear', side: 1, fold: 4, detach: 45, survivable: true },
  engine: { label: 'Engine', kind: 'engine', bend: 1.5, detach: 40, engine: true, fuel: true, survivable: true },
  engineL: { label: 'Left engine', kind: 'engine', side: -1, bend: 1.5, detach: 40, engine: true, fuel: true, survivable: true },
  engineR: { label: 'Right engine', kind: 'engine', side: 1, bend: 1.5, detach: 40, engine: true, fuel: true, survivable: true },
  engineL1: { label: 'Left inner engine', kind: 'engine', side: -1, bend: 1.5, detach: 40, engine: true, fuel: true, survivable: true },
  engineL2: { label: 'Left outer engine', kind: 'engine', side: -1, bend: 1.5, detach: 40, engine: true, fuel: true, survivable: true },
  engineR1: { label: 'Right inner engine', kind: 'engine', side: 1, bend: 1.5, detach: 40, engine: true, fuel: true, survivable: true },
  engineR2: { label: 'Right outer engine', kind: 'engine', side: 1, bend: 1.5, detach: 40, engine: true, fuel: true, survivable: true },
  rotor: { label: 'Main rotor blades', kind: 'rotor', bend: 0.6, detach: 2.5, survivable: false },
  tailRotor: { label: 'Tail rotor', kind: 'rotor', bend: 1, detach: 4, survivable: true },
  // Six-engined (the An-225, aircraft/extra/giants.js): the third each side.
  // Last, so every zone before keeps its index in ZONE_IDS.
  engineL3: { label: 'Left outermost engine', kind: 'engine', side: -1, bend: 1.5, detach: 40, engine: true, fuel: true, survivable: true },
  engineR3: { label: 'Right outermost engine', kind: 'engine', side: 1, bend: 1.5, detach: 40, engine: true, fuel: true, survivable: true },
};
export const ZONE_IDS = Object.keys(ZONES);
/** How much harder than its own strength a blow must reach a zone it only travelled to, to take it off (see planBreak). */
export const TRANSMIT = 1.8;
/** ...for a blow under this, J/kg, fading to none at it. */
export const TRANSMIT_FADE = 250;
/** The zone the airframe IS: it never comes off, everything else hangs on it. */
export const CORE = 'core';

/*
 * THE BEAMNG BAR (the owner, 2026-10-23: "metal bends/crumples progressively,
 * parts hang by threads before tearing, deformation persists"). Three things
 * make a break-up read as structure giving way rather than a model exploding:
 *
 *   ORDER     the zone that touched goes first; the blow runs on through the
 *             airframe at CRACK_SPEED metres a second, so a zone further from
 *             the contact lets go later (plan.delays, seconds after the hit).
 *   HANGING   a zone the blow nearly tore off — HANG.from of its strength and
 *             up — comes off its seam but stays on the airframe, swinging on
 *             what is left of its spar or pylon, and tears away a moment
 *             later (plan.hangs: HANG.tMin..HANG.tMax seconds, sooner the
 *             nearer it came to tearing at once). Only a BLOW hangs a part;
 *             a scrape grinds it (a 75 m/s belly slide leaves the tailplanes
 *             on). Only wings, tails and podded engines hang: a propeller
 *             bends, a leg folds, a fuselage section crushes or breaks.
 *   MODE      where it hit and how steeply (classifyImpact) tunes the plan a
 *             little — nose-in breaks the forward fuselage at the cockpit
 *             seam, a tail strike the tail cone, a wing caught hard tears at
 *             the root — and tells features/breakup.js what the airframe does
 *             next (cartwheel, belly slide, nose-over, skip off the water).
 */
export const CRACK_SPEED = 60;
export const DELAY_MAX = 0.45;
export const HANG = { from: 0.55, blowShare: 0.5, tMin: 0.3, tMax: 1.6 };
/** Per-mode strength scaling of the seam the mode is about (the zone that touched). */
export const MODE_TUNE = {
  nose: { nose: 0.7 },
  tail: { rear: 0.75 },
  wingtip: { root: 0.7, rootFrom: 60 },
};

/** A small seeded random (0..1): the same seed gives the same crash, so a replay's crash is the recording's crash. */
export function rng(seed) {
  let a = (Number(seed) || 0) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const fin = (v) => typeof v === 'number' && Number.isFinite(v);

/* ------------------------------------------------------------------ *
 * The frame: where things are, in body metres
 * ------------------------------------------------------------------ */

/** The legacy model's lathe (model.js), radius x bodyRadius, z x bodyLength. */
const LATHE = [
  [0.05, -2.55], [0.3, -2.42], [0.5, -2.15], [0.62, -1.7], [0.7, -1.1], [0.76, -0.3], [0.78, 0.45],
  [0.75, 1.15], [0.66, 1.95], [0.52, 2.7], [0.34, 3.35], [0.18, 3.85], [0.05, 3.95],
];

function profileFrom(stations) {
  // stations: [{ z, w, top, bot }] sorted by z
  const st = stations.filter((s) => fin(s.z) && fin(s.w)).sort((a, b) => a.z - b.z);
  return st.length ? st : [{ z: 0, w: 0.6, top: 0.6, bot: -0.6 }];
}

/**
 * Body half-width, top and bottom at a station, linearly between the
 * stations. Returns a SCRATCH object (classify() calls this for every
 * triangle, and allocating one each time is what made breaking up a big
 * model stutter): read it straight away, or copy it.
 */
const BODY = { z: 0, w: 0, top: 0, bot: 0 };
export function bodyAt(frame, z) {
  const st = frame.profile;
  let a = st[0];
  let b = st[0];
  let t = 0;
  if (z > st[0].z) {
    const last = st[st.length - 1];
    if (z >= last.z) a = b = last;
    else {
      for (let i = 1; i < st.length; i++) {
        if (z <= st[i].z) {
          a = st[i - 1];
          b = st[i];
          t = (z - a.z) / (b.z - a.z || 1);
          break;
        }
      }
    }
  }
  BODY.z = z;
  BODY.w = a.w + (b.w - a.w) * t;
  BODY.top = a.top + (b.top - a.top) * t;
  BODY.bot = a.bot + (b.bot - a.bot) * t;
  return BODY;
}

function engineIds(list) {
  // count 1 -> engine; 2 -> engineL/R; more -> engineL1 (inboard), engineL2,
  // engineL3 (the An-225's six) ...
  const left = list.filter((e) => e.x < -0.01).sort((a, b) => b.x - a.x);
  const right = list.filter((e) => e.x > 0.01).sort((a, b) => a.x - b.x);
  const mid = list.filter((e) => Math.abs(e.x) <= 0.01);
  if (list.length === 1) list[0].id = 'engine';
  else {
    if (left.length === 1) left[0].id = 'engineL';
    else left.forEach((e, i) => (e.id = `engineL${Math.min(3, i + 1)}`));
    if (right.length === 1) right[0].id = 'engineR';
    else right.forEach((e, i) => (e.id = `engineR${Math.min(3, i + 1)}`));
    // Two on the centreline (rare): the first is "engine", the rest join it.
    mid.forEach((e) => (e.id = 'engine'));
  }
  return list;
}

/**
 * The frame from the type's own description: its `shape` (and `plan`, the
 * drawn length and span). The airliners' shapes (aircraft/extra/airliners.js
 * shapeFrom) write their wing and tail stations divided by scale x
 * bodyLength; everyone else's by scale alone. That is told apart by the
 * airliners' shape.plan.noseZ.
 */
export function frameFromShape(type) {
  const S = (type && type.shape) || {};
  const s = S.scale || 1;
  const bl = S.bodyLength || 1;
  const br = S.bodyRadius || 1;
  const sp = S.plan && fin(S.plan.noseZ) ? S.plan : null;
  const zw = sp ? s * bl : s;
  const plan = (type && type.plan) || {};
  const P = S.power || {};
  const rotorcraft = !!P.rotor;
  const person = typeof (type && type.buildModel) === 'function';
  const flyingWing = !!S.flyingWing;

  let noseZ = fin(plan.nose) ? plan.nose : sp ? sp.noseZ * s * bl : -2.6 * bl * s;
  let tailZ = fin(plan.tail) ? plan.tail : sp ? sp.tailZ * s * bl : 3.95 * bl * s;
  if (rotorcraft) {
    // The plan of a helicopter is its rotor disc; the body is the lathe's.
    noseZ = -2.6 * bl * s;
    tailZ = Math.max(tailZ, 3.95 * bl * s);
  }
  const semi = fin(plan.span) && !rotorcraft ? plan.span / 2 : ((S.wingRootX || 0) + (S.halfSpan || 5)) * s;
  // The lathe, stretched to the drawn length.
  const latheL = 6.5 * bl * s;
  const stretch = (tailZ - noseZ) / latheL;
  const halfW = sp && fin(sp.halfWidth) ? sp.halfWidth * s : null;
  const profile = profileFrom(
    LATHE.map(([r, z]) => {
      const w = halfW ? Math.min(halfW, r * br * s * 1.4) : r * br * s;
      return { z: noseZ + (z * bl * s + 2.6 * bl * s) * stretch, w, top: w, bot: -w };
    })
  );

  const engines = [];
  if (!rotorcraft && P.kind) {
    const count = P.count || 1;
    const y = (P.y || 0) * s;
    const r = (P.radius || 0.4) * s;
    const len = (P.length || 1) * s;
    if (P.kind === 'prop' && count === 1 && !fin(P.x)) {
      engines.push({ x: 0, y, z: noseZ + 0.2 * s, r: 0.5 * s, len: 0.5 * s, prop: true, propR: (P.propRadius || 1) * s, nose: true });
    } else if (count === 1 && (!fin(P.x) || Math.abs(P.x) < 0.01)) {
      engines.push({ x: 0, y, z: (P.z || 0) * s, r, len, buried: true });
    } else if (sp && Array.isArray(sp.engines) && sp.engines.length) {
      for (const e of sp.engines) engines.push({ x: e.x * s, y, z: e.z * s * bl, r, len });
    } else {
      const x = (P.x || 2) * s;
      const z = (P.z || 0) * s;
      engines.push({ x: -x, y, z, r, len, prop: P.kind === 'prop', propR: (P.drawRadius || P.propRadius || 0) * s });
      engines.push({ x, y, z, r, len, prop: P.kind === 'prop', propR: (P.drawRadius || P.propRadius || 0) * s });
    }
    engineIds(engines);
  }

  const gear = [];
  // A helicopter's skids are two rails, one a side: no nose leg.
  if (S.nose && !rotorcraft) gear.push({ id: 'gearN', x: (S.nose.x || 0) * s, y: S.nose.y * s, z: S.nose.z * s, r: ((S.wheelR && S.wheelR.nose) || 0.3) * s });
  if (S.main) {
    const r = ((S.wheelR && S.wheelR.main) || 0.36) * s;
    gear.push({ id: 'gearL', x: -S.main.x * s, y: S.main.y * s, z: S.main.z * s, r });
    gear.push({ id: 'gearR', x: S.main.x * s, y: S.main.y * s, z: S.main.z * s, r });
  }

  const wingRoot = Math.max((S.wingRootX || 0) * s, profile.reduce((m, p) => Math.max(m, p.w), 0) * 0.8);
  const rootLE = (S.wingZ || 0) * zw;
  const wing = flyingWing || !rotorcraft || (S.halfSpan || 0) > 0
    ? { rootX: wingRoot, tipX: semi, y: (S.wingY || 0) * s, rootLE, rootTE: rootLE + (S.rootChord || 1.5) * zw }
    : null;
  const tail = flyingWing
    ? null
    : {
      startZ: Math.min(fin(S.finZ) ? S.finZ : 3, fin(S.hZ) ? S.hZ : 3) * zw - 0.12 * s,
      spanX: ((S.hSpan || 1.5) + 0.3) * s * 1.15,
    };
  const rotor = rotorcraft ? { x: 0, y: (P.y || 1.2) * s, z: (P.z || 0) * s, r: (P.propRadius || 4) * s, hubR: 0.5 * s } : null;
  // A tandem (the Chinook) has no tail rotor: its two discs turn opposite
  // ways and cancel each other's torque, so there is no such zone to lose.
  const tailRotor = rotorcraft && !P.tandem
    ? { x: 0.25 * s, y: (S.finHeight ? S.finHeight * 0.6 : 0.9) * s, z: (fin(S.finZ) ? S.finZ : 3.2) * s, r: 0.9 * s }
    : null;
  return finishFrame({
    id: type && type.id,
    family: person ? 'person' : rotorcraft ? 'rotor' : flyingWing ? 'wing' : 'fixed',
    scale: s,
    noseZ,
    tailZ,
    semi,
    profile,
    wing,
    tail,
    engines,
    gear,
    rotor,
    tailRotor,
    eyeZ: Array.isArray(S.eye) ? S.eye[2] * s : null,
    source: 'shape',
  });
}

/**
 * The frame from a fleet-pack build config (src/fleet/aircraft-*.js), which
 * is in the drawn model's own metres: body stations [z, halfWidth,
 * halfHeight, yOffset], wing, tail, fin, gear and engines.
 */
export function frameFromFleetConfig(config, type) {
  const c = config || {};
  const body = Array.isArray(c.body) ? c.body : [];
  const profile = profileFrom(body.map(([z, w, h, y]) => ({ z, w, top: (y || 0) + h, bot: (y || 0) - h })));
  const noseZ = profile[0].z;
  const tailZ = profile[profile.length - 1].z;
  const maxW = profile.reduce((m, p) => Math.max(m, p.w), 0);
  const W = c.wing;
  const semi = W ? W.rootX + W.span : type && type.plan && fin(type.plan.span) ? type.plan.span / 2 : maxW * 4;
  const wing = W
    ? { rootX: W.rootX, tipX: W.rootX + W.span, y: W.rootY || 0, rootLE: W.rootZ, rootTE: W.rootZ + W.rootChord }
    : { rootX: maxW * 0.9, tipX: semi, y: 0, rootLE: noseZ + (tailZ - noseZ) * 0.3, rootTE: noseZ + (tailZ - noseZ) * 0.7 };
  const tail = c.tail || c.fin
    ? {
      startZ: Math.min(c.tail ? c.tail.rootZ : Infinity, c.fin ? c.fin.rootZ : Infinity) - 0.1,
      spanX: c.tail ? (c.tail.rootX + c.tail.span) * 1.12 : maxW * 1.5,
    }
    : null;
  const engines = engineIds(
    (Array.isArray(c.engines) ? c.engines : []).map((e) => ({
      x: e.x || 0, y: e.y || 0, z: e.z || 0, r: e.radius || 0.4, len: e.length || 1,
      buried: !!e.buried, prop: e.kind === 'prop', propR: e.propRadius || 0,
      nose: e.kind === 'prop' && Math.abs(e.x || 0) < 0.01,
    }))
  );
  const G = c.gear || {};
  const gear = [];
  const nr = G.noseRadius || 0.3;
  const mr = G.mainRadius || 0.36;
  if (Array.isArray(G.nose)) gear.push({ id: 'gearN', x: G.nose[0], y: G.nose[1] - nr, z: G.nose[2], r: nr });
  if (Array.isArray(G.main)) {
    gear.push({ id: 'gearL', x: -Math.abs(G.main[0]), y: G.main[1] - mr, z: G.main[2], r: mr });
    gear.push({ id: 'gearR', x: Math.abs(G.main[0]), y: G.main[1] - mr, z: G.main[2], r: mr });
  }
  return finishFrame({
    id: c.id || (type && type.id),
    family: c.kind === 'flying-wing' ? 'wing' : 'fixed',
    scale: 1,
    noseZ,
    tailZ,
    semi,
    profile,
    wing,
    tail,
    engines,
    gear,
    rotor: null,
    tailRotor: null,
    eyeZ: Array.isArray(c.eye) ? c.eye[2] : null,
    source: 'fleet',
  });
}

/** The frame for a type, from the build config when the drawing came from one. */
export function frameFor(type, config = null) {
  return config ? frameFromFleetConfig(config, type) : frameFromShape(type);
}

/**
 * Correct a frame against what was actually drawn (breakup-mesh.js
 * surveyModel). Every field is optional; whatever the survey measured wins.
 *
 *   survey.bbox      { min: [x,y,z], max: [x,y,z] } of the airframe (no rotor)
 *   survey.body      [{ z, w, top, bot }] from the meshes that ARE the fuselage
 *   survey.rotor     { x, y, z, r }    the main rotor's hub and radius
 *   survey.tailRotor { x, y, z, r }
 *   survey.finZ / survey.tailplaneZ / survey.tailplaneX   from the meshes named so
 */
export function refineFrame(frame, survey) {
  if (!survey) return frame;
  const f = { ...frame };
  const b = survey.bbox;
  if (b && fin(b.min[2]) && fin(b.max[2]) && b.max[2] - b.min[2] > 0.5) {
    const oldN = f.noseZ;
    const oldT = f.tailZ;
    f.noseZ = b.min[2];
    f.tailZ = b.max[2];
    // Stations given against the old length move with it.
    const k = (f.tailZ - f.noseZ) / (oldT - oldN || 1);
    const map = (z) => f.noseZ + (z - oldN) * k;
    if (f.source === 'shape') {
      f.profile = f.profile.map((p) => ({ ...p, z: map(p.z) }));
      if (f.wing) f.wing = { ...f.wing, rootLE: map(f.wing.rootLE), rootTE: map(f.wing.rootTE) };
      if (f.tail) f.tail = { ...f.tail, startZ: map(f.tail.startZ) };
      f.engines = f.engines.map((e) => (e.nose ? { ...e, z: f.noseZ + 0.2 * f.scale } : { ...e, z: map(e.z) }));
      if (f.tailRotor) f.tailRotor = { ...f.tailRotor, z: map(f.tailRotor.z) };
    }
    if (f.family !== 'rotor') {
      const semi = Math.max(Math.abs(b.min[0]), Math.abs(b.max[0]));
      if (semi > 0.3) {
        f.semi = semi;
        if (f.wing) f.wing = { ...f.wing, tipX: semi };
      }
    }
  }
  if (Array.isArray(survey.body) && survey.body.length >= 3) f.profile = profileFrom(survey.body);
  if (survey.rotor) f.rotor = { ...(f.rotor || {}), ...survey.rotor, hubR: Math.max(0.35, survey.rotor.r * 0.1), named: true };
  if (survey.tailRotor) f.tailRotor = { ...survey.tailRotor, named: true };
  if (f.tail && (fin(survey.finZ) || fin(survey.tailplaneZ))) {
    const z = Math.min(fin(survey.finZ) ? survey.finZ : Infinity, fin(survey.tailplaneZ) ? survey.tailplaneZ : Infinity);
    f.tail = { ...f.tail, startZ: z - 0.08 * (f.scale || 1) };
  }
  if (f.tail && fin(survey.tailplaneX)) f.tail = { ...f.tail, spanX: survey.tailplaneX * 1.1 };
  return finishFrame(f);
}

/** Derived numbers every frame needs: the splits, the gear's height. */
function finishFrame(f) {
  const L = Math.max(1, f.tailZ - f.noseZ);
  f.L = L;
  const sc = f.scale || 1;
  // The nose section: the front fifth — radome, cowl or flight deck.
  f.noseSplit = f.noseZ + (f.family === 'rotor' ? 0.2 : 0.2) * L;
  // The rear fuselage starts behind the wing's root trailing edge, and never
  // before the middle of the aeroplane.
  const tailStart = f.tail ? f.tail.startZ : f.tailZ - 0.15 * L;
  let rear = f.noseZ + (f.family === 'rotor' ? 0.5 : 0.5) * L;
  if (f.wing && f.family !== 'rotor' && fin(f.wing.rootTE)) rear = Math.max(rear, f.wing.rootTE + 0.02 * L);
  f.rearSplit = clamp(rear, f.noseSplit + 0.15 * L, Math.max(f.noseSplit + 0.2 * L, tailStart - 0.02 * L));
  if (f.wing) {
    const root = Math.max(f.wing.rootX || 0, 0.05);
    const tip = Math.max(f.wing.tipX || f.semi, root + 0.5);
    // Outboard of halfway along the exposed wing — and outboard of any engine
    // hung on it, so a nacelle always stays with the inner wing that holds it.
    let split = root + 0.5 * (tip - root);
    for (const e of f.engines) if (!e.buried && Math.abs(e.x) > root) split = Math.max(split, Math.abs(e.x) + e.r * 1.6);
    f.wing.splitX = Math.min(split, root + 0.8 * (tip - root));
  }
  const contact = f.gear.length ? Math.min(...f.gear.map((g) => g.y)) : -1.5 * sc;
  // Gear is what hangs below 45% of the way from the wheels to the axis.
  f.gearTopY = contact * 0.55;
  return f;
}

/* ------------------------------------------------------------------ *
 * The layout: zones, the tree, classify()
 * ------------------------------------------------------------------ */

/**
 * Mesh hints (breakup-mesh.js reads them off mesh and part names, and the
 * fleet pack's strike ids): a hint names the PART a triangle belongs to; the
 * position then says which zone of that part.
 */
export const HINTS = ['gear', 'rotor', 'tailRotor', 'prop', 'engine', 'fin', 'tailplane', 'wing', 'body', 'tail'];

export function layoutFor(frame) {
  const f = frame;
  const sc = f.scale || 1;
  const zones = new Set([CORE, 'nose', 'rear']);
  if (f.wing && f.family !== 'rotor') ['wingInnerL', 'wingOuterL', 'wingInnerR', 'wingOuterR'].forEach((z) => zones.add(z));
  if (f.family === 'rotor' && f.wing && (f.wing.tipX || 0) > 0) ['wingInnerL', 'wingInnerR'].forEach((z) => zones.add(z));
  if (f.tail) ['fin', 'tailplaneL', 'tailplaneR'].forEach((z) => zones.add(z));
  for (const g of f.gear) zones.add(g.id);
  for (const e of f.engines) zones.add(e.id);
  if (f.rotor) zones.add('rotor');
  if (f.tailRotor) zones.add('tailRotor');

  const wingZone = (x) => {
    const outer = f.family !== 'rotor' && f.wing && Math.abs(x) > f.wing.splitX;
    return x < 0 ? (outer ? 'wingOuterL' : 'wingInnerL') : outer ? 'wingOuterR' : 'wingInnerR';
  };
  const bodyZone = (z) => (z < f.noseSplit ? 'nose' : z > f.rearSplit ? 'rear' : CORE);
  const nearestGear = (x, z) => {
    let best = null;
    let bd = Infinity;
    for (const g of f.gear) {
      const d = (g.x - x) ** 2 + (g.z - z) ** 2;
      if (d < bd) {
        bd = d;
        best = g;
      }
    }
    return best;
  };
  const nearestEngine = (x, y, z) => {
    let best = null;
    let bd = Infinity;
    for (const e of f.engines) {
      const d = (e.x - x) ** 2 + (e.y - y) ** 2 + (e.z - z) ** 2;
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    return best;
  };
  const inEngine = (x, y, z) => {
    for (const e of f.engines) {
      if (e.buried) continue;
      const dx = x - e.x;
      const dy = y - e.y;
      const rad = Math.sqrt(dx * dx + dy * dy);
      const half = e.len * 0.5 + e.r * 0.4;
      const along = Math.abs(z - e.z);
      if (along <= half && rad < e.r * 1.4) return e.id;
      // A propeller's disc, in front of its nacelle.
      if (e.prop && e.propR && rad < e.propR * 1.05 && Math.abs(z - (e.z - e.len * 0.5)) < 0.35 * sc) return e.id;
      if (e.nose && e.propR && rad < e.propR * 1.05 && z < f.noseZ + 0.45 * sc) return e.id;
    }
    return null;
  };
  const tailRegion = (x, y, z) => {
    const b = bodyAt(f, z);
    const ax = Math.abs(x);
    const finMaxX = Math.max(b.w * 1.3, f.tail ? f.tail.spanX * 0.22 : 0.5);
    if (ax < finMaxX && y > b.top - 0.02 * sc) return 'fin';
    if (ax > b.w * 1.06 + 0.03 * sc) return x < 0 ? 'tailplaneL' : 'tailplaneR';
    return 'rear';
  };

  /**
   * Which zone is (x, y, z) in? `hint` is the part a mesh says it is (see
   * HINTS), or null for merged geometry, which goes by position alone.
   */
  function classify(x, y, z, hint = null) {
    if (hint === 'rotor' && f.rotor) return 'rotor';
    if (hint === 'tailRotor' && f.tailRotor) return 'tailRotor';
    if (hint === 'gear' && f.gear.length) return nearestGear(x, z).id;
    if ((hint === 'prop' || hint === 'engine') && f.engines.length) return nearestEngine(x, y, z).id;
    // A ventral fin, under the tail, is drawn with the fin but stays with the
    // rear fuselage: a belly scrape grinds it, it does not take the fin.
    if (hint === 'fin' && f.tail) return y < bodyAt(f, z).bot ? 'rear' : 'fin';
    if (hint === 'tailplane' && f.tail) return x < 0 ? 'tailplaneL' : 'tailplaneR';
    if (hint === 'wing' && f.wing) return wingZone(x);
    if (hint === 'body') return bodyZone(z);
    if (hint === 'tail' && f.tail) return z > f.tail.startZ ? tailRegion(x, y, z) : bodyZone(z);

    // By position only when no mesh says which the rotors are: a boom or a
    // fin top under the disc is not a blade.
    if (f.rotor && !f.rotor.named && y > f.rotor.y - 0.12 * sc && Math.hypot(x - f.rotor.x, z - f.rotor.z) > f.rotor.hubR) return 'rotor';
    if (f.tailRotor && !f.tailRotor.named) {
      const t = f.tailRotor;
      if (Math.hypot(x - t.x, y - t.y, z - t.z) < t.r * 1.1) return 'tailRotor';
    }
    if (f.gear.length && y < f.gearTopY) {
      const g = nearestGear(x, z);
      if (g && Math.hypot(g.x - x, g.z - z) < Math.max(0.6 * sc, g.r * 3.2)) return g.id;
    }
    const e = f.engines.length ? inEngine(x, y, z) : null;
    if (e) return e;
    const b = bodyAt(f, z);
    if (Math.abs(x) > b.w * 1.12 + 0.04 * sc) {
      if (f.tail && z > f.tail.startZ && Math.abs(x) < f.tail.spanX) return tailRegion(x, y, z);
      if (f.wing) return wingZone(x);
    }
    if (f.tail && z > f.tail.startZ) return tailRegion(x, y, z);
    return bodyZone(z);
  }

  /** The zone each hangs on: it goes with its parent when the parent comes off. */
  const parent = {};
  for (const id of zones) {
    if (id === CORE) continue;
    const Z = ZONES[id];
    if (id === 'nose' || id === 'rear' || id === 'rotor') parent[id] = CORE;
    else if (id === 'wingInnerL' || id === 'wingInnerR') parent[id] = CORE;
    else if (id === 'wingOuterL') parent[id] = zones.has('wingInnerL') ? 'wingInnerL' : CORE;
    else if (id === 'wingOuterR') parent[id] = zones.has('wingInnerR') ? 'wingInnerR' : CORE;
    else if (Z.kind === 'tail' || id === 'tailRotor') parent[id] = 'rear';
    else if (Z.kind === 'gear') {
      // Legs hang on the fuselage (the nose leg on the nose section when it is in it).
      const g = f.gear.find((q) => q.id === id);
      parent[id] = g && id === 'gearN' && g.z < f.noseSplit ? 'nose' : CORE;
    } else if (Z.kind === 'engine') {
      // A buried engine is the fuselage's; a podded one hangs on its wing.
      const e = f.engines.find((q) => q.id === id);
      parent[id] = !e ? CORE : e.buried ? bodyZone(e.z) : classifyBody(e);
    } else parent[id] = CORE;
  }
  function classifyBody(p) {
    if (p.nose) return 'nose';
    const b = bodyAt(f, p.z);
    if (Math.abs(p.x) > b.w * 1.12 && f.wing && f.family !== 'rotor') return wingZone(p.x);
    return bodyZone(p.z);
  }

  const soft = f.family === 'person';
  return {
    frame: f,
    family: f.family,
    soft,
    zones: [...zones],
    parent,
    classify,
    /** Children of a zone, all the way down. */
    descendants(id) {
      const out = [];
      const walk = (p) => {
        for (const z of zones) if (parent[z] === p) {
          out.push(z);
          walk(z);
        }
      };
      walk(id);
      return out;
    },
  };
}

/**
 * Rough boxes for each zone from the frame alone — for planning without a
 * model (node, and the NPC fallback). With a model, breakup-mesh.js measures
 * the real ones and they are used instead.
 */
export function approxBoxes(layout) {
  const f = layout.frame;
  const sc = f.scale || 1;
  const B = {};
  const box = (x0, y0, z0, x1, y1, z1) => ({ min: [Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1)], max: [Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1)] });
  const wMax = f.profile.reduce((m, p) => Math.max(m, p.w), 0);
  const top = f.profile.reduce((m, p) => Math.max(m, p.top), 0);
  const bot = f.profile.reduce((m, p) => Math.min(m, p.bot), 0);
  B.nose = box(-wMax, bot, f.noseZ, wMax, top, f.noseSplit);
  B.core = box(-wMax, bot, f.noseSplit, wMax, top, f.rearSplit);
  B.rear = box(-wMax, bot, f.rearSplit, wMax, top, f.tailZ);
  if (f.wing) {
    const w = f.wing;
    const y = w.y;
    const le = w.rootLE;
    const te = Math.max(w.rootTE, le + 0.5);
    for (const s of [-1, 1]) {
      const L = s < 0 ? 'L' : 'R';
      if (layout.zones.includes(`wingInner${L}`)) B[`wingInner${L}`] = box(s * w.rootX, y - 0.3 * sc, le, s * (w.splitX || w.tipX), y + 0.3 * sc, te);
      if (layout.zones.includes(`wingOuter${L}`)) B[`wingOuter${L}`] = box(s * w.splitX, y - 0.3 * sc, le, s * w.tipX, y + 0.5 * sc, te + (w.tipX - w.rootX) * 0.3);
    }
  }
  if (f.tail) {
    const t = f.tail;
    B.fin = box(-0.2 * sc, top, t.startZ, 0.2 * sc, top + 1.4 * sc, f.tailZ);
    B.tailplaneL = box(-t.spanX, -0.3 * sc, t.startZ, -wMax * 0.5, 0.4 * sc, f.tailZ);
    B.tailplaneR = box(wMax * 0.5, -0.3 * sc, t.startZ, t.spanX, 0.4 * sc, f.tailZ);
  }
  for (const g of f.gear) B[g.id] = box(g.x - g.r * 1.5, g.y, g.z - g.r * 1.5, g.x + g.r * 1.5, f.gearTopY, g.z + g.r * 1.5);
  for (const e of f.engines) {
    const R = Math.max(e.r, e.propR || 0);
    B[e.id] = box(e.x - R, e.y - R, e.z - e.len / 2, e.x + R, e.y + R, e.z + e.len / 2);
  }
  if (f.rotor) B.rotor = box(f.rotor.x - f.rotor.r, f.rotor.y - 0.15 * sc, f.rotor.z - f.rotor.r, f.rotor.x + f.rotor.r, f.rotor.y + 0.4 * sc, f.rotor.z + f.rotor.r);
  if (f.tailRotor) {
    const t = f.tailRotor;
    B.tailRotor = box(t.x - t.r * 0.3, t.y - t.r, t.z - t.r, t.x + t.r * 0.3, t.y + t.r, t.z + t.r);
  }
  return B;
}

/* ------------------------------------------------------------------ *
 * The plan: an impact -> what happens to each zone
 * ------------------------------------------------------------------ */

function boxDistance(b, p, kz = 1) {
  const dx = Math.max(b.min[0] - p[0], 0, p[0] - b.max[0]);
  const dy = Math.max(b.min[1] - p[1], 0, p[1] - b.max[1]);
  const dz = Math.max(b.min[2] - p[2], 0, p[2] - b.max[2]) * kz;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** How far along `n` the lowest corner of the box is: what is down on a surface whose normal is `n`. */
function lowestAlong(b, n) {
  let s = 0;
  for (let i = 0; i < 3; i++) s += n[i] >= 0 ? b.min[i] * n[i] : b.max[i] * n[i];
  return s;
}

/** The zone whose box is nearest the point (ties to the smaller box). */
export function nearestZone(layout, boxes, point) {
  let best = null;
  let bd = Infinity;
  let bv = Infinity;
  for (const id of layout.zones) {
    const b = boxes[id];
    if (!b) continue;
    const d = boxDistance(b, point);
    const v = (b.max[0] - b.min[0]) * (b.max[1] - b.min[1]) * (b.max[2] - b.min[2]);
    if (d < bd - 1e-6 || (Math.abs(d - bd) <= 1e-6 && v < bv)) {
      best = id;
      bd = d;
      bv = v;
    }
  }
  return best;
}

/**
 * Closing energy, J/kg: half the square of the speed INTO the surface at the
 * point that touched, plus a little of the speed along it — a scrape at 40
 * m/s is not nothing, but it is not a 40 m/s dive either.
 */
export function impactEnergy(vel, normal) {
  const vn = -(vel[0] * normal[0] + vel[1] * normal[1] + vel[2] * normal[2]);
  const closing = Math.max(0, vn);
  const tx = vel[0] + vn * normal[0];
  const ty = vel[1] + vn * normal[1];
  const tz = vel[2] + vn * normal[2];
  const tangent = Math.sqrt(tx * tx + ty * ty + tz * tz);
  return { energy: 0.5 * closing * closing + 0.012 * tangent * tangent, closing, tangent };
}

/**
 * How an impact reads — what a spectator would call it, and what the
 * airframe does next. Pure: from the zone that touched, how steeply it came
 * in and what it touched.
 *
 *   hitZone   the zone that touched (planBreak's)
 *   steep     closing / speed, 0 (a graze) .. 1 (square on)
 *   speed     m/s at the contact
 *   hit.surface   'ground' | 'water' | 'wall' | 'aircraft' (default ground)
 *   hit.survivable, hit.midair
 *
 * Returns { mode, side, steep, grip, restitution, skip }:
 *   mode   'knock'    a survivable touch: nothing to choreograph
 *          'midair'   came apart in the air: a tumble all the way down
 *          'water'    into the sea (skip: true for a fast, flat arrival that skips off it)
 *          'wall'     a building or another aircraft: a hard stop and a drop
 *          'rotor'    a helicopter's blades struck something
 *          'wingtip'  a wing caught the ground: it digs in, the airframe yaws
 *                     and rolls over it (side: -1 left, +1 right)
 *          'nose'     nose-in: the forward fuselage takes it, and it pitches over
 *          'tail'     a tail strike: the tail cone, and the nose slaps down
 *          'gear'     a hard arrival on the wheels
 *          'belly'    a belly slide: friction and sparks until it stops
 *   grip   how much of the speed ALONG the surface the contact takes at once
 *          (a tip that digs in takes most of it; a belly slides)
 *   restitution  how much of the speed INTO the surface comes back
 */
export function classifyImpact(layout, hitZone, steep, speed, hit = {}) {
  const Z = ZONES[hitZone] || ZONES[CORE];
  const surface = hit.surface || 'ground';
  const side = Z.side || 0;
  const out = (mode, grip, restitution, extra = {}) => ({ mode, side, steep, speed, grip, restitution, skip: false, ...extra });
  if (hit.survivable) return out('knock', 0, 0);
  if (hit.midair) return out('midair', 0, 0);
  if (surface === 'water') return out('water', 0.3, steep < 0.25 && speed > 25 ? 0.45 : 0.05, { skip: steep < 0.25 && speed > 25 });
  if (surface === 'wall' || surface === 'aircraft') return out('wall', 0.6, 0.25);
  if (Z.kind === 'rotor') return out('rotor', 0.2, 0.1);
  if (Z.kind === 'engine') {
    // A propeller or an engine in the nose IS the nose; a podded one scrapes along, or digs in when it comes in steeply.
    const e = (layout.frame.engines || []).find((q) => q.id === hitZone);
    if (e && (e.nose || e.buried)) return steep > 0.45 ? out('nose', 0.65, 0.06) : out('belly', 0.15, 0.1);
    return steep > 0.6 ? out('nose', 0.5, 0.08) : out('belly', 0.2, 0.1);
  }
  if (Z.kind === 'wing') return out('wingtip', /Outer/.test(hitZone) ? 0.6 : 0.45, 0.12);
  if (Z.kind === 'tail' || (hitZone === 'rear' && Array.isArray(hit.zones) && hit.zones[0] === 'rear')) return out('tail', 0.3, 0.2);
  if (hitZone === 'nose') return steep > 0.45 ? out('nose', 0.65, 0.06) : out('belly', 0.15, 0.1);
  if (Z.kind === 'gear') {
    /*
     * A leg that is out takes a hard arrival on its wheels. One that is up is only the nearest zone to the
     * point that touched: the belly took it — or, for a leg out under the wing (the Harrier's outriggers,
     * near its tips), the wing did, and a wing that catches throws the airframe round like any other.
     */
    const w = layout.frame.wing;
    const px = Array.isArray(hit.point) ? Math.abs(hit.point[0]) : 0;
    const outOnWing = !!w && side !== 0 && px > Math.max(w.rootX || 0, 0.5 * (w.tipX || 0));
    if (hit.gearDown != null && hit.gearDown < 0.5) return outOnWing ? out('wingtip', 0.45, 0.12) : out('belly', 0.15, 0.1);
    return out('gear', 0.05, 0.15);
  }
  if (hitZone === 'rear') return steep > 0.6 ? out('tail', 0.3, 0.2) : out('belly', 0.15, 0.1);
  return out('belly', 0.15, 0.1);
}

/**
 * hit (all in body metres, body axes):
 *   point     [x, y, z] where it touched
 *   normal    [x, y, z] the surface's normal, pointing out of the surface
 *   velocity  [x, y, z] the touching point's velocity relative to the surface
 *   energy    J/kg — overrides the velocity's (a damage event's severity)
 *   survivable  true: only zones that leave a flyable aeroplane may come off
 *   gearDown  0..1, how far the gear is out
 *   zone      force the hit zone (the part the flight model named), optional
 * boxes: zone -> { min, max } (measured; approxBoxes() without a model)
 *
 * The zone hit takes all of the energy. The rest take the BLOW (the closing
 * part) less with distance over `reach`; the SCRAPE (the part along the
 * surface) reaches only zones within a short way of the contact that are
 * down on the surface too (their lowest point along the normal within a
 * little of the aeroplane's lowest).
 *
 * Returns { energy, blow, scrape, closing, tangent, hitZone, reach, actions, pieces }:
 *   actions  [{ zone, action: 'detach'|'bend'|'crush'|'fold'|'shake', amount, e }]
 *   pieces   [[zone, ...], ...] — what flies off together, one array per piece
 */
export function planBreak(layout, hit, boxes = null) {
  const B = boxes || approxBoxes(layout);
  const f = layout.frame;
  const sc = f.scale || 1;
  const p = hit.point || [0, 0, 0];
  const n = hit.normal || [0, 1, 0];
  let E;
  // The blow (the speed INTO the surface) travels through the airframe; the
  // scrape (the speed along it) only hurts what is touching. A wheels-up
  // landing at a fighter's 70 m/s is a long, loud scrape — not a blow that
  // snaps its fin and tailplanes off from the belly.
  let blow;
  let scrape = 0;
  let closing = 0;
  let tangent = 0;
  if (fin(hit.energy)) E = blow = Math.max(0, hit.energy);
  else {
    const r = impactEnergy(hit.velocity || [0, 0, 0], n);
    E = r.energy;
    closing = r.closing;
    tangent = r.tangent;
    blow = 0.5 * closing * closing;
    scrape = Math.max(0, E - blow);
  }
  const speed = Math.hypot(...(hit.velocity || [0, 0, 0]));
  const steep = speed > 0.5 ? clamp(closing / speed, 0, 1) : 0.5;
  /*
   * The zone that touched: named (`hit.zone`), or the nearest of the ones the
   * caller says it can only have been (`hit.zones`, in order of preference —
   * the flight model knows which part touched, a wing or the tail, and where
   * the point lies on a short jet the zone nearest it can be the neighbour's:
   * a knock on a tailplane that "hit" the wing, a tail strike that broke
   * whichever tailplane the tie happened to fall to), or the nearest of all.
   */
  // (Not for a helicopter, whose tail strike is the tail rotor and whose "wings" are blades.)
  const named = Array.isArray(hit.zones) && !layout.zones.includes('rotor') ? hit.zones.filter((z) => B[z]) : [];
  let hitZone = hit.zone && B[hit.zone] ? hit.zone : null;
  if (!hitZone && named.length) {
    let bd = Infinity;
    for (const z of named) {
      const d = boxDistance(B[z], p);
      if (d < bd - 1e-6) {
        bd = d;
        hitZone = z;
      }
    }
  }
  if (!hitZone) hitZone = nearestZone(layout, B, p) || CORE;
  const mode = classifyImpact(layout, hitZone, steep, speed, hit);
  // The seam the mode is about gives a little sooner (MODE_TUNE): the cockpit seam nose-in, the tail cone
  // on a tail strike, the wing root when a wing has caught the ground hard.
  const tune = {};
  const MT = MODE_TUNE[mode.mode];
  if (MT) {
    if (MT.nose && hitZone === 'nose') tune.nose = MT.nose;
    if (MT.rear && hitZone === 'rear') tune.rear = MT.rear;
    if (MT.root && blow >= MT.rootFrom) tune[mode.side < 0 ? 'wingInnerL' : 'wingInnerR'] = MT.root;
  }
  // How far the blow travels through the airframe, metres: a clip stays in
  // the tip it clipped, a square blow at the same place goes on up the spar.
  let reach = f.L * clamp(0.15 + 0.7 * Math.sqrt((blow + 0.25 * scrape) / 1000), 0.15, 1.3);
  // A knock you fly on from is a touch, not a crash: it stays in what it touched and what is next to it. On a short
  // jet the reach above is the length of the aeroplane, and a knock on an engine took the fin and both tailplanes
  // off (the crash sweep, finding 5).
  if (hit.survivable) reach = Math.min(reach, Math.max(0.1 * f.L, 2 * sc));
  // The scrape grinds what is DOWN on the surface: the lowest thing along the
  // normal is what the aeroplane is sliding on, and whatever is within a
  // little of it scrapes too — the whole underside in a level belly slide,
  // only the tip in a wing clip, never a fin standing above it. Less of it
  // the further from the first touch.
  const gearOut = hit.gearDown == null ? 1 : hit.gearDown;
  const isGear = (id) => ZONES[id].kind === 'gear';
  const scrapeGap = clamp(0.02 * f.L, 0.15, 0.8);
  const slide = Math.max(0.6 * f.L, 3 * sc);
  const floorOf = (withGear) => {
    let m = Infinity;
    for (const id of layout.zones) if (B[id] && (withGear || !isGear(id))) m = Math.min(m, lowestAlong(B[id], n));
    return m;
  };
  const dist = {};
  const scrapeOn = (id, floor) => {
    const gap = (lowestAlong(B[id], n) - floor) / scrapeGap;
    if (!(scrape > 0) || gap >= 1) return 0;
    return scrape * 0.35 * (1 - Math.max(0, gap)) * (1 - 0.5 * Math.min(1, dist[id] / slide));
  };
  // A head-on blow runs back along the fuselage further than one from the side.
  const kz = 1 - 0.35 * steep;
  const actions = [];
  const local = {};
  const blowAt = {};
  // On its wheels while the gear is out and holds; on its belly with it up.
  const floor = scrape > 0 ? floorOf(gearOut >= 0.5) : Infinity;
  for (const id of layout.zones) {
    const b = B[id];
    if (!b) continue;
    if (id === hitZone) {
      // The zone that touched takes all of it — except that a wheel on the ground is rolling, not sliding:
      // its leg takes the blow, and almost none of the speed along the ground. A 55 m/s landing at 6 m/s
      // down put 1500 J/kg of "scrape" into the leg and tore it off, and the belly slide that followed
      // took the tailplanes and wing tips of every jet with them (the crash sweep, finding 5).
      local[id] = isGear(id) && gearOut >= 0.5 && !hit.survivable ? blow + 0.04 * scrape : E;
      continue;
    }
    const d = boxDistance(b, p, kz);
    dist[id] = d;
    const u = d / reach;
    blowAt[id] = u >= 1 ? 0 : blow * Math.pow(1 - u, 1.2);
    // A knock is a touch: what is next to the zone it touched feels a third of it, not all of it (an engine in the
    // tail of a fighter shares its box walls with the fin and the tailplanes).
    if (hit.survivable) blowAt[id] *= 0.35;
    local[id] = blowAt[id] + scrapeOn(id, floor);
  }
  // The gear gives way: the aeroplane settles on its belly, its nacelles and
  // its propellers, and they scrape as well (bent props on a belly landing).
  // (A leg on the ground that merely folds under a hard landing leaves the aeroplane on its other legs: it settles on the belly when a leg is touched hard enough to go, or the contact was somewhere else.)
  const wheelHit = isGear(hitZone) && gearOut >= 0.5 && (local[hitZone] || 0) < ZONES[hitZone].detach;
  if (scrape > 0 && gearOut >= 0.5 && !wheelHit && layout.zones.some((id) => isGear(id) && (local[id] || 0) >= ZONES[id].fold)) {
    const belly = floorOf(false);
    for (const id of layout.zones) if (B[id] && id !== hitZone && !isGear(id)) local[id] = Math.max(local[id], blowAt[id] + scrapeOn(id, belly));
  }
  for (const id of layout.zones) {
    const Z = ZONES[id];
    const e = local[id] || 0;
    if (e <= 0 || id === CORE && e < Z.bend) continue;
    if (layout.soft) {
      if (e >= 2) actions.push({ zone: id, action: 'shake', amount: clamp(e / 40, 0, 1), e });
      continue;
    }
    if (Z.kind === 'gear') {
      if (e >= Z.detach && gearOut > 0.5 && !hit.survivable) actions.push({ zone: id, action: 'detach', amount: 1, e, delay: id === hitZone ? 0 : clamp((dist[id] || 0) / CRACK_SPEED, 0.02, DELAY_MAX) });
      else if (e >= Z.fold) actions.push({ zone: id, action: 'fold', amount: clamp((e - Z.fold) / (Z.fold * 3), 0.35, 1), e, hidden: gearOut < 0.5 });
      continue;
    }
    const canDetach = !hit.survivable || Z.survivable;
    // A zone the blow only reached THROUGH the airframe needs a harder blow to be torn off than one that
    // touched: the touched zone gives first, and the thresholds above (a wing tip at 11 J/kg, a tailplane
    // 13, a fin 16) are for it. Without this a 32 J/kg landing (8 m/s down) took both tailplanes and a wing
    // tip off a short jet from the wheels, three metres away.
    // (Fading out as the blow becomes a real crash: past TRANSMIT_FADE J/kg everything near the touch goes, as it always did.)
    const detachAt = (tune[id] || 1) * (id === hitZone ? Z.detach : Z.detach * (1 + (TRANSMIT - 1) * clamp(1 - blow / TRANSMIT_FADE, 0, 1)));
    // Seconds after the hit this zone lets go: the touched zone at once, the rest as the blow runs to them.
    const delay = id === hitZone ? 0 : clamp((dist[id] || 0) / CRACK_SPEED, 0.02, DELAY_MAX);
    if (e >= detachAt && canDetach) actions.push({ zone: id, action: 'detach', amount: 1, e, delay });
    else if (e >= Z.bend) {
      // Nearly torn off by the BLOW (not ground off by a scrape): it hangs by what is left, and tears later.
      const blowPart = id === hitZone ? blow : blowAt[id] || 0;
      const hangs = canDetach && !hit.survivable && Number.isFinite(detachAt) && e >= detachAt * HANG.from && blowPart >= HANG.blowShare * e && hangKind(f, id);
      if (hangs) {
        const near = clamp((e - detachAt * HANG.from) / (detachAt * (1 - HANG.from)), 0, 1);
        actions.push({ zone: id, action: 'hang', amount: 1, e, delay, t: HANG.tMax - (HANG.tMax - HANG.tMin) * near });
        continue;
      }
      const amount = clamp((e - Z.bend) / Math.max(1, (Number.isFinite(Z.detach) ? Z.detach : Z.bend * 6) - Z.bend), 0.15, 1);
      actions.push({ zone: id, action: id === 'nose' || id === CORE || id === 'rear' ? 'crush' : 'bend', amount, e });
    }
  }
  const pieces = piecesOf(layout, actions, local);
  // The order they come away in: a piece lets go when its first zone does.
  const delays = pieces.map((piece) => Math.min(...piece.map((z) => {
    const a = actions.find((q) => q.zone === z && q.action === 'detach');
    return a ? a.delay : DELAY_MAX;
  })));
  const hangs = hangsOf(layout, actions, pieces);
  // Where the fuel is and the tank has gone: torn off, or crushed and bent hard enough to split.
  const fuel = [];
  for (const a of actions) if (ZONES[a.zone] && ZONES[a.zone].fuel && (a.action === 'detach' || a.action === 'hang' || ((a.action === 'bend' || a.action === 'crush') && a.amount >= 0.5))) fuel.push(a.zone);
  return { energy: E, blow, scrape, closing, tangent, steep, hitZone, reach, mode, actions, pieces, delays, hangs, fuel, dist };
}

/** Which zones can hang by a thread: wings, tails and podded (not propeller, not buried) engines. */
function hangKind(f, id) {
  const Z = ZONES[id];
  if (!Z) return false;
  if (Z.kind === 'wing' || Z.kind === 'tail') return true;
  if (Z.kind === 'engine') {
    const e = f.engines.find((q) => q.id === id);
    return !!e && !e.prop && !e.nose && !e.buried;
  }
  return false;
}

/**
 * The hanging pieces: a zone with a 'hang' action that no detached piece is
 * taking with it, plus whatever hangs on it that is not going anywhere by
 * itself. [{ zones, zone, t, delay }], t the seconds it hangs before tearing.
 */
function hangsOf(layout, actions, pieces) {
  const taken = new Set();
  for (const p of pieces) for (const z of p) taken.add(z);
  const hanging = actions.filter((a) => a.action === 'hang' && !taken.has(a.zone));
  const out = [];
  for (const a of hanging) {
    // A zone hanging under another hanging zone is part of that one's piece, not its own.
    if (hanging.some((h) => h !== a && layout.descendants(h.zone).includes(a.zone))) continue;
    // It takes with it whatever hangs on it that is not flying off by itself.
    const zones = [a.zone, ...layout.descendants(a.zone).filter((d) => !taken.has(d))];
    out.push({ zones, zone: a.zone, t: a.t, delay: a.delay });
  }
  return out;
}

/**
 * What comes off together. A zone that comes off takes everything hanging on
 * it that did not break away by itself (a wing takes its tip and its engine
 * with it); a child that took a blow well past its own strength flies off as
 * a piece of its own, so a big hit throws more pieces than a medium one.
 */
function piecesOf(layout, actions, local) {
  const detached = new Set(actions.filter((a) => a.action === 'detach').map((a) => a.zone));
  const owner = {};
  const roots = [];
  // Parents first: walk down from the core.
  const order = [];
  const walk = (p) => {
    for (const z of layout.zones) if (layout.parent[z] === p) {
      order.push(z);
      walk(z);
    }
  };
  walk(CORE);
  for (const z of order) {
    const par = layout.parent[z];
    const parOwner = owner[par];
    if (detached.has(z)) {
      const own = (local[z] || 0) >= ZONES[z].detach * 1.5;
      if (parOwner && !own) owner[z] = parOwner;
      else {
        owner[z] = z;
        roots.push(z);
      }
    } else if (parOwner) owner[z] = parOwner;
  }
  return roots.map((r) => order.filter((z) => owner[z] === r));
}

/**
 * The flight model's `lost` record from a plan's detached zones (and bent
 * props): see ../aircraft/damage-handling.js. `engineCount` is every engine
 * the aeroplane has; `prior` is the record so far (losses add up).
 */
export function lostFrom(layout, plan, prior = null) {
  const f = layout.frame;
  const out = prior ? { ...prior, engines: [...(prior.engines || [])] } : { engines: [], engineCount: Math.max(1, f.engines.length) };
  out.engineCount = Math.max(1, f.engines.length);
  const gone = new Set();
  for (const piece of plan.pieces) for (const z of piece) gone.add(z);
  for (const z of gone) {
    if (z === 'wingOuterL' || z === 'wingOuterR' || z === 'fin' || z === 'tailplaneL' || z === 'tailplaneR') out[z] = true;
    // A helicopter's tail rotor is its fin and its rudder at once.
    if (z === 'tailRotor') {
      out.fin = true;
      out.tailRotor = true;
    }
    if (ZONES[z] && ZONES[z].engine && !out.engines.some((e) => e.id === z)) {
      const e = f.engines.find((q) => q.id === z);
      out.engines.push({ id: z, x: e ? e.x : 0 });
    }
  }
  for (const a of plan.actions) {
    if (a.action === 'bend' && ZONES[a.zone] && ZONES[a.zone].engine) {
      const e = f.engines.find((q) => q.id === a.zone);
      if (e && (e.prop || e.nose)) out.propBent = true;
    }
  }
  return out;
}

/** For the tests and the console: the zones a type has, from its description alone. */
export function zonesForType(type, config = null) {
  return layoutFor(frameFor(type, config)).zones.slice().sort();
}
