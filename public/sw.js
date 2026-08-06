const CACHE_NAME = 'weblogger-cms-v1';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js'
];

// Install event - Cache static shell assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    }).then(() => self.skipWaiting())
  );
});

// Activate event - Clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            return caches.delete(cache);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch event - Network-first strategy with safe scheme validation (filters chrome-extension, data, etc.)
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Cache API strictly requires http: or https: schemes.
  // Reject chrome-extension://, moz-extension://, data:, blob:, chrome://, etc.
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return;
  }

  // Only cache GET requests
  if (req.method !== 'GET') {
    return;
  }

  event.respondWith(
    fetch(req)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            // Verify URL scheme before calling cache.put to avoid unsupported scheme errors
            if (url.protocol === 'http:' || url.protocol === 'https:') {
              cache.put(req, responseToCache).catch(() => {});
            }
          }).catch(() => {});
        }
        return networkResponse;
      })
      .catch(() => {
        return caches.match(req);
      })
  );
});
