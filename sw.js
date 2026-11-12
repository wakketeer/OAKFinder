// Offline cache for the app files. Bump VERSION on every deploy so phones pick up changes.
const VERSION = 'oak-capture-v1';
const FILES = [
  './',
  'index.html',
  'styles.css',
  'manifest.webmanifest',
  'js/app.js',
  'js/db.js',
  'js/image.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Serve from cache first so the app opens instantly with no signal; refresh the cache when online.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const key = req.mode === 'navigate' ? './' : req;
    const cached = await cache.match(key, { ignoreSearch: true });
    const network = fetch(req)
      .then((res) => { if (res.ok) cache.put(key, res.clone()); return res; })
      .catch(() => null);
    if (cached) { e.waitUntil(network); return cached; }
    return (await network) || new Response('Offline', { status: 503 });
  })());
});
