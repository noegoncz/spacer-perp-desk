/**
 * Jediný modul, který komunikuje s Bybitem.
 *
 * Zbytek aplikace nesmí volat fetch ani WebSocket přímo — v checkpointu 4
 * (Capacitor / APK) se transport vymění za nativní plugin a musí to jít
 * udělat na jednom místě. Proto tenhle modul nesahá na DOM a výsledky hlásí
 * výhradně callbacky.
 */

import { t } from './i18n.js';

const REST_BASE = 'https://api.bybit.com';
const WS_PRIVATE = 'wss://stream.bybit.com/v5/private';
/*
 * ⚠ V cestě musí být `public`. Bez něj se spojení vůbec nenaváže (zavře se
 * s kódem 1006) a tiše — aplikace jen pořád dokola zkouší znovu. Veřejný
 * stream proto nikdy nefungoval: živé svíčky se nehýbaly a mark cena se
 * měnila jen při dotazu po 30 s. Ověřeno proti burze, viz CLAUDE.md.
 */
const WS_PUBLIC_LINEAR = 'wss://stream.bybit.com/v5/public/linear';

const RECV_WINDOW = '10000';

/**
 * Chyby autentizace nechodí jako JSON s retCode, ale jako HTTP 401
 * s prázdným tělem (ověřeno proti produkci). Důvod je v hlavičce stavového
 * řádku, kterou prohlížeč přes HTTP/2 nezpřístupní, takže se text odvozuje
 * ze stavového kódu.
 */
function httpErrorMessage(status, statusText) {
  const detail = statusText ? ` (${statusText})` : '';
  switch (status) {
    case 401:
    case 403:
      return t('error.rejected', { detail });
    case 429:
      return t('error.rateLimit');
    default:
      if (status >= 500) return t('error.outage', { status });
      return t('error.unexpected', { status, detail });
  }
}

/**
 * Kolik sekund čekat na odpověď.
 *
 * ⚠ `fetch` sám o sobě **žádný časový limit nemá**. Na telefonu se požadavek
 * umí zaseknout natrvalo (přepnutí sítě, mrtvá Wi-Fi) a bez limitu by na něm
 * aplikace uvázla bez jediné hlášky.
 */
const LIMIT_ODPOVEDI = 15000;

/** Výchozí transport. Capacitor ho nahradí nativním HTTP pluginem. */
async function defaultHttpGet(url, headers) {
  const stopky = new AbortController();
  const casovac = setTimeout(() => stopky.abort(), LIMIT_ODPOVEDI);

  let res;
  try {
    res = await fetch(url, {
      method: 'GET',
      headers,
      cache: 'no-store',
      signal: stopky.signal,
    });
  } catch (err) {
    throw new Error(err?.name === 'AbortError' ? t('error.timeout') : t('error.offline'));
  } finally {
    clearTimeout(casovac);
  }

  const text = (await res.text()).trim();
  if (!text) throw new Error(httpErrorMessage(res.status, res.statusText));

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(httpErrorMessage(res.status, res.statusText));
  }
}

/* ---------- podpis ---------- */

const encoder = new TextEncoder();
const keyCache = new Map();

async function importKey(secret) {
  let key = keyCache.get(secret);
  if (!key) {
    key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    keyCache.set(secret, key);
  }
  return key;
}

