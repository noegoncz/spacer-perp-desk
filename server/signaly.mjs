/**
 * Signály na grafech — hlídání RSI divergence na serveru (v0.89.0;
 * v0.90.0 pravidla po párech, přání uživatele).
 *
 * Běží uvnitř hlídače alarmů (hlidac.mjs). Telefon posílá pravidla stejnou
 * cestou jako cenové alarmy (/api/account/alarms), jedno na pár:
 * `{ id: 'sig-…', typ: 'divergence', symboly: ['binance:BTCUSDT'], intervaly: ['60','240'], faze: 2 }`
 * — pár, který si uživatel zapnul zvonkem v panelu RSI (js/signaly.js).
 * `faze`: 1 / 2 = upozornit na rozpracovanou divergenci (1 / 2 uzavřené
 * svíčky za pivotem), 3 = až na potvrzenou. Na jednu divergenci jedna
 * notifikace na účet.
 *
 * Po uzavření svíčky každého timeframu stáhne hlídač poslední svíčky
 * hlídaných párů (veřejné REST, žádné klíče) a spočítá divergenci stejným
 * kódem jako graf (js/divergence.js).
 */
import { novaDivergence, novaRozpracovana, VYCHOZI } from '../js/divergence.js';

const H = 3600e3;
const INTERVALY = {
  1: { ms: 60e3, binance: '1m', popis: '1m' },
  5: { ms: 5 * 60e3, binance: '5m', popis: '5m' },
  15: { ms: 15 * 60e3, binance: '15m', popis: '15m' },
  30: { ms: 30 * 60e3, binance: '30m', popis: '30m' },
  60: { ms: H, binance: '1h', popis: '1h' },
  240: { ms: 4 * H, binance: '4h', popis: '4h' },
  D: { ms: 24 * H, binance: '1d', popis: '1D' },
  // Týdenní svíčky začínají v pondělí 00:00 UTC (epocha je čtvrtek).
  W: { ms: 7 * 24 * H, binance: '1w', popis: '1W', posun: 4 * 24 * H },
};
const PO_UZAVRENI = 20000;      // burza dá uzavřenou svíčku do pár vteřin
const POZDE = 10 * 60e3;        // svíčka zavřená dřív (restart) se už nehlásí
const ROZESTUP = 120;           // ms mezi dotazy na burzu
const SVICEK = 200;

const TEXTY = {
  byci: {
    cs: 'Býčí RSI divergence', en: 'Bullish RSI divergence',
    csRozpr: 'Rýsuje se býčí RSI divergence', enRozpr: 'Bullish RSI divergence forming', smer: 'nahoru',
  },
  medvedi: {
    cs: 'Medvědí RSI divergence', en: 'Bearish RSI divergence',
    csRozpr: 'Rýsuje se medvědí RSI divergence', enRozpr: 'Bearish RSI divergence forming', smer: 'dolu',
  },
};

const cekej = (ms) => new Promise((r) => setTimeout(r, ms));

async function stahni(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'PerpyX-hlidac/1' }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** Začátek poslední uzavřené svíčky timeframu v čase `ted`. */
export function posledniUzavrena(interval, ted = Date.now()) {
  const { ms, posun = 0 } = INTERVALY[interval];
  return posun + Math.floor((ted - posun) / ms) * ms - ms;
}

/** Uzavřené svíčky páru, nejstarší první, `{ timestamp, open, high, low, close }`. */
export async function svicky(symbol, interval) {
  interval = String(interval);
  const i = symbol.indexOf(':');
  const burza = i < 0 ? 'bybit' : symbol.slice(0, i);
  const par = i < 0 ? symbol : symbol.slice(i + 1);
  let rada;
  if (burza === 'binance') {
    const d = await stahni(`https://fapi.binance.com/fapi/v1/klines?symbol=${par}&interval=${INTERVALY[interval].binance}&limit=${SVICEK}`);
    rada = d.map((k) => ({ timestamp: Number(k[0]), open: +k[1], high: +k[2], low: +k[3], close: +k[4] }));
  } else if (burza === 'bybit') {
    const d = await stahni(`https://api.bybit.com/v5/market/kline?category=linear&symbol=${par}&interval=${interval}&limit=${SVICEK}`);
    if (d.retCode !== 0) throw new Error(d.retMsg || `retCode ${d.retCode}`);
    rada = (d.result?.list || []).map((k) => ({ timestamp: Number(k[0]), open: +k[1], high: +k[2], low: +k[3], close: +k[4] })).reverse();
  } else {
    return [];
  }
  // Poslední svíčka bývá ještě otevřená — ta do výpočtu nepatří.
  const ted = Date.now();
  return rada.filter((s) => s.timestamp + INTERVALY[interval].ms <= ted);
}

