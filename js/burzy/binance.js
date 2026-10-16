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
import { nactiCcxt, nativniFetch } from './ccxt.js';

const cislo = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const TYDEN = 7 * 864e5;
/*
 * Živý proud tržních dat (v0.59.10). ⚠ Tržní data futures jsou na
 * `/market/ws` — stará `/ws` odběr potvrdí, ale data neposílá (ověřeno
 * 2026-10-16, viz server/hlidac.mjs).
 */
const PROUD = 'wss://fstream.binance.com/market/ws';
const TF = { 1: '1m', 5: '5m', 15: '15m', 30: '30m', 60: '1h', 240: '4h', D: '1d', W: '1w', M: '1M' };

export class BinanceClient extends CcxtAdapter {
  constructor(handlers = {}, volby = {}) {
    // fetchCurrencies: CCXT by si s klíčem stahovala měny ze spotové části
    // (/sapi/…) — k ničemu, a v Demo Tradingu ten dotaz vůbec nejde.
    super('binanceusdm', handlers, {
      ...volby,
      ccxtVolby: { ...(volby.ccxtVolby || {}), options: { fetchCurrencies: false } },
    });
    // USDⓈ-M má páry v USDT i USDC (BTCUSDC…). Uživatelé v EU smí kvůli
    // MiCA jen USDC (ověřeno u uživatele 2026-10-13) — bez nich by jejich
    // pozice ani zůstatek nebyly vidět.
    this.meny = ['USDT', 'USDC'];
    // Plnění (`userTrades`) vydá Binance jen za posledních 6 měsíců —
    // starší okna by byla jen prázdné dotazy navíc.
    this.plneniNejdal = 180 * 864e5;
  }

  popisUctu() {
    return 'USDⓈ-M';
  }

  /* ---------- živý proud: cena (@miniTicker) a svíčka (@kline) ---------- */

  /*
   * Ceny dlaždic a pozic a živá svíčka grafu chodí proudem místo dotazu
   * po 2 s (u Bybitu to tak je odjakživa). Dotazování v obecném adaptéru
   * zůstává jako záloha: pár, pro který proud 6 s mlčí, se zeptá dotazem.
   * Demo Trading má jiné ceny než ostrá burza → proud jen naostro. Na
   * pozadí se proud zavře (baterie), po návratu otevře znovu.
   */
  chceneTemata() {
    const temata = new Map(); // téma → klíč čerstvosti
    if (this.volby.demo || this.volby.testnet || !this.foreground || this.zastaveno) return temata;
    for (const s of this.paryCen()) {
      const id = this.trh(s)?.id;
      if (id) temata.set(`${id.toLowerCase()}@miniTicker`, `c:${s}`);
    }
    if (this.svicka && TF[this.svicka.interval]) {
      const id = this.trh(this.svicka.symbol)?.id;
      if (id) temata.set(`${id.toLowerCase()}@kline_${TF[this.svicka.interval]}`, `k:${this.svicka.symbol}:${this.svicka.interval}`);
    }
    return temata;
  }

  synchronizujOdbery() {
    if (typeof WebSocket === 'undefined' || !Object.keys(this.trhyCcxt()).length) return;
    const chci = this.chceneTemata();
    if (!this.ws) {
      if (chci.size && !this.wsZnovu) this.otevriProud();
      return;
    }
    if (this.ws.readyState !== 1) return; // po otevření se zavolá znovu
    if (!chci.size) {
      this.ws.close();
      return;
    }
    const pridat = [...chci.keys()].filter((t) => !this.wsOdbery.has(t));
    const odebrat = [...this.wsOdbery].filter((t) => !chci.has(t));
    for (let i = 0; i < pridat.length; i += 50) {
      this.ws.send(JSON.stringify({ method: 'SUBSCRIBE', params: pridat.slice(i, i + 50), id: ++this.wsId }));
    }
    for (let i = 0; i < odebrat.length; i += 50) {
      this.ws.send(JSON.stringify({ method: 'UNSUBSCRIBE', params: odebrat.slice(i, i + 50), id: ++this.wsId }));
    }
    odebrat.forEach((t) => this.wsOdbery.delete(t));
    pridat.forEach((t) => this.wsOdbery.add(t));
  }

