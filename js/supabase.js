const SUPABASE_URL = 'https://itqxljtfbrppntgyfush.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_OkIT2ttNgBiOm-E4HJLnFw_OmIz-8VG';

const { createClient } = window.supabase;

// ── Auth lock override ───────────────────────────────────────────────
// supabase-js 2.34.0 serialises every auth op (getSession / signIn /
// signOut / token refresh) behind a single Web Lock and acquires it with an
// INFINITE timeout (`_acquireLock(-1, …)`). doLogout() fires a
// `signOut().catch()` fire-and-forget; if that op (or a refresh tick) ends up
// holding the lock without releasing, the very next `signInWithPassword()`
// waits on it forever — which is exactly the "Signing in… stuck until you
// refresh the page" bug after logout. A page refresh frees it only because the
// whole JS context (and its Web Locks) is torn down.
//
// We replace the lock with an in-memory promise-chain mutex that still
// serialises auth ops (so cross-tab/refresh token races stay safe) but caps how
// long any op will wait for its predecessor, so a stuck/abandoned op can never
// deadlock the next one. No page refresh needed to log back in.
let _authLockChain = Promise.resolve();
function _authLock(_name, acquireTimeout, fn) {
  const waitMs = acquireTimeout > 0 ? acquireTimeout : 8000; // default -1 → cap at 8s
  const prev = _authLockChain;
  let release;
  _authLockChain = new Promise(res => { release = res; });
  return (async () => {
    try { await Promise.race([ prev.catch(() => {}), new Promise(r => setTimeout(r, waitMs)) ]); }
    catch (_) {}
    try { return await fn(); }
    finally { release(); }
  })();
}

// flowType:'pkce' is required — v2.34.0 defaults to 'implicit'.
// Without PKCE the reset email lands with #access_token= hash, not ?code=,
// so exchangeCodeForSession() never fires and password reset is broken.
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    flowType: 'pkce',
    detectSessionInUrl: true,
    lock: _authLock,
  }
});
