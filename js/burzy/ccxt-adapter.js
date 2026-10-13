/*
 * Obecný adaptér burzy nad CCXT (krok 2 napojení více burz, v0.53.0).
 *
 * Převádí sjednocené API knihovny CCXT do společného modelu PerpyX
 * (js/burzy/model.js). Konkrétní burza (js/burzy/binance.js…) z něj dědí
 * a přepisuje jen to, co CCXT nesjednocuje — hlavně kontrolu „klíč jen pro
 * čtení" a historii uzavřených obchodů.
 *
 * Živá data zatím jdou dotazováním (pozice po 3 s v popředí, ceny páru
 * v grafu a seznamu po 2 s). WebSocket (CCXT „pro") přijde později —
 * aplikace rozdíl nepozná, dostává stejné zprávy (`onPositions`,
 * `onTicker`, `onKline`).
 *
 * ⚠ Modul nesahá na DOM (kromě načtení knihovny v js/burzy/ccxt.js)
 * a nikam neposílá klíče — CCXT běží v telefonu a volá přímo burzu.
 */
import { nactiCcxt, TIMEFRAME, DELKA_TF, nativniFetch } from './ccxt.js';
import { t } from '../i18n.js';

const strana = (s) => (String(s).toLowerCase() === 'buy' || String(s).toLowerCase() === 'long' ? 'Buy' : 'Sell');
const cislo = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const cisloNebo = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) || Number(v) === 0
  ? null : Number(v));

const POZICE_POPREDI = 3000;
const POZICE_POZADI = 30000;
const CENY_KAZDYCH = 2000;

export class CcxtAdapter {
  /**
   * @param {string} idCcxt   id burzy v CCXT (např. 'binanceusdm')
   * @param {object} handlers stejné zprávy jako Bybit adaptér
   * @param {object} volby    { testnet?, demo?, ccxtVolby? }
   */
  constructor(idCcxt, handlers = {}, volby = {}) {
    this.idCcxt = idCcxt;
    // Měna, ve které se perpetuály vypořádávají (Hyperliquid: USDC),
    // a všechny, které burza nabízí (Binance: USDT i USDC — v EU jde
    // kvůli MiCA jen USDC, v0.59.1).
    this.mena = 'USDT';
    this.meny = null;
    // Burzy, jejichž API nemá CORS (MEXC, soukromá data Gate a Bitget):
    // v APK jdou dotazy nativním HTTP Capacitoru (v0.57.0).
    this.nativniHttp = false;
    this.handlers = handlers;
    this.volby = volby;
    this.apiKey = '';
    this.apiSecret = '';
    // OKX, Bitget a KuCoin chtějí ke klíči ještě heslo (passphrase) —
    // formulář pro něj přijde s připojením těch burz.
    this.apiPassphrase = '';
    this.ex = null;
    this.exKlic = '';
    this.positions = new Map();
    this.running = false;
    this.foreground = true;
    this.casovacPozic = null;
    this.casovacCen = null;
    this.casovacSvicky = null;
    this.extraTickers = new Set();
    this.svicka = null;              // { symbol, interval }
    this.status = { ws: 'idle', rest: 'idle', lastUpdate: null };
    this.diag = { krok: 'start', pokusu: 0, posledniChyba: null, casChyby: null };
    // Aplikace čte uložené fundingy a otevření — u CCXT zatím prázdné.
    this.ulozeneOtevreni = new Map();
    this.ulozeneSoucty = new Map();
  }

  /* ---------- knihovna a převody ---------- */

  /** Instance burzy v CCXT; při změně klíče se vyrobí znovu. */
  async burzaCcxt() {
    const klic = `${this.apiKey}|${this.apiSecret}|${this.apiPassphrase}`;
    if (this.ex && this.exKlic === klic) return this.ex;
    const ccxt = await nactiCcxt();
    const ex = new ccxt[this.idCcxt]({
      apiKey: this.apiKey || undefined,
      secret: this.apiSecret || undefined,
      password: this.apiPassphrase || undefined,
      enableRateLimit: true,
      // Mobilní síť: výchozích 10 s CCXT bylo na telefonu málo (v0.58.2).
      timeout: 20000,
      ...(this.volby.ccxtVolby || {}),
    });
    // Jen perpetuály: spotové trhy ani seznam měn aplikace nepotřebuje
    // a u několika burz (Gate, MEXC) je jejich API bez CORS — načtení
    // trhů by kvůli nim spadlo celé (v0.57.0, ověřeno sondou).
    ex.fetchCurrencies = async () => ({});
    // Otevřené příkazy na všech párech najednou: CCXT to u Binance bez
    // této volby odmítne varováním („could not load open orders").
    ex.options.warnOnFetchOpenOrdersWithoutSymbol = false;
    if (this.typyTrhu) ex.options.fetchMarkets = { ...(ex.options.fetchMarkets || {}), types: this.typyTrhu };
    this.upravCcxt(ex);
    const nativni = this.nativniHttp && nativniFetch();
    if (nativni) ex.fetchImplementation = nativni;
    if (this.volby.demo && ex.enableDemoTrading) ex.enableDemoTrading(true);
    else if (this.volby.testnet) ex.setSandboxMode(true);
    await ex.loadMarkets();
    this.ex = ex;
    this.exKlic = klic;
    return ex;
  }