  otevriProud() {
    this.cerstve ??= new Map();
    this.wsOdbery = new Set();
    this.wsId ??= 0;
    let ws;
    try {
      ws = new WebSocket(PROUD);
    } catch {
      // Spojení nejde vůbec založit — zkusit později, ne při každém dotazu.
      this.wsZnovu = setTimeout(() => { this.wsZnovu = null; }, 30000);
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.wsPokus = 0;
      this.synchronizujOdbery();
    };
    ws.onmessage = (e) => this.zpravaProudu(e.data);
    ws.onclose = () => {
      if (this.ws === ws) this.ws = null;
      this.wsOdbery = new Set();
      if (!this.chceneTemata().size) return; // zavřeno schválně (pozadí, nic k odběru)
      const cekat = Math.min(30000, 1000 * 2 ** (this.wsPokus || 0));
      this.wsPokus = (this.wsPokus || 0) + 1;
      clearTimeout(this.wsZnovu);
      this.wsZnovu = setTimeout(() => {
        this.wsZnovu = null;
        this.synchronizujOdbery();
      }, cekat);
    };
    ws.onerror = () => { /* zavření řeší onclose */ };
  }

  /** Symbol Binance (JUPUSDT) → kanonický pár; u USDⓈ-M stejný text, ale přes trhy. */
  parZId(id) {
    this.paryPodleId ??= new Map();
    if (!this.paryPodleId.has(id)) {
      const m = Object.values(this.trhyCcxt()).find((x) => x.id === id && x.swap && x.linear);
      this.paryPodleId.set(id, m ? this.kanonicky(m) : null);
    }
    return this.paryPodleId.get(id);
  }

  zpravaProudu(text) {
    let m;
    try {
      m = JSON.parse(text);
    } catch {
      return;
    }
    const par = m?.s && this.parZId(m.s);
    if (!par) return;
    if (m.e === '24hrMiniTicker') {
      const posledni = cislo(m.c);
      if (!posledni) return;
      this.cerstve.set(`c:${par}`, Date.now());
      const otevreni = cislo(m.o);
      const z = {
        symbol: par,
        last: posledni,
        changePct: otevreni ? ((posledni - otevreni) / otevreni) * 100 : 0,
        turnover: cislo(m.q),
      };
      if (this.pouzijCenu(z, posledni)) this.emitPositions();
    } else if (m.e === 'kline' && m.k) {
      const k = m.k;
      const sv = this.svicka;
      if (!sv || sv.symbol !== par || TF[sv.interval] !== k.i) return;
      this.cerstve.set(`k:${sv.symbol}:${sv.interval}`, Date.now());
      this.handlers.onKline?.({
        time: cislo(k.t), open: cislo(k.o), high: cislo(k.h), low: cislo(k.l), close: cislo(k.c),
        volume: cislo(k.v), closed: Boolean(k.x),
      });
    }
  }

  setForeground(value) {
    super.setForeground(value);
    // Na pozadí proud zavřít (synchronizace bez témat ho zavře), po návratu otevřít.
    this.synchronizujOdbery();
  }

  async start() {
    this.zastaveno = false;
    return super.start();
  }

  stop() {
    this.zastaveno = true; // zavřený proud se už sám nepřipojí
    super.stop();
    clearTimeout(this.wsZnovu);
    this.wsZnovu = null;
    this.ws?.close();
  }

  /**
   * Interval fundingu: CCXT ho u Binance nedává. `/fapi/v1/fundingInfo`
   * vypisuje jen páry s jiným než výchozím intervalem (8 h) — mění se
   * zřídka, drží se do konce běhu.
   */
  async fundingMinut(symbol) {
    if (!this.intervalyFundingu) {
      const ex = await this.burzaVerejna();
      const seznam = await ex.fapiPublicGetFundingInfo();
      this.intervalyFundingu = new Map((seznam || []).map((x) => [x.symbol, Number(x.fundingIntervalHours) * 60]));
    }
    return this.intervalyFundingu.get(this.trh(symbol)?.id) || 480;
  }

  /**
   * Tickery pro dotazování po 2 s. ⚠ USDⓈ-M neumí `ticker/24hr` pro výběr
   * párů — CCXT pak stáhne celý trh, a to Binance počítá jako 40 jednotek
   * (pár zvlášť 1). Omezovač CCXT za to čeká 2 s, takže při dotazu každé
   * 2 s byla fronta trvale plná a svíčky grafu v ní čekaly i přes 4 s
   * (v0.59.2, měřeno). Pro pár párů proto po jednom.
   */
  async tickeryParu(ex, symboly) {
    if (symboly.length > 20) return super.tickeryParu(ex, symboly);
    const vysledky = await Promise.allSettled(symboly.map((s) => ex.fetchTicker(s)));
    const vse = {};
    for (const r of vysledky) if (r.status === 'fulfilled' && r.value) vse[r.value.symbol] = r.value;
    return vse;
  }

