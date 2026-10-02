/**
 * Which aeroplanes are military, and which have a tail hook. Pure, so node
 * can check every type in the roster (tests/features/carrier.mjs).
 */

/** Military, by the same rules the hangar files aeroplanes under (menus.js aircraftCategory). */
export function isMilitary(type) {
  if (!type) return false;
  const cat = String(type.category || '').toLowerCase();
  if (cat) return cat === 'military';
  if (type.military) return true;
  const cls = String(type.class || '').toLowerCase();
  if (/heli|rotor/.test(cls)) return false;
  return /fighter|bomber|carrier|attack|strike|military|interceptor|stealth/.test(cls);
}

/**
 * A tail hook: every military jet except the STOVL one, which has no hook
 * (a real F-35B has none) and lands by hovering.
 */
export function hasHookFor(type) {
  if (!type) return false;
  if (type.stovl) return false;
  if (type.shape && type.shape.power && type.shape.power.rotor) return false;
  return isMilitary(type) || !!(type.shape && type.shape.hook);
}
