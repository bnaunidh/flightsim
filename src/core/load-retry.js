/**
 * LOAD RELIABILITY (the Nov 4 demo pass, 2026-10-30).
 *
 * The rival study (.claude/devtools/briefs/rival-sr71-deep.md) saw one of
 * four cold loads die on "Could not load the game" because ONE of the 442
 * module and asset requests was aborted — and that screen had no way back
 * but the browser's own reload. A classroom loading at once on one wifi is
 * exactly when a request drops.
 *
 * Two answers, in one place:
 *   - fetchRetry(): an asset fetch (a .glb, a font, a sound manifest) that
 *     failed — a network error, or a 5xx / 408 / 429 answer — is asked for
 *     again once, after a short back-off. A 404 is not retried: the file is
 *     not there, and asking twice does not make it so.
 *   - retrying(): the same for any promise-returning loader (a dynamic
 *     import()). index.html's bootstrap carries its own copy of this logic
 *     (it runs before any module can), with the Reload screen.
 *
 * No DOM here: the tests run it in node.
 */

/** The wait before the second try, in ms (`attempt` is 1 for the first retry). */
export const RETRY_BACKOFF_MS = 600;

/** How many times a failed load is tried again. */
export const RETRIES = 1;

/** An HTTP status worth a second try: the server or the network is having a moment, not a missing file. */
export function retryableStatus(status) {
  return status === 408 || status === 429 || status >= 500;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Run `attempt()` (returns a promise); on rejection try again `retries`
 * times with `backoffMs * n` between tries. `shouldRetry(err)` can say no
 * (a 404). `onRetry(err, n)` is told each time.
 */
export async function retrying(attempt, { retries = RETRIES, backoffMs = RETRY_BACKOFF_MS, shouldRetry = () => true, onRetry = null, wait = sleep } = {}) {
  let n = 0;
  for (;;) {
    try {
      return await attempt(n);
    } catch (err) {
      if (n >= retries || !shouldRetry(err)) throw err;
      n++;
      if (onRetry) onRetry(err, n);
      await wait(backoffMs * n);
    }
  }
}

/**
 * fetch() with one retry on a network error or a retryable status. Resolves
 * to the Response (whatever its status, after the retries are spent) so the
 * caller's own `res.ok` check stays the law.
 */
export function fetchRetry(url, init, opts = {}) {
  const f = opts.fetch || (typeof fetch === 'function' ? fetch : null);
  if (!f) return Promise.reject(new Error('fetch is not available'));
  return retrying(
    async () => {
      const res = await f(url, init);
      if (retryableStatus(res.status)) {
        const err = new Error(`${url}: HTTP ${res.status}`);
        err.response = res;
        throw err;
      }
      return res;
    },
    { ...opts, shouldRetry: (err) => !(err && err.response) || retryableStatus(err.response.status) }
  ).catch((err) => {
    // The retries are spent: hand the last answer back as a Response when there was one.
    if (err && err.response) return err.response;
    throw err;
  });
}
