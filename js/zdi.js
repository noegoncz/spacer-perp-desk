/*
 * Zdi v knize příkazů v grafu (v0.72.0) — data ze serveru
 * (/api/zdi, sbírá server/zdi.mjs). Bez DOM.
 *
 * Server sleduje trhy s obratem ≥ 20 M a trhy, jejichž graf někdo otevřel.
 * Trh, který ještě nesleduje (`sleduje: false`), se tím dotazem zapíše
 * a do 5 min se začne sledovat; do té doby se zdi spočítají z aktuální
 * knihy burzy přímo v telefonu (js/zdi-format.js) — bez historie, „od teď“.
 */
import { najdiZdi, NASOBEK, NASOBEK_HL } from './zdi-format.js';

const API = 'https://perpyx.com/api/zdi';

/** Klíč trhu na serveru: burza + pár (Bybit v aplikaci bez předpony). */
export const klicTrhu = (burza, symbol) => `${burza || 'bybit'}:${symbol}`;

/**
 * Zdi trhu pro okno grafu. `kniha()` = slib knihy burzy ({ bids, asks })
 * pro nesledovaný trh (nepovinné). Vrací
 * { zive: [[strana, cena, usd, od, min, max]], hist: [[strana, cena, od, do, min, max]],
 *   krok, sleduje, t } nebo null.
 */
export async function zdi({ burza, symbol, od, doKdy, kniha }) {
  if (!['binance', 'bybit', 'hyperliquid'].includes(burza || 'bybit')) return null;
  const k = klicTrhu(burza, symbol);
  const r = await fetch(`${API}?k=${encodeURIComponent(k)}&od=${Math.floor(od)}&do=${Math.floor(doKdy)}`);
  if (!r.ok) throw new Error(`zdi ${r.status}`);
  const d = await r.json();
  if (d.sleduje) return { zive: d.zdi || [], hist: d.hist || [], krok: d.krok, sleduje: true, t: d.t };
  // Nesledovaný trh: aktuální kniha z burzy, zdi „od teď“.
  if (!kniha) return { zive: [], hist: d.hist || [], krok: null, sleduje: false, t: null };
  const b = await kniha();
  const v = najdiZdi(b?.bids || [], b?.asks || [], 0, burza === 'hyperliquid' ? NASOBEK_HL : NASOBEK);
  if (!v) return null;
  const ted = Date.now();
  return {
    zive: v.zdi.map(([s, i, usd]) => [s, +(i * v.krok).toPrecision(6), usd, ted, usd, usd]),
    hist: d.hist || [], krok: v.krok, sleduje: false, t: ted,
  };
}
