/**
 * Node checks for dialing the autopilot's heading, speed and climb/descend
 * bugs while it keeps flying (src/flight/autopilot.js, src/flight/input.js).
 * Run from the repo root with plain node:
 *
 *   node tests/features/autopilot-adjust.mjs
 *
 * 1. THE REGISTRY. The six keys (apHdgLeft/Right, apSpdDown/Up, apVsDown/Up)
 *    are real actions, each in the new 'Autopilot' group, plane only, with no
 *    clash against anything else — and a real Input answers to their default
 *    keys, exactly as main.js's handleDiscreteInput() asks it to.
 * 2. THE ENGINE. A nudge changes the dialled-in heading, speed or
 *    climb/descend rate; the autopilot stays engaged throughout (nothing
 *    about moving a bug should ever hand control back — only the stick does
 *    that, and these never touch it); heading wraps at 0/360 instead of
 *    running off the end; speed and VS clamp at the same sane limits the
 *    pause-menu sliders already use; and a mode that works out its own
 *    heading (returning to the field) still remembers the dialled heading
 *    without letting it steer.
 */

global.document = {
  createElement: () => ({
    getContext: () => new Proxy({}, { get: () => () => ({ addColorStop() {}, data: new Uint8ClampedArray(4) }) }),
    width: 0,
    height: 0,
    style: {},
  }),
  body: { appendChild() {} },
};

const root = new URL('../../', import.meta.url);
const load = (p) => import(new URL(p, root).href);

const results = [];
function ok(name, pass, detail = '') {
  results.push({ name, pass: !!pass, detail: String(detail) });
}

/* ---------------- 1. the registry ---------------- */

await load('src/features/index.js');
const I = await load('src/flight/input.js');
const { ACTIONS, GROUPS, defaultBindings, findConflicts } = I;

const BUG_IDS = ['apHdgLeft', 'apHdgRight', 'apSpdDown', 'apSpdUp', 'apVsDown', 'apVsUp'];
ok('"Autopilot" is a real group', GROUPS.some((g) => g.id === 'Autopilot'), GROUPS.map((g) => g.id).join(', '));
const badShape = BUG_IDS.filter((id) => {
  const a = ACTIONS[id];
  return !a || !a.label || a.group !== 'Autopilot' || JSON.stringify(a.ctx) !== JSON.stringify(['plane']) || !Array.isArray(a.default) || !a.default.length;
});
ok('all six bugs are plane-only actions in the Autopilot group', badShape.length === 0, badShape.join(', ') || BUG_IDS.map((id) => `${id}:${ACTIONS[id].default}`).join(' '));
const clashes = findConflicts(defaultBindings());
const ourClashes = BUG_IDS.filter((id) => clashes[id]);
ok('none of the six clash with anything on their defaults', ourClashes.length === 0, JSON.stringify(clashes[ourClashes[0]] || {}));
const dupe = BUG_IDS.filter((id, i) => BUG_IDS.some((other, j) => j !== i && ACTIONS[other].default.some((c) => ACTIONS[id].default.includes(c))));
ok('...and no two of the six share a key with each other', dupe.length === 0, dupe.join(', '));

// A real Input answers to the defaults, same as handleDiscreteInput() asks it to.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
const win = new EventTarget();
globalThis.window = win;
const dom = { addEventListener() {}, removeEventListener() {}, requestPointerLock() {} };
const fire = (type, code) => {
  const e = new Event(type, { cancelable: true });
  e.code = code;
  win.dispatchEvent(e);
};
const inp = new I.Input(dom);
inp.context = 'plane';
for (const id of BUG_IDS) {
  const code = ACTIONS[id].default[0];
  fire('keydown', code);
  const pressed = inp.pressed(id);
  fire('keyup', code);
  inp.endFrame();
  ok(`pressing ${code} fires ${id}`, pressed, `codesFor ${I.codesFor(id)}`);
}
inp.dispose();

/* ---------------- 2. the engine ---------------- */

const AP = await load('src/flight/autopilot.js');
const fakeAc = { readouts: () => ({ altFt: 2000, aglFt: 1800, iasKts: 95, heading: 90 }) };

function nudgeHeading(ap, d) { return ap.setSelectedHeading(ap.selectedHeadingDeg + d); }
function nudgeSpeed(ap, d) { return ap.setSelectedSpeed(ap.selectedSpeedKts + d); }
function nudgeVs(ap, d) { return ap.setSelectedVs(ap.selectedVsFpm + d); }

