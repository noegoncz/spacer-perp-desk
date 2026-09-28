/**
 * Formátování čísel. Řídí se zvoleným jazykem, ne nastavením telefonu —
 * v anglické verzi má být 1,234.56, v české 1 234,56.
 */

import { getLocale } from './i18n.js';

/*
 * ⚠ Formátovače se **vyrábějí jednou a pak se používají znovu.**
 * `číslo.toLocaleString(jazyk, volby)` si při každém volání interně staví
 * nový `Intl.NumberFormat`, a to je drahé. Při čtyřech pozicích a tickerech
 * po 100 ms to byly tisíce formátovačů za vteřinu: měření
 * (tools/mereni-vykonu.py) ukázalo, že formátování čísel zabíralo přes
 * polovinu času hlavního vlákna a aplikace pak reagovala líně.
 * Klíč cache obsahuje jazyk, takže přepnutí jazyka funguje dál.
 */
const cisla = new Map();
function formatovac(min, max) {
  const klic = `${getLocale()}|${min}|${max}`;
  let f = cisla.get(klic);
  if (!f) {
    f = new Intl.NumberFormat(getLocale(), {
      minimumFractionDigits: min,
      maximumFractionDigits: max,
    });
    cisla.set(klic, f);
  }
  return f;
}

const casy = new Map();
function formatovacCasu() {
  const klic = getLocale();
  let f = casy.get(klic);
  if (!f) {
    f = new Intl.DateTimeFormat(klic, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    casy.set(klic, f);
  }
  return f;
}

/**
 * Krypto ceny mají rozsah od 100 000 (BTC) po 0,000001 (memecoiny), takže
 * pevný počet desetinných míst nedává smysl — volí se podle řádu.
 */
export function priceDecimals(value) {
  const abs = Math.abs(value);
  if (abs === 0) return 2;
  if (abs >= 1000) return 2;
  if (abs >= 10) return 3;
  if (abs >= 1) return 4;
  if (abs >= 0.01) return 5;
  if (abs >= 0.0001) return 6;
  return 8;
}

export function formatPrice(value) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const desetin = priceDecimals(value);
  return formatovac(desetin, desetin).format(value);
}

export function formatSize(value) {
  if (!Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  const decimals = abs >= 1000 ? 0 : abs >= 1 ? 3 : 6;
  return formatovac(0, decimals).format(value);
}

export function formatUsd(value) {
  if (!Number.isFinite(value)) return '—';
  return formatovac(2, 2).format(value);
}

/** PnL vždy se znaménkem, ať je na první pohled jasný směr. */
export function formatSignedUsd(value) {
  if (!Number.isFinite(value)) return '—';
  const sign = value > 0 ? '+' : value < 0 ? '−' : '';
  return `${sign}${formatUsd(Math.abs(value))}`;
}

/**
 * Procenta se znaménkem. `desetin` je kvůli fundingu — jeho sazby jsou
 * setiny procenta, na dvě místa by z 0,005 % zbyla nula.
 */
export function formatPercent(value, desetin = 2) {
  if (!Number.isFinite(value)) return '—';
  const sign = value > 0 ? '+' : value < 0 ? '−' : '';
  return `${sign}${formatovac(desetin, desetin).format(Math.abs(value))} %`;
}

export function formatTime(timestamp) {
  if (!timestamp) return '—';
  return formatovacCasu().format(new Date(timestamp));
}

/** Vzdálenost mark ceny k likvidaci v procentech. */
export function liquidationDistance(position) {
  if (!position.liq || !position.mark) return null;
  return ((position.liq - position.mark) / position.mark) * 100;
}