  /** Měny vypořádání, jejichž perpetuály adaptér bere. */
  menyTrhu() {
    return this.meny || [this.mena];
  }

  /** Úprava instance CCXT před načtením trhů — burza může přepsat. */
  upravCcxt() {}

  /** Lineární perpetuál CCXT → kanonický symbol PerpyX ('JUPUSDT', na Hyperliquid 'BTCUSDC'). */
  kanonicky(trh) {
    return `${trh.base}${trh.quote}`;
  }

  /** Kanonický symbol → trh CCXT (jen lineární USDT perpetuály). */
  trh(symbol) {
    const ex = this.ex;
    const hledany = String(symbol).toUpperCase();
    return Object.values(ex.markets).find((m) => m.swap && m.linear && this.menyTrhu().includes(m.quote)
      && this.kanonicky(m) === hledany) || null;
  }

  async symbolCcxt(symbol) {
    await this.burzaCcxt();
    const m = this.trh(symbol);
    if (!m) throw new Error(`${this.burza?.nazev || this.idCcxt}: pár ${symbol} tu není`);
    return m.symbol;
  }

  /**
   * Chyba CCXT → srozumitelná hláška. ⚠ Podle tříd knihovny (`instanceof`),
   * ne podle jména — ve zmenšené knihovně jsou jména tříd zkomolená.
   * Surová zpráva CCXT obsahuje celou adresu dotazu i s podpisem; do UI
   * nepatří (podpis není tajemství, ale nic uživateli neřekne).
   */
  prelozChybu(err) {
    const c = globalThis.ccxt || {};
    const je = (trida) => typeof c[trida] === 'function' && err instanceof c[trida];
    if (je('AuthenticationError')) return t('error.badKey');
    if (je('PermissionDenied')) return t('error.noPermission');
    if (je('InvalidNonce')) return t('error.clock');
    if (je('NetworkError')) return t('error.network');
    const zprava = String(err?.message || err || '')
      .replace(/^\S+\s+(GET|POST|PUT|DELETE)\s+https?:\/\/\S+\s*/i, '')
      .replace(/https?:\/\/\S+/g, '')
      .trim();
    return zprava || t('error.network');
  }

  /**
   * Technický popis chyby do diagnostiky: třída CCXT a cesta dotazu bez
   * parametrů (v parametrech je podpis), např. „NetworkError /fapi/v3/account".
   * Uživatel blok vyfotí a je hned vidět, který dotaz neprošel.
   */
  technickyPopis(err) {
    const c = globalThis.ccxt || {};
    const trida = Object.keys(c).find((k) => typeof c[k] === 'function' && /Error|Denied|Nonce|Exchange/.test(k)
      && err?.constructor === c[k]) || err?.name || 'Error';
    const cesta = (String(err?.message || '').match(/https?:\/\/[^/\s]+(\/[^?\s]*)/) || [])[1] || '';
    return `${trida}${cesta ? ' ' + cesta : ''}`;
  }

  /* ---------- stejné rozhraní jako Bybit adaptér ---------- */

  zapisDiag(krok, chyba = null) {
    this.diag.krok = krok;
    if (chyba) {
      this.diag.posledniChyba = chyba;
      this.diag.casChyby = Date.now();
    }
    this.handlers.onDiag?.(this.diag);
  }

  setCredentials(apiKey, apiSecret) {
    this.apiKey = (apiKey || '').trim();
    this.apiSecret = (apiSecret || '').trim();
  }

  hasCredentials() {
    return Boolean(this.apiKey && this.apiSecret);
  }

  setStatus(patch) {
    this.status = { ...this.status, ...patch };
    this.handlers.onStatus?.(this.status);
  }

