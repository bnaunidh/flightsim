/**
 * Which aeroplanes are military, and which have a tail hook. Pure, so node
 * can check every type in the roster (tests/features/carrier.mjs).
 */

/** Military, by the same rules the hangar files aeroplanes under (menus.js aircraftCategory). */
export function isMilitary(type) {
  if (!type) return false;
  /*
   * A military TRANSPORT (the C-5, aircraft/extra/giants.js: `transport:
   * true`) flies for an air force and sits behind the passcode, but it is not
   * a combat jet: no carrier, no hook, no guns, no heat-seekers — every
   * caller of this means the jets.
   */
  if (type.transport) return false;
  /*
   * The same for an UNARMED combat type (the B-1B Lancer, aircraft/extra/
   * lancer.js: `unarmed: true`): military by the passcode and the hangar's
   * shelves, but it carries nothing and has no hook.
   */
  if (type.unarmed) return false;
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
