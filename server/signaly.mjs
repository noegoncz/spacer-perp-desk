/**
 * Signály na grafech — hlídání RSI divergence na serveru (v0.89.0, přání
 * uživatele: push ze serveru, timeframy 1h a 4h).
 *
 * Běží uvnitř hlídače alarmů (hlidac.mjs). Telefon posílá „signálový
 * alarm" stejnou cestou jako cenové alarmy (/api/account/alarms):
 * `{ typ: 'divergence', symboly: ['JUPUSDT', 'binance:BTCUSDT'…], intervaly: ['60','240'] }`
 * — páry ze seznamů a otevřených pozic, jen Bybit a Binance.
 *
 * Po uzavření svíčky každého timeframu stáhne hlídač poslední svíčky všech
 * hlídaných párů (veřejné REST, žádné klíče) a spočítá divergenci stejným
 * kódem jako graf (js/divergence.js). Potvrdí-li ji právě uzavřená svíčka,
 * pošle push každému účtu, který pár hlídá.
 */
import { novaDivergence } from '../js/divergence.js';

const INTERVALY = { 60: { ms: 3600e3, binance: '1h', popis: '1h' }, 240: { ms: 4 * 3600e3, binance: '4h', popis: '4h' } };
const PO_UZAVRENI = 20000;      // burza dá uzavřenou svíčku do pár vteřin
const POZDE = 10 * 60e3;        // svíčka zavřená dřív (restart) se už nehlásí
const ROZESTUP = 120;           // ms mezi dotazy na burzu
const SVICEK = 200;

const TEXTY = {
  byci: { cs: 'Býčí RSI divergence', en: 'Bullish RSI divergence', smer: 'nahoru' },
  medvedi: { cs: 'Medvědí RSI divergence', en: 'Bearish RSI divergence', smer: 'dolu' },
};

const cekej = (ms) => new Promise((r) => setTimeout(r, ms));

async function stahni(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'PerpyX-hlidac/1' }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** Uzavřené svíčky páru, nejstarší první, `{ timestamp, open, high, low, close }`. */
export async function svicky(symbol, interval) {
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
 * Spustí hlídání. `alarmy()` vrátí aktuální signálové alarmy (s `account`
 * a `jazyk`), `posli(account, zprava)` doručí push na zařízení účtu.
 */
export function spustSignaly({ alarmy, posli, log }) {
  const hotovo = {};           // interval → čas otevření poslední zpracované svíčky
  const odeslano = new Set();  // symbol|interval|čas pivotu — jedna divergence jednou
  let bezi = false;
  let stav = 'zatím nic';

  async function zpracuj(interval, otevreni) {
    const hlidane = new Map();   // symbol → [alarmy]
    for (const a of alarmy()) {
      if (!(a.intervaly || []).map(String).includes(String(interval))) continue;
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
        // jinak by se divergence potvrzená o svíčku dřív ohlásila znovu.
        if (rada.at(-1)?.timestamp !== otevreni) continue;
        for (const d of novaDivergence(rada)) {
          const klic = `${symbol}|${interval}|${d.do.cas}|${d.typ}`;
          if (odeslano.has(klic)) continue;
          odeslano.add(klic);
          nalezeno += 1;
          const ucty = new Set();
          for (const a of kdo) {
            if (ucty.has(a.account)) continue;
            ucty.add(a.account);
            const tx = TEXTY[d.typ];
            const titulek = `PerpyX · ${nazevParu(symbol)}`;
            const text = `${tx[a.jazyk === 'cs' ? 'cs' : 'en']} · ${INTERVALY[interval].popis}`;
            await posli(a.account, {
              titulek, text, smer: tx.smer,
              // Text i v datech: push do otevřené aplikace Android sám
              // neukáže, aplikace ho pak ukáže místní notifikací.
              data: {
                alarmId: `sig:${klic}`, symbol, interval: String(interval), typ: 'divergence',
                divergence: d.typ, smer: tx.smer, at: String(Date.now()), titulek, text,
              },
            });
          }
          log('signál', symbol, INTERVALY[interval].popis, d.typ, 'účtů:', ucty.size);
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
        const ms = INTERVALY[interval].ms;
        const otevreni = Math.floor((ted - PO_UZAVRENI) / ms) * ms - ms;   // poslední uzavřená svíčka
        if (hotovo[interval] === otevreni) continue;
        const hotovaPred = hotovo[interval] === undefined && ted - (otevreni + ms) > POZDE;
        hotovo[interval] = otevreni;
        if (hotovaPred) continue;    // po restartu nehlásit starou svíčku znovu
        await zpracuj(Number(interval), otevreni);
      }
    } finally {
      bezi = false;
    }
  }

  setInterval(kontrola, 15000);
  kontrola();
  return { stav: () => stav, zpracuj };
}
