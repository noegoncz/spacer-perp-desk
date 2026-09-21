/*
 * Zdroj pravdy o verzi aplikace.
 *
 * Schválně classic script (ne ES modul) — načítá ho přes importScripts()
 * i service worker, a ten by `export` nepřečetl.
 *
 * `__BUILD_ID__` nahradí deploy workflow krátkým SHA commitu. Když v UI vidíš
 * „dev", běží to z lokálního serveru, ne z Pages.
 */
self.APP_VERSION = '0.9.0';
self.APP_BUILD = '__BUILD_ID__';
