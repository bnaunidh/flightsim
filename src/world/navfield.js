/**
 * The field the radio, the approach autopilot and the landing aids are
 * working, when that is not simply "the loaded map's airport".
 *
 * Every map has had one airport, and the ATC director, the autopilot's
 * approach and "return to the field" modes, the PAPI hint and the guidance's
 * fallback all read that one (terrain.js AIRPORT, airport.js RUNWAY). The
 * World Map preview has sixteen, and the one the world was built round is
 * only the one you took off from. So the preview names the field you are
 * nearest to here (features/world-preview.js, every frame), and those five
 * readers use it when one is named. Nothing names one on any other map, so
 * there every reader does exactly what it did before.
 *
 * A field: { id, code, name, radio, cx, cz, elev, length, halfWidth, dir }
 *   radio  what the tower calls itself ("Gull" for Gull Tower)
 *   dir    +1 lands 09 (eastbound, approach from the west), -1 lands 27
 */

let FIELD = null;

export function setNavField(f) {
  FIELD = f || null;
}

/** The named field, or null (the loaded airport, as always). */
export function navField() {
  return FIELD;
}

/** Runway 09 or 27, into the wind: 09 when the wind has any east in it. */
export function landingDir(windDirDeg) {
  return Math.cos(((windDirDeg - 90) * Math.PI) / 180) >= 0 ? 1 : -1;
}

/** The threshold you land over, and the aiming point 200 m in from it (airport.js's own numbers). */
export function thresholdOf(f) {
  const x = f.cx - f.dir * (f.length / 2);
  return { x, z: f.cz, touchX: x + f.dir * 200 };
}

/** "zero nine" / "two seven". */
export function runwayWords(dir) {
  return dir > 0 ? 'zero nine' : 'two seven';
}

/** On this field's runway (with a margin), the same test terrain.js isOnRunway makes. */
export function onFieldRunway(f, x, z, margin = 0) {
  return Math.abs(z - f.cz) <= f.halfWidth + margin && Math.abs(x - f.cx) <= f.length / 2 + margin;
}

/**
 * The PAPI's answer for this field: how many of its four lights show white
 * from `pos`, and the HUD's hint (airport.js updatePapi, for any field and
 * either direction). Pure.
 */
export function papiFor(f, pos) {
  const t = thresholdOf(f);
  const dx = t.touchX - pos.x;
  const dz = f.cz - pos.z;
  const dist = Math.hypot(dx, dz);
  const alt = pos.y - f.elev;
  const approaching = Math.sign(dx) === f.dir && dist < 12000 && dist > 120 && alt > 3;
  let whites = 0;
  if (approaching) {
    const angle = (Math.atan2(alt, dist) * 180) / Math.PI;
    whites = [2.5, 2.83, 3.17, 3.5].filter((k) => angle > k).length;
  }
  let hint = null;
  if (approaching) {
    if (whites === 4) hint = { state: 'high', text: 'Too high — ease off and descend' };
    else if (whites === 0) hint = { state: 'low', text: 'Too low — add power!' };
    else if (whites === 2) hint = { state: 'good', text: 'On the perfect glide path' };
    else hint = { state: whites > 2 ? 'slightlyHigh' : 'slightlyLow', text: whites > 2 ? 'A little high' : 'A little low' };
  }
  return { whites, approaching, hint };
}