  emitPositions() {
    const list = [...this.positions.values()].sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
    this.handlers.onPositions?.(list);
  }

  setForeground(value) {
    this.foreground = value;
    this.naplanujPozice();
  }

  popisUctu() {
    return '';
  }

  async start() {
    if (!this.hasCredentials()) return false;
    this.running = true;
    this.setStatus({ ws: 'poll' });
    this.naplanujCeny();
    return this.refresh();
  }

  stop() {
    this.running = false;
    clearTimeout(this.casovacPozic);
    clearInterval(this.casovacCen);
    clearInterval(this.casovacSvicky);
    this.positions.clear();
    this.setStatus({ ws: 'idle', rest: 'idle' });
  }

  ensureConnected() {
    if (this.running) this.refresh();
  }

  naplanujPozice() {
    clearTimeout(this.casovacPozic);
    if (!this.running) return;
    this.casovacPozic = setTimeout(() => this.refresh(), this.foreground ? POZICE_POPREDI : POZICE_POZADI);
  }

  /** Převod pozice CCXT → model PerpyX. */
  pozice(p) {
    const m = this.ex.markets[p.symbol];
    const velikost = Math.abs(cislo(p.contracts) * cislo(p.contractSize || m?.contractSize || 1));
    return {
      symbol: m ? this.kanonicky(m) : String(p.symbol).split('/')[0] + this.mena,
      side: strana(p.side),
      size: velikost,
      entry: cislo(p.entryPrice),
      mark: cislo(p.markPrice),
      pnl: cislo(p.unrealizedPnl),
      liq: cisloNebo(p.liquidationPrice),
      leverage: cisloNebo(p.leverage),
      value: Math.abs(cislo(p.notional) || velikost * cislo(p.markPrice)),
      stopLoss: cisloNebo(p.stopLossPrice),
      takeProfit: cisloNebo(p.takeProfitPrice),
      positionIdx: 0,
      openedAt: null,
      updatedAt: Date.now(),
    };
  }

  async refresh() {
    this.setStatus({ rest: 'loading' });
    this.diag.pokusu += 1;
    try {
      this.zapisDiag('pozice');
      const ex = await this.burzaCcxt();
      const surove = await ex.fetchPositions(undefined, this.volbyPozic());
      this.positions.clear();
      for (const p of surove) {
        const m = ex.markets[p.symbol];
        if (!m || !m.linear || !this.menyTrhu().includes(m.quote)) continue;
        const poz = this.pozice(p);
        if (!poz.size) continue;
        this.positions.set(`${poz.symbol}#${poz.side}`, poz);
      }
      this.zapisDiag(`hotovo, pozic: ${this.positions.size}`);
      this.setStatus({ rest: 'ok', lastUpdate: Date.now() });
      this.emitPositions();
      this.refreshExtras();
      return true;
    } catch (err) {
      const zprava = this.prelozChybu(err);
      this.zapisDiag('chyba', `${zprava} [${this.technickyPopis(err)}]`);
      this.setStatus({ rest: 'error' });
      this.handlers.onError?.(zprava);
      return false;
    } finally {
      this.naplanujPozice();
    }
  }

  /** Volby pro fetchPositions — burza může přepsat. */
  volbyPozic() {
    return {};
  }

  refreshExtras() {
    if (!this.hasCredentials()) return;
    this.getWalletBalance()
      .then(({ ucet, chyba }) => this.handlers.onAccount?.(ucet, chyba))
      .catch((err) => this.handlers.onAccount?.(null, this.prelozChybu(err)));
    this.getAllOpenOrders()
      .then((orders) => this.handlers.onOrders?.(orders, null))
      .catch((err) => this.handlers.onOrders?.([], this.prelozChybu(err)));
  }

  /** Funding a dopočty z minulého spuštění — u CCXT zatím nic. */
  obnovUlozeneFundingy() {}

  async getWalletBalance() {
    const ex = await this.burzaCcxt();
    const b = await ex.fetchBalance();
    // Dotaz prošel = přehled je; i nulová equity je údaj (prázdný futures
    // účet), ne chybějící oprávnění (v0.58.2).
    // Víc měn vypořádání (USDT + USDC) se sčítá — stablecoiny ~1:1.
    const soucet = (k) => this.menyTrhu().reduce((s, c) => s + cislo(b?.[k]?.[c]), 0);
    const equity = soucet('total');
    const volny = soucet('free');
    const pouzity = soucet('used');
    return {
      ucet: { equity, volny, pouzity, vyuziti: equity > 0 ? (pouzity / equity) * 100 : null, typ: '' },
      chyba: null,
    };
  }

