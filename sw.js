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
  './js/chart.js',
  './js/draw.js',
  './js/indikatory.js',
  './js/alarmy.js',
  './js/alarmy-logika.js',
  './js/sestavy.js',
  './js/zaloha.js',
  './js/ucet.js',
  './js/zamek.js',
  './js/push.js',
  './js/alarmy-server.js',
  './js/hlaseni.js',
  './js/pozvanky.js',
  './js/dlazdice.js',
  './js/i18n.js',
  './js/i18n/en.js',
  './js/i18n/cs.js',
  './vendor/klinecharts.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      // cache: 'reload' obchází HTTP cache prohlížeče. GitHub Pages servíruje
      // soubory s max-age=600, takže bez tohohle si instalace nové verze
      // klidně uloží až deset minut starou kopii — a protože každý soubor
      // vyprší jindy, vznikne míchanice nové a staré verze.
      cache.addAll(SHELL.map((url) => new Request(url, { cache: 'reload' }))),
    ),
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
  // Poznámky k nové verzi patří k serveru, ne k cache (a mají jedinečný
  // parametr, takže by se cache jen zbytečně plnila).
  if (url.pathname.endsWith('/novinky.json')) return;

  /*
   * ⚠ Všechno z cache **této verze**, bez čekání na síť (v0.34.0).
   *
   * Dřív šla index.html vždy nejdřív na server (na mobilní síti klidně
   * vteřina i víc, než se vůbec začalo něco kreslit) a ostatní soubory se
   * při každém startu stahovaly znovu na pozadí — ~25 požadavků, které se
   * na mobilu praly s prvními dotazy na burzu, a navíc do cache běžící
   * verze tahaly soubory z novější verze na serveru (míchanice verzí).
   *
   * Nová verze se do telefonu dostává jinou cestou: každé nasazení mění
   * sw.js (BUILD_ID), prohlížeč nainstaluje nový worker, ten si do své
   * cache stáhne celou novou sadu souborů (install, cache: 'reload')
   * a po „Aktualizovat" se přepne. Běžící verze tedy má vždy svou
   * úplnou a konzistentní sadu.
   */
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const klic = request.mode === 'navigate' ? './index.html' : request;
      const cached = await cache.match(klic, { ignoreSearch: request.mode === 'navigate' });
      if (cached) return cached;
      // Co v cache není (soubor mimo SHELL, první spuštění): ze sítě a uložit.
      try {
        const fresh = await fetch(request, { cache: 'no-cache' });
        if (fresh.ok && request.mode !== 'navigate') cache.put(request, fresh.clone());
        return fresh;
      } catch {
        return (await caches.match(klic, { ignoreSearch: true })) || Response.error();
      }
    })(),
  );
});