/** „binance:JUPUSDT" → „JUPUSDT (Binance)", Bybit beze změny. */
function nazevParu(symbol) {
  const i = symbol.indexOf(':');
  return i < 0 ? symbol : `${symbol.slice(i + 1)} (${symbol.slice(0, i) === 'binance' ? 'Binance' : symbol.slice(0, i)})`;
}

/**
 * Spustí hlídání. `alarmy()` vrátí aktuální signálová pravidla (s `account`
 * a `jazyk`), `posli(account, zprava, pravidlo)` doručí push na zařízení účtu.
 */
export function spustSignaly({ alarmy, posli, log }) {
  const hotovo = {};           // interval → čas otevření poslední zpracované svíčky
  const odeslano = new Set();  // účet|symbol|interval|pivot|typ — jedna divergence jednou
  let bezi = false;
  let stav = 'zatím nic';

  async function zpracuj(interval, otevreni) {
    interval = String(interval);
    const hlidane = new Map();   // symbol → [pravidla]
    for (const a of alarmy()) {
      if (!(a.intervaly || []).map(String).includes(interval)) continue;
      for (const s of a.symboly || []) {
        if (typeof s !== 'string' || !s) continue;
        if (!hlidane.has(s)) hlidane.set(s, []);
        hlidane.get(s).push(a);
      }
    }
    let nalezeno = 0;
    let chyb = 0;
    for (const [symbol, kdo] of hlidane) {
      try {
        const rada = await svicky(symbol, interval);
        // Burza ještě nemá uzavřenou svíčku, na kterou čekáme → přeskočit,
        // jinak by se divergence z předchozí svíčky ohlásila znovu.
        if (rada.at(-1)?.timestamp !== otevreni) continue;
        const podleFaze = {
          1: novaRozpracovana(rada, 1),
          2: novaRozpracovana(rada, 2),
          3: novaDivergence(rada),
        };
        for (const a of kdo) {
          const faze = [1, 2, 3].includes(Number(a.faze)) ? Number(a.faze) : 2;
          for (const d of podleFaze[faze]) {
            const klic = `${a.account}|${symbol}|${interval}|${d.do.cas}|${d.typ}`;
            if (odeslano.has(klic)) continue;
            odeslano.add(klic);
            nalezeno += 1;
            const tx = TEXTY[d.typ];
            const cs = a.jazyk === 'cs';
            const druh = faze < 3 ? tx[cs ? 'csRozpr' : 'enRozpr'] + ` (${faze}/${VYCHOZI.vpravo})` : tx[cs ? 'cs' : 'en'];
            const titulek = `PerpyX · ${nazevParu(symbol)}`;
            const text = `${druh} · ${INTERVALY[interval].popis}`;
            await posli(a.account, {
              titulek, text, smer: tx.smer,
              // Text i v datech: push do otevřené aplikace Android sám
              // neukáže, aplikace ho pak ukáže místní notifikací.
              data: {
                alarmId: `sig:${klic}`, symbol, interval, typ: 'divergence', faze: String(faze),
                divergence: d.typ, smer: tx.smer, at: String(Date.now()), titulek, text,
              },
            }, a);
            log('signál', symbol, INTERVALY[interval].popis, d.typ, `fáze ${faze}`);
          }
        }
      } catch (e) {
        chyb += 1;
        if (chyb <= 3) log('signály: svíčky', symbol, e.message);
      }
      await cekej(ROZESTUP);
    }
    stav = `${INTERVALY[interval].popis} ${new Date().toISOString().slice(11, 16)} par:${hlidane.size} sig:${nalezeno} chyb:${chyb}`;
    if (odeslano.size > 20000) odeslano.clear();
  }

  async function kontrola() {
    if (bezi) return;
    bezi = true;
    try {
      const ted = Date.now();
      for (const interval of Object.keys(INTERVALY)) {
        const { ms } = INTERVALY[interval];
        const otevreni = posledniUzavrena(interval, ted - PO_UZAVRENI);
        if (hotovo[interval] === otevreni) continue;
        const hotovaPred = hotovo[interval] === undefined && ted - (otevreni + ms) > POZDE;
        hotovo[interval] = otevreni;
        if (hotovaPred) continue;    // po restartu nehlásit starou svíčku znovu
        // Bez pravidla na tenhle timeframe se nic nestahuje.
        if (!alarmy().some((a) => (a.intervaly || []).map(String).includes(interval))) continue;
        await zpracuj(interval, otevreni);
      }
    } finally {
      bezi = false;
    }
  }

  setInterval(kontrola, 15000);
  kontrola();
  return { stav: () => stav, zpracuj };
}