  /** Typ podmíněného příkazu CCXT → `stopType` PerpyX. Burza může přepsat. */
  typStop(o) {
    if (o.takeProfitPrice) return 'TakeProfit';
    if (o.stopLossPrice) return 'StopLoss';
    const typ = String(o.type || '').toLowerCase();
    if (typ.includes('take_profit') || typ.includes('takeprofit')) return 'TakeProfit';
    if (typ.includes('trailing')) return 'TrailingStop';
    if (typ.includes('stop')) return 'StopLoss';
    return '';
  }

  prikaz(o) {
    const m = this.ex.markets[o.symbol];
    return {
      id: String(o.id),
      symbol: m ? this.kanonicky(m) : o.symbol,
      side: strana(o.side),
      type: o.type ? o.type[0].toUpperCase() + o.type.slice(1) : 'Limit',
      stopType: this.typStop(o),
      price: cisloNebo(o.price),
      trigger: cisloNebo(o.triggerPrice ?? o.stopPrice ?? o.takeProfitPrice ?? o.stopLossPrice),
      qty: cislo(o.amount),
      filled: cislo(o.filled),
      reduceOnly: Boolean(o.reduceOnly),
      createdAt: cislo(o.timestamp),
    };
  }

  async getOpenOrders(symbol) {
    const ex = await this.burzaCcxt();
    return (await ex.fetchOpenOrders(await this.symbolCcxt(symbol))).map((o) => this.prikaz(o));
  }

  async getAllOpenOrders() {
    const ex = await this.burzaCcxt();
    return (await ex.fetchOpenOrders()).filter((o) => ex.markets[o.symbol]?.linear).map((o) => this.prikaz(o));
  }

  plneni(tr) {
    return {
      buy: strana(tr.side) === 'Buy',
      price: cislo(tr.price),
      qty: cislo(tr.amount),
      time: cislo(tr.timestamp),
      orderId: String(tr.order ?? tr.id),
      execId: String(tr.id),
    };
  }

  /** Plnění na páru v okně (burzy mívají strop okna — dělí se po 7 dnech). */
  async getExecutions(symbol, startTime, endTime) {
    const ex = await this.burzaCcxt();
    const s = await this.symbolCcxt(symbol);
    const vse = [];
    const krok = 7 * 864e5 - 1000;
    for (let od = startTime; od < endTime; od += krok) {
      const doKdy = Math.min(endTime, od + krok);
      const davka = await ex.fetchMyTrades(s, Math.floor(od), 1000, { endTime: Math.ceil(doKdy) });
      vse.push(...davka);
    }
    const videne = new Set();
    return vse.filter((x) => (videne.has(x.id) ? false : videne.add(x.id)))
      .map((x) => this.plneni(x))
      .sort((a, b) => b.time - a.time);
  }

  /** Uzavřené obchody — CCXT je nesjednocuje, burza musí přepsat. */
  async getClosedTrades() {
    return [];
  }

  /** Plnění jednoho uzavřeného obchodu (prohlídka z Historie). */
  async plneniObchodu(obchod) {
    const od = (obchod.openedAt && obchod.openedAt < obchod.closedAt ? obchod.openedAt : obchod.closedAt - 7 * 864e5);
    const plneni = await this.getExecutions(obchod.symbol, od, obchod.closedAt + 1000);
    return { plneni: plneni.sort((a, b) => a.time - b.time), otevreno: null };
  }

  /** Čas otevření pozice z plnění — u CCXT zatím neumíme, aplikace to snese. */
  async otevreniPozice() {
    return null;
  }

  async getKlines(symbol, interval, limit = 500, endTime = null) {
    const ex = await this.burzaCcxt();
    const tf = TIMEFRAME[interval];
    if (!tf) return [];
    const s = await this.symbolCcxt(symbol);
    const konec = endTime || Date.now();
    const od = konec - limit * (DELKA_TF[tf] || 3600e3);
    const radky = await ex.fetchOHLCV(s, tf, Math.floor(od), limit, endTime ? { until: Math.ceil(endTime) } : {}); // `until` = sjednocený konec okna CCXT
    return radky.map(([time, open, high, low, close, volume]) => ({
      time, open: cislo(open), high: cislo(high), low: cislo(low), close: cislo(close), volume: cislo(volume),
    }));
  }