async function hmacHex(secret, message) {
  const key = await importKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/* ---------- převod odpovědí na jednotný tvar ---------- */

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function optionalNum(value) {
  if (value === '' || value === null || value === undefined) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return null;
  return n;
}

/**
 * REST a WebSocket vrací tutéž pozici pod jinými jmény polí
 * (REST `avgPrice` vs. WS `entryPrice`), proto sjednocení na jednom místě.
 */
function normalizePosition(raw) {
  return {
    symbol: raw.symbol,
    side: raw.side,
    size: num(raw.size),
    entry: num(raw.entryPrice ?? raw.avgPrice),
    mark: num(raw.markPrice),
    pnl: num(raw.unrealisedPnl),
    liq: optionalNum(raw.liqPrice),
    leverage: raw.leverage ? num(raw.leverage) : null,
    value: num(raw.positionValue),
    stopLoss: optionalNum(raw.stopLoss),
    takeProfit: optionalNum(raw.takeProfit),
    positionIdx: raw.positionIdx ?? 0,
    // Kdy pozice vznikla — od toho se počítá, za jak dlouhou dobu se
    // sčítá zaplacený funding.
    openedAt: Number(raw.createdTime) || null,
    updatedAt: Date.now(),
  };
}

function positionKey(p) {
  return `${p.symbol}#${p.positionIdx ?? 0}`;
}

/** Příkaz v jednotném tvaru — stejný pro čáry v grafu i pro seznam příkazů. */
function normalizeOrder(o) {
  return {
    id: o.orderId,
    symbol: o.symbol,
    side: o.side,
    type: o.orderType,
    stopType: o.stopOrderType || '',
    price: optionalNum(o.price),
    trigger: optionalNum(o.triggerPrice),
    qty: num(o.qty),
    filled: num(o.cumExecQty),
    reduceOnly: Boolean(o.reduceOnly),
    createdAt: Number(o.createdTime) || 0,
  };
}

/** PnL přepočítaný lokálně, když přijde nová mark cena z ticker streamu. */
function recalcPnl(p) {
  if (!p.entry || !p.size || !p.mark) return p.pnl;
  const direction = p.side === 'Sell' ? -1 : 1;
  return (p.mark - p.entry) * p.size * direction;
}

/** Srozumitelný český text pro známé chybové kódy Bybitu. */
export function describeError(retCode, retMsg) {
  switch (Number(retCode)) {
    case 10003:
    case 10004:
      return t('error.badKey');
    case 10002:
      return t('error.clock');
    case 10005:
      return t('error.noPermission');
    case 10010:
      return t('error.ipLocked');
    case 33004:
      return t('error.expired');
    default:
      return retMsg
        ? t('error.bybit', { message: retMsg, code: retCode })
        : t('error.bybitCode', { code: retCode });
  }
}

/* ---------- klient ---------- */

export class BybitClient {
  /**
   * @param {object} handlers
   * @param {(positions: object[]) => void} handlers.onPositions
   * @param {(status: object) => void}      handlers.onStatus
   * @param {(message: string) => void}     handlers.onError
   * @param {object} [options]
   * @param {Function} [options.httpGet] náhrada transportu pro Capacitor
   */
  constructor(handlers = {}, options = {}) {
    this.handlers = handlers;
    this.httpGet = options.httpGet || defaultHttpGet;

    this.apiKey = '';
    this.apiSecret = '';

    /** rozdíl mezi časem serveru a telefonu; bez něj padají podpisy na 10002 */
    this.timeOffset = 0;

    this.positions = new Map();
    this.running = false;
    this.foreground = true;

    this.privateWs = null;
    this.publicWs = null;
    this.privateAttempt = 0;
    this.publicAttempt = 0;
    this.privateTimer = null;
    this.publicTimer = null;
    this.pingTimer = null;
    this.watchdogTimer = null;
    this.pollTimer = null;
    this.subscribedSymbols = new Set();
    this.klineTopic = null;

    /** UNIFIED nebo CONTRACT; zjistí se při prvním načtení přehledu účtu. */
    this.typUctu = '';
    /** Funding interval páru se prakticky nemění — stačí se zeptat jednou. */
    this.fundingIntervaly = new Map();
    /** Sazba funding se mění po hodinách; častější dotazování nemá smysl. */
    this.fundingCache = new Map();
    /**
     * Čas otevření současné pozice, dopočítaný z plnění. Drží se, dokud
     * pozice žije — přikoupení ani částečné zavření ho nemění. Maže se,
     * až když pozice zmizí, aby si ho ta příští nezdědila.
     */
    this.otevreniCache = new Map();
    /**
     * Dopočítávaný součet zaplaceného fundingu na pár. Bez něj by se při
     * každém obnovení procházela celá historie pozice po sedmidenních
     * oknech. Maže se spolu s pozicí.
     */
    this.fundingSoucty = new Map();

    this.status = { ws: 'idle', rest: 'idle', lastUpdate: null };

    /**
     * Stopa toho, co klient právě dělá. Bez ní se chyba na cizím telefonu
     * hledá jen hádáním — což už jednou stálo dvě zbytečná kola.
     */
    this.diag = { krok: 'start', pokusu: 0, posledniChyba: null, casChyby: null };
  }

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

  now() {
    return Date.now() + this.timeOffset;
  }

  setStatus(patch) {
    this.status = { ...this.status, ...patch };
    this.handlers.onStatus?.(this.status);
  }

  emitPositions() {
    const list = [...this.positions.values()].sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
    this.handlers.onPositions?.(list);
  }

  emitError(message) {
    this.handlers.onError?.(message);
  }

  /* ---------- REST ---------- */

  async syncTime() {
    try {
      const json = await this.httpGet(`${REST_BASE}/v5/market/time`, {});
      const serverMs = Number(json?.result?.timeNano ?? 0) / 1e6 || Number(json?.time ?? 0);
      if (serverMs > 0) this.timeOffset = Math.round(serverMs - Date.now());
    } catch (err) {
      // Běží se dál s offsetem 0, ale chyba se musí zaznamenat — dřív mizela
      // beze stopy a schovávala tím, že je čas serveru nedostupný.
      this.zapisDiag('čas serveru selhal', err.message || String(err));
    }
  }

  async signedGet(path, params) {
    if (!this.hasCredentials()) throw new Error(t('error.noKeys'));

    // Podepisuje se přesně ten query string, který se odešle, ve stejném pořadí.
    const query = new URLSearchParams(params).toString();
    const timestamp = String(this.now());
    const sign = await hmacHex(
      this.apiSecret,
      timestamp + this.apiKey + RECV_WINDOW + query,
    );

    const json = await this.httpGet(`${REST_BASE}${path}?${query}`, {
      'X-BAPI-API-KEY': this.apiKey,
      'X-BAPI-TIMESTAMP': timestamp,
      'X-BAPI-RECV-WINDOW': RECV_WINDOW,
      'X-BAPI-SIGN': sign,
    });

    if (Number(json.retCode) !== 0) {
      throw new Error(describeError(json.retCode, json.retMsg));
    }
    return json.result;
  }

  /** Načte otevřené linear USDT pozice a nahradí jimi celý stav. */
  async refresh() {
    this.setStatus({ rest: 'loading' });
    this.diag.pokusu += 1;
    this.zapisDiag('čas serveru');
    try {
      await this.syncTime();
      this.zapisDiag('pozice');
      const result = await this.signedGet('/v5/position/list', {
        category: 'linear',
        settleCoin: 'USDT',
        limit: '200',
      });

      this.positions.clear();
      for (const raw of result?.list ?? []) {
        const p = normalizePosition(raw);
        if (p.size === 0) continue;
        // Funding se drží v cache, ne na pozici — jinak by po každém
        // přenačtení pozic na kartě na chvíli zmizel.
        const zaznam = this.fundingCache.get(p.symbol);
        if (zaznam) p.funding = zaznam.funding;
        this.positions.set(positionKey(p), p);
      }

      this.zapisDiag(`hotovo, pozic: ${this.positions.size}`);
      this.setStatus({ rest: 'ok', lastUpdate: Date.now() });
      this.emitPositions();
      this.syncTickerSubscriptions();
      // Přehled účtu, funding a příkazy jdou zvlášť a bez čekání — pozice
      // se musí ukázat hned, i kdyby tyhle dotazy selhaly nebo se vlekly.
      this.refreshExtras();
      return true;
    } catch (err) {
      this.zapisDiag('chyba', err.message || String(err));
      this.setStatus({ rest: 'error' });
      this.emitError(err.message || String(err));
      return false;
    }
  }

  /**
   * Doplňková data o účtu. Schválně mimo `refresh()`: každá část smí selhat
   * samostatně a ani jedna nesmí shodit seznam pozic. Proto žádné `await`
   * na výsledek a každá větev má vlastní `catch`.
   */
  refreshExtras() {
    if (!this.hasCredentials()) return;

    this.getWalletBalance()
      .then(({ ucet, chyba }) => this.handlers.onAccount?.(ucet, chyba))
      .catch((err) => this.handlers.onAccount?.(null, err?.message || String(err)));

    this.getAllOpenOrders()
      .then((orders) => this.handlers.onOrders?.(orders, null))
      .catch((err) => this.handlers.onOrders?.([], err?.message || String(err)));

    this.refreshFunding();
  }

  /**
   * Funding pro páry s otevřenou pozicí. Sazba se hýbe po hodinách, takže
   * se drží deset minut v paměti — jinak by každý třicetisekundový poll
   * poslal na burzu dva dotazy na pár zbytečně.
   */
  async refreshFunding() {
    const symboly = [...new Set([...this.positions.values()].map((p) => p.symbol))];
    const ted = Date.now();
    let zmena = false;

    await Promise.all(symboly.map(async (symbol) => {
      const ulozene = this.fundingCache.get(symbol);
      if (ulozene && ted - ulozene.kdy < 600000) return;
      /*
       * ⚠ Místo v cache se zamluví **hned**, ještě před prvním `await`.
       * Dotahování běží každých třicet vteřin a dopočet času otevření
       * i součtu fundingu může trvat dýl — bez zámluvy se rozjede druhý,
       * třetí a čtvrtý běh na tomtéž páru, dotazy se znásobí a burza začne
       * odmítat kvůli limitu. Pak zmizí i to, co předtím fungovalo.
       */
      this.fundingCache.set(symbol, { kdy: ted, funding: ulozene?.funding || null });
      try {
        const funding = await this.getFunding(symbol);
        if (!funding) return;

        // Součet zaplaceného je zvlášť: potřebuje oprávnění Wallet, které
        // klíč mít nemusí. Když nevyjde, zbytek fundingu se ukáže dál.
        let zaplaceno = null;
        const pozice = [...this.positions.values()].find((p) => p.symbol === symbol);
        try {
          // Když se čas otevření nedohledá, funding se sečte za posledních
          // sedm dní — to je pořád lepší než neukázat nic.
          const otevreno = await this.otevreniPozice(pozice).catch(() => null);
          zaplaceno = await this.getFundingPaid(symbol, otevreno);
        } catch (err) {
          // ⚠ Nepolykat potichu. Když součet chybí, musí jít zjistit proč —
          // jinak se hádá, jestli chybí oprávnění, nebo je chyba v kódu.
          this.zapisDiag('funding součet', err?.message || String(err));
        }

        this.fundingCache.set(symbol, { kdy: ted, funding: { ...funding, zaplaceno } });
        zmena = true;
      } catch {
        // Zámluvu zrušit, ať se to zkusí znovu při dalším kole a ne až
        // za deset minut.
        this.fundingCache.delete(symbol);
      }
    }));

    // Nalepit na pozice a znovu ohlásit, ať karty dostanou čísla.
    let pripojeno = false;
    for (const p of this.positions.values()) {
      const zaznam = this.fundingCache.get(p.symbol);
      if (zaznam && p.funding !== zaznam.funding) {
        p.funding = zaznam.funding;
        pripojeno = true;
      }
    }
    if (zmena || pripojeno) this.emitPositions();
  }

  /**
   * Kdy se **současná** pozice otevřela.
   *
   * ⚠ `createdTime` z `position/list` na to není — je to čas, kdy na tom páru
   * vznikla pozice **poprvé v historii**, ne ta dnešní. Uživateli to u páru
   * obchodovaného před sedmi týdny napsalo „paid 0.91 USDT in 49 d", přestože
   * pozici držel dvacet minut; v součtu byl funding dávno zavřených obchodů.
   *
   * Čas otevření se proto dopočítá z plnění: jde se od teď dozadu a odečítá
   * se, čím se pozice měnila. Ve chvíli, kdy velikost padne na nulu, stojíme
   * na plnění, které pozici otevřelo. Když se to do osmi týdnů nepodaří
   * dohledat, vrací se `null` — pak se sčítá posledních sedm dní a karta to
   * přizná, místo aby si vymýšlela.
   */
  async otevreniPozice(pozice) {
    if (!pozice || !(pozice.size > 0)) return null;

    const ulozene = this.otevreniCache.get(pozice.symbol);
    // Přepočítává se, až když pozice zmizí — částečné zavření ani přikoupení
    // čas otevření nemění.
    //
    // ⚠ Ukládá se **rozdělaná práce, ne hotová hodnota**. Ptá se odsud jak
    // funding, tak graf; bez sdílení by oba spustili vlastní procházení
    // plnění naráz a dotazy se zdvojily.
    if (ulozene !== undefined) return ulozene;

    const prace = this.dohledejOtevreni(pozice);
    this.otevreniCache.set(pozice.symbol, prace);
    // Neúspěch se nemá zapamatovat jako platná odpověď.
    prace.catch(() => this.otevreniCache.delete(pozice.symbol));
    return prace;
  }

  async dohledejOtevreni(pozice) {

    const OKNO = 7 * 86400000;
    const long = pozice.side !== 'Sell';
    // Zaokrouhlení velikostí: nulu nehledat na desetinu přesně.
    const epsilon = Math.abs(pozice.size) * 1e-6;

    let zbyva = pozice.size;
    let konec = Date.now();
    let cas = null;

    try {
      /*
       * Rok po týdnech. Stejně jako u součtu to není limit na dobu držení,
       * ale pojistka proti nekonečné smyčce — a počítá se jednou za pozici.
       *
       * `createdTime` je poctivá spodní mez: dřív, než na páru vznikla první
       * pozice v historii, žádné plnění být nemůže. U páru obchodovaného
       * poprvé před týdnem se tak projde jedno okno místo dvaapadesáti.
       */
      const nejdal = Number(pozice.openedAt) || 0;

      for (let okno = 0; okno < 52 && zbyva > epsilon; okno += 1) {
        if (nejdal && konec <= nejdal) break;
        const od = konec - OKNO;
        const plneni = await this.getExecutions(pozice.symbol, od, konec);
        for (let i = plneni.length - 1; i >= 0 && zbyva > epsilon; i -= 1) {
          // Plnění ve směru pozice ji zvětšovalo, opačné zmenšovalo.
          zbyva -= (plneni[i].buy === long ? 1 : -1) * plneni[i].qty;
          cas = plneni[i].time;
        }
        konec = od;
      }
    } catch (err) {
      /*
       * ⚠ Chyba se **nezapamatuje**. Klíč bez práva na plnění i vyčerpaný
       * limit dotazů vypadají stejně, jenže limit za chvíli povolí — a kdyby
       * se `null` uložilo natrvalo, zůstal by u té pozice nepřesný součet
       * až do jejího zavření. Slib se proto zahodí (viz `otevreniPozice`)
       * a příští kolo to zkusí znovu.
       */
      this.zapisDiag('otevření pozice', err?.message || String(err));
      throw err;
    }

    return zbyva <= epsilon ? cas : null;
  }

  /* ---------- svíčky a příkazy (checkpoint 2) ---------- */

  /** Tržní data jsou veřejná, nepodepisují se. */
  async publicGet(path, params) {
    const query = new URLSearchParams(params).toString();
    const json = await this.httpGet(`${REST_BASE}${path}?${query}`, {});
    if (Number(json.retCode) !== 0) {
      throw new Error(describeError(json.retCode, json.retMsg));
    }
    return json.result;
  }

  /**
   * Svíčky vzestupně podle času. Bybit je vrací od nejnovější, graf je
   * potřebuje obráceně.
   */
  async getKlines(symbol, interval, limit = 500, endTime = null) {
    const result = await this.publicGet('/v5/market/kline', {
      category: 'linear',
      symbol,
      interval,
      limit: String(limit),
      // Bez `end` vrací Bybit nejnovější svíčky; při prohlížení starého
      // obchodu potřebujeme okno kolem jeho času.
      ...(endTime ? { end: String(Math.ceil(endTime)) } : {}),
    });
    // Čas zůstává v milisekundách, jak ho Bybit posílá. Objem je potřeba
    // pro indikátor objemu v grafu.
    return (result?.list ?? [])
      .map((row) => ({
        time: Number(row[0]),
        open: num(row[1]),
        high: num(row[2]),
        low: num(row[3]),
        close: num(row[4]),
        volume: num(row[5]),
      }))
      .reverse();
  }

  /**
   * Všechny linear USDT páry se základními čísly, seřazené podle obratu.
   * Veřejné, nepotřebuje klíče — seznam jde ukázat i před přihlášením.
   */
  async getTickers() {
    const result = await this.publicGet('/v5/market/tickers', { category: 'linear' });
    return (result?.list ?? [])
      // Předlistingové páry se ještě neobchodují a jen by kazily seznam.
      .filter((t) => t.symbol?.endsWith('USDT') && !t.curPreListingPhase)
      .map((t) => ({
        symbol: t.symbol,
        last: num(t.lastPrice),
        changePct: num(t.price24hPcnt) * 100,
        turnover: num(t.turnover24h),
      }))
      .sort((a, b) => b.turnover - a.turnover);
  }

  /**
   * Uzavřené obchody, nejnovější první.
   *
   * ⚠ `side` v téhle odpovědi je strana **zavírací** objednávky, ne směr
   * pozice — dlouhá pozice se zavírá prodejem. Směr se proto odvozuje
   * z cen a zisku, což je samo o sobě konzistentní: když se vydělalo
   * a výstup byl výš než vstup, šlo o long.
   */
  async getClosedTrades(limit = 50) {
    const result = await this.signedGet('/v5/position/closed-pnl', {
      category: 'linear',
      limit: String(limit),
    });
    return (result?.list ?? []).map((r) => {
      const entry = num(r.avgEntryPrice);
      const exit = num(r.avgExitPrice);
      const pnl = num(r.closedPnl);
      const long = entry === exit ? r.side === 'Sell' : (exit > entry) === (pnl >= 0);
      return {
        id: r.orderId,
        symbol: r.symbol,
        long,
        qty: num(r.qty),
        entry,
        exit,
        pnl,
        value: num(r.cumEntryValue),
        leverage: r.leverage ? num(r.leverage) : null,
        openedAt: Number(r.createdTime),
        closedAt: Number(r.updatedTime),
      };
    });
  }

  /**
   * Jednotlivá plnění na páru v daném okně. Právě díky nim jdou vstupy
   * a výstupy položit na správné svíčky — průměry z uzavřených obchodů
   * by daly jednu značku uprostřed ničeho.
   */
  async getExecutions(symbol, startTime, endTime) {
    const result = await this.signedGet('/v5/execution/list', {
      category: 'linear',
      symbol,
      startTime: String(Math.floor(startTime)),
      endTime: String(Math.ceil(endTime)),
      limit: '100',
    });
    return (result?.list ?? [])
      .filter((e) => e.execType === 'Trade')
      .map((e) => ({
        buy: e.side === 'Buy',
        price: num(e.execPrice),
        qty: num(e.execQty),
        time: Number(e.execTime),
      }))
      .sort((a, b) => a.time - b.time);
  }

  /** Zavírací ceny za posledních 24 hodin — podklad pro mini-graf trendu. */
  async getSparkline(symbol) {
    const result = await this.publicGet('/v5/market/kline', {
      category: 'linear',
      symbol,
      interval: '60',
      limit: '24',
    });
    return (result?.list ?? []).map((row) => num(row[4])).reverse();
  }

  /** Otevřené příkazy k páru — limitky a podmíněné příkazy pro čáry v grafu. */
  async getOpenOrders(symbol) {
    const result = await this.signedGet('/v5/order/realtime', {
      category: 'linear',
      symbol,
      limit: '50',
    });
    return (result?.list ?? []).map(normalizeOrder);
  }

  /**
   * Všechny otevřené příkazy napříč páry — podklad pro samostatný seznam,
   * ne jen čáry v grafu jednoho páru.
   */
  async getAllOpenOrders() {
    const result = await this.signedGet('/v5/order/realtime', {
      category: 'linear',
      settleCoin: 'USDT',
      limit: '50',
    });
    return (result?.list ?? [])
      .map(normalizeOrder)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  /* ---------- přehled účtu a funding (checkpoint 7) ---------- */

  /**
   * Equity, volný margin a využití marginu.
   *
   * ⚠ Klíč jen s právem na pozice tohle nevrátí — Bybit odpoví 10005.
   * Volající to **nesmí brát jako chybu spojení**: pozice fungují dál, jen
   * se přehled nezobrazí. Proto se chyba vrací jako hodnota, ne výjimka.
   *
   * ⚠ Typ účtu se zkouší oběma směry. `UNIFIED` je dnešní výchozí, starší
   * účty jsou `CONTRACT` a mají čísla jinde — v `coin[]` místo v součtech.
   */
  async getWalletBalance() {
    let posledniChyba = null;

    for (const accountType of ['UNIFIED', 'CONTRACT']) {
      try {
        const result = await this.signedGet('/v5/account/wallet-balance', { accountType });
        const ucet = result?.list?.[0];
        if (!ucet) continue;

        const usdt = (ucet.coin ?? []).find((c) => c.coin === 'USDT') ?? {};
        const equity = num(ucet.totalEquity) || num(usdt.equity);
        if (!equity) continue;

        const volny = num(ucet.totalAvailableBalance) || num(usdt.availableToWithdraw);
        // accountIMRate je podíl 0–1; u CONTRACT účtů chybí, tam se dopočítá.
        const podil = Number(ucet.accountIMRate);
        const pouzity = num(ucet.totalInitialMargin) || num(usdt.totalPositionIM);
        const vyuziti = Number.isFinite(podil) && podil > 0
          ? podil * 100
          : (equity > 0 ? (pouzity / equity) * 100 : null);

        // Typ účtu si pamatujeme — transaction-log ho potřebuje taky.
        this.typUctu = accountType;
        return {
          ucet: { equity, volny, vyuziti, pouzity, typ: accountType },
          chyba: null,
        };
      } catch (err) {
        posledniChyba = err?.message || String(err);
      }
    }
    return { ucet: null, chyba: posledniChyba || t('account.unavailable') };
  }

  /**
   * Funding páru: sazba za jedno stržení a kdy se strhne příště.
   *
   * Interval se u Bybitu liší pár od páru (osm hodin je jen nejčastější),
   * a v tickeru není — musí se doptat `instruments-info`. Mění se prakticky
   * nikdy, takže se pamatuje do konce běhu.
   */
  async getFunding(symbol) {
    const [ticker, minut] = await Promise.all([
      this.publicGet('/v5/market/tickers', { category: 'linear', symbol }),
      this.fundingInterval(symbol),
    ]);
    const row = ticker?.list?.[0];
    if (!row) return null;
    return {
      rate: Number(row.fundingRate) || 0,
      nextAt: Number(row.nextFundingTime) || null,
      minut,
    };
  }

  /**
   * Kolik funding pozice zatím stála, nebo vynesla — od jejího otevření.
   *
   * Bere se z `transaction-log`, typ `SETTLEMENT`: to jsou právě jednotlivá
   * stržení fundingu. `funding` je **záporné, když se platí**; starší
   * odpovědi ho nemusí mít, tam zbývá `cashFlow`.
   *
   * ⚠ Stejně jako přehled účtu tohle potřebuje oprávnění Wallet. Volající
   * to musí umět přežít — bez součtu se pozice ukazuje dál.
   */
  async getFundingPaid(symbol, odKdy) {
    const ted = Date.now();
    /*
     * Součet se **dopočítává**, nepočítá znovu. Pozici jde držet měsíce
     * a projít celou její historii po sedmidenních oknech při každém
     * desetiminutovém obnovení by znamenalo desítky dotazů pořád dokola.
     * Takhle je drahý jen první průchod; pak se přidává posledních pár
     * minut. Záznam se maže, až když pozice zmizí.
     */
    const ulozeny = this.fundingSoucty.get(symbol);
    const odkud = ulozeny ? ulozeny.doKdy : odKdy;
    const pridavek = await this.sectiZDeniku(symbol, odkud, ted, !ulozeny);

    const soucet = {
      celkem: (ulozeny?.celkem || 0) + pridavek.celkem,
      pocet: (ulozeny?.pocet || 0) + pridavek.pocet,
      // Od kdy se doopravdy počítalo — UI z toho píše, za jak dlouhou dobu
      // součet je, takže nesmí tvrdit víc, než se stáhlo.
      odKdy: ulozeny?.odKdy ?? pridavek.odKdy,
      doKdy: ted,
    };
    this.fundingSoucty.set(symbol, soucet);
    return soucet;
  }

  async sectiZDeniku(symbol, odKdy, doKdy, prvniPruchod) {
    /*
     * ⚠ Deník neumí filtrovat na `symbol`, jen na `baseCoin`. Bez něj se
     * do stránek po 50 řádcích vejde při více pozicích sotva den — právě
     * proto stálo na telefonu „paid 0.00 USDT in 1 d" i u pozice držené
     * několik dní. Kdyby Bybit `baseCoin` u páru neplnil, jde druhé kolo
     * bez něj a řádky se odfiltrují podle symbolu jako dřív.
     *
     * ⚠ Druhé kolo jen při prvním průchodu. Později je nula stržení běžný
     * stav (za posledních deset minut se nic nestrhlo) a opakovaný dotaz
     * by jen zdvojnásobil provoz.
     */
    const baseCoin = symbol.endsWith('USDT') ? symbol.slice(0, -4) : '';
    if (baseCoin) {
      const s = await this.sectiFunding(symbol, odKdy, doKdy, baseCoin);
      if (s.pocet > 0 || !prvniPruchod) return s;
    }
    return this.sectiFunding(symbol, odKdy, doKdy, '');
  }

  /**
   * Sečte funding po **sedmidenních oknech** mezi dvěma časy.
   *
   * ⚠ Bybit vyžaduje `startTime` a `endTime` **společně** a okno smí být
   * nejvýš sedm dní. Samotný `startTime` (jak to dělala první verze) dotaz
   * shodí, takže součet nikdy nedorazil. Proti mocku to přitom vycházelo —
   * mock odpoví na cokoli.
   */
  async sectiFunding(symbol, odKdy, ted, baseCoin) {
    const OKNO = 7 * 86400000;
    /*
     * Strop není „takhle dlouho smíš držet pozici", ale pojistka proti
     * nekonečné smyčce, kdyby čas otevření vyšel nesmyslně (třeba z rozjetých
     * hodin v telefonu). Rok po sedmidenních oknech je 52 dotazů, a ty se
     * díky dopočítávání výš udělají jednou za pozici, ne při každém obnovení.
     */
    const MAX_OKEN = 52;

    const chtenyZacatek = Number.isFinite(odKdy) && odKdy > 0 ? odKdy : ted - OKNO;
    const zacatek = Math.max(chtenyZacatek, ted - MAX_OKEN * OKNO);

    let celkem = 0;
    let pocet = 0;
    let odKdyReal = null;

    for (let od = zacatek; od < ted; od += OKNO) {
      const doKdy = Math.min(od + OKNO, ted);
      try {
        const kus = await this.stahniFunding(symbol, {
          startTime: String(Math.floor(od)),
          endTime: String(Math.ceil(doKdy)),
          ...(baseCoin ? { baseCoin } : {}),
        });
        celkem += kus.celkem;
        pocet += kus.pocet;
        if (kus.odKdy !== null && (odKdyReal === null || kus.odKdy < odKdyReal)) {
          odKdyReal = kus.odKdy;
        }
      } catch (err) {
        // Jedno vypadlé okno nesmí shodit celý součet. Chybějící stržení se
        // na čísle projeví, proto to jde aspoň do diagnostické stopy.
        this.zapisDiag('funding okno', err?.message || String(err));
      }
    }

    return { celkem, pocet, odKdy: odKdyReal ?? zacatek };
  }

  async stahniFunding(symbol, okno) {
    let celkem = 0;
    let pocet = 0;
    let cursor = '';
    let odKdy = null;

    // Tři stránky po 50 pokryjí sedmidenní okno i při třech strženích denně.
    for (let stranka = 0; stranka < 3; stranka += 1) {
      const result = await this.signedGet('/v5/account/transaction-log', {
        accountType: this.typUctu || 'UNIFIED',
        category: 'linear',
        currency: 'USDT',
        type: 'SETTLEMENT',
        limit: '50',
        ...okno,
        ...(cursor ? { cursor } : {}),
      });

      const radky = result?.list ?? [];
      for (const r of radky) {
        if (r.symbol !== symbol) continue;
        const castka = Number(r.funding ?? r.cashFlow ?? r.change);
        if (Number.isFinite(castka) && castka !== 0) {
          celkem += castka;
          pocet += 1;
          const kdy = Number(r.transactionTime);
          if (Number.isFinite(kdy) && (odKdy === null || kdy < odKdy)) odKdy = kdy;
        }
      }

      cursor = result?.nextPageCursor || '';
      if (!cursor || !radky.length) break;
    }
    // `odKdy` říká, od kdy se doopravdy počítalo — UI pak nelže, že jde
    // o součet za celou dobu držení, když Bybit dal jen posledních pár dní.
    return { celkem, pocet, odKdy };
  }

  async fundingInterval(symbol) {
    if (this.fundingIntervaly.has(symbol)) return this.fundingIntervaly.get(symbol);
    let minut = 480; // osm hodin, standard u USDT perpetuálů
    try {
      const result = await this.publicGet('/v5/market/instruments-info', {
        category: 'linear',
        symbol,
      });
      minut = Number(result?.list?.[0]?.fundingInterval) || 480;
    } catch {
      /* zůstane výchozích osm hodin — lepší než nic neukázat */
    }
    this.fundingIntervaly.set(symbol, minut);
    return minut;
  }

  /**
   * Přepne odběr svíček na veřejném streamu. Drží se jen jeden — graf ukazuje
   * vždy jeden pár a interval. `null` odběr zruší.
   */
  setKlineSubscription(symbol, interval) {
    const topic = symbol && interval ? `kline.${interval}.${symbol}` : null;
    if (topic === this.klineTopic) return;

    const ws = this.publicWs;
    const open = ws && ws.readyState === WebSocket.OPEN;

    if (this.klineTopic && open) {
      ws.send(JSON.stringify({ op: 'unsubscribe', args: [this.klineTopic] }));
    }
    this.klineTopic = topic;
    if (topic && open) {
      ws.send(JSON.stringify({ op: 'subscribe', args: [topic] }));
    }
  }

  /* ---------- životní cyklus ---------- */

  async start() {
    if (!this.hasCredentials()) return false;
    this.running = true;

    // Opakované dotahování se rozjede jako první. Kdyby se první načtení
    // zaseklo, běželo by se dál zkoušet — dřív na něm aplikace uvázla.
    this.startPolling();
    this.connectPrivate();
    this.connectPublic();
    return this.refresh();
  }

  stop() {
    this.running = false;
    clearTimeout(this.privateTimer);
    clearTimeout(this.publicTimer);
    clearInterval(this.pingTimer);
    clearInterval(this.pollTimer);
    clearTimeout(this.watchdogTimer);
    this.closeSocket(this.privateWs);
    this.closeSocket(this.publicWs);
    this.privateWs = null;
    this.publicWs = null;
    this.subscribedSymbols.clear();
    this.positions.clear();
    this.setStatus({ ws: 'idle', rest: 'idle' });
  }

  closeSocket(ws) {
    if (!ws) return;
    ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
    try {
      ws.close();
    } catch {
      /* už je zavřený */
    }
  }

  /**
   * Volat při návratu aplikace do popředí. Android uspaná WS spojení tiše
   * zabíjí, takže se po odemčení telefonu musí stav ověřit a spojení oživit.
   */
  ensureConnected() {
    if (!this.running) return;
    this.refresh();
    if (!this.privateWs || this.privateWs.readyState > WebSocket.OPEN) {
      this.privateAttempt = 0;
      this.connectPrivate();
    }
    if (!this.publicWs || this.publicWs.readyState > WebSocket.OPEN) {
      this.publicAttempt = 0;
      this.connectPublic();
    }
  }

  /** Aplikace hlásí, jestli je v popředí — modul sám na DOM nesahá. */
  setForeground(value) {
    this.foreground = value;
  }

  /** REST poll jako záchranná síť, kdyby WS tiše umřel. */
  startPolling() {
    clearInterval(this.pollTimer);
    this.pollTimer = setInterval(() => {
      if (this.running && this.foreground) this.refresh();
    }, 30000);
  }

  backoffDelay(attempt) {
    // 1s, 2s, 4s… strop 30s, plus jitter ať se obě spojení netrefují naráz.
    return Math.min(30000, 1000 * 2 ** attempt) + Math.random() * 500;
  }

  /* ---------- privátní WebSocket ---------- */

  connectPrivate() {
    if (!this.running || !this.hasCredentials()) return;
    clearTimeout(this.privateTimer);
    this.closeSocket(this.privateWs);
    this.setStatus({ ws: this.privateAttempt === 0 ? 'connecting' : 'reconnecting' });

    let ws;
    try {
      ws = new WebSocket(WS_PRIVATE);
    } catch {
      this.schedulePrivateReconnect();
      return;
    }
    this.privateWs = ws;

    ws.onopen = async () => {
      const expires = this.now() + 10000;
      const sign = await hmacHex(this.apiSecret, `GET/realtime${expires}`);
      ws.send(JSON.stringify({ op: 'auth', args: [this.apiKey, expires, sign] }));
    };

    ws.onmessage = (event) => {
      this.kickWatchdog();
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }

      if (msg.op === 'auth') {
        if (msg.success === false) {
          // WebSocket V5 odpovídá hned v obou konvencích názvů, podle případu.
          const code = msg.retCode ?? msg.ret_code ?? 10004;
          this.emitError(describeError(code, msg.retMsg ?? msg.ret_msg));
          this.setStatus({ ws: 'error' });
          return;
        }
        ws.send(JSON.stringify({ op: 'subscribe', args: ['position'] }));
        return;
      }

      if (msg.op === 'subscribe') {
        if (msg.success !== false) {
          this.privateAttempt = 0;
          this.setStatus({ ws: 'live' });
          this.startPing(ws);
        }
        return;
      }

      if (msg.topic === 'position' && Array.isArray(msg.data)) {
        this.applyPositionPush(msg.data);
      }
    };

    ws.onerror = () => this.setStatus({ ws: 'error' });
    ws.onclose = () => {
      if (this.privateWs === ws) this.schedulePrivateReconnect();
    };
  }

  schedulePrivateReconnect() {
    clearInterval(this.pingTimer);
    clearTimeout(this.watchdogTimer);
    if (!this.running) return;
    this.setStatus({ ws: 'reconnecting' });
    const delay = this.backoffDelay(this.privateAttempt++);
    clearTimeout(this.privateTimer);
    this.privateTimer = setTimeout(() => this.connectPrivate(), delay);
  }

  startPing(ws) {
    clearInterval(this.pingTimer);
    this.pingTimer = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ op: 'ping' }));
    }, 20000);
    this.kickWatchdog();
  }

  /** Když 45 s nepřijde vůbec nic (ani pong), spojení je mrtvé. */
  kickWatchdog() {
    clearTimeout(this.watchdogTimer);
    this.watchdogTimer = setTimeout(() => {
      if (this.running) this.connectPrivate();
    }, 45000);
  }

  applyPositionPush(rows) {
    let changed = false;
    for (const raw of rows) {
      if (raw.category && raw.category !== 'linear') continue;
      if (!String(raw.symbol || '').endsWith('USDT')) continue;

      const p = normalizePosition(raw);
      const key = positionKey(p);
      if (p.size > 0) {
        this.positions.set(key, p);
      } else {
        this.positions.delete(key);
        // Příští pozice na tomhle páru se otevře jindy a funding se jí
        // počítá od začátku.
        this.otevreniCache.delete(p.symbol);
        this.fundingCache.delete(p.symbol);
        this.fundingSoucty.delete(p.symbol);
      }
      changed = true;
    }
    if (changed) {
      this.setStatus({ lastUpdate: Date.now() });
      this.emitPositions();
      this.syncTickerSubscriptions();
    }
  }

  /* ---------- veřejný ticker stream (živá mark cena) ---------- */

  connectPublic() {
    if (!this.running) return;
    clearTimeout(this.publicTimer);
    this.closeSocket(this.publicWs);

    let ws;
    try {
      ws = new WebSocket(WS_PUBLIC_LINEAR);
    } catch {
      this.schedulePublicReconnect();
      return;
    }
    this.publicWs = ws;

    ws.onopen = () => {
      this.publicAttempt = 0;
      this.subscribedSymbols.clear();
      this.syncTickerSubscriptions();
      // Po znovupřipojení obnovit i odběr svíček, jinak by otevřený graf zamrzl.
      if (this.klineTopic) {
        ws.send(JSON.stringify({ op: 'subscribe', args: [this.klineTopic] }));
      }
    };

    ws.onmessage = (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      if (typeof msg.topic !== 'string' || !msg.data) return;

      if (msg.topic.startsWith('tickers.')) {
        this.applyTicker(msg.data);
      } else if (msg.topic === this.klineTopic) {
        this.applyKline(msg.data);
      }
    };

    ws.onerror = () => {};
    ws.onclose = () => {
      if (this.publicWs === ws) this.schedulePublicReconnect();
    };
  }

  schedulePublicReconnect() {
    if (!this.running) return;
    const delay = this.backoffDelay(this.publicAttempt++);
    clearTimeout(this.publicTimer);
    this.publicTimer = setTimeout(() => this.connectPublic(), delay);
  }

  /** Odebírá tickery přesně těch párů, na kterých je otevřená pozice. */
  syncTickerSubscriptions() {
    const ws = this.publicWs;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    const wanted = new Set([...this.positions.values()].map((p) => p.symbol));

    const toAdd = [...wanted].filter((s) => !this.subscribedSymbols.has(s));
    const toRemove = [...this.subscribedSymbols].filter((s) => !wanted.has(s));

    if (toAdd.length) {
      ws.send(JSON.stringify({ op: 'subscribe', args: toAdd.map((s) => `tickers.${s}`) }));
      toAdd.forEach((s) => this.subscribedSymbols.add(s));
    }
    if (toRemove.length) {
      ws.send(JSON.stringify({ op: 'unsubscribe', args: toRemove.map((s) => `tickers.${s}`) }));
      toRemove.forEach((s) => this.subscribedSymbols.delete(s));
    }
  }

  /**
   * Ticker chodí i jako delta, takže markPrice v konkrétní zprávě být nemusí.
   * PnL se dopočítává lokálně — position topic pushuje jen při změně pozice,
   * bez tohohle by čísla mezi obchody stála.
   */
  applyTicker(data) {
    const mark = optionalNum(data.markPrice);
    if (!mark || !data.symbol) return;

    let changed = false;
    for (const p of this.positions.values()) {
      if (p.symbol !== data.symbol || p.mark === mark) continue;
      p.mark = mark;
      p.pnl = recalcPnl(p);
      changed = true;
    }
    if (changed) {
      this.setStatus({ lastUpdate: Date.now() });
      this.emitPositions();
    }
  }

  /**
   * Živá svíčka. Bybit posílá i nepotvrzenou (`confirm: false`), tedy tu
   * rozestavěnou — graf ji překresluje na místě, dokud se neuzavře.
   */
  applyKline(rows) {
    for (const row of rows) {
      this.handlers.onKline?.({
        time: Number(row.start),
        open: num(row.open),
        high: num(row.high),
        low: num(row.low),
        close: num(row.close),
        volume: num(row.volume),
        closed: Boolean(row.confirm),
      });
    }
  }

  /** Ověření klíčů na obrazovce nastavení. */
  async testCredentials(apiKey, apiSecret) {
    const prevKey = this.apiKey;
    const prevSecret = this.apiSecret;
    this.setCredentials(apiKey, apiSecret);
    try {
      await this.syncTime();
      await this.signedGet('/v5/position/list', {
        category: 'linear',
        settleCoin: 'USDT',
        limit: '1',
      });
      return { ok: true };
    } catch (err) {
      this.setCredentials(prevKey, prevSecret);
      return { ok: false, message: err.message || String(err) };
    }
  }
}
