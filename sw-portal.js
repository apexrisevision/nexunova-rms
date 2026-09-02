// Nexunova CRM portal — minimal service worker.
// Purpose: make the portal an installable PWA (Chrome requires a SW with a fetch
// handler) WITHOUT introducing staleness. Strategy = NETWORK-FIRST for navigations
// (always the latest app when online) with an offline fallback to the cached shell.
// Scoped to /sales-portal.html only (registered with that scope) so the admin app
// (login.html) is never controlled. API/POST traffic is left untouched.
const CACHE = 'nxcrm-portal-v2';
const SHELL = '/sales-portal.html';
// The hub is served at /sales-portal.html/hub — inside this worker's scope, on
// purpose, because that is the only scope the already-installed app has. It is
// a DIFFERENT page from the shell, so it must never be written over the shell's
// cache entry, or an offline launch would show the hub in the portal's place.
const HUB = '/sales-portal.html/hub';

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
    // The hub only lives inside this worker's scope because that is the one
    // scope the already-installed app has; it is not this worker's business.
    // Handing it back to the browser untouched keeps the browser's own timeouts
    // and error page — a fetch() here has neither, and a stalled one is a
    // spinner that never ends on the way back to the doors.
    if (new URL(req.url).pathname === HUB) return;
    e.respondWith(
      fetch(req)
        .then(r => { const cp = r.clone(); caches.open(CACHE).then(c => c.put(SHELL, cp)).catch(() => {}); return r; })
        .catch(() => caches.match(SHELL))
    );
    return;
  }
  e.respondWith(fetch(req).catch(() => caches.match(req)));  // assets: network, cache fallback only when offline
});

// ── Web Push: show notification + deep-link click to the lead ──
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { body: e.data ? e.data.text() : '' }; }
  const title = d.title || 'Nexunova CRM';
  e.waitUntil(self.registration.showNotification(title, {
    body: d.body || '',
    data: { url: d.url || '/sales-portal.html' },
    icon: '/assets/icon-192.png',
    badge: '/assets/icon-192.png'
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/sales-portal.html';
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of wins) {
      if (c.url.includes('/sales-portal.html')) { try { await c.focus(); await c.navigate(url); } catch (_) {} return; }
    }
    await self.clients.openWindow(url);
  })());
});