  async getSparkline(symbol) {
    const ex = await this.burzaCcxt();
    const radky = await ex.fetchOHLCV(await this.symbolCcxt(symbol), '1h', undefined, 24);
    return radky.map((r) => cislo(r[4]));
  }

  ticker(tk) {
    const m = this.ex.markets[tk.symbol];
    return {
      symbol: m ? this.kanonicky(m) : tk.symbol,
      last: cislo(tk.last),
      changePct: cislo(tk.percentage),
      // Obrat 24 h v měně vypořádání; OKX dává jen objem v coinu.
      turnover: cislo(tk.quoteVolume) || cislo(tk.baseVolume) * cislo(tk.last),
      funding: 0,
      openInterest: 0,
    };
  }

  async getTicker(symbol) {
    const ex = await this.burzaCcxt();
    const tk = await ex.fetchTicker(await this.symbolCcxt(symbol));
    return tk ? this.ticker(tk) : null;
  }

  async getTickers() {
    const ex = await this.burzaCcxt();
    const vse = await ex.fetchTickers(undefined, { type: 'swap', subType: 'linear' });
    return Object.values(vse)
      .filter((tk) => {
        const m = ex.markets[tk.symbol];
        return m && m.swap && m.linear && this.menyTrhu().includes(m.quote) && m.active !== false;
      })
      .map((tk) => this.ticker(tk))
      .sort((a, b) => b.turnover - a.turnover);
  }

  /* ---------- živá data dotazováním ---------- */

  setExtraTickers(symbols) {
    this.extraTickers = new Set(symbols || []);
  }

  naplanujCeny() {
    clearInterval(this.casovacCen);
    this.casovacCen = setInterval(() => this.obnovCeny(), CENY_KAZDYCH);
  }

  async obnovCeny() {
    if (!this.foreground || !this.ex) return;
    const pary = new Set([...this.extraTickers, ...[...this.positions.values()].map((p) => p.symbol)]);
    if (!pary.size) return;
    try {
      const symboly = [...pary].map((s) => this.trh(s)?.symbol).filter(Boolean);
      const vse = await this.ex.fetchTickers(symboly);
      let zmena = false;
      for (const tk of Object.values(vse)) {
        const z = this.ticker(tk);
        if (this.extraTickers.has(z.symbol)) this.handlers.onTicker?.(z);
        for (const p of this.positions.values()) {
          const mark = cislo(tk.markPrice ?? tk.last);
          if (p.symbol !== z.symbol || !mark || p.mark === mark) continue;
          p.mark = mark;
          p.pnl = (mark - p.entry) * p.size * (p.side === 'Sell' ? -1 : 1);
          zmena = true;
        }
      }
      if (zmena) this.emitPositions();
    } catch { /* příště znovu */ }
  }

  setKlineSubscription(symbol, interval) {
    clearInterval(this.casovacSvicky);
    this.svicka = symbol && interval ? { symbol, interval } : null;
    if (!this.svicka) return;
    const { symbol: s, interval: i } = this.svicka;
    this.casovacSvicky = setInterval(async () => {
      if (!this.foreground || this.svicka?.symbol !== s || this.svicka?.interval !== i) return;
      try {
        const posledni = (await this.getKlines(s, i, 2)).pop();
        if (posledni) this.handlers.onKline?.({ ...posledni, closed: false });
      } catch { /* příště znovu */ }
    }, CENY_KAZDYCH);
  }

  /* ---------- klíč ---------- */

  /** Oprávnění klíče — CCXT nesjednocuje, burza musí přepsat (null = nevím). */
  async opravneniKlice() {
    return null;
  }

  async testCredentials(apiKey, apiSecret) {
    const predtim = [this.apiKey, this.apiSecret];
    this.setCredentials(apiKey, apiSecret);
    try {
      const ex = await this.burzaCcxt();
      await ex.fetchPositions(undefined, this.volbyPozic());
      const opravneni = await this.opravneniKlice();
      if (opravneni?.vyber) {
        this.setCredentials(...predtim);
        return { ok: false, kod: 'withdraw', message: t('settings.keyWithdraw') };
      }
      if (opravneni && !opravneni.jenCteni) {
        this.setCredentials(...predtim);
        return { ok: false, kod: 'trade', message: t('settings.keyNotReadOnly') };
      }
      return { ok: true, overeno: Boolean(opravneni) };
    } catch (err) {
      this.setCredentials(...predtim);
      return { ok: false, message: this.prelozChybu(err) };
    }
  }
}
