/* Inkwell service worker: offline app shell + runtime-cached CDN libraries.
   User data lives in IndexedDB; this worker never touches it.
   Bump VERSION whenever the shell files change. */
var VERSION = 'v11-2026-11-19';
var SHELL_CACHE = 'inkwell-shell-' + VERSION;
var RUNTIME_CACHE = 'inkwell-runtime-' + VERSION;
var APP_SHELL = [
  '/',
  'index.html',
  'styles.css',
  'app.js',
  'icon-192.png',
  'icon-512.png',
  'icon-512-maskable.png',
  'manifest.json'
];
var CDN_HOSTS = [
  'cdnjs.cloudflare.com',
  'cdn.jsdelivr.net',
  'fonts.googleapis.com',
  'fonts.gstatic.com'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(function (cache) {
      return cache.addAll(APP_SHELL);
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (key) {
        return key !== SHELL_CACHE && key !== RUNTIME_CACHE;
      }).map(function (key) { return caches.delete(key); }));
    }).then(function () { return self.clients.claim(); })
  );
});

function isCdn(url) { return CDN_HOSTS.indexOf(url.host) !== -1; }

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);

  // Navigations: network first, cached index.html when offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).then(function (res) {
        return res;
      }).catch(function () {
        return caches.match('index.html');
      })
    );
    return;
  }

  // CDN libraries: stale-while-revalidate.
  if (isCdn(url)) {
    event.respondWith(
      caches.match(req).then(function (cached) {
        var network = fetch(req).then(function (res) {
          if (res && (res.ok || res.type === 'opaque')) {
            var copy = res.clone();
            caches.open(RUNTIME_CACHE).then(function (cache) { cache.put(req, copy); });
          }
          return res;
        }).catch(function () { return cached; });
        return cached || network;
      })
    );
    return;
  }

  // Same-origin files: network first so edits appear immediately, with the
  // cached copy as the offline fallback.
  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(req).then(function (res) {
        if (res && res.ok) {
          var copy = res.clone();
          caches.open(SHELL_CACHE).then(function (cache) { cache.put(req, copy); });
        }
        return res;
      }).catch(function () {
        return caches.match(req, { ignoreSearch: true });
      })
    );
  }
});
