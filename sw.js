/* Service worker — TRV & BEC Navires (v8).
 * v8 = vérification MarineTraffic / VesselFinder + AISStream automatique :
 * le cache change de nom pour que les téléphones prennent la nouvelle
 * version des fichiers.
 * Stratégie :
 * - data/vessels.json et data/ais_verification.json : réseau d'abord,
 *   repli sur le cache (dernières données connues). Sans réseau, l'appli
 *   affiche quand même quelque chose.
 * - pages et ressources du site : cache d'abord, puis réseau.
 * - à chaque nouvelle version du cache, les anciens caches sont supprimés.
 */
const CACHE = 'trv-bec-v8';

const PRECACHE = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json',
  './icon.svg',
  './icon-192.png',
  './icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // on ne met en cache que le site lui-même

  // Données des navires et vérification AIS : réseau d'abord, sinon
  // dernières données connues.
  if (url.pathname.endsWith('vessels.json') || url.pathname.endsWith('ais_verification.json')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // Le reste : cache d'abord, puis réseau (avec mise en cache de la réponse).
  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ||
        fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
    )
  );
});
