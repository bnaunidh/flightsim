/**
 * LOAD RELIABILITY, in the page (index.html's bootstrap, core/load-retry.js):
 *
 *   1. this page came up through the bootstrap (window.__boot says so);
 *   2. a loader that fails ONCE succeeds on the retry, without a word on
 *      screen (the importer is handed in, so the drop is made here);
 *   3. a loader that always fails — a real import of a file that is not on
 *      the server, twice — puts up the failure screen: one line, a Reload
 *      button at least 48 px tall and 200 px wide, which calls the page's
 *      reload (window.__reloadPage, stubbed here) when tapped;
 *   4. main.js's own fatal() screen has the same button;
 *   5. a Reload asked for by either button is not met by the flight's
 *      "Leave site?" guard (main.js 'beforeunload').
 *
 * Every check here fails on v75.8.
 *
 *   node one-check.mjs 'http://127.0.0.1:PORT/?mute=1' ./tests/features/load-retry.browser.js check "" 1
 */
export const id = 'load-retry';

export async function check(sim, r, say) {
  const log = (m) => { if (say) say(`load retry: ${m}`); };
  const box = document.getElementById('fatal');
  const boot = window.__boot;
  const shown = (n) => !!n && !n.hidden && n.getClientRects().length > 0;

  r.ok('load retry: the page came up through the retrying bootstrap', typeof window.__bootLoad === 'function' && !!boot && boot.ok === true && boot.attempts >= 1 && !boot.failed, JSON.stringify(boot));

  /* ---- 2. fails once ---- */
  log('a loader that fails once');
  let calls = 0;
  const rec = {};
  let got = null;
  let err = null;
  try {
    got = await window.__bootLoad(() => { calls++; return calls === 1 ? Promise.reject(new Error('net::ERR_ABORTED (made here)')) : Promise.resolve({ fine: true }); }, { backoffMs: 20, record: rec });
  } catch (e) { err = e; }
  r.ok('load retry: a load that fails once succeeds on the retry, with nothing on screen', !err && got && got.fine && calls === 2 && rec.attempts === 2 && rec.retried === true && !rec.failed && box.hidden, `calls ${calls}, ${JSON.stringify(rec)}, fatal hidden ${box.hidden}`);

  /* ---- 3. always fails: a real missing module, twice ---- */
  log('a loader that always fails');
  const reloads = [];
  const origReload = window.__reloadPage;
  window.__reloadPage = () => reloads.push(Date.now());
  const rec2 = {};
  const wasLoadingHidden = document.getElementById('loading') ? document.getElementById('loading').hidden : true;
  err = null;
  try {
    await window.__bootLoad(() => import(`/src/not-on-this-server-${Date.now()}.js`), { backoffMs: 20, record: rec2 });
  } catch (e) { err = e; }
  const btn = box.querySelector('[data-fatal-reload]');
  const line = box.querySelector('.fatal-line');
  const bb = btn ? btn.getBoundingClientRect() : null;
  r.ok('load retry: two failures put up the screen — one line and a Reload button', !!err && rec2.attempts === 2 && rec2.failed === true && shown(box) && !!btn && !!line && /Reload/.test(btn.textContent) && line.textContent.trim().length > 10 && line.textContent.trim().length < 140, `${JSON.stringify(rec2)} line "${line && line.textContent.trim()}"`);
  r.ok('load retry: the Reload button is a touch target (48 px tall, 200 px wide or more)', !!bb && bb.height >= 48 && bb.width >= 200, bb ? `${Math.round(bb.width)}x${Math.round(bb.height)}` : 'no button');
  if (btn) btn.click();
  r.ok('load retry: tapping Reload reloads the page', reloads.length === 1, `${reloads.length} reloads`);
  // Put the page back for the checks after this one.
  window.__reloadPage = origReload;
  box.hidden = true;
  box.innerHTML = '';
  if (boot) boot.failed = false;
  const loading = document.getElementById('loading');
  if (loading) loading.hidden = wasLoadingHidden;

  /* ---- 4. main.js's own fatal screen ---- */
  log('the fatal screen');
  // fatal() is not exported: the source says what it writes, and the same markup is measured here.
  const mainSrc = await fetch(new URL('../../src/main.js', import.meta.url)).then((res) => res.text()).catch(() => '');
  const fatalHas = /data-fatal-reload>Reload<\/button>/.test(mainSrc) && /querySelector\('\[data-fatal-reload\]'\)/.test(mainSrc);
  box.hidden = false;
  box.innerHTML = '<div class="fatal-card"><h2>Something went wrong</h2><p class="fatal-line">x</p><button type="button" class="fatal-reload" data-fatal-reload>Reload</button></div>';
  const b2 = box.querySelector('[data-fatal-reload]').getBoundingClientRect();
  box.hidden = true;
  box.innerHTML = '';
  r.ok('load retry: main.js fatal() has the same Reload button, styled as the same touch target', fatalHas && b2.height >= 48 && b2.width >= 200, `in source ${fatalHas}, ${Math.round(b2.width)}x${Math.round(b2.height)}`);

  /* ---- 5. Reload on purpose is not met by "Leave site?" (the checker, 2026-10-31) ---- */
  // An error in a flight put up fatal(); its Reload, tapped, raised the
  // browser's own "Leave site?" box (main.js 'beforeunload', the flight
  // guard) before it reloaded anything. A reload asked for by a button sets
  // window.__leavingOnPurpose first, and the guard stands aside for it.
  log('Reload in a flight');
  const htmlSrc = await fetch(new URL('../../index.html', import.meta.url)).then((res) => res.text()).catch(() => '');
  const bootSets = /__reloadPage = function \(\) \{ window\.__leavingOnPurpose = true; location\.reload\(\); \}/.test(htmlSrc);
  const fatalSets = /data-fatal-reload\]'\);\s*if \(btn\) btn\.addEventListener\('click', \(\) => \{\s*window\.__leavingOnPurpose = true;/.test(mainSrc);
  const guardReads = /if \(window\.__leavingOnPurpose \|\| this\._errored \|\| !this\.unloadGuard\(\)\) return undefined;/.test(mainSrc);
  const stateWas = sim.state;
  let guarded = null;
  let onPurpose = null;
  try {
    if (sim.state !== 'flying') await sim.startMode('free', { aircraft: 'skylark', airborne: true });
    sim.step(0.2);
    const ev1 = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(ev1);
    guarded = sim.unloadGuard() === true && ev1.defaultPrevented === true;
    window.__leavingOnPurpose = true;
    const ev2 = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(ev2);
    onPurpose = ev2.defaultPrevented === false;
  } finally {
    window.__leavingOnPurpose = false;
    if (stateWas === 'menu' && sim.state !== 'menu' && sim.quitToMenu) sim.quitToMenu();
  }
  r.ok('load retry: in a flight a plain leave still asks first, but a Reload asked for on purpose (both screens\' buttons) is not met by "Leave site?"', guarded && onPurpose && bootSets && fatalSets && guardReads, `guarded ${guarded}, on purpose passes ${onPurpose}, index.html sets ${bootSets}, fatal() sets ${fatalSets}, guard reads ${guardReads}`);
}
