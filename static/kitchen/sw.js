// Cache only the public app shell. Inventory/API responses are always network-only.
const CACHE = 'our-kitchen-shell-v2';
const SHELL = ['/kitchen/', '/kitchen/kitchen.css', '/kitchen/kitchen.js', '/kitchen/config.js', '/kitchen/manifest.webmanifest', '/kitchen/icons/icon-192.png', '/kitchen/icons/icon-512.png', '/kitchen/icons/apple-touch-icon.png'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('our-kitchen-shell-') && key !== CACHE).map(key => caches.delete(key)))));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.search || !SHELL.includes(url.pathname)) return;
  event.respondWith((async () => {
    try {
      const response = await fetch(event.request);
      if (response.ok) {
        const cache = await caches.open(CACHE);
        await cache.put(event.request, response.clone());
      }
      return response;
    } catch {
      return await caches.match(event.request) || Response.error();
    }
  })());
});
