// Nexunova CRM portal — minimal service worker.
// Purpose: make the portal an installable PWA (Chrome requires a SW with a fetch
// handler) WITHOUT introducing staleness. Strategy = NETWORK-FIRST for navigations
// (always the latest app when online) with an offline fallback to the cached shell.
// Scoped to /sales-portal.html only (registered with that scope) so the admin app
// (login.html) is never controlled. API/POST traffic is left untouched.
const CACHE = 'nxcrm-portal-v1';
const SHELL = '/sales-portal.html';

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.add(SHELL)).catch(() => {}));
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;                      // never touch POST/API mutations
  if (req.mode === 'navigate') {                          // page load → fresh, cache as offline fallback
    e.respondWith(
      fetch(req)
        .then(r => { const cp = r.clone(); caches.open(CACHE).then(c => c.put(SHELL, cp)).catch(() => {}); return r; })
        .catch(() => caches.match(SHELL))
    );
    return;
  }
  e.respondWith(fetch(req).catch(() => caches.match(req)));  // assets: network, cache fallback only when offline
});
