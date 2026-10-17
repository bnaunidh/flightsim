/**
 * Render the loading-screen pictures from the game itself.
 *
 *   node tools/loading-art/capture.mjs <baseUrl> <outDir> [--only=kestrel,ember] [--preview] [--quality=ultra]
 *   python3 tools/loading-art/pack.py <outDir>        # -> assets/loading/<map>.jpg
 *
 * For each map it builds the world, loads golden-hour light (the game's own
 * 'sunset'), puts the map's own camera spot (spots.mjs) in front of it, with
 * the aeroplane, boat or van in frame, and saves the canvas as <outDir>/<map>.jpg
 * at 1920x1080 (pack.py grades it, shrinks it to 1600x900 and fits it in the
 * size budget). `--preview` renders 800x450 for quick looks. It also records
 * where each picture's subject is (run.mjs), for the phone crop.
 *
 * The in-page half is page.js (how a spot is read is written at its top).
 * Everything is the game's own: its terrain, sky, water, scenery and models. No
 * outside art, nothing from any other game. The headless Chrome comes from
 * the Mac-wide pool in .claude/devtools/cdp.mjs (two at a time); point
 * CDP at another copy of it if the tree is somewhere else.
 *
 * The page runs the real renderer at the real quality tier ('ultra' unless
 * told otherwise) with requestAnimationFrame frozen, so each picture is one
 * frame the script asks for. The game is served by any static server (serve.py).
 */
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, captureMaps, pageSource } from './run.mjs';

async function findCdp() {
  const tries = [
    process.env.CDP,
    join(ROOT, '.claude', 'devtools', 'cdp.mjs'),
    // A builder's worktree lives at <repo>/.claude/worktrees/<name>
    join(ROOT, '..', '..', 'devtools', 'cdp.mjs'),
  ].filter(Boolean);
  for (const t of tries) if (existsSync(t)) return pathToFileURL(resolve(t)).href;
  throw new Error('cdp.mjs not found; set CDP=/path/to/.claude/devtools/cdp.mjs');
}

const argv = process.argv.slice(2);
const flags = argv.filter((a) => a.startsWith('--'));
const [baseUrl, outDir] = argv.filter((a) => !a.startsWith('--'));
const flag = (k, d = null) => {
  const f = flags.find((x) => x.startsWith(`--${k}=`));
  return f ? f.slice(k.length + 3) : d;
};
if (!baseUrl || !outDir) {
  console.error('usage: node capture.mjs <baseUrl> <outDir> [--only=a,b] [--preview] [--quality=ultra]');
  process.exit(2);
}
const only = flag('only') ? flag('only').split(',') : null;
const preview = flags.includes('--preview');
const quality = flag('quality', 'ultra');
const SIZE = preview ? [800, 450, 0.85] : [1920, 1080, 0.97];

const { openPage } = await import(await findCdp());
const page = await openPage(baseUrl.includes('?') ? baseUrl : `${baseUrl}?dev=1`, { timeoutS: 300 });

// One live flight so the world, the aircraft and the clock exist; then the helper.
await page.eval(
  `sim.settings.quality = '${quality}';
   await sim.startMode('free', { time: 'sunset', condition: 'clear', windSpeedKts: 4, windDirDeg: 250, airborne: false, loadingScreen: false });
   ${pageSource()}`,
  300
);

const { ok, total } = await captureMaps({ evalFn: (body, t) => page.eval(body, t), ids: only, size: SIZE, outDir: resolve(outDir) });
if (page.logs.length) console.log('console:', page.logs.slice(-8).join('\n'));
console.log(`${ok}/${total} captured into ${outDir}`);
await page.close();
process.exit(ok === total ? 0 : 1);
