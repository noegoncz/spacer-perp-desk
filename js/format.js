/**
 * Formátování čísel. Řídí se zvoleným jazykem, ne nastavením telefonu —
 * v anglické verzi má být 1,234.56, v české 1 234,56.
 */

import { getLocale } from './i18n.js';

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
  return value.toLocaleString(getLocale(), {
    minimumFractionDigits: priceDecimals(value),
    maximumFractionDigits: priceDecimals(value),
  });
}

export function formatSize(value) {
  if (!Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  const decimals = abs >= 1000 ? 0 : abs >= 1 ? 3 : 6;
  return value.toLocaleString(getLocale(), {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  });
}

export function formatUsd(value) {
  if (!Number.isFinite(value)) return '—';
  return value.toLocaleString(getLocale(), {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** PnL vždy se znaménkem, ať je na první pohled jasný směr. */
export function formatSignedUsd(value) {
  if (!Number.isFinite(value)) return '—';
  const sign = value > 0 ? '+' : value < 0 ? '−' : '';
  return `${sign}${formatUsd(Math.abs(value))}`;
}

export function formatPercent(value) {
  if (!Number.isFinite(value)) return '—';
  const sign = value > 0 ? '+' : value < 0 ? '−' : '';
  return `${sign}${Math.abs(value).toLocaleString(getLocale(), {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} %`;
}

export function formatTime(timestamp) {
  if (!timestamp) return '—';
  return new Date(timestamp).toLocaleTimeString(getLocale(), {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/** Vzdálenost mark ceny k likvidaci v procentech. */
export function liquidationDistance(position) {
  if (!position.liq || !position.mark) return null;
  return ((position.liq - position.mark) / position.mark) * 100;
}
