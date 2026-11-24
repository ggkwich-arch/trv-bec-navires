const CACHE = 'trv-bec-v4';
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['./', './index.html', './manifest.json', './icon.svg'])));
  self.skipWaiting();
});
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  if (e.request.url.includes('vessels.json')) return;
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});