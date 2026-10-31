/**
 * TOUCH WORDING (the Nov 4 demo pass, 2026-10-30).
 *
 * The coaching line, the toasts and the objective are written for a
 * keyboard: "Hold <kbd>Shift</kbd> for full power", "Press <kbd>G</kbd>
 * before you land". On a phone or a tablet there is no Shift and no G —
 * there is a throttle slider, a stick, and pads that say GEAR and FLAPS
 * (ui/touch.js) — and the rival study caught "Hold Shift for full power"
 * on a 390 px phone. Hud.words() runs every line through here when the HUD
 * is in its touch layout (.is-touch); on a keyboard the line is as written.
 *
 * Whole phrases first (they read best), then the single keys that are
 * left, then any <kbd> nobody named is dropped with its verb. Plain text in,
 * plain text out: the HUD escapes nothing here and the lines carry no other
 * markup than <kbd> and <b>.
 */

/** [pattern, replacement] in order; the first match of each applies everywhere it occurs. */
export const TOUCH_PHRASES = [
  // A line that already names the touch control ("press 7 (or tap the button)") says only that.
  [/\b(Press|press) <kbd>[^<]{1,12}<\/kbd> \(or tap ([^)]+)\)/g, (m, verb, what) => `${verb === 'Press' ? 'Tap' : 'tap'} ${what}`],
  [/Hold <kbd>Shift<\/kbd> for full power/g, 'Slide the throttle all the way up for full power'],
  [/Hold <kbd>Shift<\/kbd> — you need (\d+) knots to fly/g, 'Throttle all the way up — you need $1 knots to fly'],
  [/Now pull back gently on <kbd>S<\/kbd> to fly!/g, 'Now ease the stick back gently to fly!'],
  [/Keep straight with <kbd>Q<\/kbd> \/ <kbd>E<\/kbd>/g, 'Keep straight with the rudder slider'],
  [/Hold <kbd>Space<\/kbd> to brake/g, 'Hold BRAKES to slow down'],
  [/Press <kbd>I<\/kbd> to start the engine/g, 'Tap ENGINE to start the engine'],
  [/Press <kbd>Esc<\/kbd> and choose <b>Restart<\/b>/g, 'Tap the pause button and choose <b>Restart</b>'],
  [/ease the power right off with <kbd>Ctrl<\/kbd>/g, 'slide the throttle right down'],
  [/ease the power off with <kbd>Ctrl<\/kbd>/g, 'slide the throttle down'],
  [/Add power with <kbd>Shift<\/kbd> and lower the nose with <kbd>W<\/kbd>/g, 'Slide the throttle up and push the stick forward'],
  [/add power with <kbd>Shift<\/kbd>/g, 'slide the throttle up'],
  [/Push the nose down with <kbd>W<\/kbd>/g, 'Push the stick forward'],
  [/Landing gear! Press <kbd>G<\/kbd> before you land/g, 'Landing gear! Tap GEAR before you land'],
  [/Press <kbd>F<\/kbd> for flaps/g, 'Tap FLAPS for flaps'],
  [/Ease back on <kbd>S<\/kbd>/g, 'Ease the stick back'],
  // The single keys that are left, as the control that stands in for each.
  [/(?:Hold|hold) <kbd>Shift<\/kbd>/g, 'slide the throttle up'],
  [/(?:Hold|hold) <kbd>Ctrl<\/kbd>/g, 'slide the throttle down'],
  [/(?:Hold|hold) <kbd>Space<\/kbd>/g, 'hold BRAKES'],
  [/(?:Press|press) <kbd>G<\/kbd>/g, 'tap GEAR'],
  [/(?:Press|press) <kbd>F<\/kbd>/g, 'tap FLAPS'],
  [/(?:Press|press) <kbd>I<\/kbd>/g, 'tap ENGINE'],
  [/(?:Press|press) <kbd>C<\/kbd>/g, 'tap the camera button'],
  [/(?:Press|press) <kbd>M<\/kbd>/g, 'tap MAP'],
  [/(?:Press|press) <kbd>Esc<\/kbd>/g, 'tap the pause button'],
  [/(?:Press|press) <kbd>H<\/kbd>/g, 'tap the help button'],
  [/<kbd>W<\/kbd>/g, 'the stick forward'],
  [/<kbd>S<\/kbd>/g, 'the stick back'],
  [/<kbd>A<\/kbd> \/ <kbd>D<\/kbd>/g, 'the stick left or right'],
  [/<kbd>Q<\/kbd> \/ <kbd>E<\/kbd>/g, 'the rudder slider'],
];

/** Is there a key named in this line at all? */
export function hasKeyWords(text) {
  return typeof text === 'string' && /<kbd>|\b(?:Press|press|Hold|hold|Tap|tap) (?:Shift|Ctrl|Space|Esc|Enter|[A-Z0-9])(?![\w'’])/.test(text);
}

/**
 * The line as a touch player should read it. A phrase nobody translated
 * loses its "Press <kbd>X</kbd>" / "Hold <kbd>X</kbd>" and keeps its
 * meaning ("Press <kbd>V</kbd> to drop the crate" → "Drop the crate"), so
 * no key name reaches a screen that has none.
 */
export function touchWording(text) {
  if (typeof text !== 'string' || !text || !hasKeyWords(text)) return text;
  /*
   * A toast written in plain text ("Cockpit view — press C to look from
   * outside again", "press Esc to go back", "press I again within 3 s")
   * names its key without a <kbd>: it is wrapped in one first, so the same
   * phrases and the same dropping apply to it (the checker found these on a
   * touchscreen, 2026-10-31).
   */
  let out = text.replace(/\b(Press|press|Hold|hold|Tap|tap) (Shift|Ctrl|Space|Esc|Enter|[A-Z0-9])(?![\w'’<])/g, '$1 <kbd>$2</kbd>');
  for (const [re, rep] of TOUCH_PHRASES) out = out.replace(re, rep);
  // "Press <kbd>X</kbd> to do the thing" → "Do the thing".
  out = out.replace(/\b(?:Press|Hold|Tap) <kbd>[^<]{1,12}<\/kbd> (?:to|and) (\w)([^<.!]*)/g, (m, c, rest) => c.toUpperCase() + rest);
  out = out.replace(/\b(?:press|hold|tap) <kbd>[^<]{1,12}<\/kbd> (?:to|and) /g, '');
  // A key with no verb left: just the word in it is no use; say "the controls".
  out = out.replace(/\(<kbd>[^<]{1,12}<\/kbd>\)/g, '');
  out = out.replace(/<kbd>[^<]{1,12}<\/kbd>/g, 'the controls');
  // Tidy: doubled spaces, a space before punctuation, a sentence that now starts in lower case.
  return out
    .replace(/ {2,}/g, ' ')
    .replace(/ ([,.!?])/g, '$1')
    .trim()
    .replace(/(^|[.!?] )([a-z])/g, (m, p, c) => p + c.toUpperCase());
}
