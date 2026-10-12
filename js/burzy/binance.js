/*
 * Binance USDⓈ-M perpetuály přes CCXT (první burza mimo Bybit, v0.53.0).
 *
 * Dostupnost ověřena 2026-10-12: fapi.binance.com odpovídá i z ČR,
 * 568 obchodovaných perpetuálů, CORS povolený i pro podepsané dotazy
 * (funguje přímo z aplikace bez nativního HTTP). Testovat jde bez rizika
 * na Demo Tradingu (`volby.demo`, demo-fapi.binance.com, CORS povolený);
 * starý futures testnet (`volby.testnet`) 2026-10-12 neodpovídal.
 *
 * Proti obecnému adaptéru doplňuje jen to, co CCXT nesjednocuje:
 *  - kontrolu klíče jen pro čtení (`/sapi/v1/account/apiRestrictions`),
 *  - uzavřené obchody — Binance nemá obdobu bybitovského `closed-pnl`;
 *    staví se z deníku příjmů (REALIZED_PNL, bez nutnosti znát pár)
 *    a plnění s realizovaným ziskem, jeden záznam na zavírací příkaz.
 */
import { CcxtAdapter } from './ccxt-adapter.js';

const cislo = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const TYDEN = 7 * 864e5;

export class BinanceClient extends CcxtAdapter {
  constructor(handlers = {}, volby = {}) {
    super('binanceusdm', handlers, volby);
  }

  popisUctu() {
    return 'USDⓈ-M';
  }

  /** Podmíněné příkazy Binance podle typu (STOP_MARKET, TAKE_PROFIT…). */
  typStop(o) {
    const typ = String(o.info?.type || o.info?.origType || o.type || '').toUpperCase();
    if (typ.startsWith('TAKE_PROFIT')) return 'TakeProfit';
    if (typ.startsWith('TRAILING')) return 'TrailingStop';
    if (typ.startsWith('STOP')) return 'StopLoss';
    return super.typStop(o);
  }

  /**
   * Oprávnění klíče. Klíč jen pro čtení nesmí mít povolené obchodování
   * (futures, spot, margin, opce) ani převody; výběr se hlásí zvlášť.
   * Testnet a Demo Trading tenhle dotaz nemají → null („nevím").
   */
  async opravneniKlice() {
    if (this.volby.testnet || this.volby.demo) return null;
    try {
      const ex = await this.burzaCcxt();
      const r = await ex.sapiGetAccountApiRestrictions();
      const ano = (k) => r?.[k] === true || r?.[k] === 'true';
      return {
        jenCteni: !['enableFutures', 'enableSpotAndMarginTrading', 'enableMargin', 'enableVanillaOptions',
          'enableInternalTransfer', 'permitsUniversalTransfer', 'enablePortfolioMarginTrading'].some(ano),
        vyber: ano('enableWithdrawals'),
      };
    } catch {
      return null;
    }
  }

  /**
   * Uzavřené obchody v okně, nejnovější první. Deník příjmů (REALIZED_PNL)
   * řekne, na kterých párech a kdy se realizoval zisk; plnění těch párů
   * pak dají ceny a množství. Jeden záznam = jeden zavírací příkaz, stejně
   * jako u Bybitu — Historie je pak seskupí do obchodů sama.
   */
  async getClosedTrades(startTime, endTime) {
    const ex = await this.burzaCcxt();
    const zaznamy = [];
    for (let od = startTime; od < endTime; od += TYDEN) {
      const doKdy = Math.min(endTime, od + TYDEN - 1);
      const davka = await ex.fapiPrivateGetIncome({
        incomeType: 'REALIZED_PNL', startTime: Math.floor(od), endTime: Math.ceil(doKdy), limit: 1000,
      });
      zaznamy.push(...(davka || []));
    }
    const pary = new Map(); // id burzy → [min čas, max čas]
    for (const z of zaznamy) {
      const [a, b] = pary.get(z.symbol) || [Infinity, 0];
      pary.set(z.symbol, [Math.min(a, cislo(z.time)), Math.max(b, cislo(z.time))]);
    }
    const vysledek = [];
    for (const [idBurzy, [od, doKdy]] of pary) {
      const trh = Object.values(ex.markets).find((m) => m.id === idBurzy && m.swap && m.linear);
      if (!trh) continue;
      const obchody = await this.surovaPlneni(trh.symbol, od - 1000, doKdy + 1000);
      const podlePrikazu = new Map();
      for (const tr of obchody) {
        const pnl = cislo(tr.info?.realizedPnl);
        if (!pnl) continue; // otevírací plnění — realizovaný zisk nemá
        const id = String(tr.order);
        const z = podlePrikazu.get(id) || { qty: 0, hodnota: 0, pnl: 0, cas: 0, strana: tr.side };
        z.qty += cislo(tr.amount);
        z.hodnota += cislo(tr.amount) * cislo(tr.price);
        z.pnl += pnl;
        z.cas = Math.max(z.cas, cislo(tr.timestamp));
        podlePrikazu.set(id, z);
      }
      for (const [id, z] of podlePrikazu) {
        if (!z.qty) continue;
        const exit = z.hodnota / z.qty;
        const long = String(z.strana).toLowerCase() === 'sell'; // long se zavírá prodejem
        const entry = exit - z.pnl / (z.qty * (long ? 1 : -1));
        vysledek.push({
          id,
          symbol: this.kanonicky(trh),
          long,
          qty: z.qty,
          entry,
          exit,
          pnl: z.pnl,
          value: entry * z.qty,
          leverage: null,
          openedAt: z.cas,
          closedAt: z.cas,
        });
      }
    }
    return vysledek.sort((a, b) => b.closedAt - a.closedAt);
  }

  /** Plnění CCXT v okně (po 7 dnech, víc Binance nedovolí). */
  async surovaPlneni(symbolCcxt, startTime, endTime) {
    const vse = [];
    for (let od = startTime; od < endTime; od += TYDEN - 1000) {
      const doKdy = Math.min(endTime, od + TYDEN - 1000);
      vse.push(...await this.ex.fetchMyTrades(symbolCcxt, Math.floor(od), 1000, { endTime: Math.ceil(doKdy) }));
    }
    return vse;
  }
}
