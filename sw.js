/* MeasureMate — sw.js
   Offline support: cache the app shell on install, serve cached
   assets first, fall back to network for anything not cached. */
var CACHE = 'measuremate-v1';
var ASSETS = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'db.js',
  'measurements.js',
  'fit-checker.js',
  'manifest.webmanifest',
  'assets/icon-192.png',
  'assets/icon-512.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) { return cache.addAll(ASSETS); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; })
        .map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  if (event.request.method !== 'GET') return;
  var url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    caches.match(event.request).then(function (cached) {
      if (cached) return cached;
      return fetch(event.request).then(function (response) {
        if (response && response.ok) {
          var copy = response.clone();
          caches.open(CACHE).then(function (cache) { cache.put(event.request, copy); });
        }
        return response;
      }).catch(function () { return caches.match('index.html'); });
    })
  );
});
