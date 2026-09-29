/**
 * The van's chevron on the last stretch to a drop-off, in node, no browser:
 *
 *   node tests/features/car-tracker.test.mjs
 *
 * The second review's blocker, as numbers. RouteTracker said ARRIVING /
 * "drop it here" with 45 m of ROUTE left, and the job only takes a stop
 * within 34 m of its target (jobs.js ARRIVE_R), so a careful kid who stopped
 * when told sat 37-40 m short for ever; and past the end of the route there
 * was no route left, so it said ARRIVING wherever the van was. Measured on
 * the first pass (a2dff77) with this file's cases: ARRIVING in all eight —
 * 40 m short at 30 km/h, and 25, 37 and 100 m past the drop-off.
 *
 * A straight road east to a drop-off at x = 200, the van on it facing east.
 */
import { RouteTracker } from '../../src/ui/hud-drive.js';

const route = [];
for (let x = 0; x <= 200; x += 16) route.push({ x, z: 0 });
route.push({ x: 200, z: 0 });

// [what, van x, speed m/s, the words the chevron must say]
const CASES = [
  ['40 m short at 30 km/h: not ARRIVING yet', 160, 8.3, 'NEARLY THERE'],
  ['30 m short at 30 km/h: inside the zone', 170, 8.3, 'ARRIVING'],
  ['30 m short at 108 km/h: inside, and brake now', 170, 30, 'ARRIVING', true],
  ['on it, stopped', 200, 0, 'ARRIVING'],
  ['25 m past, going away at 54 km/h: it cannot stop in the zone', 225, 15, 'BACK UP'],
  ['37 m past, stopped (the reviewer\'s Night Call-out)', 237, 0, 'BACK UP'],
  ['37 m past, already reversing', 237, -3, 'BACK UP'],
  ['100 m past, stopped', 300, 0, 'TURN AROUND'],
];

let failed = 0;
for (const [what, x, v, want, brake] of CASES) {
  const t = new RouteTracker(route.slice());
  // What the courier guide sets every frame (jobs.js CourierGuide.update).
  t.stopAtEnd = true;
  t.goalX = 200;
  t.goalZ = 0;
  t.arriveR = 34;
  const a = t.next({ x, z: 0 }, 90, 30, 1600, v, 1);
  const got = a ? a.label : 'nothing';
  const ok = got === want && (brake == null || !!a.brake === brake)
    // TO GO is never nought short of the zone or past it.
    && (!a || x === 200 || a.remainingM >= 20);
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${what}: ${got}${a && a.brake ? ' (brake)' : ''}, to go ${a ? a.remainingM.toFixed(0) : '-'} m`);
}

// A split you drive through, and free drive's places, are not stops.
{
  const t = new RouteTracker(route.slice());
  t.stopAtEnd = false;
  const a = t.next({ x: 170, z: 0 }, 90, 30, 1600, 8.3, 1);
  const ok = !!a && a.label === 'ARRIVING' && t.stopAtEnd === false;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'} a split, 30 m short: ${a ? a.label : 'nothing'}`);
}

console.log(failed ? `${failed} FAILED` : 'all passed');
if (typeof process !== 'undefined') process.exitCode = failed ? 1 : 0;
