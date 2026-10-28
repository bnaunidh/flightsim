/**
 * Node checks for the Tomm1z video pass, item 6 — PER-TYPE TEXT
 * (.claude/devtools/briefs/tomm1z-video.md, 7:00: "lift off at 55 knots" in
 * the A321 — "that's like nothing").
 *
 *   node tests/features/tomm1z-text.mjs
 *
 * game/speed-text.js: the Skylark keeps exactly its numbers (55 / 70 / 65 /
 * 70 / 60), an airliner gets its own from the same table the HUD's coach
 * uses (ui/speed-bands.js), an offset token ({Vglide+5}) adds, an unknown
 * type falls back to the Skylark's. And the mission files themselves —
 * missions.js, campaign.js, campaign-b.js — carry no literal speed in any
 * line a player reads (text, hint, radio, dialogue, notices), only tokens,
 * and every token is a known one.
 */
import { readFileSync } from 'node:fs';
import { load, ok, report, root } from './tomm1z-common.mjs';

const S = await load('src/game/speed-text.js');
const { speedBands } = await load('src/ui/speed-bands.js');
const { performanceFor } = await load('src/aircraft/types.js');

{
  const w = S.speedWordsFor('skylark');
  ok('the Skylark keeps its own numbers: rotate 55, approach 70, glide 65, drop 70, threshold 60', w.Vr === 55 && w.Vapp === 70 && w.Vglide === 65 && w.Vdrop === 70 && w.Vthr === 60, JSON.stringify(w));
  ok('"lift off at {Vr} knots" reads 55 in the Skylark', S.resolveSpeedText('lift off at {Vr} knots', 'skylark') === 'lift off at 55 knots');
  for (const id of ['a321', 'b747']) {
    const B = speedBands(performanceFor(id));
    const w2 = S.speedWordsFor(id);
    ok(`${id}: rotate and approach are the coach's own (${B.liftOff} / ${B.approach}), never the Skylark's`, w2.Vr === B.liftOff && w2.Vapp === B.approach && w2.Vr > 70, JSON.stringify(w2));
    ok(`${id}: "lift off at {Vr} knots" says ${B.liftOff}`, S.resolveSpeedText('lift off at {Vr} knots', id) === `lift off at ${B.liftOff} knots`, S.resolveSpeedText('lift off at {Vr} knots', id));
    ok(`${id}: glide and drop speeds scale with the type`, w2.Vglide > 65 && w2.Vdrop > 70 && w2.Vthr === B.approach - 5, JSON.stringify(w2));
  }
  ok('an offset token adds: {Vglide+5} is 70 in the Skylark, {Vglide-3} is 62', S.resolveSpeedText('{Vglide+5} and {Vglide-3}', 'skylark') === '70 and 62', S.resolveSpeedText('{Vglide+5} and {Vglide-3}', 'skylark'));
  ok('a line without a token comes back untouched (the same string)', S.resolveSpeedText('Hold Shift for full power', 'a321') === 'Hold Shift for full power');
  ok('a non-string comes back as it was', S.resolveSpeedText(null, 'a321') === null && S.resolveSpeedText(undefined, 'a321') === undefined);
  ok('an unknown type falls back to the Skylark\'s numbers', S.speedWordsFor('no-such-type').Vr === 55);
  ok('hasSpeedToken() tells a token from a number', S.hasSpeedToken('at {Vr} knots') && !S.hasSpeedToken('at 55 knots'));
}

/* The mission files: no literal speed left in anything a player reads. */
{
  const files = ['src/game/missions.js', 'src/game/campaign.js', 'src/game/campaign-b.js'];
  const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const literal = /\b\d{2,3}\s*(knots|kt)\b/i;
  const words = /\b(fifty|sixty|seventy|eighty|ninety)[- ]?(five|two|one|three|four|six|seven|eight|nine)?\s+knots\b/i;
  const known = /\{V(r|app|glide|drop|thr)([+-]\d+)?\}/g;
  const anyToken = /\{V[A-Za-z]*([+-]\d+)?\}/g;
  for (const f of files) {
    const src = stripComments(readFileSync(new URL(f, root), 'utf8'));
    const lines = src.split('\n');
    const bad = [];
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      // Strings a player reads: text, hint, reward, radio, dialogue, notices and sayOnce lines.
      if (!/['"`]/.test(l)) continue;
      if (literal.test(l) || words.test(l)) bad.push(`${i + 1}: ${l.trim().slice(0, 90)}`);
    }
    ok(`${f}: no literal speed in a line a player reads (tokens instead)`, bad.length === 0, bad.join(' | '));
    const tokens = src.match(anyToken) || [];
    const unknown = tokens.filter((t) => !t.match(known));
    ok(`${f}: every speed token is a known one (${tokens.length} tokens)`, unknown.length === 0, unknown.join(' '));
  }
}

report();
