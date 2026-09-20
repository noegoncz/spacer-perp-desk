/*
 * Service worker.
 *
 * `__BUILD_ID__` nahradí deploy workflow krátkým SHA commitu — a to je důvod,
 * proč je placeholder i tady, ne jen ve version.js: prohlížeč pozná novou verzi
 * podle změny bajtů tohohle souboru.
 *
 * Nová verze se nikdy neaktivuje sama. Čeká ve `waiting`, dokud uživatel
 * neklikne na „Nová verze – načíst" a aplikace nepošle SKIP_WAITING. Jinak by
 * se stránka mohla přenačíst uprostřed sledování pozice.
 */

importScripts('js/version.js');

const BUILD_ID = '__BUILD_ID__';
const CACHE = `perp-desk-${self.APP_VERSION}-${BUILD_ID}`;

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/style.css',
  './js/version.js',
  './js/app.js',
  './js/bybit.js',
  './js/store.js',
  './js/format.js',
  './js/ui.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((n) => n.startsWith('perp-desk-') && n !== CACHE)
             .map((n) => caches.delete(n)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Bybit se nikdy necachuje ani neobchází — data musí být vždy živá.
  if (url.origin !== self.location.origin) return;

  // Navigace: nejdřív síť, ať se nedrží stará index.html.
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request);
          const cache = await caches.open(CACHE);
          cache.put('./index.html', fresh.clone());
          return fresh;
        } catch {
          const cached = await caches.match('./index.html');
          return cached || Response.error();
        }
      })(),
    );
    return;
  }

  // Ostatní soubory: z cache hned, na pozadí se obnoví.
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(request);

      const network = fetch(request)
        .then((response) => {
          if (response.ok) cache.put(request, response.clone());
          return response;
        })
        .catch(() => null);

      return cached || (await network) || Response.error();
    })(),
  );
});
