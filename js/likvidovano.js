/*
 * Skutečné likvidace z CEX v grafu (v0.83.0) — data ze serveru
 * (/api/likvidovano, sbírá server/likvidovano.mjs: Binance, Bybit, OKX
 * od 25. 10. 2026). Bez DOM.
 *
 * Likvidace patří ke coinu (všechny burzy v jednom řádku), cena je za
 * 1 coin — graf páru s násobkem (1000PEPE) ji přenásobí.
 */
const API = 'https://perpyx.com/api/likvidovano';
const DEN = 86400000;

/** Pár → { coin, nasobek } (stejné pravidlo jako coinParu na serveru). */
export function coinGrafu(symbol) {
  const zaklad = String(symbol || '').toUpperCase().replace(/(USDT|USDC|PERP)$/, '');
  let m = /^(1\d{3,})([A-Z].*)$/.exec(zaklad);
  if (m) return { coin: m[2], nasobek: +m[1] };
  m = /^([A-Z].*?)(1000+)$/.exec(zaklad);
  if (m) return { coin: m[1], nasobek: +m[2] };
  // Hyperliquid: kPEPE = 1000 PEPE.
  m = /^K([A-Z]{2,})$/.exec(zaklad);
  if (m && /^(PEPE|SHIB|BONK|FLOKI|LUNC|DOGS|NEIRO)$/.test(m[1])) return { coin: m[1], nasobek: 1000 };
  return { coin: zaklad, nasobek: 1 };
}

/**
 * Likvidace coinu v okně (nejvýš 30 dní zpět). Vrací
 * { udalosti: [[minuta, cena, usd, strana, burza]], t } — cena v ceně páru
 * grafu; strana 0 = zlikvidovaný long, 1 = short; burza 0 Binance, 1 Bybit, 2 OKX.
 */
export async function likvidovano({ symbol, od, doKdy }) {
  const { coin, nasobek } = coinGrafu(symbol);
  if (!coin) return null;
  const odKdy = Math.max(Math.floor(od), Date.now() - 30 * DEN);
  const r = await fetch(`${API}?c=${encodeURIComponent(coin)}&od=${odKdy}&do=${Math.floor(doKdy)}`);
  if (!r.ok) throw new Error(`likvidovano ${r.status}`);
  const d = await r.json();
  const u = d.u || [];
  return { udalosti: nasobek === 1 ? u : u.map((z) => [z[0], z[1] * nasobek, z[2], z[3], z[4]]), t: d.t };
}