{
  const ap = new AP.Autopilot();
  ap.setEngaged(true, fakeAc);
  ok('engaging holds the aircraft\'s own heading to start', ap.engaged && ap.holdHeadingDeg === 90, ap.holdHeadingDeg);

  const r1 = nudgeHeading(ap, 5);
  ok('a heading nudge moves the bug by exactly the step', ap.selectedHeadingDeg === 95, ap.selectedHeadingDeg);
  ok('...and it stays engaged — a bug is not the stick', ap.engaged === true, ap.engaged);
  ok('...and in "hold" it actually steers there (applied)', r1.applied === true && ap.holdHeadingDeg === 95, JSON.stringify(r1));

  const r2 = nudgeSpeed(ap, 5);
  ok('a speed nudge moves the target by the step', ap.selectedSpeedKts === 100 && r2 === 100, r2);
  ok('...still engaged', ap.engaged === true, ap.engaged);

  const r3 = nudgeVs(ap, 100);
  ok('a VS nudge moves the climb/descend rate by the step', ap.selectedVsFpm === 1000 && r3 === 1000, r3);
  ok('...still engaged', ap.engaged === true, ap.engaged);
}

// Heading wraps at 0/360 rather than running off the end, in both directions.
{
  const ap = new AP.Autopilot();
  ap.setEngaged(true, fakeAc);
  ap.setSelectedHeading(358);
  nudgeHeading(ap, 5);
  ok('heading wraps past 360 back to just past 0', ap.selectedHeadingDeg === 3, ap.selectedHeadingDeg);
  ap.setSelectedHeading(2);
  nudgeHeading(ap, -5);
  ok('...and past 0 back to just under 360', ap.selectedHeadingDeg === 357, ap.selectedHeadingDeg);
  ok('still engaged after wrapping either way', ap.engaged === true, ap.engaged);
}

// Clamps are sane: repeated nudges cannot push speed or VS past the limits
// the pause-menu sliders already enforce (55-260 kt, 200-2000 ft/min).
{
  const ap = new AP.Autopilot();
  ap.setEngaged(true, fakeAc);
  for (let i = 0; i < 60; i++) nudgeSpeed(ap, 5);
  ok('speed clamps at the top (260 kt)', ap.selectedSpeedKts === 260, ap.selectedSpeedKts);
  for (let i = 0; i < 60; i++) nudgeSpeed(ap, -5);
  ok('speed clamps at the bottom (55 kt)', ap.selectedSpeedKts === 55, ap.selectedSpeedKts);
  for (let i = 0; i < 40; i++) nudgeVs(ap, 100);
  ok('VS clamps at the top (2,000 ft/min)', ap.selectedVsFpm === 2000, ap.selectedVsFpm);
  for (let i = 0; i < 40; i++) nudgeVs(ap, -100);
  ok('VS clamps at the bottom (200 ft/min)', ap.selectedVsFpm === 200, ap.selectedVsFpm);
  ok('100 nudges in a row never once let go of it', ap.engaged === true, ap.engaged);
}

// A mode that works out its own heading (returning to the field) still
// remembers the dialled heading for later — it just does not steer by it.
{
  const ap = new AP.Autopilot();
  ap.setEngaged(true, fakeAc);
  ap.setMode('field');
  const r = nudgeHeading(ap, 5);
  ok('heading set while navigating itself is saved but not applied', r.applied === false && r.why === 'field' && ap.selectedHeadingDeg === 95, JSON.stringify(r));
  ok('mode-driven navigation never disengages it either', ap.engaged === true, ap.engaged);
}

// Nudging one bug leaves the other two exactly where they were.
{
  const ap = new AP.Autopilot();
  ap.setEngaged(true, fakeAc);
  const before = { spd: ap.selectedSpeedKts, vs: ap.selectedVsFpm };
  nudgeHeading(ap, 5);
  ok('a heading nudge does not touch speed or VS', ap.selectedSpeedKts === before.spd && ap.selectedVsFpm === before.vs, JSON.stringify(before));
}

/* ---------------- report ---------------- */

const failed = results.filter((r) => !r.pass);
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `\n      ${r.detail}` : ''}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