  /**
   * ⚠ Podmíněné příkazy (TP, SL, stop, trailing) má Binance od konce roku
   * 2025 ve **službě Algo Orders** (`/fapi/v1/openAlgoOrders`) — běžný
   * dotaz na otevřené příkazy je nevrací. Bez toho graf ani karta pozice
   * neukázaly žádné TP/SL, jen likvidaci (snímky uživatele 2026-10-16).
   */
  async otevrenePrikazy(ex, symbolCcxt) {
    const [bezne, algo] = await Promise.all([
      ex.fetchOpenOrders(symbolCcxt),
      ex.fetchOpenOrders(symbolCcxt, undefined, undefined, { trigger: true }),
    ]);
    this.zapamatujCelePozice(algo, symbolCcxt);
    return [...bezne, ...algo];
  }

  /*
   * Position TP/SL patří k pozici jako u Bybitu (`stopLoss`, `takeProfit`):
   * karta pak ukazuje „SL x %" a graf čáru SL/TP pro celou pozici. Příkaz
   * se stejnou cenou aplikace jako duplicitu nekreslí podruhé.
   */
  zapamatujCelePozice(algo, symbolCcxt) {
    this.celePozice ??= new Map();
    const nove = new Map();
    for (const o of algo) {
      if (!(o.info?.closePosition === true || o.info?.closePosition === 'true')) continue;
      const m = this.trhyCcxt()[o.symbol];
      if (!m) continue;
      const par = this.kanonicky(m);
      const z = nove.get(par) || {};
      const cena = Number(o.triggerPrice) || null;
      if (this.typStop(o) === 'TakeProfit') z.takeProfit = cena;
      else z.stopLoss = cena;
      nove.set(par, z);
    }
    if (symbolCcxt) {
      const m = this.trhyCcxt()[symbolCcxt];
      if (m) {
        const par = this.kanonicky(m);
        if (nove.has(par)) this.celePozice.set(par, nove.get(par));
        else this.celePozice.delete(par);
      }
    } else {
      this.celePozice = nove;
    }
    let zmena = false;
    for (const poz of this.positions.values()) {
      const z = this.celePozice.get(poz.symbol) || {};
      const sl = z.stopLoss ?? null;
      const tp = z.takeProfit ?? null;
      if (poz.stopLoss !== sl || poz.takeProfit !== tp) {
        poz.stopLoss = sl;
        poz.takeProfit = tp;
        zmena = true;
      }
    }
    if (zmena) this.emitPositions();
  }

  pozice(p) {
    const poz = super.pozice(p);
    const z = this.celePozice?.get(poz.symbol);
    if (z) {
      poz.stopLoss = z.stopLoss ?? null;
      poz.takeProfit = z.takeProfit ?? null;
    }
    return poz;
  }

  /**
   * „Position TP/SL" (na celou pozici) má `closePosition` a množství 0 —
   * zavře, co v pozici zrovna je. Množství se proto bere z pozice, jinak
   * by čára nesla 0 JUP a aplikace by nepoznala, že jde o celou pozici.
   */
  prikaz(o) {
    const z = super.prikaz(o);
    if (o.info?.closePosition === true || o.info?.closePosition === 'true') {
      const poz = [...this.positions.values()].find((p) => p.symbol === z.symbol);
      if (poz) z.qty = poz.size;
      z.reduceOnly = true;
      z.celaPozice = true;
    }
    return z;
  }

  /** Podmíněné příkazy Binance podle typu (STOP_MARKET, TAKE_PROFIT…). */
  typStop(o) {
    // Algo příkazy nesou typ v `orderType`; CCXT z nich dělá obecné „market".
    const typ = String(o.info?.orderType || o.info?.type || o.info?.origType || o.type || '').toUpperCase();
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
    /*
     * ⚠ `/sapi/v1/account/apiRestrictions` nemá CORS (ověřeno 2026-10-13):
     * z WebView by dotaz vždy spadl a kontrola by tiše řekla „nevím" — klíč
     * s právem obchodovat by prošel. Proto jde přes nativní HTTP v APK;
     * jinde (prohlížeč) zůstává „nevím" s upozorněním „zkontroluj si to".
     */
    const nativni = nativniFetch();
    if (!nativni) return null;
    try {
      const ccxt = await nactiCcxt();
      const ex = new ccxt.binanceusdm({ apiKey: this.apiKey, secret: this.apiSecret, timeout: 20000 });
      ex.fetchImplementation = nativni;
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
      const davka = await this.soukrome((e) => e.fapiPrivateGetIncome({
        incomeType: 'REALIZED_PNL', startTime: Math.floor(od), endTime: Math.ceil(doKdy), limit: 1000,
      }), true);
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
      vse.push(...await this.soukrome((e) => e.fetchMyTrades(symbolCcxt, Math.floor(od), 1000, { endTime: Math.ceil(doKdy) }), true));
    }
    return vse;
  }
}
