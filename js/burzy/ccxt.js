/*
 * Líné načtení knihovny CCXT (vendor/ccxt, verze a otisk ve VERZE.md).
 *
 * Knihovna má 5,9 MB (1,1 MB po kompresi), proto se stahuje až ve chvíli,
 * kdy ji nějaký adaptér opravdu potřebuje. Uživatel jen s Bybitem ji
 * nestahuje vůbec. Soubor nesahá na nic jiného než na <head> (vložení
 * skriptu) — knihovna je klasický skript a ES modul ji neimportuje.
 */

let nacitani = null;

export function nactiCcxt() {
  if (globalThis.ccxt) return Promise.resolve(globalThis.ccxt);
  if (!nacitani) {
    nacitani = new Promise((ok, chyba) => {
      const s = document.createElement('script');
      s.src = new URL('../../vendor/ccxt/ccxt.browser.min.js', import.meta.url).href;
      s.async = true;
      s.onload = () => (globalThis.ccxt ? ok(globalThis.ccxt) : chyba(new Error('CCXT: knihovna se nenačetla')));
      s.onerror = () => {
        nacitani = null; // příště zkusit znovu (výpadek sítě)
        chyba(new Error('CCXT: knihovna se nenačetla'));
      };
      document.head.append(s);
    });
  }
  return nacitani;
}

/** Interval grafu (Bybit kódy, které používá aplikace) → timeframe CCXT. */
export const TIMEFRAME = {
  1: '1m', 5: '5m', 15: '15m', 30: '30m', 60: '1h', 240: '4h', D: '1d', W: '1w', M: '1M',
};

/** Délka svíčky v ms (pro výpočet začátku okna). */
export const DELKA_TF = {
  '1m': 60e3, '5m': 300e3, '15m': 900e3, '30m': 1800e3, '1h': 3600e3, '4h': 14400e3,
  '1d': 86400e3, '1w': 604800e3, '1M': 2592000e3,
};
