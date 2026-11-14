// sw.js
// Service worker: offline shell via a versioned, explicit precache list.
//
// Bump CACHE_NAME (and update PRECACHE_URLS) whenever any precached file
// changes — the `install` handler re-fetches everything into the new cache,
// and `activate` deletes every cache whose name isn't the current one, which
// is how old precached assets get evicted on upgrade.

const CACHE_NAME = 'vtaper-coach-v2';

const PRECACHE_URLS = [
  'index.html',
  'manifest.webmanifest',
  'css/styles.css',
  'js/app.js',
  'js/data/plan.js',
  'js/db.js',
  'js/charts.js',
  'js/checkin.js',
  'js/nutrition.js',
  'js/progression.js',
  'js/timer.js',
  'js/ui/body.js',
  'js/ui/diet.js',
  'js/ui/progress.js',
  'js/ui/router.js',
  'js/ui/settings.js',
  'js/ui/today.js',
  'js/week.js',
  'icons/favicon.png',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  // Don't wait for old tabs to close before this version takes over install.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  // Only handle simple GET requests; let everything else (POST, etc. — none
  // currently exist in this app, but be defensive) pass straight through.
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;

      return fetch(event.request)
        .then((networkResponse) => {
          // Only cache same-origin, successful responses so we don't stash
          // opaque cross-origin responses or error pages.
          if (
            networkResponse &&
            networkResponse.ok &&
            new URL(event.request.url).origin === self.location.origin
          ) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseClone));
          }
          return networkResponse;
        })
        .catch(() => {
          // Offline and not in cache: nothing more we can do for this
          // request (the precached shell itself is always cache-first above).
          return caches.match('index.html');
        });
    })
  );
});
