// Offline shell: the app opens without signal; live features reconnect when it returns.
const VERSION = 'rylaide-v2';
const SHELL = [
  '/', '/styles.css', '/manifest.webmanifest',
  '/js/app.js', '/js/api.js', '/js/map.js', '/js/voice.js', '/js/util.js', '/js/ui.js', '/js/icons.js', '/js/theme.js',
  '/js/state.js', '/js/router.js', '/js/engine.js',
  '/js/screens/onboarding.js', '/js/screens/home.js', '/js/screens/groups.js', '/js/screens/history.js',
  '/js/screens/garage.js', '/js/screens/setup.js', '/js/screens/ride.js',
  '/vendor/maplibre/maplibre-gl.js', '/vendor/maplibre/maplibre-gl.css',
  '/icons/icon-192.png', '/icons/favicon.svg',
  '/fonts/symbols.woff2', '/fonts/google-sans-flex-latin-wght-normal.woff2', '/fonts/roboto-latin-400-normal.woff2', '/fonts/roboto-latin-500-normal.woff2',
  '/img/bike-classic.jpg', '/img/bike-adventure.jpg', '/img/group-ride.jpg', '/img/ghat-road.jpg',
];
const TILE_CACHE = 'rylaide-tiles';
const TILE_MAX = 1500;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== TILE_CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Map tiles: cache what you've seen so recently viewed areas still show without signal.
  if (url.hostname === 'tiles.openfreemap.org') {
    e.respondWith(caches.open(TILE_CACHE).then(async (c) => {
      const hit = await c.match(req);
      const net = fetch(req).then((r) => {
        if (r.ok) { c.put(req, r.clone()); trim(c); }
        return r;
      }).catch(() => hit);
      return hit || net;
    }));
    return;
  }
  if (url.origin !== location.origin || url.pathname.startsWith('/api/') || url.pathname === '/ws') return;

  // App shell: network first so updates land immediately, cache as fallback.
  e.respondWith(fetch(req).then((r) => {
    if (r.ok) { const copy = r.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
    return r;
  }).catch(async () => (await caches.match(req)) || (req.mode === 'navigate' ? caches.match('/') : Response.error())));
});

let trimming = false;
async function trim(c) {
  if (trimming) return;
  trimming = true;
  const keys = await c.keys();
  for (let i = 0; i < keys.length - TILE_MAX; i++) await c.delete(keys[i]);
  trimming = false;
}
