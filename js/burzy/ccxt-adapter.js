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
// Živý proud (burza, která ho má — Binance v0.59.10): dotaz se přeskočí,
// když z proudu přišla cena / svíčka v posledních 6 s.
const PROUD_CERSTVY = 6000;
// Zůstatek a otevřené příkazy (u Binance bez páru 40 jednotek) ne s každým
// dotazem na pozice — jen při změně pozic, na vyžádání, jinak po 30 s.
const DOPLNKY_KAZDYCH = 30000;
// Sazba fundingu se mění po hodinách — v paměti 10 minut (jako u Bybitu).
const FUNDING_PLATI = 600000;
const TYDEN_MS = 7 * 864e5;
/** „8h", „1h", „30m" (CCXT `interval`) → minuty; jinak null. */
const minutIntervalu = (text) => {
  const m = /^(\d+)\s*([hm])$/i.exec(String(text || ''));
  if (!m) return null;
  return Number(m[1]) * (m[2].toLowerCase() === 'h' ? 60 : 1);
};

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
    this.exVerejna = null; // jen u účtu s klíčem, viz burzaVerejna()
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
    /*
     * Souběžné dotazy (ceny, mini-grafy, svíčky) čekají na jedno založení —
     * dřív si každý vyrobil vlastní instanci a stáhl seznam trhů znovu
     * (u Binance stovky kB na každý dotaz při prvním otevření).
     */
    if (this.zakladani?.klic !== klic) {
      const slib = this.zalozBurzu(klic);
      this.zakladani = { klic, slib };
      slib.catch(() => { if (this.zakladani?.slib === slib) this.zakladani = null; });
    }
    return this.zakladani.slib;
  }

  async zalozBurzu(klic) {
    const ex = await this.novaInstance(true);
    await this.nactiTrhy(ex, this.exVerejna);
    this.ex = ex;
    this.exKlic = klic;
    return ex;
  }

  /**
   * Instance pro **veřejná data** (svíčky, ceny, mini-grafy) — u účtu
   * s klíčem samostatná, bez klíče (v0.59.3). ⚠ Omezovač dotazů CCXT má
   * každá instance svůj a řadí do něj všechno: u účtu Binance v něm každé
   * 3 s stály pozice, zůstatek a příkazy (50 jednotek = 2,5 s fronty)
   * a svíčky grafu čekaly za nimi ~5 s (video uživatele 2026-10-14).
   * Skutečný limit Binance (2400 / min na IP) je daleko.
   */
  async burzaVerejna() {
    if (!this.hasCredentials()) return this.burzaCcxt();
    if (this.exVerejna) return this.exVerejna;
    if (!this.zakladaniVerejne) {
      this.zakladaniVerejne = (async () => {
        const ex = await this.novaInstance(false);
        await this.nactiTrhy(ex, this.ex);
        this.exVerejna = ex;
        return ex;
      })();
      this.zakladaniVerejne.catch(() => { this.zakladaniVerejne = null; });
    }
    return this.zakladaniVerejne;
  }

  /**
   * Instance s klíčem pro **hromadné stahování** (plnění po 7denních
   * oknech, deník příjmů) — vlastní fronta, ať pozice a příkazy nikdy
   * nečekají za desítkami dotazů do historie (v0.59.4: graf Binance na
   * 1W poslal 60 dotazů na plnění po 5 jednotkách = ~15 s fronty a TP/SL,
   * pozice i Historie čekaly za nimi, až vypršely).
   */
  async burzaHromadna() {
    if (!this.hasCredentials()) return this.burzaCcxt();
    const klic = `${this.apiKey}|${this.apiSecret}|${this.apiPassphrase}`;
    if (this.exHromadna && this.exHromadnaKlic === klic) return this.exHromadna;
    if (this.zakladaniHromadne?.klic !== klic) {
      const slib = (async () => {
        const ex = await this.novaInstance(true);
        await this.nactiTrhy(ex, this.ex || this.exVerejna);
        this.exHromadna = ex;
        this.exHromadnaKlic = klic;
        return ex;
      })();
      this.zakladaniHromadne = { klic, slib };
      slib.catch(() => { if (this.zakladaniHromadne?.slib === slib) this.zakladaniHromadne = null; });
    }
    return this.zakladaniHromadne.slib;
  }

  /** Trhy převezme od druhé instance, je-li hotová (seznam trhů je stejný), jinak stáhne. */
  async nactiTrhy(ex, jina) {
    if (jina?.markets) {
      try {
        ex.setMarkets(jina.markets, jina.currencies);
        return;
      } catch { /* stáhne si je sama */ }
    }
    await ex.loadMarkets();
  }

  /** Trhy kterékoli hotové instance (pro převody symbolů). */
  trhyCcxt() {
    return (this.ex || this.exVerejna)?.markets || {};
  }

  async novaInstance(sKlicem) {
    const ccxt = await nactiCcxt();
    const ex = new ccxt[this.idCcxt]({
      apiKey: (sKlicem && this.apiKey) || undefined,
      secret: (sKlicem && this.apiSecret) || undefined,
      password: (sKlicem && this.apiPassphrase) || undefined,
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
    const hledany = String(symbol).toUpperCase();
    return Object.values(this.trhyCcxt()).find((m) => m.swap && m.linear && this.menyTrhu().includes(m.quote)
      && this.kanonicky(m) === hledany) || null;
  }

  async symbolCcxt(symbol, verejne = false) {
    await (verejne ? this.burzaVerejna() : this.burzaCcxt());
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
   * Soukromý dotaz s jedním tichým opakováním a přeloženou chybou
   * (v0.59.4, snímky uživatele). Po návratu z jiné aplikace telefon
   * dotazy pozdrží: podepsaný dotaz pak Binance odmítne jako starý
   * (-1021, „outside of the recvWindow" — CCXT InvalidNonce) nebo
   * vyprší síť. Obojí napodruhé projde; u času se navíc změří rozdíl
   * hodin vůči burze. ⚠ Ven nikdy surová zpráva CCXT: obsahuje adresu
   * dotazu i s podpisem a uživateli nic neřekne.
   */
  async soukrome(fn, hromadne = false) {
    const ex = await (hromadne ? this.burzaHromadna() : this.burzaCcxt());
    const c = globalThis.ccxt || {};
    const je = (err, trida) => typeof c[trida] === 'function' && err instanceof c[trida];
    try {
      try {
        return await fn(ex);
      } catch (err) {
        if (!je(err, 'InvalidNonce') && !je(err, 'NetworkError')) throw err;
        if (je(err, 'InvalidNonce')) {
          ex.options.adjustForTimeDifference = true;
          try { await ex.loadTimeDifference?.(); } catch { /* zkusí se i tak */ }
        }
        return await fn(ex);
      }
    } catch (err) {
      const chyba = new Error(this.prelozChybu(err));
      chyba.puvodni = err;
      chyba.technicky = this.technickyPopis(err);
      throw chyba;
    }
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
    this.doplnkyHned = true; // návrat do aplikace / obnova: i příkazy a zůstatek
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
      // Pozice se staví znovu při každém dotazu — funding z paměti se
      // musí přilepit znovu, jinak by z karty po 3 s zmizel.
      funding: this.fundingCache?.get(m ? this.kanonicky(m) : '')?.funding || undefined,
    };
  }

  async refresh() {
    this.setStatus({ rest: 'loading' });
    this.diag.pokusu += 1;
    try {
      this.zapisDiag('pozice');
      const ex = await this.burzaCcxt();
      const surove = await this.soukrome((e) => e.fetchPositions(undefined, this.volbyPozic()));
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
      const otisk = [...this.positions.values()].map((p) => `${p.symbol}#${p.side}:${p.size}`).sort().join(',');
      if (this.doplnkyHned || otisk !== this.otiskPozic || Date.now() - (this.doplnkyCas || 0) >= DOPLNKY_KAZDYCH) {
        this.doplnkyHned = false;
        this.otiskPozic = otisk;
        this.doplnkyCas = Date.now();
        this.refreshExtras();
      }
      return true;
    } catch (err) {
      const zprava = this.prelozChybu(err.puvodni || err);
      this.zapisDiag('chyba', `${zprava} [${err.technicky || this.technickyPopis(err)}]`);
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
    this.refreshFunding().catch(() => { /* funding je doplněk, pozice jedou dál */ });
    this.getWalletBalance()
      .then(({ ucet, chyba }) => this.handlers.onAccount?.(ucet, chyba))
      .catch((err) => this.handlers.onAccount?.(null, this.prelozChybu(err)));
    this.getAllOpenOrders()
      .then((orders) => this.handlers.onOrders?.(orders, null))
      .catch((err) => this.handlers.onOrders?.([], this.prelozChybu(err)));
  }

  /** Funding a dopočty z minulého spuštění — u CCXT zatím nic. */
  obnovUlozeneFundingy() {}

  /*
   * Funding pozic (v0.59.8) — obecně pro burzy přes CCXT, tvar jako
   * u Bybitu: { rate (podíl), nextAt, minut, zaplaceno: { celkem, pocet,
   * odKdy } }. Sazba z `fetchFundingRate` (veřejná fronta), zaplacené
   * z `fetchFundingHistory` (hromadná fronta, u Binance deník příjmů
   * FUNDING_FEE) od otevření pozice; součet se dopočítává, nepočítá
   * znovu. Burza bez funding v `schopnosti` nic nestahuje.
   */
  async refreshFunding() {
    if (!this.burza?.schopnosti?.funding) return;
    this.fundingCache ??= new Map();
    this.fundingSoucty ??= new Map();
    const symboly = [...new Set([...this.positions.values()].map((p) => p.symbol))];
    // Zavřené pozice z paměti pryč.
    for (const s of [...this.fundingCache.keys()]) if (!symboly.includes(s)) this.fundingCache.delete(s);
    for (const s of [...this.fundingSoucty.keys()]) if (!symboly.includes(s)) this.fundingSoucty.delete(s);
    const ted = Date.now();
    let zmena = false;
    await Promise.all(symboly.map(async (symbol) => {
      const ulozene = this.fundingCache.get(symbol);
      if (ulozene && ted - ulozene.kdy < FUNDING_PLATI) return;
      // ⚠ Zámluva hned, před prvním await (stejně jako u Bybitu) — jinak
      // se při dotazech po 3 s rozjede víc běhů na tomtéž páru.
      this.fundingCache.set(symbol, { kdy: ted, funding: ulozene?.funding || null });
      try {
        const funding = await this.getFunding(symbol);
        if (!funding) return;
        let zaplaceno = null;
        if (this.burza.schopnosti.fundingHistorie) {
          try {
            const pozice = [...this.positions.values()].find((p) => p.symbol === symbol);
            const otevreno = await this.otevreniPozice(pozice).catch(() => null);
            zaplaceno = await this.getFundingPaid(symbol, otevreno);
          } catch (err) {
            this.zapisDiag('funding součet', err?.message || String(err));
          }
        }
        this.fundingCache.set(symbol, { kdy: ted, funding: { ...funding, zaplaceno } });
        zmena = true;
      } catch {
        this.fundingCache.delete(symbol); // příště znovu, ne až za 10 minut
      }
    }));
    if (!zmena) return;
    for (const p of this.positions.values()) {
      const f = this.fundingCache.get(p.symbol)?.funding;
      if (f) p.funding = f;
    }
    this.emitPositions();
  }

  async getFunding(symbol) {
    const ex = await this.burzaVerejna();
    const s = await this.symbolCcxt(symbol, true);
    const f = await ex.fetchFundingRate(s);
    if (!f) return null;
    const dalsi = cislo(f.nextFundingTimestamp) || cislo(f.fundingTimestamp);
    return {
      rate: cislo(f.fundingRate),
      nextAt: dalsi > Date.now() ? dalsi : null,
      minut: minutIntervalu(f.interval) || await this.fundingMinut(symbol).catch(() => 480),
    };
  }

  /** Interval stržení v minutách, když ho CCXT nedá — burza může přepsat. */
  async fundingMinut() {
    return 480;
  }

  /**
   * Zaplacený (−) / přijatý (+) funding od otevření pozice; bez známého
   * otevření za posledních 7 dní. Po týdnech (deníky burz mívají strop
   * okna), dopočítává se jen to, co přibylo od minula.
   */
  async getFundingPaid(symbol, odKdy) {
    const ted = Date.now();
    const od = odKdy || ted - TYDEN_MS;
    let z = this.fundingSoucty.get(symbol);
    if (!z || z.od !== od) z = { od, doKdy: od, celkem: 0, pocet: 0, odKdy: null, videne: new Set() };
    const s = await this.symbolCcxt(symbol);
    for (let start = Math.max(od, z.doKdy - 3600e3); start < ted; start += TYDEN_MS) {
      const konec = Math.min(ted, start + TYDEN_MS);
      const davka = await this.soukrome((ex) => ex.fetchFundingHistory(s, Math.floor(start), 1000,
        { until: Math.ceil(konec) }), true);
      for (const f of davka || []) {
        const cas = cislo(f.timestamp);
        const id = String(f.id ?? `${cas}|${f.amount}`);
        if (cas < od || z.videne.has(id)) continue;
        z.videne.add(id);
        z.celkem += cislo(f.amount);
        z.pocet += 1;
        z.odKdy = z.odKdy === null ? cas : Math.min(z.odKdy, cas);
      }
    }
    z.doKdy = ted;
    this.fundingSoucty.set(symbol, z);
    return { celkem: z.celkem, pocet: z.pocet, odKdy: z.odKdy };
  }

  async getWalletBalance() {
    const b = await this.soukrome((ex) => ex.fetchBalance());
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
    const m = this.trhyCcxt()[o.symbol];
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
    const s = await this.symbolCcxt(symbol);
    return (await this.soukrome((ex) => this.otevrenePrikazy(ex, s))).map((o) => this.prikaz(o));
  }

  async getAllOpenOrders() {
    const prikazy = await this.soukrome((ex) => this.otevrenePrikazy(ex, undefined));
    return prikazy.filter((o) => this.trhyCcxt()[o.symbol]?.linear).map((o) => this.prikaz(o));
  }

  /** Otevřené příkazy CCXT (páru, nebo všech) — burza může přidat další druhy. */
  async otevrenePrikazy(ex, symbolCcxt) {
    return ex.fetchOpenOrders(symbolCcxt);
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
      const davka = await this.soukrome((e) => e.fetchMyTrades(s, Math.floor(od), 1000, { endTime: Math.ceil(doKdy) }), true);
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

  /**
   * Čas otevření pozice z plnění (v0.59.8, pro funding a graf): od teď
   * dozadu se odečítá, čím se pozice měnila; kde je nula, tam začala.
   * Nejvýš 4 týdny zpátky, jinak null (funding se pak sečte za 7 dní).
   * Drží se, dokud se pozice nezmění (směr i velikost).
   */
  async otevreniPozice(pozice) {
    if (!pozice || !(pozice.size > 0) || !this.hasCredentials()) return null;
    this.otevreniCache ??= new Map();
    const klic = `${pozice.side}|${pozice.size}`;
    const z = this.otevreniCache.get(pozice.symbol);
    if (z && z.klic === klic) return z.slib;
    const slib = (async () => {
      const long = pozice.side !== 'Sell';
      let zbyva = pozice.size;
      let konec = Date.now();
      for (let i = 0; i < 4; i += 1) {
        const od = konec - TYDEN_MS;
        const plneni = (await this.getExecutions(pozice.symbol, od, konec)).sort((a, b) => b.time - a.time);
        for (const f of plneni) {
          zbyva -= (f.buy === long ? 1 : -1) * f.qty;
          if (zbyva <= pozice.size * 1e-6) return f.time;
        }
        konec = od;
      }
      return null;
    })();
    this.otevreniCache.set(pozice.symbol, { klic, slib });
    // Neúspěch se nepamatuje (limit dotazů za chvíli povolí).
    slib.catch(() => { if (this.otevreniCache.get(pozice.symbol)?.slib === slib) this.otevreniCache.delete(pozice.symbol); });
    return slib;
  }

  async getKlines(symbol, interval, limit = 500, endTime = null) {
    const ex = await this.burzaVerejna();
    const tf = TIMEFRAME[interval];
    if (!tf) return [];
    const s = await this.symbolCcxt(symbol, true);
    // Burza se stropem na počet svíček (OKX 300) by vrátila začátek okna
    // a nejnovější svíčky by chyběly — okno se proto zkrátí na strop.
    if (this.maxSvicek) limit = Math.min(limit, this.maxSvicek);
    const konec = endTime || Date.now();
    const od = konec - limit * (DELKA_TF[tf] || 3600e3);
    const radky = await ex.fetchOHLCV(s, tf, Math.floor(od), limit, endTime ? { until: Math.ceil(endTime) } : {}); // `until` = sjednocený konec okna CCXT
    return radky.map(([time, open, high, low, close, volume]) => ({
      time, open: cislo(open), high: cislo(high), low: cislo(low), close: cislo(close), volume: cislo(volume),
    }));
  }

  async getSparkline(symbol) {
    const ex = await this.burzaVerejna();
    const radky = await ex.fetchOHLCV(await this.symbolCcxt(symbol, true), '1h', undefined, 24);
    return radky.map((r) => cislo(r[4]));
  }

  ticker(tk) {
    const m = this.trhyCcxt()[tk.symbol];
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
    const ex = await this.burzaVerejna();
    const tk = await ex.fetchTicker(await this.symbolCcxt(symbol, true));
    return tk ? this.ticker(tk) : null;
  }

  async getTickers() {
    const ex = await this.burzaVerejna();
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

  /** Páry, jejichž cenu aplikace chce (dlaždice seznamu + pozice). */
  paryCen() {
    return new Set([...this.extraTickers, ...[...this.positions.values()].map((p) => p.symbol)]);
  }

  /** Přišlo z živého proudu v posledních pár vteřinách? (bez proudu nikdy) */
  zProudu(klic) {
    return Date.now() - (this.cerstve?.get(klic) || 0) < PROUD_CERSTVY;
  }

  /** Živý proud — burza, která ho má, přepíše (Binance). */
  synchronizujOdbery() {}

  /** Nová cena páru → dlaždice (onTicker) a pozice (mark, PnL). Vrací, jestli se pozice změnily. */
  pouzijCenu(z, mark) {
    if (this.extraTickers.has(z.symbol)) this.handlers.onTicker?.(z);
    let zmena = false;
    for (const p of this.positions.values()) {
      if (p.symbol !== z.symbol || !mark || p.mark === mark) continue;
      p.mark = mark;
      p.pnl = (mark - p.entry) * p.size * (p.side === 'Sell' ? -1 : 1);
      zmena = true;
    }
    return zmena;
  }

  async obnovCeny() {
    if (!this.foreground || (!this.ex && !this.exVerejna)) return;
    this.synchronizujOdbery();
    // Páry, které živý proud právě obsluhuje, se dotazem neptají.
    const pary = [...this.paryCen()].filter((s) => !this.zProudu(`c:${s}`));
    if (!pary.length) return;
    try {
      const symboly = pary.map((s) => this.trh(s)?.symbol).filter(Boolean);
      const vse = await this.tickeryParu(await this.burzaVerejna(), symboly);
      let zmena = false;
      for (const tk of Object.values(vse)) {
        if (this.pouzijCenu(this.ticker(tk), cislo(tk.markPrice ?? tk.last))) zmena = true;
      }
      if (zmena) this.emitPositions();
    } catch { /* příště znovu */ }
  }

  /** Tickery vybraných párů (symboly CCXT) → { symbol: ticker }; burza může přepsat. */
  async tickeryParu(ex, symboly) {
    return ex.fetchTickers(symboly);
  }

  setKlineSubscription(symbol, interval) {
    clearInterval(this.casovacSvicky);
    this.svicka = symbol && interval ? { symbol, interval } : null;
    this.synchronizujOdbery();
    if (!this.svicka) return;
    const { symbol: s, interval: i } = this.svicka;
    this.casovacSvicky = setInterval(async () => {
      if (!this.foreground || this.svicka?.symbol !== s || this.svicka?.interval !== i) return;
      if (this.zProudu(`k:${s}:${i}`)) return; // živá svíčka jde proudem
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
