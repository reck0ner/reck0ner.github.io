// Cache only the public app shell. Inventory/API responses are always network-only.
const CACHE = 'our-kitchen-shell-v6';
const SHELL = [
  '/kitchen/', '/kitchen/kitchen.css?v=6', '/kitchen/kitchen.js?v=6',
  '/kitchen/config.js?v=6', '/kitchen/manifest.webmanifest',
  '/kitchen/icons/icon-192.png', '/kitchen/icons/icon-512.png',
  '/kitchen/icons/apple-touch-icon.png',
];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(key => key.startsWith('our-kitchen-shell-') && key !== CACHE)
      .map(key => caches.delete(key))
  )).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  const key = url.pathname + url.search;
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || !SHELL.includes(key)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (key === '/kitchen/') {
      // Prefer fresh HTML so new asset versions take effect; fall back promptly offline.
      const network = fetch(event.request).then(async response => {
        if (response.ok) await cache.put(event.request, response.clone());
        return response;
      }).catch(() => null);
      event.waitUntil(network);
      const timely = await Promise.race([network, new Promise(resolve => setTimeout(() => resolve(null), 1200))]);
      return timely || await cache.match(event.request) || await network || Response.error();
    }
    const cached = await cache.match(event.request);
    if (cached) {
      event.waitUntil(fetch(event.request).then(response => {
        if (response.ok) return cache.put(event.request, response);
      }).catch(() => {}));
      return cached;
    }
    try {
      const response = await fetch(event.request);
      if (response.ok) await cache.put(event.request, response.clone());
      return response;
    } catch {
      return Response.error();
    }
  })());
});
